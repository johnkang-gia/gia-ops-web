import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 학생 사진의 서명 주소를 **같은 주소로 되풀이해** 줍니다.
 *
 * 서명 주소는 만들 때마다 열쇠 글자가 달라집니다. 학생 조회를 열 때마다 새로 만들면 브라우저 눈에는
 * 매번 처음 보는 사진 103장이라, 어제 받은 사진을 또 받습니다. 그래서 한 번 만든 주소를 하루 동안
 * 쓰고(유효기간 25시간), 끝나기 한 시간 전에 새로 만듭니다. 서버가 다시 떠서 기억이 비면 새로 만들
 * 뿐이라 틀린 사진이 뜰 일은 없습니다 - 파일 이름이 학생 번호라 경로가 곧 그 아이입니다.
 *
 * 사진을 바꿔도 경로는 같습니다. 그래서 바꾼 시각(`photo_updated_at`)을 열쇠에 넣고 주소 끝에도
 * 붙입니다 - 안 붙이면 새 사진을 올려도 하루 동안 예전 얼굴이 뜹니다.
 */
const VALID_SEC = 25 * 60 * 60;
const RENEW_BEFORE_MS = 60 * 60 * 1000;
const memo = new Map<string, { url: string; expiresAt: number }>();

export async function studentPhotoUrls(
  supabase: SupabaseClient,
  photos: { path: string; version?: string | null }[],
): Promise<{ urls: Record<string, string>; error: string | null }> {
  const now = Date.now();
  const urls: Record<string, string> = {};
  const need: string[] = [];
  const versionOf = new Map<string, string>();
  for (const { path: p, version } of photos) {
    const v = version ?? "";
    versionOf.set(p, v);
    const hit = memo.get(`${p}@${v}`);
    if (hit && hit.expiresAt - RENEW_BEFORE_MS > now) urls[p] = hit.url;
    else need.push(p);
  }
  if (need.length === 0) return { urls, error: null };
  const { data, error } = await supabase.storage.from("student-photos").createSignedUrls(need, VALID_SEC);
  for (const r of data ?? []) {
    if (!r.path || !r.signedUrl) continue;
    const v = versionOf.get(r.path) ?? "";
    const url = v ? `${r.signedUrl}&v=${encodeURIComponent(v)}` : r.signedUrl;
    urls[r.path] = url;
    memo.set(`${r.path}@${v}`, { url, expiresAt: now + VALID_SEC * 1000 });
  }
  return { urls, error: error?.message ?? null };
}
