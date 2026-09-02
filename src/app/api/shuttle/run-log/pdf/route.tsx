import { ensureKoreanFont, pdfDisposition } from "@/lib/pdfFont";
import { todayKst } from "@/lib/kst";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";


const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const SAFETY_PENALTY_PER_EVENT = 5;

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Pretendard", fontSize: 9.5, lineHeight: 1.5, color: "#1a1a1a" },
  title: { fontSize: 19, fontWeight: 700, marginBottom: 3, textAlign: "center" },
  subtitle: { fontSize: 10, color: "#666666", textAlign: "center", marginBottom: 14 },
  summaryRow: { flexDirection: "row", marginBottom: 14, gap: 8 },
  summaryBox: { flex: 1, border: "1pt solid #e2e8f0", borderRadius: 4, padding: 8, alignItems: "center" },
  summaryValue: { fontSize: 14, fontWeight: 700 },
  summaryLabel: { fontSize: 8.5, color: "#64748b", marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 6, marginTop: 10, color: "#1e293b" },
  infoRow: { flexDirection: "row", marginBottom: 2 },
  infoLabel: { width: "22%", fontSize: 9, color: "#64748b" },
  infoValue: { width: "78%", fontSize: 9, color: "#1a1a1a" },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #e2e8f0", paddingVertical: 4 },
  headerRow: { flexDirection: "row", borderBottom: "1pt solid #334155", paddingBottom: 4, marginBottom: 2 },
  headCell: { fontSize: 8.5, fontWeight: 700, color: "#334155" },
  cell: { fontSize: 8.5, color: "#334155" },
  colSeq: { width: "10%" },
  colTime: { width: "18%" },
  colName: { width: "34%" },
  colStatus: { width: "20%" },
  colAlight: { width: "18%" },
  emptyText: { fontSize: 9, color: "#94a3b8", marginTop: 4 },
  pageNumber: { position: "absolute", bottom: 20, right: 40, fontSize: 8, color: "#999999" },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, fontSize: 8, color: "#999999", textAlign: "center" },
});

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

type RouteInfo = {
  route_no: string;
  direction: string;
  name: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_no: string | null;
  teacher_name: string | null;
  teacher_phone: string | null;
};

type RosterRow = {
  stopSeq: number;
  stopTime: string | null;
  studentName: string;
  status: string;
  alighted: boolean;
};

function RunLogDocument({
  route,
  date,
  weekdayLabel,
  departedAt,
  fivMinAt,
  arrivedAt,
  durationMin,
  roster,
  accelCount,
  decelCount,
  safetyScore,
  boardCounts,
}: {
  route: RouteInfo;
  date: string;
  weekdayLabel: string;
  departedAt: string | null;
  fivMinAt: string | null;
  arrivedAt: string | null;
  durationMin: number | null;
  roster: RosterRow[];
  accelCount: number;
  decelCount: number;
  safetyScore: number;
  boardCounts: Record<string, number>;
}) {
  const generatedAt = fmtTime(new Date().toISOString()) + " 발행";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>
          {route.direction} {route.route_no}호차 운행일지
        </Text>
        <Text style={styles.subtitle}>
          {date} ({weekdayLabel}) · {generatedAt} · GIA
        </Text>
        <Text fixed style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        <Text fixed style={styles.footer}>GIA · 셔틀 운행일지 (3단계-a 자동생성)</Text>

        <View style={{ marginBottom: 10 }}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>노선</Text>
            <Text style={styles.infoValue}>
              {route.direction} {route.route_no}호차 {route.name ?? ""}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>기사님</Text>
            <Text style={styles.infoValue}>
              {route.driver_name ?? "-"} {route.driver_phone ? `(${route.driver_phone})` : ""}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>동승선생님</Text>
            <Text style={styles.infoValue}>
              {route.teacher_name ?? "-"} {route.teacher_phone ? `(${route.teacher_phone})` : ""}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>차량번호</Text>
            <Text style={styles.infoValue}>{route.vehicle_no ?? "-"}</Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryValue}>{fmtTime(departedAt)}</Text>
            <Text style={styles.summaryLabel}>출발</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryValue}>{fmtTime(fivMinAt)}</Text>
            <Text style={styles.summaryLabel}>5분전 알림</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryValue}>{fmtTime(arrivedAt)}</Text>
            <Text style={styles.summaryLabel}>도착</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryValue}>{durationMin != null ? `${durationMin}분` : "-"}</Text>
            <Text style={styles.summaryLabel}>소요시간</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryValue}>{safetyScore}점</Text>
            <Text style={styles.summaryLabel}>안전운행지수(급가속{accelCount}·급감속{decelCount})</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>
          🚌 탑승현황 (전체 {roster.length}명 · 탑승 {boardCounts["탑승"] ?? 0} · 결석 {boardCounts["결석"] ?? 0} · 미탑승 {boardCounts["미탑승"] ?? 0} ·
          픽업 {boardCounts["픽업"] ?? 0})
        </Text>
        {roster.length === 0 ? (
          <Text style={styles.emptyText}>오늘 이 노선에 배정된 학생이 없습니다.</Text>
        ) : (
          <View>
            <View style={styles.headerRow}>
              <Text style={[styles.headCell, styles.colSeq]}>순번</Text>
              <Text style={[styles.headCell, styles.colTime]}>정류장 시각</Text>
              <Text style={[styles.headCell, styles.colName]}>학생</Text>
              <Text style={[styles.headCell, styles.colStatus]}>탑승 상태</Text>
              <Text style={[styles.headCell, styles.colAlight]}>하차</Text>
            </View>
            {roster.map((r, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.colSeq]}>{r.stopSeq}</Text>
                <Text style={[styles.cell, styles.colTime]}>{r.stopTime ?? "-"}</Text>
                <Text style={[styles.cell, styles.colName]}>{r.studentName}</Text>
                <Text style={[styles.cell, styles.colStatus]}>{r.status}</Text>
                <Text style={[styles.cell, styles.colAlight]}>{r.alighted ? "하차완료" : "-"}</Text>
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
    // 예전에는 여기서 터지면 **빈 500**이 돌아와, 화면에는 아무것도 안 뜨고 이유도 알 수
    // 없었습니다(담당자: "오늘 운행일지 아예 페이지 안나와").
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[운행일지] 만들지 못했습니다:", e);
    return new Response(`운행일지를 만들지 못했습니다.\n\n${msg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function handle(request: Request) {
  ensureKoreanFont();

  const me = await getCurrentAppUser();
  if (!me || !isAdminUser(me)) return new Response("권한이 없습니다.", { status: 403 });

  const { searchParams } = new URL(request.url);
  const routeId = searchParams.get("routeId");
  const date = searchParams.get("date") || todayKst();
  if (!routeId) return new Response("routeId가 필요합니다.", { status: 400 });

  const supabase = await createClient();

  const { data: routeData } = await supabase
    .from("shuttle_routes")
    .select("route_no, direction, name, driver_name, driver_phone, vehicle_no, teacher_name, teacher_phone")
    .eq("id", routeId)
    .maybeSingle();
  if (!routeData) return new Response("노선을 찾을 수 없습니다.", { status: 404 });

  const [{ data: eventsData }, { data: stopsData }, { data: safetyData }] = await Promise.all([
    supabase.from("shuttle_run_events").select("event, created_at").eq("route_id", routeId).eq("service_date", date).order("created_at"),
    supabase.from("shuttle_stops").select("id, seq, stop_time").eq("route_id", routeId).order("seq"),
    supabase.from("shuttle_safety_events").select("event_type").eq("route_id", routeId).eq("service_date", date),
  ]);

  const stops = stopsData ?? [];
  const stopIds = stops.map((s) => s.id);
  // 그 날짜의 요일(1=월...5=금)에 해당하는 배정만 - 실제 체크인 화면과 같은 필터 기준입니다.
  const weekday = new Date(`${date}T00:00:00`).getDay();

  let roster: RosterRow[] = [];
  const boardCounts: Record<string, number> = {};
  if (stopIds.length > 0) {
    const { data: assignments } = await supabase
      .from("shuttle_assignments")
      .select("id, stop_id, student_name_raw, weekdays")
      .in("stop_id", stopIds);
    const relevant = (assignments ?? []).filter((a) => (a.weekdays as number[]).includes(weekday));

    const { data: boardings } = relevant.length
      ? await supabase
          .from("shuttle_boardings")
          .select("assignment_id, status, alighted_at")
          .eq("service_date", date)
          .in("assignment_id", relevant.map((a) => a.id))
      : { data: [] };
    const boardingByAssignment = new Map((boardings ?? []).map((b) => [b.assignment_id, b]));
    const stopById = new Map(stops.map((s) => [s.id, s]));

    roster = relevant
      .map((a) => {
        const stop = stopById.get(a.stop_id);
        const b = boardingByAssignment.get(a.id);
        const status = (b?.status as string) ?? "예정";
        boardCounts[status] = (boardCounts[status] ?? 0) + 1;
        return {
          stopSeq: stop?.seq ?? 0,
          stopTime: stop?.stop_time ?? null,
          studentName: a.student_name_raw as string,
          status,
          alighted: !!b?.alighted_at,
        };
      })
      .sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));
  }

  const events = eventsData ?? [];
  const departEvent = events.find((e) => e.event === "출발");
  const fiveMinEvent = events.find((e) => e.event === "5분전");
  const arriveEvent = [...events].reverse().find((e) => e.event === "도착");
  const durationMin =
    departEvent && arriveEvent
      ? Math.round((new Date(arriveEvent.created_at).getTime() - new Date(departEvent.created_at).getTime()) / 60000)
      : null;

  const safety = safetyData ?? [];
  const accelCount = safety.filter((s) => s.event_type === "급가속").length;
  const decelCount = safety.filter((s) => s.event_type === "급감속").length;
  const safetyScore = Math.max(0, 100 - (accelCount + decelCount) * SAFETY_PENALTY_PER_EVENT);

  const weekdayLabel = WEEKDAY_KO[new Date(`${date}T00:00:00`).getDay()];

  const buffer = await renderToBuffer(
    <RunLogDocument
      route={routeData as RouteInfo}
      date={date}
      weekdayLabel={weekdayLabel}
      departedAt={departEvent?.created_at ?? null}
      fivMinAt={fiveMinEvent?.created_at ?? null}
      arrivedAt={arriveEvent?.created_at ?? null}
      durationMin={durationMin}
      roster={roster}
      accelCount={accelCount}
      decelCount={decelCount}
      safetyScore={safetyScore}
      boardCounts={boardCounts}
    />
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": pdfDisposition(`운행일지_${routeData.route_no}호_${date}`),
    },
  });
}
