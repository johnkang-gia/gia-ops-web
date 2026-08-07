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
