import { haversineMeters } from "@/lib/shuttleRecommend";

/**
 * **정류장 좌표 학습** — 실제 주행 GPS에서 「차가 매일 서는 자리」를 찾아내는 계산입니다.
 *
 * ── 왜 라이브러리로 뺐나 ────────────────────────────────────────────────────
 *
 * 이 계산이 크론 라우트 안에만 있어서, 화면은 **결과 숫자만** 볼 수 있고 「왜 이 정류장은
 * 학습이 안 됐는가」는 어디에도 안 남았습니다. 실제로 정류장 656곳 중 2곳만 학습된 상태로
 * 몇 주가 지났는데, 화면에는 학습된 2곳의 「10일 관측 · 83%」만 떴습니다 — 나머지 654곳은
 * 아예 목록에 없으니 아무도 이상하다고 느끼지 못했습니다.
 *
 * 계산을 여기로 옮기면 크론과 화면이 **같은 판단**을 쓰고, 탈락 이유가 값으로 돌아옵니다.
 *
 * ── 자리(spot)와 정류장(place)을 나눕니다 ───────────────────────────────────
 *
 * 예전에는 40m로 한 번만 묶었습니다. 그런데 40m는 **「같은 지점」**이지 **「같은 정류장」**이
 * 아닙니다. 차가 서는 자리는 앞차·주차 상황에 따라 날마다 수십 미터씩 달라집니다.
 *
 * 실측에서 그대로 나왔습니다 - 27호 2번 정류장은 61m 자리에 2일, 144m 자리에 2일로 **둘로
 * 쪼개져** 각각 문턱(3일)에 미달했습니다. 합치면 4일이라 통과하는데, 40m 묶기가 같은
 * 정류장을 두 개로 세고 있었습니다.
 *
 * 그래서 두 단계로 묶습니다.
 *
 *   ① 자리(spot)  : 40m. GPS 오차 범위의 「같은 점」.
 *   ② 정류장(place): 자주 선 자리를 중심으로 120m 안의 자리를 흡수.
 *
 * 120m인 이유: 한 정류장 앞에서 차가 서는 자리의 흔들림은 100m를 잘 넘지 않고, 정류장
 * 300m 앞 신호등은 흡수되지 않습니다. 전에 반경 400m 안의 정차를 통째로 평균 내서 신호등이
 * 정류장 좌표를 끌고 간 적이 있어, 넓히더라도 그 선은 넘지 않습니다.
 */

// ── 정차 감지 ────────────────────────────────────────────────────────────────

/** 이 반경(m) 안에 이어지는 핑들을 「같은 자리에 멈춰 있던 것」으로 묶습니다. */
export const DWELL_RADIUS_M = 35;
/** 그 자리에 최소한 이만큼(초) 머물러야 정차로 인정합니다(신호 대기와 구분). */
export const DWELL_MIN_SEC = 45;
/** 점 하나가 튀어서 생기는 가짜 정차를 막기 위한 최소 핑 개수. */
export const DWELL_MIN_SAMPLES = 3;
/** 속도 정보가 있을 때, 이 속도(km/h)보다 빠른 핑은 정차로 보지 않습니다. */
export const STOPPED_SPEED_KMH = 5;

/**
 * 두 핑 사이가 이만큼(초) 넘게 비어 있으면 「그 사이에 서 있었다」고 봅니다.
 * 앱에 거리 필터를 걸면 멈춘 동안에는 위치를 아예 안 보내므로, 정차는 점이 쌓이는 모습이
 * 아니라 **기록이 비는 모습**으로 나타납니다.
 */
export const GAP_MIN_SEC = 45;
/**
 * 빈 구간의 앞뒤 점이 이 거리(m) 안이어야 정차로 인정합니다. 멀면 서 있었던 게 아니라
 * 신호가 끊긴 채로 달린 것입니다(터널·음영지역).
 *
 * 400m인 이유: 다시 출발하면 앱은 다음 확인 시각(30초)에 위치를 보냅니다. 시속 40km면 그
 * 30초에 330m를 가므로, 정상적인 정차에서도 앞뒤 점이 300m 넘게 벌어집니다.
 */
export const GAP_MAX_MOVE_M = 400;
/** 빈 구간 직전 점의 속도가 이보다 빠르면 정차로 보지 않습니다(달리다 끊긴 것). */
export const GAP_MAX_APPROACH_KMH = 30;

// ── 묶기·판정 ────────────────────────────────────────────────────────────────

/** 최근 며칠치 관측으로 판단할지. */
export const LEARN_WINDOW_DAYS = 60;
/** ① 자리 묶기 반경(m). GPS 오차 범위의 「같은 점」. */
export const SPOT_RADIUS_M = 40;
/** ② 자리들을 한 정류장으로 합치는 반경(m). 위 주석 참고. */
export const STOP_MERGE_M = 120;
/**
 * 관측된 정차를 기존 정류장에 연결할 때 인정하는 최대 거리(m).
 *
 * 기존 좌표 자체가 주소 지오코딩 결과라 부정확한 상태이므로 넉넉히 잡습니다. 이 밖이면
 * 「미매칭」으로 남겨 담당자가 직접 지정합니다 - 자동으로 끌어다 붙이면 엉뚱한 정류장의
 * 좌표를 망가뜨립니다.
 */
export const MATCH_RADIUS_M = 400;
/** 학교 근처 정차는 정류장이 아니라 승하차 지점이므로 제외합니다. */
export const CAMPUS_EXCLUDE_M = 150;
/** 비율이 높아도 표본이 적으면(운행 이틀째 등) 아직 판단하지 않습니다. */
export const RECUR_MIN_DAYS = 3;
/**
 * 운행일 대비 이 비율 이상 관측돼야 정류장으로 인정합니다.
 *
 * 0.5에서 0.4로 낮췄습니다. 정차 감지는 완벽하지 않아서(신호에 걸려 정류장 앞에서 미리
 * 서면 같은 자리로 안 잡힙니다) 매일 서는 정류장도 관측은 며칠씩 빕니다. 실측에서 27호
 * 3번 정류장이 7일 중 3일(0.43)로 잡혀 0.5 문턱에 걸려 있었는데, 그 정류장은 실제로 매일
 * 서는 곳입니다. 0.5는 자료가 아니라 문턱이 만든 탈락이었습니다.
 */
export const RECUR_MIN_RATE = 0.4;

export type Ping = { lat: number; lng: number; speed: number | null; recorded_at: string };
export type Dwell = { lat: number; lng: number; startAt: string; endAt: string; seconds: number; samples: number };

/**
 * 연속된 핑을 훑으면서 「한 자리에 머문 구간」을 찾습니다. 두 가지 모습을 모두 잡습니다 -
 * 기사님 앱 설정이 어느 쪽이든 학습이 끊기지 않아야 하기 때문입니다.
 *
 *  ① 점이 뭉치는 모습(거리 필터 없음): 멈춰 있는 동안에도 30초마다 같은 자리 점이 쌓입니다.
 *     여러 점을 평균 내므로 좌표가 가장 정확합니다.
 *  ② 기록이 비는 모습(거리 필터 있음): 멈춘 동안 전송이 없어 점 사이가 훌쩍 벌어집니다.
 *     이때는 빈 구간 직전의 점을 정차 지점으로 씁니다.
 */
export function detectDwells(pings: Ping[]): Dwell[] {
  const dwells: Dwell[] = [];
  let group: Ping[] = [];

  function flush() {
    if (group.length >= DWELL_MIN_SAMPLES) {
      const startAt = group[0].recorded_at;
      const endAt = group[group.length - 1].recorded_at;
      const seconds = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000;
      if (seconds >= DWELL_MIN_SEC) {
        const lat = group.reduce((sum, p) => sum + p.lat, 0) / group.length;
        const lng = group.reduce((sum, p) => sum + p.lng, 0) / group.length;
        dwells.push({ lat, lng, startAt, endAt, seconds: Math.round(seconds), samples: group.length });
      }
    }
    group = [];
  }

  for (let i = 0; i < pings.length; i += 1) {
    const ping = pings[i];

    // ② 기록이 비는 모습.
    const next = pings[i + 1];
    if (next) {
      const gapSec = (new Date(next.recorded_at).getTime() - new Date(ping.recorded_at).getTime()) / 1000;
      const moved = haversineMeters(ping.lat, ping.lng, next.lat, next.lng);
      const slowingDown = ping.speed == null || ping.speed <= GAP_MAX_APPROACH_KMH;
      if (gapSec >= GAP_MIN_SEC && moved <= GAP_MAX_MOVE_M && slowingDown) {
        // 뭉쳐 있던 점이 있으면 그쪽을 먼저 닫습니다(같은 정차를 두 번 세지 않도록).
        const already = group.length >= DWELL_MIN_SAMPLES;
        flush();
        if (!already) {
          dwells.push({
            lat: ping.lat,
            lng: ping.lng,
            startAt: ping.recorded_at,
            endAt: next.recorded_at,
            seconds: Math.round(gapSec),
            // 점 하나로 추정한 정차라는 표시(뭉친 정차는 3 이상).
            samples: 1,
          });
        }
        continue;
      }
    }

    // ① 점이 뭉치는 모습.
    if (ping.speed != null && ping.speed > STOPPED_SPEED_KMH) {
      flush();
      continue;
    }
    if (group.length === 0) {
      group.push(ping);
      continue;
    }
    const centerLat = group.reduce((sum, p) => sum + p.lat, 0) / group.length;
    const centerLng = group.reduce((sum, p) => sum + p.lng, 0) / group.length;
    if (haversineMeters(centerLat, centerLng, ping.lat, ping.lng) <= DWELL_RADIUS_M) {
      group.push(ping);
    } else {
      flush();
      group.push(ping);
    }
  }
  flush();
  return dwells;
}

// ── 관측 묶기 ────────────────────────────────────────────────────────────────

export type Obs = {
  id: number;
  lat: number;
  lng: number;
  service_date: string;
  dwell_seconds: number | null;
  /** 이 정차를 이룬 점 수. 1이면 「기록이 빈 구간」으로 추정한 정차라 덜 정확합니다. */
  sample_count?: number | null;
};

/**
 * **치우침에 강한 중심** — 가중 중앙값(위도·경도 따로).
 *
 * 예전에는 평균을 냈습니다. 평균은 한두 번 엉뚱한 자리(앞차 때문에 30m 앞에서 선 날)에 그대로
 * 끌려갑니다. 중앙값은 절반 넘게 같은 자리에 서면 그 자리를 답합니다 - 날이 쌓일수록 실제
 * 하차 자리로 모입니다.
 *
 * 점 여럿이 뭉친 정차(뭉친 자리의 평균이라 정확)는 2, 기록이 빈 구간으로 추정한 정차(빈 구간
 * 직전 점이라 수십 m 어긋날 수 있음)는 1로 가중합니다.
 */
export function robustCenter(points: { lat: number; lng: number; w: number }[]): { lat: number; lng: number } {
  const med = (key: "lat" | "lng") => {
    const arr = [...points].sort((a, b) => a[key] - b[key]);
    const total = arr.reduce((n, p) => n + p.w, 0);
    let acc = 0;
    for (const p of arr) {
      acc += p.w;
      if (acc >= total / 2) return p[key];
    }
    return arr[arr.length - 1]?.[key] ?? 0;
  };
  return { lat: med("lat"), lng: med("lng") };
}

export const weightOf = (o: { sample_count?: number | null }) => ((o.sample_count ?? 1) >= DWELL_MIN_SAMPLES ? 2 : 1);

/** 관측 정차들이 중심에서 떨어진 거리의 중앙값(m). 작을수록 매일 같은 자리에 섭니다. */
export function spreadMeters(center: { lat: number; lng: number }, points: { lat: number; lng: number }[]): number {
  if (points.length === 0) return 0;
  const d = points.map((p) => haversineMeters(center.lat, center.lng, p.lat, p.lng)).sort((a, b) => a - b);
  return Math.round(d[Math.floor(d.length / 2)]);
}

export type Place = {
  lat: number;
  lng: number;
  /** 관측 정차들이 중심에서 떨어진 거리의 중앙값(m). */
  spreadM: number;
  /** 이 자리에서 정차가 관측된 **날** 수. 같은 날 여러 번 서도 1일입니다. */
  dayCount: number;
  /** 관측 건수(하루에 두 번 설 수도 있습니다). */
  count: number;
  /** 평균 체류시간(초). 승하차는 20~60초로 일정한 편이고 신호대기는 들쭉날쭉합니다. */
  dwellAvg: number;
  obsIds: number[];
};

type Spot = { lat: number; lng: number; days: Set<string>; dwellTotal: number; count: number; ids: number[]; pts: { lat: number; lng: number; w: number }[] };

/** ① 40m — GPS 오차 범위의 「같은 점」끼리 묶습니다. */
function clusterSpots(rows: Obs[]): Spot[] {
  const spots: Spot[] = [];
  for (const r of rows) {
    let hit: Spot | null = null;
    for (const s of spots) {
      if (haversineMeters(s.lat, s.lng, r.lat, r.lng) <= SPOT_RADIUS_M) {
        hit = s;
        break;
      }
    }
    const dwell = r.dwell_seconds ?? 0;
    if (!hit) {
      spots.push({ lat: r.lat, lng: r.lng, days: new Set([r.service_date]), dwellTotal: dwell, count: 1, ids: [r.id], pts: [{ lat: r.lat, lng: r.lng, w: weightOf(r) }] });
      continue;
    }
    hit.pts.push({ lat: r.lat, lng: r.lng, w: weightOf(r) });
    // 중심을 새 점까지 포함해 다시 평균 냅니다(관측이 쌓일수록 중심이 정확해집니다).
    hit.lat = (hit.lat * hit.count + r.lat) / (hit.count + 1);
    hit.lng = (hit.lng * hit.count + r.lng) / (hit.count + 1);
    hit.count += 1;
    hit.days.add(r.service_date);
    hit.dwellTotal += dwell;
    hit.ids.push(r.id);
  }
  return spots;
}

/**
 * ② 120m — 자리들을 한 정류장으로 합칩니다.
 *
 * **자주 선 자리부터 중심을 잡습니다.** 순서를 안 정하면 어쩌다 한 번 선 자리가 중심이 되어
 * 정류장 좌표를 그쪽으로 끌고 갑니다. 중심은 흡수한 자리들의 관측 수로 가중 평균합니다.
 */
export function groupIntoPlaces(rows: Obs[]): Place[] {
  const spots = clusterSpots(rows).sort((a, b) => b.days.size - a.days.size || b.count - a.count);

  const places: (Spot & { merged: Spot[] })[] = [];
  for (const s of spots) {
    const host = places.find((p) => haversineMeters(p.lat, p.lng, s.lat, s.lng) <= STOP_MERGE_M);
    if (!host) {
      places.push({ ...s, days: new Set(s.days), ids: [...s.ids], pts: [...s.pts], merged: [s] });
      continue;
    }
    host.pts.push(...s.pts);
    host.lat = (host.lat * host.count + s.lat * s.count) / (host.count + s.count);
    host.lng = (host.lng * host.count + s.lng * s.count) / (host.count + s.count);
    host.count += s.count;
    host.dwellTotal += s.dwellTotal;
    for (const d of s.days) host.days.add(d);
    host.ids.push(...s.ids);
    host.merged.push(s);
  }

  return places
    .map((p) => {
      // 묶는 동안은 평균으로 자리를 잡고(어느 자리를 흡수할지 정하는 데 충분), **최종 좌표는
      // 흡수한 정차 전부의 중앙값**으로 냅니다 - 엉뚱한 날 하루가 좌표를 끌고 가지 못하게.
      const c = robustCenter(p.pts);
      return { ...p, lat: c.lat, lng: c.lng, spreadM: spreadMeters(c, p.pts) };
    })
    .map((p) => ({
      lat: p.lat,
      lng: p.lng,
      spreadM: p.spreadM,
      dayCount: p.days.size,
      count: p.count,
      dwellAvg: p.count > 0 ? Math.round(p.dwellTotal / p.count) : 0,
      obsIds: p.ids,
    }))
    .sort((a, b) => b.dayCount - a.dayCount || b.count - a.count);
}

// ── 정류장에 붙이기 ──────────────────────────────────────────────────────────

export type LearnStop = { id: string; seq: number; lat: number | null; lng: number | null };

export type PlaceVerdict = Place & {
  /** 인정되어 이 정류장의 좌표로 쓸 자리. null 이면 아래 reason 이 이유를 말합니다. */
  stopId: string | null;
  stopSeq: number | null;
  distanceM: number | null;
  rate: number;
  accepted: boolean;
  /** 인정 못 한 이유. **빈 문자열이 아니면 화면이 그대로 띄웁니다.** */
  reason: string;
};

/**
 * 자리 목록을 정류장에 붙입니다.
 *
 * **탈락한 자리도 이유와 함께 그대로 돌려줍니다.** 예전에는 문턱을 못 넘으면 그냥 건너뛰어서,
 * 화면에는 「학습된 2곳」만 남고 「654곳이 왜 안 됐는지」는 어디에도 없었습니다. 없는 것과
 * 안 되는 것이 화면에서 똑같아 보이면 아무도 고치지 않습니다.
 */
export function matchPlacesToStops(places: Place[], runDays: number, stops: LearnStop[]): PlaceVerdict[] {
  const withCoords = stops.filter((s) => s.lat != null && s.lng != null);
  const taken = new Set<string>();
  const out: PlaceVerdict[] = [];

  for (const p of places) {
    const rate = runDays > 0 ? p.dayCount / runDays : 0;

    let best: { stop: LearnStop; dist: number } | null = null;
    let nearestAny: { stop: LearnStop; dist: number } | null = null;
    for (const s of withCoords) {
      const dist = haversineMeters(s.lat as number, s.lng as number, p.lat, p.lng);
      if (nearestAny == null || dist < nearestAny.dist) nearestAny = { stop: s, dist };
      if (taken.has(s.id)) continue;
      if (dist <= MATCH_RADIUS_M && (best == null || dist < best.dist)) best = { stop: s, dist };
    }

    let reason = "";
    if (withCoords.length === 0) {
      // 이 노선의 정류장에 좌표가 하나도 없습니다. 아무리 관측해도 붙을 자리가 없습니다.
      reason = `이 노선의 정류장 ${stops.length}곳에 좌표가 없어 붙일 수 없습니다`;
    } else if (p.dayCount < RECUR_MIN_DAYS) {
      reason = `${p.dayCount}일 관측 (${RECUR_MIN_DAYS}일 필요)`;
    } else if (rate < RECUR_MIN_RATE) {
      reason = `운행 ${runDays}일 중 ${p.dayCount}일 (${Math.round(RECUR_MIN_RATE * 100)}% 필요)`;
    } else if (!best) {
      reason = nearestAny
        ? `가장 가까운 정류장이 ${Math.round(nearestAny.dist)}m (${MATCH_RADIUS_M}m 안이어야 합니다)`
        : "붙일 정류장이 없습니다";
    }

    const accepted = reason === "" && best != null;
    if (accepted && best) taken.add(best.stop.id);

    out.push({
      ...p,
      rate: Number(rate.toFixed(2)),
      accepted,
      reason,
      stopId: accepted && best ? best.stop.id : null,
      stopSeq: accepted && best ? best.stop.seq : (nearestAny?.stop.seq ?? null),
      distanceM: accepted && best ? Math.round(best.dist) : nearestAny ? Math.round(nearestAny.dist) : null,
    });
  }

  return out;
}

// ── 한 노선 학습 전체 ────────────────────────────────────────────────────────

export type LearnObs = Obs & { matched_stop_id: string | null; assigned_by_human?: boolean | null };

export type StopUpdate = {
  stopId: string;
  lat: number;
  lng: number;
  dayCount: number;
  count: number;
  rate: number;
  dwellAvg: number;
  spreadM: number;
  /** 이 정류장 좌표에 쓰인 정차들. 화면이 「어느 날 어디 섰나」를 그릴 때 씁니다. */
  obsIds: number[];
  /** 사람이 고른 정차가 섞였는가. */
  human: boolean;
};

/**
 * 한 노선의 최근 정차 관측으로 **정류장마다 좌표 하나**를 냅니다.
 *
 * **사람이 고른 정차는 거리로 다시 짝짓지 않습니다.** 사람이 「이건 3번 정류장」이라고 골라
 * 준 것은 기사님이 실제로 거기서 내려준다는 사람의 판단이라, 등록 좌표와 멀어도 그 정류장의
 * 학습에 그대로 들어갑니다. 예전 재계산은 이 표시를 읽지 않아 고른 것이 다음 날 그대로
 * 버려졌습니다 - 화면에는 「다음부터 반영됩니다」라고 적혀 있었습니다.
 */
export function learnRoute(rows: LearnObs[], stops: LearnStop[]): { verdicts: PlaceVerdict[]; updates: StopUpdate[]; runDays: number } {
  const runDays = new Set(rows.map((r) => r.service_date)).size;
  const manual = rows.filter((r) => r.assigned_by_human && r.matched_stop_id);
  const auto = rows.filter((r) => !(r.assigned_by_human && r.matched_stop_id));
  const verdicts = matchPlacesToStops(groupIntoPlaces(auto), runDays, stops);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const idsByStop = new Map<string, { ids: number[]; human: boolean }>();
  for (const v of verdicts) {
    if (v.accepted && v.stopId) idsByStop.set(v.stopId, { ids: [...v.obsIds], human: false });
  }
  for (const m of manual) {
    const cur = idsByStop.get(m.matched_stop_id as string) ?? { ids: [], human: true };
    cur.ids.push(m.id);
    cur.human = true;
    idsByStop.set(m.matched_stop_id as string, cur);
  }

  const updates: StopUpdate[] = [];
  for (const [stopId, { ids, human }] of idsByStop) {
    const obs = ids.map((id) => byId.get(id)).filter((o): o is LearnObs => !!o);
    if (obs.length === 0) continue;
    const pts = obs.map((o) => ({ lat: o.lat, lng: o.lng, w: weightOf(o) }));
    const c = robustCenter(pts);
    const days = new Set(obs.map((o) => o.service_date)).size;
    updates.push({
      stopId,
      lat: c.lat,
      lng: c.lng,
      dayCount: days,
      count: obs.length,
      rate: runDays > 0 ? Number((days / runDays).toFixed(2)) : 0,
      dwellAvg: Math.round(obs.reduce((n, o) => n + (o.dwell_seconds ?? 0), 0) / obs.length),
      spreadM: spreadMeters(c, pts),
      obsIds: ids,
      human,
    });
  }
  return { verdicts, updates, runDays };
}

// ── 화면용 ──────────────────────────────────────────────────────────────────

/** 「주소 위치에서 실제 정차는 어느 쪽으로 얼마」 — 미터만 적으면 어디로 가야 하는지 모릅니다. */
export function directionLabel(from: { lat: number; lng: number }, to: { lat: number; lng: number }): string {
  const y = to.lat - from.lat;
  const x = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180);
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  const names = ["북쪽", "북동쪽", "동쪽", "남동쪽", "남쪽", "남서쪽", "서쪽", "북서쪽"];
  return names[Math.round(deg / 45) % 8];
}

/** 정확도 등급. 퍼짐(매일 선 자리가 학습 좌표에서 떨어진 중앙값)과 관측 일수로 매깁니다. */
export function precisionGrade(spreadM: number | null | undefined, dayCount: number | null | undefined): { label: string; tone: "good" | "mid" | "low" } {
  const d = dayCount ?? 0;
  const s = spreadM ?? 999;
  if (d >= 5 && s <= 15) return { label: "확정 수준", tone: "good" };
  if (d >= 3 && s <= 40) return { label: "거의 확정", tone: "mid" };
  return { label: "더 지켜봐야 함", tone: "low" };
}

/**
 * **날이 갈수록 모이고 있는가** — 날짜순으로 하루씩 더하면서 그때까지의 중심이 지금 중심에서
 * 얼마나 떨어져 있었는지. 숫자가 작아지며 0에 붙으면 수렴한 것이고, 오락가락하면 서는 자리가
 * 날마다 다른 것입니다.
 */
export function convergence(obs: { lat: number; lng: number; service_date: string; sample_count?: number | null }[]): { date: string; offM: number }[] {
  if (obs.length === 0) return [];
  const all = robustCenter(obs.map((o) => ({ lat: o.lat, lng: o.lng, w: weightOf(o) })));
  const dates = [...new Set(obs.map((o) => o.service_date))].sort();
  return dates.map((d) => {
    const upto = obs.filter((o) => o.service_date <= d).map((o) => ({ lat: o.lat, lng: o.lng, w: weightOf(o) }));
    const c = robustCenter(upto);
    return { date: d, offM: Math.round(haversineMeters(c.lat, c.lng, all.lat, all.lng)) };
  });
}
