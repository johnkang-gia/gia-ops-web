import type { SupabaseClient } from "@supabase/supabase-js";

// 데이터가 앞뒤가 맞는지 확인합니다.
//
// 담당자: "중복되는 기능이나 중복으로 적용되는 것들 보고 통합해주고 (...) 데이터 무결성."
//
// 왜 필요한지는 이번 주에 다 겪었습니다.
//   · 같은 아이가 두 노선에 배정돼 **양쪽 다 '탄다'로 보였습니다.** 두 기사님이 서로
//     상대가 태웠겠거니 하면 아무도 안 태웁니다.
//   · 정류장에 좌표가 없어 GPS 도착이 영영 안 찍혔습니다.
//   · 정류장에 주소가 없어 기사님이 어디서 내릴지 알 수 없었습니다.
//   · 학생이 안 붙은 픽업 예약은 크론이 조용히 건너뜁니다.
//
// 하나같이 **화면에서는 멀쩡해 보이는데 실제로는 틀린** 것들입니다. 그래서 사고가 나거나
// 누가 이상하다고 말하기 전까지 아무도 모릅니다. 미리 세어두면 그 전에 잡힙니다.
//
// 여기서 고치지는 않습니다. 세고, 무엇이 문제인지 말하고, 고치러 갈 곳을 알려줍니다.
// 자동으로 고치면 "왜 바뀌었지"를 또 찾아야 합니다.

export type Issue = {
  /** 사람이 읽는 문제 이름. */
  label: string;
  /** 몇 건인지. 0이면 정상입니다. */
  count: number;
  /** 왜 문제인지 - 고쳐야 하는 이유. */
  why: string;
  /** 대표 사례 몇 개(이름 등). 전부 쏟지 않습니다. */
  samples: string[];
  /** 고치러 갈 화면. */
  href?: string;
  /** 있어도 당장 위험하지 않은 것은 노랑, 태우고 못 태우는 문제는 빨강. */
  severity: "high" | "low";
};

const SAMPLE_MAX = 6;

export async function runIntegrityChecks(supabase: SupabaseClient): Promise<Issue[]> {
  const issues: Issue[] = [];

  // ── 셔틀 노선·정류장·배정 ──────────────────────────────────────────────
  const { data: routes } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, direction, term")
    .eq("active", true);
  const routeList = (routes ?? []) as { id: string; route_no: string; direction: string; term: string }[];
  const routeIds = routeList.map((r) => r.id);
  const routeById = new Map(routeList.map((r) => [r.id, r]));

  const { data: stops } = routeIds.length
    ? await supabase.from("shuttle_stops").select("id, route_id, address, lat, lng, seq").in("route_id", routeIds)
    : { data: [] };
  const stopList = (stops ?? []) as {
    id: string;
    route_id: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    seq: number;
  }[];
  const stopById = new Map(stopList.map((s) => [s.id, s]));

  const stopIds = stopList.map((s) => s.id);
  const { data: assigns } = stopIds.length
    ? await supabase
        .from("shuttle_assignments")
        .select("id, stop_id, student_id, student_name_raw, choice_group")
        .in("stop_id", stopIds)
    : { data: [] };
  const assignList = (assigns ?? []) as {
    id: string;
    stop_id: string;
    student_id: string | null;
    student_name_raw: string;
    choice_group: string | null;
  }[];

  // ① 같은 학생이 같은 방향에서 두 노선 이상에 배정
  //
  // 행선지를 그날 고르는 학생(choice_group)은 일부러 그렇게 둔 것이라 뺍니다.
  const byStudentDir = new Map<string, Set<string>>();
  for (const a of assignList) {
    if (a.choice_group) continue;
    const stop = stopById.get(a.stop_id);
    const route = stop ? routeById.get(stop.route_id) : null;
    if (!route) continue;
    const key = `${a.student_name_raw}|${route.direction}|${route.term}`;
    const set = byStudentDir.get(key) ?? new Set<string>();
    set.add(route.route_no);
    byStudentDir.set(key, set);
  }
  const dupes = [...byStudentDir.entries()].filter(([, set]) => set.size > 1);
  issues.push({
    label: "같은 학생이 두 노선에",
    count: dupes.length,
    why: "양쪽 다 '탄다'로 보입니다. 두 기사님이 서로 상대가 태웠겠거니 하면 아무도 안 태웁니다.",
    samples: dupes.slice(0, SAMPLE_MAX).map(([k, set]) => `${k.split("|")[0]} (${[...set].join("·")}호)`),
    href: "/shuttle/students",
    severity: "high",
  });

  // ② 좌표 없는 정류장 - GPS 도착이 영영 안 찍힙니다.
  const noCoord = stopList.filter((s) => s.lat == null || s.lng == null);
  issues.push({
    label: "좌표 없는 정류장",
    count: noCoord.length,
    why: "아무리 가까이 가도 GPS 도착이 안 잡힙니다.",
    samples: noCoord.slice(0, SAMPLE_MAX).map((s) => `${routeById.get(s.route_id)?.route_no ?? "?"}호 ${s.address ?? "(주소 없음)"}`),
    href: "/shuttle/routes",
    severity: "low",
  });

  // ③ 주소 없는 정류장 - 기사님이 어디서 내릴지 모릅니다.
  const noAddr = stopList.filter((s) => !s.address || !s.address.trim());
  issues.push({
    label: "주소 없는 정류장",
    count: noAddr.length,
    why: "기사님이 어디서 내려줘야 하는지 알 수 없습니다.",
    samples: noAddr.slice(0, SAMPLE_MAX).map((s) => `${routeById.get(s.route_id)?.route_no ?? "?"}호 ${s.seq}번`),
    href: "/shuttle/routes",
    severity: "high",
  });

  // ④ 명부에 연결 안 된 배정 - 픽업·결석 자동 처리가 이 학생만 건너뜁니다.
  const noStudent = assignList.filter((a) => !a.student_id);
  issues.push({
    label: "명부에 연결 안 된 배정",
    count: noStudent.length,
    why: "픽업·결석 자동 반영이 이 학생만 조용히 건너뜁니다.",
    samples: noStudent.slice(0, SAMPLE_MAX).map((a) => a.student_name_raw),
    href: "/shuttle/students",
    severity: "high",
  });

  // ⑤ 정류장이 없는 활성 노선 - 명단에 아무도 안 뜹니다.
  const stopCountByRoute = new Map<string, number>();
  for (const s of stopList) stopCountByRoute.set(s.route_id, (stopCountByRoute.get(s.route_id) ?? 0) + 1);
  const emptyRoutes = routeList.filter((r) => (stopCountByRoute.get(r.id) ?? 0) === 0);
  issues.push({
    label: "정류장이 없는 노선",
    count: emptyRoutes.length,
    why: "쓰는 노선으로 켜져 있는데 정류장이 없어, 명단에 아무도 안 뜹니다.",
    samples: emptyRoutes.slice(0, SAMPLE_MAX).map((r) => `${r.route_no}호 ${r.direction} (${r.term})`),
    href: "/shuttle/routes",
    severity: "low",
  });

  // ⑥ 행선지 선택 학생 중 버튼 이름이 없는 줄
  const noLabel = assignList.filter((a) => a.choice_group);
  const { data: labelRows } = noLabel.length
    ? await supabase.from("shuttle_assignments").select("id, student_name_raw, choice_label").not("choice_group", "is", null)
    : { data: [] };
  const missingLabel = ((labelRows ?? []) as { student_name_raw: string; choice_label: string | null }[]).filter(
    (r) => !r.choice_label
  );
  issues.push({
    label: "이름 없는 행선지 선택지",
    count: missingLabel.length,
    why: "화면에 '7호?'처럼 뜹니다. 무엇인지 모르는 채로 눌리면 그 차에 태워집니다.",
    samples: missingLabel.slice(0, SAMPLE_MAX).map((r) => r.student_name_raw),
    href: "/shuttle/students",
    severity: "low",
  });

  // ── 픽업 ────────────────────────────────────────────────────────────────
  // ⑦ 확정 픽업인데 학생이 안 붙은 것 - 크론이 '실패'로 넘깁니다.
  const { data: pickupNoStudent } = await supabase
    .from("pickup_requests")
    .select("id, ai_student_name, matched_name, service_date")
    .eq("kind", "픽업")
    .eq("status", "확정")
    .is("student_id", null)
    .gte("service_date", new Date(Date.now() - 30 * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }))
    .limit(50);
  const pns = (pickupNoStudent ?? []) as { ai_student_name: string | null; matched_name: string | null; service_date: string }[];
  issues.push({
    label: "학생 없는 확정 픽업",
    count: pns.length,
    why: "픽업으로 확정됐지만 어느 학생인지 안 붙어 있어, 그날 체크표에 아무것도 안 찍힙니다.",
    samples: pns.slice(0, SAMPLE_MAX).map((r) => `${r.matched_name ?? r.ai_student_name ?? "이름 없음"} (${r.service_date})`),
    href: "/pickup/inbox",
    severity: "high",
  });

  // ⑧ 지속 특이사항 중 학생이 안 붙은 것
  const { data: notes } = await supabase
    .from("shuttle_persistent_notes")
    .select("id, student_name, content")
    .eq("active", true)
    .is("student_id", null)
    .limit(50);
  const nn = (notes ?? []) as { student_name: string | null; content: string }[];
  issues.push({
    label: "학생 없는 지속 특이사항",
    count: nn.length,
    why: "매일 아침 크론이 읽지만 학생을 못 찾아 아무 일도 하지 않습니다.",
    samples: nn.slice(0, SAMPLE_MAX).map((r) => `${r.student_name ?? "?"} · ${r.content.slice(0, 20)}`),
    href: "/shuttle/checklist",
    severity: "high",
  });

  return issues;
}
