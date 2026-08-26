// 카카오맵 JS SDK를 딱 한 번만 <script>로 불러오고, 이후 호출은 같은 Promise를 재사용합니다
// (지도가 여러 컴포넌트에서 쓰여도 스크립트가 중복 삽입되지 않도록).
// services 라이브러리를 같이 로드해야 주소 -> 좌표 변환(Geocoder)을 쓸 수 있습니다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KakaoNamespace = any;

declare global {
  interface Window {
    kakao?: KakaoNamespace;
  }
}

let loadPromise: Promise<KakaoNamespace> | null = null;

export function loadKakaoMaps(): Promise<KakaoNamespace> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    if (!appKey) {
      reject(new Error("NEXT_PUBLIC_KAKAO_MAP_KEY가 설정되지 않았습니다."));
      return;
    }
    if (window.kakao?.maps) {
      resolve(window.kakao);
      return;
    }
    const existing = document.getElementById("kakao-maps-sdk");
    if (existing) {
      existing.addEventListener("load", () => window.kakao!.maps.load(() => resolve(window.kakao)));
      existing.addEventListener("error", () => reject(new Error("카카오맵 SDK 로드 실패")));
      return;
    }
    const script = document.createElement("script");
    script.id = "kakao-maps-sdk";
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=services`;
    script.async = true;
    script.onload = () => window.kakao!.maps.load(() => resolve(window.kakao));
    script.onerror = () => reject(new Error("카카오맵 SDK 로드 실패 - 도메인 등록을 확인해주세요."));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export type GeocodeResult = { lat: number; lng: number; gu: string | null; dong: string | null };

/** 장소 검색 결과 한 건. */
export type PlaceResult = GeocodeResult & { name: string; address: string; roadAddress: string | null };

/**
 * 장소 **이름**으로 찾습니다("반포자이", "래미안퍼스티지 정문", "잠원역 3번출구").
 *
 * 담당자 요청: "못 찾은 정류장은 카카오 지도 검색해서 위치 검색해서 넣을 수 있게 만들어줘."
 *
 * 주소 변환(geocodeAddress)이 실패하는 정류장들은 대개 **주소가 아니라 장소 이름**으로 적혀
 * 있습니다 - "반포 자이 후문", "○○아파트 놀이터 앞" 같은 것들이죠. 기사님과 학부모가 실제로
 * 쓰는 말이라 이걸 억지로 지번 주소로 바꾸라고 하는 것보다, 그 말 그대로 검색해서 고르게
 * 하는 편이 맞습니다.
 *
 * 카카오 키워드 검색은 지도 SDK의 Places 서비스를 씁니다(주소 검색과 같은 키를 쓰므로 새로
 * 발급받을 것이 없습니다).
 */
export async function searchPlaces(keyword: string, limit = 10): Promise<PlaceResult[]> {
  const q = keyword.trim();
  if (!q) return [];
  const kakao = await loadKakaoMaps();
  return new Promise((resolve) => {
    const places = new kakao.maps.services.Places();
    places.keywordSearch(q, (result: KakaoNamespace, status: string) => {
      if (status !== kakao.maps.services.Status.OK || !Array.isArray(result)) {
        resolve([]);
        return;
      }
      resolve(
        (result as Record<string, string>[]).slice(0, limit).map((r) => {
          // 카카오는 "서울 서초구 반포동 123" 식으로 돌려줍니다. 구·동은 그 문자열에서
          // 뽑습니다 - 지역별 대시보드가 구/동으로 묶기 때문에 좌표만으로는 부족합니다.
          const addr = r.address_name ?? "";
          const parts = addr.split(/\s+/);
          return {
            name: r.place_name ?? q,
            address: addr,
            roadAddress: r.road_address_name || null,
            lat: parseFloat(r.y),
            lng: parseFloat(r.x),
            gu: parts.find((p) => p.endsWith("구") || p.endsWith("시") || p.endsWith("군")) ?? null,
            dong: parts.find((p) => /(동|읍|면|가)$/.test(p)) ?? null,
          };
        }),
      );
    });
  });
}

// 주소 하나를 좌표로 변환합니다(카카오 Geocoder는 콜백 방식이라 Promise로 감쌌습니다). 지번/도로명
// 주소 어느 쪽이든 카카오가 행정구역(구/동)까지 함께 파싱해서 돌려주므로, 노선 이름 문자열을
// 억지로 파싱하는 대신 이 값을 지역별 대시보드의 구/동 분류 기준으로 씁니다.
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const kakao = await loadKakaoMaps();
  return new Promise((resolve) => {
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, (result: KakaoNamespace, status: string) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const r = result[0];
        const region = r.address ?? r.road_address ?? null;
        resolve({
          lat: parseFloat(r.y),
          lng: parseFloat(r.x),
          gu: region?.region_2depth_name ?? null,
          dong: region?.region_3depth_name ?? null,
        });
      } else {
        resolve(null);
      }
    });
  });
}
