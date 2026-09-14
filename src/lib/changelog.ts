import fs from "node:fs";
import path from "node:path";

export type ChangelogEntry = {
  version: string;
  date: string;
  status: string | null;
  body: string;
};

// CHANGELOG.md는 매 릴리즈마다 "## v0.58.0 - 2026-08-04 (staging)" 형식의 헤더로
// 시작합니다. 헤더만 정규식으로 골라내고, 그 사이 본문은 그대로 반환합니다 - 실제 마크다운
// 해석(문단/글머리표/```sql 코드블록)은 렌더링하는 쪽(/changelog 페이지)에서 처리합니다.
//
// **날짜를 필수로 두지 않습니다.** 예전에는 `- 날짜` 가 없으면 아예 안 걸려서 그 항목이
// 화면에서 조용히 사라졌습니다. 오류가 아니라 「그 버전은 기록이 없나 보다」로 보였고,
// v0.492.0 부터 84개가 그렇게 빠진 채 화면이 v0.491.0 에 멈춰 있었습니다. 눈으로
// 발견하기까지 며칠이 걸렸습니다.
//
// 이제 날짜가 없어도 **항목은 뜹니다**(날짜 칸만 빕니다). 날짜를 빠뜨리는 것 자체는
// `scripts/check-changelog.mjs` 가 빌드에서 막습니다 - 빠진 것을 화면에서 숨기는 대신
// 애초에 빠지지 않게 하고, 그래도 빠졌으면 드러나게 둡니다.
const HEADER_RE = /^## (v[\d.]+)(?:\s*-\s*([\d-]+))?(?:\s*\(([^)]+)\))?\s*$/;

export function getChangelogEntries(): ChangelogEntry[] {
  const file = path.join(process.cwd(), "CHANGELOG.md");
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }

  const lines = raw.split("\n");
  const entries: ChangelogEntry[] = [];
  let current: { version: string; date: string; status: string | null } | null = null;
  let bodyLines: string[] = [];

  function flush() {
    if (current) entries.push({ ...current, body: bodyLines.join("\n").trim() });
  }

  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (m) {
      flush();
      current = { version: m[1], date: m[2] ?? "", status: m[3] ?? null };
      bodyLines = [];
    } else if (current) {
      bodyLines.push(line);
    }
  }
  flush();

  return entries;
}
