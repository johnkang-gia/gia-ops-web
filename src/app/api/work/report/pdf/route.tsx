import { ensureKoreanFont, pdfDisposition } from "@/lib/pdfFont";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { AppUser, Task, TaskStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/components/work/statusConfig";
import { type ReportPeriodType, getReportRange, parseDateStr, PERIOD_TYPE_LABEL } from "@/lib/reportPeriod";


const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Pretendard", fontSize: 9.5, lineHeight: 1.5, color: "#1a1a1a" },
  title: { fontSize: 19, fontWeight: 700, marginBottom: 3, textAlign: "center" },
  subtitle: { fontSize: 10, color: "#666666", textAlign: "center", marginBottom: 14 },
  summaryRow: { flexDirection: "row", marginBottom: 14, gap: 8 },
  summaryBox: { flex: 1, border: "1pt solid #e2e8f0", borderRadius: 4, padding: 8, alignItems: "center" },
  summaryValue: { fontSize: 15, fontWeight: 700 },
  summaryLabel: { fontSize: 8.5, color: "#64748b", marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 6, marginTop: 10, color: "#1e293b" },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #e2e8f0", paddingVertical: 4 },
  headerRow: { flexDirection: "row", borderBottom: "1pt solid #334155", paddingBottom: 4, marginBottom: 2 },
  headCell: { fontSize: 8.5, fontWeight: 700, color: "#334155" },
  cell: { fontSize: 8.5, color: "#334155" },
  colTime: { width: "16%" },
  colTitle: { width: "34%" },
  colWho: { width: "22%" },
  colNote: { width: "28%" },
  colStatus: { width: "14%" },
  colTitle2: { width: "40%" },
  colWho2: { width: "24%" },
  colDue: { width: "22%" },
  emptyText: { fontSize: 9, color: "#94a3b8", marginTop: 4 },
  pageNumber: { position: "absolute", bottom: 20, right: 40, fontSize: 8, color: "#999999" },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, fontSize: 8, color: "#999999", textAlign: "center" },
});

function fmtDateTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ReportDocument({
  periodType,
  rangeLabel,
  department,
  completed,
  active,
  counts,
  nameByEmail,
}: {
  periodType: ReportPeriodType;
  rangeLabel: string;
  department: string;
  completed: Task[];
  active: Task[];
  counts: Record<TaskStatus, number>;
  nameByEmail: Record<string, string>;
}) {
  const nameOf = (email: string) => nameByEmail[email] ?? email;
  const generatedAt = fmtDateTime(new Date().toISOString());

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{department === "전체" ? "전체" : department} 업무 보고서 ({PERIOD_TYPE_LABEL[periodType]})</Text>
        <Text style={styles.subtitle}>대상 기간: {rangeLabel} · 발행: {generatedAt} · GIA</Text>
        <Text fixed style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        <Text fixed style={styles.footer}>GIA · 업무 보고서</Text>

        <View style={styles.summaryRow}>
          {(["완료", "진행중", "예정", "보류"] as TaskStatus[]).map((s) => (
            <View key={s} style={styles.summaryBox}>
              <Text style={styles.summaryValue}>{counts[s]}</Text>
              <Text style={styles.summaryLabel}>{STATUS_LABEL[s]}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>✅ 이 기간에 완료된 업무 ({completed.length}건)</Text>
        {completed.length === 0 ? (
          <Text style={styles.emptyText}>이 기간에 완료된 업무가 없습니다.</Text>
        ) : (
          <View>
            <View style={styles.headerRow}>
              <Text style={[styles.headCell, styles.colTime]}>완료 일시</Text>
              <Text style={[styles.headCell, styles.colTitle]}>업무</Text>
              <Text style={[styles.headCell, styles.colWho]}>담당/등록</Text>
              <Text style={[styles.headCell, styles.colNote]}>업무결과</Text>
            </View>
            {completed.map((t) => (
              <View key={t.id} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.colTime]}>{fmtDateTime(t.completed_at)}</Text>
                <Text style={[styles.cell, styles.colTitle]}>{t.title}</Text>
                <Text style={[styles.cell, styles.colWho]}>
                  {t.assignee_emails.length ? t.assignee_emails.map(nameOf).join(", ") : nameOf(t.owner_email)}
                </Text>
                <Text style={[styles.cell, styles.colNote]}>{t.resolution_note ?? t.description ?? ""}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>📌 이 기간 진행 중이던 업무 현황 ({active.length}건)</Text>
        {active.length === 0 ? (
          <Text style={styles.emptyText}>이 기간에 진행 중이던 업무가 없습니다.</Text>
        ) : (
          <View>
            <View style={styles.headerRow}>
              <Text style={[styles.headCell, styles.colStatus]}>상태</Text>
              <Text style={[styles.headCell, styles.colTitle2]}>업무</Text>
              <Text style={[styles.headCell, styles.colWho2]}>담당</Text>
              <Text style={[styles.headCell, styles.colDue]}>마감일</Text>
            </View>
            {active.map((t) => (
              <View key={t.id} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.colStatus]}>{STATUS_LABEL[t.status]}</Text>
                <Text style={[styles.cell, styles.colTitle2]}>{t.title}</Text>
                <Text style={[styles.cell, styles.colWho2]}>
                  {t.assignee_emails.length ? t.assignee_emails.map(nameOf).join(", ") : nameOf(t.owner_email)}
                </Text>
                <Text style={[styles.cell, styles.colDue]}>{t.due_at ? t.due_at.slice(0, 10) : "-"}</Text>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (e) {
    // 실패하면 빈 500이 돌아가 화면에 아무것도 안 뜹니다. 이유를 글로 돌려줍니다.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[업무 보고 PDF] 만들지 못했습니다:", e);
    return new Response(`업무 보고 PDF를 만들지 못했습니다.\n\n${msg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function handle(request: Request) {
  ensureKoreanFont();

  const me = await getCurrentAppUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });

  const { searchParams } = new URL(request.url);
  const periodType = (searchParams.get("type") as ReportPeriodType) ?? "day";
  const dateParam = searchParams.get("date");
  const department = searchParams.get("department") || "전체";
  const anchor = dateParam ? parseDateStr(dateParam) : new Date();
  const range = getReportRange(periodType, anchor);

  const supabase = await createClient();
  const [{ data: tasksData }, { data: usersData }] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, case_id, title, description, resolution_note, status, priority, department, owner_email, assignee_emails, due_at, completed_at, archived_at, created_at, updated_at"
      )
      .limit(3000),
    supabase.from("app_users").select("email, name"),
  ]);

  const allTasks = (tasksData as Task[] | null) ?? [];
  const users = (usersData as Pick<AppUser, "email" | "name">[] | null) ?? [];
  const nameByEmail = Object.fromEntries(users.map((u) => [u.email, u.name || u.email]));

  const scoped = department === "전체" ? allTasks : allTasks.filter((t) => t.department === department);

  const completed = scoped
    .filter((t) => t.completed_at && t.completed_at.slice(0, 10) >= range.start && t.completed_at.slice(0, 10) <= range.end)
    .sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? ""));

  const active = scoped
    .filter((t) => t.status !== "완료" && t.created_at.slice(0, 10) <= range.end)
    .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));

  const counts: Record<TaskStatus, number> = { 예정: 0, 진행중: 0, 보류: 0, 완료: completed.length };
  for (const t of active) counts[t.status] += 1;

  const buffer = await renderToBuffer(
    <ReportDocument
      periodType={periodType}
      rangeLabel={range.label}
      department={department}
      completed={completed}
      active={active}
      counts={counts}
      nameByEmail={nameByEmail}
    />
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": pdfDisposition(`업무보고서_${range.start}_${periodType}`),
    },
  });
}
