// 안내보드에 붙여넣는 유튜브 URL(영상 또는 재생목록)을 임베드용 값으로 정규화합니다.
// 재생목록은 영상 ID와 구분하기 위해 "playlist:PLxxxx" 형태로 저장합니다.
export function parseYoutubeInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^playlist:/.test(trimmed)) return trimmed;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed; // 순수 영상 ID(11자)만 붙여넣은 경우

  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get("list");
    const v = url.searchParams.get("v");
    if (list && !v) return `playlist:${list}`;
    if (v) return v;
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "");
      if (id) return id;
    }
    const embedMatch = url.pathname.match(/\/embed\/([\w-]+)/);
    if (embedMatch) return embedMatch[1];
    if (list) return `playlist:${list}`;
  } catch {
    // URL 파싱 실패 - 영상 ID를 그대로 붙여넣은 경우 등. 원본을 그대로 씁니다.
  }
  return trimmed;
}

export function youtubeEmbedSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = "https://www.youtube.com/embed/";
  const params = "autoplay=1&mute=1&controls=1&modestbranding=1&rel=0&playsinline=1";
  if (value.startsWith("playlist:")) {
    const listId = value.slice("playlist:".length);
    return `${base}videoseries?list=${listId}&${params}&loop=1`;
  }
  return `${base}${value}?${params}&loop=1&playlist=${value}`;
}
