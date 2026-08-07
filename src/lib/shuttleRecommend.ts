// 학생 주소(좌표)를 기준으로 기존 셔틀 정류장 중 가장 가까운 곳을 찾아 몇 호차에 태우면
// 좋을지 추천합니다. 실제 도로 거리가 아니라 직선거리(haversine) 기준의 "1차 추천"이며,
// 최종 배정은 담당자가 지도를 보고 판단해서 확정합니다.

import type { ShuttleDirection, ShuttleRoute, ShuttleStop } from "@/lib/types";

// 두 좌표 사이의 직선거리를 미터 단위로 계산합니다(지구를 구로 근사).
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type StopCandidate = {
  route: ShuttleRoute;
  stop: ShuttleStop;
  distanceM: number;
};

// direction(등원/하원)에 해당하는 활성 노선의 정류장 중, 좌표가 있는 곳만 대상으로 가까운
// 순서로 정렬해 상위 limit개를 돌려줍니다.
export function recommendStops(
  studentLat: number,
  studentLng: number,
  direction: ShuttleDirection,
  routes: ShuttleRoute[],
  stops: ShuttleStop[],
  limit = 5
): StopCandidate[] {
  const routeById = new Map(routes.filter((r) => r.direction === direction && r.active).map((r) => [r.id, r]));
  const candidates: StopCandidate[] = [];
  for (const s of stops) {
    if (s.lat == null || s.lng == null) continue;
    const route = routeById.get(s.route_id);
    if (!route) continue;
    candidates.push({ route, stop: s, distanceM: haversineMeters(studentLat, studentLng, s.lat, s.lng) });
  }
  candidates.sort((a, b) => a.distanceM - b.distanceM);
  return candidates.slice(0, limit);
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}
