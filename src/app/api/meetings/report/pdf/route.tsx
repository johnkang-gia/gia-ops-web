import path from "node:path";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import type { Meeting } from "@/lib/types";
import { type ReportPeriodType, getReportRange, parseDateStr, PERIOD_TYPE_LABEL } from "@/lib/reportPeriod";

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
  page: { padding: 40, fontFamily: "Pretendard", fontSize: 9.5, lineHeight: 1.5, color: "#1a1a1a" },
  title: { fontSize: 19, fontWeight: 700, marginBottom: 3, textAlign: "center" },
  subtitle: { fontSize: 10, color: "#666666", textAlign: "center", marginBottom: 16 },
  block: { marginBottom: 12, padding: 9, border: "1pt solid #e2e8f0", borderRadius: 4 },
  blockHeader: { flexDirection: "row", marginBottom: 4, alignItems: "center" },
  dateText: { fontSize: 11, fontWeight: 700, color: "#1e293b" },
  attendeesText: { fontSize: 8.5, color: "#64748b", marginLeft: 8 },
  statusChip: { fontSize: 7.5, color: "#64748b", marginLeft: "auto", backgroundColor: "#f1f5f9", paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 3 },
  bodyText: { fontSize: 9, color: "#334155" },
  agendaText: { fontSize: 8.5, color: "#2563eb", marginTop: 4 },
  emptyText: { fontSize: 9, color: "#94a3b8" },
  pageNumber: { position: "absolute", bottom: 20, right: 40, fontSize: 8, color: "#999999" },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, fontSize: 8, color: "#999999", textAlign: "center" },
});

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ReportDocument({
  periodType,
  rangeLabel,
  meetings,
}: {
  periodType: ReportPeriodType;
  rangeLabel: string;
  meetings: Meeting[];
}) {
  const generatedAt = fmtDateTime(new Date().toISOString());
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>회의 보고서 ({PERIOD_TYPE_LABEL[periodType]})</Text>
        <Text style={styles.subtitle}>대상 기간: {rangeLabel} · 발행: {generatedAt} · GIA</Text>
        <Text fixed style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        <Text fixed style={styles.footer}>GIA · 회의 보고서</Text>

        {meetings.length === 0 && <Text style={styles.emptyText}>이 기간에 기록된 회의가 없습니다.</Text>}
        {meetings.map((m) => (
          <View key={m.id} style={styles.block} wrap={false}>
            <View style={styles.blockHeader}>
              <Text style={styles.dateText}>{m.date}</Text>
              {m.attendees && <Text style={styles.attendeesText}>참석: {m.attendees}</Text>}
              {m.status && <Text style={styles.statusChip}>{m.status}</Text>}
            </View>
            <Text style={styles.bodyText}>{m.final_record || m.content || "(내용 없음)"}</Text>
            {m.next_agenda && <Text style={styles.agendaText}>다음 안건: {m.next_agenda}</Text>}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function GET(request: Request) {
  ensureFontRegistered();

  const me = await getCurrentAppUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });

  const { searchParams } = new URL(request.url);
  const periodType = (searchParams.get("type") as ReportPeriodType) ?? "day";
  const dateParam = searchParams.get("date");
  const anchor = dateParam ? parseDateStr(dateParam) : new Date();
  const range = getReportRange(periodType, anchor);

  const supabase = await createClient();
  const { data } = await supabase
    .from("meetings")
    .select("id, case_id, date, attendees, content, status, next_agenda, final_record, created_at")
    .gte("date", range.start)
    .lte("date", range.end)
    .order("date", { ascending: true });

  const meetings = (data as Meeting[] | null) ?? [];

  const buffer = await renderToBuffer(<ReportDocument periodType={periodType} rangeLabel={range.label} meetings={meetings} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="회의보고서_${range.start}_${periodType}.pdf"`,
    },
  });
}
