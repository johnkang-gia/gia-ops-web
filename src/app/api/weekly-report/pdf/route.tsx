import path from "node:path";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import type { WrReport, WrStudent } from "@/lib/types";
import { BADGE_MAP, EVAL_LABELS, EVAL_CATEGORIES } from "@/lib/weeklyReport/badges";
import type { EvalCategory } from "@/lib/types";

const FONT_DIR = path.join(process.cwd(), "src/assets/fonts");
let fontRegistered = false;
function ensureFontRegistered() {
  if (fontRegistered) return;
  Font.register({
    family: "Pretendard",
    fonts: [
      { src: path.join(FONT_DIR, "Pretendard-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Pretendard-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontRegistered = true;
}

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

function ReportDocument({ student, reports }: { student: WrStudent; reports: WrReport[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverTitle}>{student.name} 학생 주간 리포트</Text>
        <Text style={styles.coverSubtitle}>
          {student.grade}학년 {student.class_name} · GIA · 발행일: {today}
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
            {r.teacher_note && (
              <View style={styles.noteBox}>
                <Text style={styles.noteLabel}>교사 종합 의견</Text>
                <Text style={styles.catText}>{r.teacher_note}</Text>
              </View>
            )}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function GET(request: Request) {
  ensureFontRegistered();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get("studentId");
  if (!studentId) return new Response("studentId가 필요합니다.", { status: 400 });

  const [{ data: student }, { data: reportsData }] = await Promise.all([
    supabase.from("wr_students").select("*").eq("id", studentId).maybeSingle(),
    supabase
      .from("wr_reports")
      .select("*")
      .eq("student_id", studentId)
      .eq("status", "published")
      .order("report_date", { ascending: false }),
  ]);
  if (!student) return new Response("학생을 찾을 수 없습니다.", { status: 404 });

  // 과목별 가장 최근 발행본 하나씩만 사용합니다.
  const latestBySubject = new Map<string, WrReport>();
  for (const r of (reportsData as WrReport[] | null) ?? []) {
    if (!latestBySubject.has(r.subject)) latestBySubject.set(r.subject, r);
  }

  const buffer = await renderToBuffer(
    <ReportDocument student={student as WrStudent} reports={[...latestBySubject.values()]} />
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${(student as WrStudent).name}_weekly_report.pdf"`,
    },
  });
}
