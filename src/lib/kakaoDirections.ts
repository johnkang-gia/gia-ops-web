// 카카오모빌리티 "자동차 길찾기"(단일 출발지-도착지) REST API 호출 헬퍼입니다. 노선 전체 경로를
// 미리 계산해 캐시하는 다중경유지 길찾기(/api/shuttle/route-path)와는 달리, 이건 "지금 위치에서
// 이 정류장까지 얼마나 걸리는지"를 그때그때 계산하는 용도라 출발/도착 2개 지점만 씁니다. 같은
// KAKAO_REST_API_KEY를 그대로 재사용합니다(요청: 도착예정시각 - 새 키 발급 불필요).
export type EtaResult = { etaSeconds: number; distanceM: number };

type KakaoDirectionsSingleResponse = {
  routes: {
    result_code: number;
    result_msg: string;
    summary: { distance: number; duration: number };
  }[];
};

export async function fetchDrivingEta(
  restKey: string,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<EtaResult | null> {
  const params = new URLSearchParams({
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    priority: "RECOMMEND",
  });
  let res: Response;
  try {
    res = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${params.toString()}`, {
      headers: { Authorization: `KakaoAK ${restKey}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as KakaoDirectionsSingleResponse | null;
  const route = data?.routes?.[0];
  if (!route || route.result_code !== 0) return null;
  return { etaSeconds: route.summary.duration, distanceM: route.summary.distance };
}
