// 매뉴얼 콘텐츠는 리치 텍스트 에디터(Tiptap) 도입 이후 HTML로 저장됩니다. 그 이전에 저장됐거나
// AI가 만들어낸 콘텐츠는 줄바꿈만 있는 일반 텍스트라서, 화면/편집기에 넣기 전에 HTML로 바꿔줘야
// 문단 구분이 깨지지 않습니다. PDF 생성 시에는 반대로 HTML을 다시 읽기 좋은 텍스트로 되돌립니다.
// (클라이언트/서버 양쪽에서 쓰는 순수 함수라 DOM API를 쓰지 않습니다.)

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function looksLikeHtml(content: string): boolean {
  return /<\/?(p|div|br|ul|ol|li|h[1-6]|strong|em|b|i)[^>]*>/i.test(content);
}

/** 일반 텍스트(줄바꿈 기준)를 리치 텍스트 에디터가 이해하는 HTML 문단으로 변환합니다. 이미 HTML이면 그대로 둡니다. */
export function plainTextToHtml(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  if (looksLikeHtml(trimmed)) return trimmed;
  return trimmed
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** 편집기/화면에 표시하기 전에 안전하게 HTML로 정규화합니다. */
export function toDisplayHtml(content: string): string {
  return plainTextToHtml(content);
}

/** HTML을 PDF 등 순수 텍스트 출력용으로 되돌립니다(태그 제거, 문단/목록 구분은 줄바꿈으로). */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  if (!looksLikeHtml(html)) return html;
  let text = html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 채택예정 발행 시, 기존 매뉴얼 항목 뒤에 새 내용을 문단으로 이어붙입니다(HTML 기준). */
export function appendHtmlSection(existingContent: string, additionPlainOrHtml: string): string {
  const existing = plainTextToHtml(existingContent);
  const addition = plainTextToHtml(additionPlainOrHtml);
  return [existing, addition].filter(Boolean).join("");
}
