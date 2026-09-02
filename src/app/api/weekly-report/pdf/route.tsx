import { ensureKoreanFont } from "@/lib/pdfFont";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { todayKst } from "@/lib/kst";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import type { WrClass, WrReport, WrStudent, WrSubject } from "@/lib/types";
import { BADGE_MAP, EVAL_LABELS, EVAL_CATEGORIES, LEGACY_EVAL_LABELS } from "@/lib/weeklyReport/badges";
import type { EvalCategory, LegacyEvalCategory } from "@/lib/types";


const styles = StyleSheet.create({
  page: { padding: 44, fontFamily: "Pretendard", fontSize: 10, lineHeight: 1.55, color: "#1a1a1a" },
  coverTitle: { fontSize: 22, fontWeight: 700, marginBottom: 4, textAlign: "center" },
  coverSubtitle: { fontSize: 10.5, color: "#666666", textAlign: "center", marginBottom: 16 },
  subjectBlock: { marginBottom: 14, padding: 10, border: "1pt solid #e2e8f0", borderRadius: 4 },
  subjectTitle: { fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: "#1e293b" },
  catRow: { marginBottom: 6 },
  catLabel: { fontSize: 9.5, fontWeight: 700, color: "#475569", marginBottom: 2 },
  catBadges: { flexDirection: "row", marginBottom: 2, gap: 4 },
  badgeChip: { fontSize: 8, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3, marginRight: 4 },
  catText: { fontSize: 9.5, color: "#334155" },
  noteBox: { marginTop: 6, padding: 8, backgroundColor: "#f8fafc", borderRadius: 4 },
  noteLabel: { fontSize: 9, fontWeight: 700, color: "#475569", marginBottom: 3 },
  pageNumber: { position: "absolute", bottom: 20, right: 44, fontSize: 8, color: "#999999" },
  footer: { position: "absolute", bottom: 20, left: 44, right: 44, fontSize: 8, color: "#999999", textAlign: "center" },
});

function ReportDocument({
  student,
  reports,
  termLabel,
}: {
  student: WrStudent;
  reports: WrReport[];
  termLabel?: string | null;
}) {
  const today = todayKst();
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverTitle}>{student.name} 학생 {termLabel ? "학기 종합 리포트" : "주간 리포트"}</Text>
        <Text style={styles.coverSubtitle}>
          {student.grade}학년 {student.class_name} · GIA{termLabel ? ` · ${termLabel}` : ""} · 발행일: {today}
        </Text>
        <Text fixed style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        <Text fixed style={styles.footer}>GIA · 주간 학생 관찰기록</Text>

        {reports.length === 0 && <Text>아직 발행된 리포트가 없습니다.</Text>}
        {reports.map((r) => (
          <View key={r.id} style={styles.subjectBlock} wrap={false}>
            <Text style={styles.subjectTitle}>
              {r.subject} ({r.report_date})
            </Text>
            {EVAL_CATEGORIES.map((cat: EvalCategory) => {
              const value = r[cat];
              const badges = r.eval_badges?.[cat] ?? [];
              if (!value) return null;
              return (
                <View key={cat} style={styles.catRow}>
                  <Text style={styles.catLabel}>{EVAL_LABELS[cat].ko}</Text>
                  <View style={styles.catBadges}>
                    {badges.map((b, idx) => (
                      <Text
                        key={idx}
                        style={[styles.badgeChip, { backgroundColor: BADGE_MAP[b].bg, color: BADGE_MAP[b].color }]}
                      >
                        {BADGE_MAP[b].label}
                      </Text>
                    ))}
                  </View>
                  <Text style={styles.catText}>{value}</Text>
                </View>
              );
            })}
            {/* 항목을 3개로 줄이기 전(학업·보완·참여·태도·교우)에 쓴 기록은 옛 칸에 글이
                남아 있습니다. 새 서식에 없다고 인쇄에서 빼면, 그 학기에 실제로 적힌 관찰이
                종이에서 사라집니다. 있으면 '이전 서식'이라 밝히고 그대로 싣습니다. */}
            {(Object.keys(LEGACY_EVAL_LABELS) as LegacyEvalCategory[]).some((k) => r[k]) && (
              <View style={styles.noteBox}>
                <Text style={styles.noteLabel}>이전 서식(5항목)에 적힌 내용</Text>
                {(Object.keys(LEGACY_EVAL_LABELS) as LegacyEvalCategory[]).map((k) =>
                  r[k] ? (
                    <Text key={k} style={styles.catText}>
                      {LEGACY_EVAL_LABELS[k].ko}: {r[k]}
                    </Text>
                  ) : null
                )}
              </View>
            )}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function GET(request: Request) {
  ensureKoreanFont();

  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get("studentId");
  if (!studentId) return new Response("studentId가 필요합니다.", { status: 400 });
  // mode=term이면 학기말 종합 PDF - 과목별 최신 1건이 아니라, 그 학기 동안 발행된 모든
  // 리포트를 과목별로 묶어 시간순(오래된 것→최신 순)으로 전부 보여줍니다(요청).
  const termId = searchParams.get("termId");
  const isTermMode = searchParams.get("mode") === "term" && !!termId;

  const [{ data: student }, { data: reportsData }, termRow] = await Promise.all([
    supabase.from("wr_students_basic").select("*").eq("id", studentId).maybeSingle(),
    supabase
      .from("wr_reports")
      .select("*")
      .eq("student_id", studentId)
      .eq("status", "published")
      .then((res) => res),
    isTermMode ? supabase.from("terms").select("*").eq("id", termId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!student) return new Response("학생을 찾을 수 없습니다.", { status: 404 });

  // /weekly-report/students/[id]와 동일한 기준으로, 교사는 자기 담임반/담당과목 학생 PDF만
  // 출력할 수 있게 막습니다(예전에는 studentId만 알면 아무 학생이나 출력 가능했습니다).
  if (isTeacherOnly(me)) {
    const s = student as WrStudent;
    const [{ data: ownClasses }, { data: ownSubjects }] = await Promise.all([
      s.class_id
        ? supabase
            .from("wr_classes")
            .select("id").eq("is_demo", isDemoAccount(me.email))
            .eq("id", s.class_id)
            .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
        : Promise.resolve({ data: [] as WrClass[] }),
      supabase.from("wr_subjects").select("id, student_ids").eq("teacher_email", me.email),
    ]);
    const ownsViaClass = (ownClasses?.length ?? 0) > 0;
    const ownsViaSubject = ((ownSubjects as WrSubject[] | null) ?? []).some((sub) => sub.student_ids?.includes(studentId));
    if (!ownsViaClass && !ownsViaSubject) return new Response("접근 권한이 없습니다.", { status: 403 });
  }

  const allReports = ((reportsData as WrReport[] | null) ?? []).filter((r) => !isTermMode || r.term_id === termId);

  let finalReports: WrReport[];
  let termLabel: string | null = null;
  let filenameSuffix = "weekly_report";

  if (isTermMode) {
    // 과목별로 묶은 뒤 오래된 순으로 정렬 - 한 학기 동안의 변화 흐름을 그대로 보여줍니다.
    const bySubject = new Map<string, WrReport[]>();
    for (const r of allReports) {
      const list = bySubject.get(r.subject) ?? [];
      list.push(r);
      bySubject.set(r.subject, list);
    }
    finalReports = [...bySubject.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .flatMap(([, list]) => list.sort((a, b) => a.report_date.localeCompare(b.report_date)));
    const term = termRow.data as { term_type: string; year: string } | null;
    termLabel = term ? `${term.year} ${term.term_type}` : "학기 종합";
    filenameSuffix = "term_report";
  } else {
    // 기본 모드: 과목별 가장 최근 발행본 하나씩만 사용합니다.
    const latestBySubject = new Map<string, WrReport>();
    for (const r of allReports.sort((a, b) => b.report_date.localeCompare(a.report_date))) {
      if (!latestBySubject.has(r.subject)) latestBySubject.set(r.subject, r);
    }
    finalReports = [...latestBySubject.values()];
  }

  const buffer = await renderToBuffer(
    <ReportDocument student={student as WrStudent} reports={finalReports} termLabel={termLabel} />
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${(student as WrStudent).name}_${filenameSuffix}.pdf"`,
    },
  });
}
