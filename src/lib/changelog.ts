import fs from "node:fs";
import path from "node:path";

export type ChangelogEntry = {
  version: string;
  date: string;
  status: string | null;
  body: string;
};

// CHANGELOG.md는 매 릴리즈마다 "## v0.58.0 - 2026-08-04 (staging)" 형식의 헤더로
// 시작합니다(package.json 버전을 올릴 때마다 이 파일 맨 위에 새 항목을 추가하는 이 세션의
// 기존 규칙). 헤더만 정규식으로 골라내고, 그 사이 본문은 그대로 반환합니다 - 실제 마크다운
// 해석(문단/글머리표/```sql 코드블록)은 렌더링하는 쪽(/changelog 페이지)에서 처리합니다.
const HEADER_RE = /^## (v[\d.]+) - ([\d-]+)(?:\s*\(([^)]+)\))?/;

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
      current = { version: m[1], date: m[2], status: m[3] ?? null };
      bodyLines = [];
    } else if (current) {
      bodyLines.push(line);
    }
  }
  flush();

  return entries;
}
