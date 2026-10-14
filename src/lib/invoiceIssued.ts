/**
 * **이 청구서는 언제·누가 냈는가** — 학생별 회계 · 학비 일괄 발행 · 학비외 일괄 발행이 같은 말로 적습니다.
 *
 * 「이미 발행되었습니다」만 들으면 어느 화면에서 그 장을 찾아야 하는지 모릅니다. 한 화면은
 * 「청구됨」, 다른 화면은 번호만, 또 다른 화면은 아무것도 안 적으면, 같은 청구서가 화면마다
 * 다른 상태로 보입니다. 표기는 여기서 한 번만 정합니다.
 */
export function issuedShort(issueDate: string | null | undefined): string {
  const d = String(issueDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return "";
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

export function issuedLong(v: { invoice_no?: string | null; issue_date?: string | null; issued_by?: string | null }): string {
  const parts = [v.invoice_no ?? "", v.issue_date ?? "", v.issued_by ? `${v.issued_by} 발행` : "발행"].filter(Boolean);
  return parts.join(" · ");
}
