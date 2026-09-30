import type { SupabaseClient } from "@supabase/supabase-js";

// 데이터가 앞뒤가 맞는지 확인합니다.
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
  //
  // **여덟 검사를 한 번에 나란히 묻습니다.** 예전에는 노선 → 정류장 → 배정 → 선택지 →
  // 픽업 → 특이사항을 **차례로** 물었습니다. 앞의 답으로 다음 조회의 `in(...)` 목록을
  // 만들었기 때문인데, 그러면 여섯 번의 왕복이 그대로 쌓입니다 - 이 함수 하나가 진단
  // 화면의 5.6초 중 절반을 먹고 있었습니다.
  //
  // 좁힐 목록을 기다리지 않고 **표를 통째로 받아 메모리에서 거릅니다.** 노선 수십 개,
  // 정류장·배정 각 수백 줄이라 한 번에 받아도 됩니다. 진단 화면도 정류장은 이미 이렇게
  // 하고 있었고, 여기만 옛 방식이 남아 있었습니다.
  const [routesRes, stopsRes, assignsRes, pickupRes, notesRes] = await Promise.all([
    supabase.from("shuttle_routes").select("id, route_no, direction, term").eq("active", true),
    supabase.from("shuttle_stops").select("id, route_id, address, lat, lng, seq"),
    // `choice_label` 을 여기서 함께 받습니다. 예전에는 선택지 이름만 따로 한 번 더
    // 물었는데, 그 조회는 **쓰는 노선으로 좁히지 않아** 지난 학기 줄까지 셌습니다 -
    // 같은 표를 두 번 묻느라 왕복이 늘고 답도 달랐습니다.
    supabase.from("shuttle_assignments").select("id, stop_id, student_id, student_name_raw, choice_group, choice_label"),
    // ⑦ 확정 픽업인데 학생이 안 붙은 것 - 크론이 '실패'로 넘깁니다.
    supabase
      .from("pickup_requests")
      .select("id, ai_student_name, matched_name, service_date")
      .eq("kind", "픽업")
      .eq("status", "확정")
      .is("student_id", null)
      .gte("service_date", new Date(Date.now() - 30 * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }))
      .limit(50),
    // ⑧ 지속 특이사항 중 학생이 안 붙은 것
    supabase
      .from("shuttle_persistent_notes")
      .select("id, student_name, content")
      .eq("active", true)
      .is("student_id", null)
      .limit(50),
  ]);

  const routeList = (routesRes.data ?? []) as { id: string; route_no: string; direction: string; term: string }[];
  const routeById = new Map(routeList.map((r) => [r.id, r]));

  // 쓰는 노선(active)의 정류장만 봅니다. 예전에 `in(route_id, ...)` 로 걸던 것과 같은
  // 범위입니다 - 좁히는 자리만 DB 에서 메모리로 옮겼습니다.
  const stopList = (
    (stopsRes.data ?? []) as {
      id: string;
      route_id: string;
      address: string | null;
      lat: number | null;
      lng: number | null;
      seq: number;
    }[]
  ).filter((s) => routeById.has(s.route_id));
  const stopById = new Map(stopList.map((s) => [s.id, s]));

  const assignList = (
    (assignsRes.data ?? []) as {
      id: string;
      stop_id: string;
      student_id: string | null;
      student_name_raw: string;
      choice_group: string | null;
      choice_label: string | null;
    }[]
  ).filter((a) => stopById.has(a.stop_id));

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
  const missingLabel = assignList.filter((a) => a.choice_group && !a.choice_label);
  issues.push({
    label: "이름 없는 행선지 선택지",
    count: missingLabel.length,
    why: "화면에 '7호?'처럼 뜹니다. 무엇인지 모르는 채로 눌리면 그 차에 태워집니다.",
    samples: missingLabel.slice(0, SAMPLE_MAX).map((r) => r.student_name_raw),
    href: "/shuttle/students",
    severity: "low",
  });

  // ── 픽업 ────────────────────────────────────────────────────────────────
  // ⑦ 위 묶음에서 함께 받았습니다.
  const pns = (pickupRes.data ?? []) as {
    ai_student_name: string | null;
    matched_name: string | null;
    service_date: string;
  }[];
  issues.push({
    label: "학생 없는 확정 픽업",
    count: pns.length,
    why: "픽업으로 확정됐지만 어느 학생인지 안 붙어 있어, 그날 체크표에 아무것도 안 찍힙니다.",
    samples: pns.slice(0, SAMPLE_MAX).map((r) => `${r.matched_name ?? r.ai_student_name ?? "이름 없음"} (${r.service_date})`),
    href: "/pickup/inbox",
    severity: "high",
  });

  // ⑧ 위 묶음에서 함께 받았습니다.
  const nn = (notesRes.data ?? []) as { student_name: string | null; content: string }[];
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
