import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { redirect } from "next/navigation";
import { todayKst, kstDateOffset } from "@/lib/kst";
import ShuttleHistoryClient, { type HistoryRow } from "@/components/shuttle/ShuttleHistoryClient";

// 결석·픽업 이력 조회.
//
// 담당자가 채택: "결석·픽업 이력 조회."
//
// 지금까지는 **오늘만** 볼 수 있었습니다. "이 아이 이번 달에 몇 번 빠졌지?"를 물으면
// 아무도 답을 못 합니다. 기록은 다 쌓여 있는데 꺼내 볼 방법이 없었습니다.
//
// 상담할 때, 학부모가 물어볼 때, 차량 인원을 다시 짤 때 전부 필요한 숫자입니다.
//
// 새로 저장하는 것은 없습니다. 이미 매일 찍히는 하원 체크표(shuttle_boardings)를
// 기간으로 묶어 보여줄 뿐입니다.

export const dynamic = "force-dynamic";

const MAX_DAYS = 120; // 넉 달. 이보다 길게 뽑으면 화면도 조회도 무거워집니다.

export default async function ShuttleHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayKst();
  // 기본은 최근 30일. 사람이 "이번 달"을 물어볼 때 대개 그 정도를 뜻합니다.
  const fromRaw = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : kstDateOffset(-30);
  // 너무 긴 기간은 잘라냅니다. 조용히 자르지 않고 화면에 적습니다.
  const minFrom = new Date(new Date(`${to}T00:00:00Z`).getTime() - MAX_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const from = fromRaw < minFrom ? minFrom : fromRaw;
  const clamped = fromRaw < minFrom;

  const supabase = await createClient();

  // 기간 안의 탑승 기록. 픽업·결석만 세면 될 것 같지만, **전체 대비 몇 번인지**를 알아야
  // 의미가 생깁니다. "3번 빠짐"은 20일 중 3번과 5일 중 3번이 전혀 다른 이야기입니다.
  const { data: boardings, error } = await supabase
    .from("shuttle_boardings")
    .select("assignment_id, status, service_date")
    .gte("service_date", from)
    .lte("service_date", to)
    .limit(20000);

  const rows = (boardings ?? []) as { assignment_id: string; status: string; service_date: string }[];
  const assignmentIds = [...new Set(rows.map((r) => r.assignment_id))];

  const { data: assigns } = assignmentIds.length
    ? await supabase
        .from("shuttle_assignments")
        .select("id, student_id, student_name_raw, stop_id")
        .in("id", assignmentIds)
    : { data: [] };
  const assignList = (assigns ?? []) as {
    id: string;
    student_id: string | null;
    student_name_raw: string;
    stop_id: string;
  }[];
  const assignById = new Map(assignList.map((a) => [a.id, a]));

  // 노선 번호까지 붙입니다. "몇 호차 아이가 자주 빠지나"도 같이 보이게 됩니다.
  const stopIds = [...new Set(assignList.map((a) => a.stop_id))];
  const { data: stops } = stopIds.length
    ? await supabase.from("shuttle_stops").select("id, route_id").in("id", stopIds)
    : { data: [] };
  const stopRoute = new Map(((stops ?? []) as { id: string; route_id: string }[]).map((s) => [s.id, s.route_id]));
  const routeIds = [...new Set([...stopRoute.values()])];
  const { data: routes } = routeIds.length
    ? await supabase.from("shuttle_routes").select("id, route_no, direction").in("id", routeIds)
    : { data: [] };
  const routeById = new Map(
    ((routes ?? []) as { id: string; route_no: string; direction: string }[]).map((r) => [r.id, r])
  );

  // 반·학년은 명부에서. 동명이인을 가르는 데도 씁니다.
  const studentIds = [...new Set(assignList.map((a) => a.student_id).filter((v): v is string => !!v))];
  const { data: students } = studentIds.length
    ? await supabase.from("wr_students").select("id, name, grade, class_name").eq("is_demo", false).in("id", studentIds)
    : { data: [] };
  const studentById = new Map(
    ((students ?? []) as { id: string; name: string; grade: string | null; class_name: string | null }[]).map((s) => [
      s.id,
      s,
    ])
  );

  // 학생 단위로 셉니다. 같은 학생이 여러 배정을 가질 수 있으므로(형제 행선지 선택 등)
  // 배정이 아니라 **학생**으로 묶습니다.
  const byStudent = new Map<string, HistoryRow>();
  for (const b of rows) {
    const a = assignById.get(b.assignment_id);
    if (!a) continue;
    const stu = a.student_id ? studentById.get(a.student_id) : null;
    const key = a.student_id ?? `name:${a.student_name_raw}`;
    const route = routeById.get(stopRoute.get(a.stop_id) ?? "");
    const cur =
      byStudent.get(key) ??
      ({
        key,
        name: stu?.name ?? a.student_name_raw,
        grade: stu?.grade ?? null,
        className: stu?.class_name ?? null,
        routes: [],
        total: 0,
        pickup: 0,
        absent: 0,
        boarded: 0,
        lastPickup: null,
        lastAbsent: null,
      } satisfies HistoryRow);

    cur.total += 1;
    if (b.status === "픽업") {
      cur.pickup += 1;
      if (!cur.lastPickup || b.service_date > cur.lastPickup) cur.lastPickup = b.service_date;
    } else if (b.status === "결석") {
      cur.absent += 1;
      if (!cur.lastAbsent || b.service_date > cur.lastAbsent) cur.lastAbsent = b.service_date;
    } else if (b.status === "탑승") {
      cur.boarded += 1;
    }
    if (route && !cur.routes.includes(route.route_no)) cur.routes.push(route.route_no);
    byStudent.set(key, cur);
  }

  const list = [...byStudent.values()]
    .filter((r) => r.pickup > 0 || r.absent > 0)
    .sort((a, b) => b.absent + b.pickup - (a.absent + a.pickup) || a.name.localeCompare(b.name, "ko"));

  return (
    <ShuttleHistoryClient
      rows={list}
      from={from}
      to={to}
      clamped={clamped}
      maxDays={MAX_DAYS}
      loadError={error?.message ?? null}
    />
  );
}
