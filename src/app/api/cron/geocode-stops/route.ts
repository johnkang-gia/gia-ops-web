import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";

/**
 * **좌표 없는 정류장 채우기** — 주소는 있는데 위경도가 비어 있는 정류장을 카카오 주소검색으로
 * 채웁니다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 정류장 656곳 중 **355곳에 좌표가 없습니다.** 좌표가 없으면 GPS 학습이 원천적으로 불가능
 * 합니다 - 차가 그 앞에 아무리 서도 「어느 정류장인가」를 잴 기준점이 없기 때문입니다. 실제로
 * 23호는 정류장 두 곳이 모두 좌표가 없어, 관측 81건을 쌓고도 학습이 한 건도 안 됐습니다.
 *
 * 화면에는 이것이 오류로 안 보입니다. 정류장 목록은 주소만으로도 멀쩡히 뜨고, 학습 화면은
 * 「학습된 정류장」만 보여주니 좌표가 없는 곳은 목록에서 아예 빠집니다.
 *
 * ── 왜 화면이 아니라 서버인가 ───────────────────────────────────────────────
 *
 * 지금까지 좌표는 담당자가 그 노선의 노선도 탭을 열었을 때 브라우저에서 채워졌습니다. 열어본
 * 적 없는 노선은 영영 비어 있습니다 - 사람이 화면을 여는 것과 자료가 갖춰지는 것이 묶여 있으면
 * 안 열어본 만큼 자료가 빕니다.
 *
 * ── 주소를 못 찾으면 ────────────────────────────────────────────────────────
 *
 * 정류장 주소는 「개포래미안포레스트 정문」처럼 건물 이름이 섞여 있어 주소검색이 실패하는
 * 경우가 있습니다. 그때는 장소검색으로 한 번 더 시도하고, 그래도 없으면 **비워 둡니다.**
 * 비슷한 주소를 억지로 갖다 붙이면 차가 엉뚱한 곳에 선 것으로 학습되고, 그건 화면에 오류가
 * 아니라 「좌표가 있는 정류장」으로 보입니다.
 */
export const maxDuration = 60;

// 카카오 로컬 API 초당 제한에 걸리지 않도록 사이를 띄웁니다.
const GAP_MS = 120;
// 60초 안에 끝내야 하므로 한 번에 이만큼만 처리하고, 남은 것은 다음 실행에서 이어 합니다.
//
// 한 곳에 후보 문장이 최대 넷이고 문장마다 주소검색·장소검색을 갑니다. 60곳이면 대부분
// 30초 안에 끝나고, 최악의 경우에도 60초 제한 안에 들어옵니다. 남은 것은 다음 날 밤에 이어
// 하고, 응답에 몇 곳이 남았는지가 같이 나옵니다.
const BATCH = 60;

type Found = { lat: number; lng: number; gu: string | null; dong: string | null; via: string };

async function kakao(path: string, query: string, key: string): Promise<Found | null> {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}.json?query=${encodeURIComponent(query)}&size=1`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!res.ok) throw new Error(`카카오 ${path} 응답 ${res.status}`);
  const json = await res.json();
  const doc = json.documents?.[0];
  if (!doc) return null;
  const lat = parseFloat(doc.y);
  const lng = parseFloat(doc.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const region = doc.address ?? doc.road_address ?? null;
  // 장소검색 결과는 지번 주소가 한 덩어리 문자열로 옵니다("서울 강남구 개포동 189").
  const parts = typeof doc.address_name === "string" ? doc.address_name.split(" ") : [];
  return {
    lat,
    lng,
    gu: region?.region_2depth_name ?? parts[1] ?? null,
    dong: region?.region_3depth_name ?? parts[2] ?? null,
    via: path,
  };
}

/**
 * 주소 칸에 **주소가 아닌 것이 섞여 들어옵니다.**
 *
 * 실제로 이런 값들이 있습니다 - 「메이플자이 205동 이우빈」(아이 이름), 「5월부터 용산구 …」
 * (언제부터인지), 「강남구 논현동 68-4 동승 선생님: 사바 010-…」(연락처). 사람이 읽으면
 * 어디인지 알 수 있지만 주소검색은 통째로 실패합니다.
 *
 * 그래서 **덧붙은 것만 정해진 규칙으로 떼어내고** 다시 찾습니다. 아무 낱말이나 잘라가며
 * 찾지는 않습니다 - 그러면 「서초구 서초대로」 같은 반쪽 주소로 엉뚱한 좌표가 잡히는데,
 * 화면에는 오류가 아니라 「좌표가 있는 정류장」으로 보입니다.
 */
export function addressCandidates(raw: string): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length >= 4 && !out.includes(t)) out.push(t);
  };

  push(raw);

  // 「5월부터」처럼 언제부터인지 적어둔 앞머리, 연락처, 동승 선생님 안내를 떼어냅니다.
  const cleaned = raw
    .replace(/^\s*\d+월\s*부터\s*/, "")
    .replace(/동승\s*선생님\s*:.*$/, "")
    .replace(/01[016-9][-\s]?\d{3,4}[-\s]?\d{4}/g, "")
    .replace(/\(.*?\)/g, "");
  push(cleaned);

  // 맨 뒤에 붙은 아이 이름(한글 2~4자, 숫자·동·호·층·로·길이 아닌 것)을 뗍니다.
  const words = cleaned.trim().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  if (words.length >= 2 && /^[가-힣]{2,4}[A-Z]?$/.test(last) && !/[동호층로길가리]$/.test(last)) {
    push(words.slice(0, -1).join(" "));
  }

  // 「원페를라 202동」처럼 동 번호까지 적힌 경우, 단지 이름만으로 한 번 더 찾습니다.
  const withoutDong = cleaned.replace(/\s*\S*\d+\s*동(\s*\d+\s*호)?\s*$/, "").trim();
  push(withoutDong);

  return out;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) return NextResponse.json({ error: "서버에 KAKAO_REST_API_KEY가 설정되어 있지 않습니다." }, { status: 500 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from("shuttle_stops")
    .select("id, seq, address, gate, lat, lng")
    .is("lat", null)
    .limit(BATCH);
  if (error) return NextResponse.json({ error: `정류장 조회 실패: ${error.message}` }, { status: 500 });

  const targets = (rows ?? []) as { id: string; seq: number; address: string | null; gate: string | null; lat: number | null }[];

  let filled = 0;
  const notFound: string[] = [];
  /** 덧붙은 것을 떼고 찾은 곳. 원문과 실제 조회한 문장을 함께 남겨 사람이 되짚을 수 있게 합니다. */
  const guessed: string[] = [];
  const errors: string[] = [];

  for (const stop of targets) {
    const address = (stop.address ?? "").trim();
    if (!address) {
      notFound.push(`${stop.id} (주소 자체가 없습니다)`);
      continue;
    }
    try {
      let found: Found | null = null;
      let usedQuery = address;
      for (const query of addressCandidates(address)) {
        found = await kakao("address", query, kakaoKey);
        if (!found) {
          await new Promise((r) => setTimeout(r, GAP_MS));
          found = await kakao("keyword", query, kakaoKey);
        }
        if (found) {
          usedQuery = query;
          break;
        }
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      if (!found) {
        notFound.push(address);
      } else {
        if (usedQuery !== address) guessed.push(`${address} → ${usedQuery}`);
        const { error: updateError } = await supabase
          .from("shuttle_stops")
          .update({ lat: found.lat, lng: found.lng, gu: found.gu, dong: found.dong, geocoded_at: new Date().toISOString() })
          .eq("id", stop.id);
        // 못 넣었으면 남깁니다. 조용히 넘기면 다음 실행에서 또 같은 주소를 조회하며
        // 영영 채워지지 않는데, 화면에는 「아직 안 됐다」로만 보입니다.
        if (updateError) errors.push(`${address}: ${updateError.message}`);
        else filled += 1;
      }
    } catch (err) {
      errors.push(`${address}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  if (errors.length > 0) await logApiError(supabase, "cron:geocode-stops", new Error(errors.slice(0, 5).join(" / ")));
  await touchHeartbeat(supabase, "cron:geocode-stops");

  const { count: remaining } = await supabase.from("shuttle_stops").select("id", { count: "exact", head: true }).is("lat", null);

  return NextResponse.json({
    ok: errors.length === 0,
    이번에처리: targets.length,
    좌표채움: filled,
    덧붙은것을떼고찾음: guessed.length,
    주소를못찾음: notFound.length,
    남은정류장: remaining ?? null,
    guessed: guessed.slice(0, 50),
    notFound: notFound.slice(0, 50),
    errors,
  });
}
