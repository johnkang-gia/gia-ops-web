// 안내보드에 붙여넣는 유튜브 URL(영상 하나, 여러 영상, 또는 재생목록)을 임베드용 값으로
// 정규화합니다. 세 가지 형태로 저장합니다:
//   - "V1"            : 영상 1개
//   - "queue:V1,V2,V3" : 영상 여러 개를 순서대로 이어서 반복 재생(진짜 유튜브 재생목록이 아니라,
//                        영상 링크 여러 개를 그냥 줄바꿈으로 붙여넣은 것 - 요청: "유튜브는
//                        재생목록으로 띄우는 거라, 링크 바로 복사하기힘들어" - 재생목록 공유
//                        링크를 따로 찾을 필요 없이, 평소 보던 영상 링크 여러 개만 붙여넣으면 됨)
//   - "playlist:PLxxx" : 실제 유튜브 재생목록(재생목록 공유 링크를 붙여넣은 경우 - 계속 지원)

// 한 줄짜리 유튜브 URL/ID에서 순수 영상 ID만 뽑아냅니다(재생목록 여부는 무시).
function extractVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed; // 순수 영상 ID(11자)만 붙여넣은 경우

  try {
    const url = new URL(trimmed);
    const v = url.searchParams.get("v");
    if (v) return v;
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "");
      if (id) return id;
    }
    const embedMatch = url.pathname.match(/\/embed\/([\w-]+)/);
    if (embedMatch) return embedMatch[1];
  } catch {
    // URL 파싱 실패 - 아래에서 원본을 그대로 씁니다.
  }
  return trimmed || null;
}

// 한 줄짜리 입력(영상 또는 재생목록 링크 하나)을 저장용 값으로 정규화합니다.
export function parseYoutubeInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^playlist:/.test(trimmed) || /^queue:/.test(trimmed)) return trimmed;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

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

// 여러 줄(영상 링크 하나씩) 입력을 저장용 값으로 정규화합니다. 한 줄만 있으면 기존과 동일하게
// 동작하고(재생목록 링크 한 줄도 그대로 지원), 두 줄 이상이면 각 줄에서 영상 ID만 뽑아
// "queue:V1,V2,V3"로 이어붙입니다.
export function parseYoutubeMultilineInput(input: string): string | null {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length === 1) return parseYoutubeInput(lines[0]);

  const ids = lines.map(extractVideoId).filter((id): id is string => !!id);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  return `queue:${ids.join(",")}`;
}

// 저장된 값을 다시 편집 화면에 보여줄 때, queue 값은 줄바꿈으로 나열된 youtu.be 링크로
// 풀어서 보여줍니다(관리자가 원래 뭘 붙여넣었는지 몰라도 계속 추가/삭제하기 쉽도록).
export function youtubeValueToEditableText(value: string | null | undefined): string {
  if (!value) return "";
  if (value.startsWith("queue:")) {
    return value
      .slice("queue:".length)
      .split(",")
      .filter(Boolean)
      .map((id) => `https://youtu.be/${id}`)
      .join("\n");
  }
  return value;
}

export function youtubeEmbedSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = "https://www.youtube.com/embed/";
  const params = "autoplay=1&mute=1&controls=1&modestbranding=1&rel=0&playsinline=1";
  if (value.startsWith("playlist:")) {
    const listId = value.slice("playlist:".length);
    return `${base}videoseries?list=${listId}&${params}&loop=1`;
  }
  if (value.startsWith("queue:")) {
    const ids = value.slice("queue:".length).split(",").filter(Boolean);
    if (ids.length === 0) return null;
    // 진짜 재생목록이 아니어도, 첫 영상을 재생하면서 playlist 파라미터에 전체 목록(첫 영상
    // 포함)을 다시 넣어주면 유튜브 플레이어가 순서대로 이어 재생하고, loop=1과 함께 끝까지
    // 재생한 뒤 처음으로 돌아가 계속 반복합니다.
    return `${base}${ids[0]}?${params}&loop=1&playlist=${ids.join(",")}`;
  }
  return `${base}${value}?${params}&loop=1&playlist=${value}`;
}
