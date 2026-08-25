import type { SupabaseClient } from "@supabase/supabase-js";

// 학교(본교) 좌표를 구합니다. 도착·출발 자동감지가 모두 이 좌표를 기준으로 반경을 재기 때문에
// 두 크론이 같은 값을 쓰도록 여기로 모았습니다. 한 번 구하면 shuttle_campus_locations에
// 저장해두고 다음부터는 지오코딩 없이 바로 씁니다.
export const CAMPUS_NAME = "본교";
export const CAMPUS_ADDRESS = "서울 강남구 논현로131길 45";
// 지오코딩이 실패하거나(카카오 키 없음·일시 장애) 아직 응답 전일 때 쓰는 고정 좌표입니다.
// 노선 지도에서 GIA는 등원의 종점·하원의 기점이라 이 점이 없으면 순서 자체가 성립하지 않아,
// "주소를 못 찾아서 학교가 안 보이는" 상황이 생기지 않도록 항상 대체값을 갖고 시작합니다.
export const CAMPUS_FALLBACK = { lat: 37.5108, lng: 127.0322 };

export async function ensureCampusLocation(supabase: SupabaseClient): Promise<{ lat: number; lng: number } | null> {
  const { data: existing } = await supabase
    .from("shuttle_campus_locations")
    .select("id, lat, lng")
    .eq("name", CAMPUS_NAME)
    .maybeSingle();

  if (existing?.lat != null && existing?.lng != null) {
    return { lat: existing.lat, lng: existing.lng };
  }

  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) return null;

  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(CAMPUS_ADDRESS)}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const doc = json.documents?.[0];
    if (!doc) return null;
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    if (existing?.id) {
      await supabase.from("shuttle_campus_locations").update({ lat, lng, geocoded_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase
        .from("shuttle_campus_locations")
        .insert({ name: CAMPUS_NAME, address: CAMPUS_ADDRESS, lat, lng, geocoded_at: new Date().toISOString() });
    }
    return { lat, lng };
  } catch {
    return null;
  }
}
