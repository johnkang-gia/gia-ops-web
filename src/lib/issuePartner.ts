"use client";

/**
 * **학비 · 학비외를 한쪽 화면에서 함께 발행.**
 *
 * 학비 일괄과 학비외 일괄이 화면이 달라서, 한 학생의 청구서를 합치거나 둘 다 내려면 학생마다
 * 두 화면을 오가야 했습니다. 오가다 한쪽을 빠뜨리면 그 아이만 청구서가 반쪽으로 나갑니다.
 *
 * 그래서 어느 화면에서 발행하든 **다른 갈래의 아직 안 나간 항목**을 함께 낼 수 있게 합니다.
 *
 *   · 한 장으로 — 학비 청구서에 학비외 줄을 함께 담습니다(학비 창구가 `itemIds` 로 받음)
 *   · 따로 한 장 — 같은 순간에 다른 갈래 청구서를 한 장 더 냅니다
 *
 * 「아직 안 나간 항목」은 학생 금전 창과 **같은 판정**(`/api/finance/ledger`)을 씁니다. 화면마다
 * 따로 세면 한 화면은 나갔다고, 다른 화면은 안 나갔다고 답해 같은 항목이 두 장에 담깁니다.
 * 이름이 겹쳐 나갔는지 가릴 수 없는 항목(`unsure`)은 담지 않습니다 - 그 판정은 원래 화면에서
 * 사람이 합니다.
 */

export type PartnerMode = "off" | "merge" | "separate";

export const PARTNER_LABEL: Record<PartnerMode, string> = {
  off: "이 갈래만",
  merge: "함께 · 한 장으로",
  separate: "함께 · 따로 한 장",
};

const KEY = "gia.finance.partnerMode";
export function loadPartnerMode(): PartnerMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "merge" || v === "separate" ? v : "off";
  } catch {
    return "off";
  }
}
export function savePartnerMode(m: PartnerMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // 기억 못 해도 발행은 됩니다. 다음에 다시 고르면 됩니다.
  }
}

type Charge = { kind: "학비" | "학비외"; id: string; label: string; amount: number; billed: unknown };

/** 이 학생의 아직 안 나간 학비 항목(plan) 번호와 학비외 항목(item) 번호. */
export async function unbilledOf(
  studentId: string,
  termId: string | null,
): Promise<{ tuition: string[]; extra: string[]; labels: Record<string, string>; error: string | null }> {
  const res = await fetch(`/api/finance/ledger/${studentId}${termId ? `?term=${termId}` : ""}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { ledger?: { charges: Charge[] }; error?: string };
  if (!res.ok || !body.ledger) return { tuition: [], extra: [], labels: {}, error: body.error ?? `읽지 못했습니다(${res.status})` };
  const open = body.ledger.charges.filter((c) => !c.billed && c.amount > 0);
  return {
    tuition: open.filter((c) => c.kind === "학비").map((c) => c.id),
    extra: open.filter((c) => c.kind === "학비외").map((c) => c.id),
    labels: Object.fromEntries(open.map((c) => [c.id, c.label])),
    error: null,
  };
}

/** 학비외 한 장을 따로 냅니다. */
export async function issueExtraInvoice(studentId: string, termId: string | null, dueDate: string, itemIds: string[]) {
  const res = await fetch("/api/finance/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, feeTermId: termId, dueDate, itemIds }),
  });
  const body = (await res.json().catch(() => ({}))) as { invoice?: { id: string; invoice_no: string }; error?: string };
  return { ok: res.ok, invoice: body.invoice ?? null, error: body.error ?? (res.ok ? null : res.statusText) };
}

/** 학비 한 장(학비외 줄을 함께 담을 수 있음)을 냅니다. */
export async function issueTuitionInvoice(
  studentId: string,
  termId: string | null,
  dueDate: string,
  planIds: string[] | null,
  itemIds: string[] = [],
) {
  const res = await fetch("/api/finance/invoices/tuition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, termId, dueDate, planIds, ...(itemIds.length > 0 ? { itemIds } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as { invoice?: { id: string; invoice_no: string }; error?: string };
  return { ok: res.ok, invoice: body.invoice ?? null, error: body.error ?? (res.ok ? null : res.statusText) };
}
