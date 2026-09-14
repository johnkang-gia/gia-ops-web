import type { Invoice } from "@/lib/types";

// 수납 대사 — 들어온 돈을 인보이스에 붙이는 규칙 한 곳.
//
// 통장에는 아이 이름이 아니라 **보호자 이름**이 찍히는 경우가 많고, 금액도 두 아이를 한 번에
// 내면 합쳐져 옵니다. 그래서 자동으로 붙일 수 있는 것만 붙이고, 애매한 것은 **애매하다고
// 말합니다.** 어림짐작으로 붙이면 틀린 곳을 아무도 못 찾습니다.

/**
 * 납부 수단(고정값).
 *
 * 자유 글자로 두면 «현금», «현금납부», «cash» 가 섞이고, 그러면 월말에 세는 일이 다시
 * 사람 손으로 돌아갑니다.
 */
export const PAYMENT_METHOD_KINDS = ["올톡페이", "방문카드", "계좌이체", "현금", "기타"] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/**
 * 현금영수증을 물어야 하는 수단.
 *
 * 카드는 그 자체로 증빙이 남고 올톡페이는 결제사가 처리합니다. 현금과 계좌이체만
 * 우리가 따로 발행해야 합니다.
 */
export function needsCashReceipt(kind: string | null | undefined): boolean {
  return kind === "현금" || kind === "계좌이체";
}

export type PaymentRow = {
  id: string;
  invoice_id: string | null;
  student_id: string | null;
  paid_at: string;
  amount: number;
  method: string | null;
  /** 고정값 수단. 옛 줄은 비어 있을 수 있습니다. */
  method_kind?: string | null;
  payer_name: string | null;
  memo: string | null;
  source: string;
  source_key: string | null;
  matched_by: string | null;
  created_by: string | null;
  created_at: string;
};

/** 엑셀에서 읽어낸 한 줄(아직 저장 전). */
export type ImportedPayment = {
  rowNo: number;
  paidAt: string;
  amount: number;
  payerName: string;
  memo: string;
  sourceKey: string;
};

const norm = (s: string | null | undefined) => (s ?? "").toString().toLowerCase().replace(/\s+/g, "");

/** 인보이스별 입금 합과 잔액. **저장하지 않고 그때그때 냅니다** - 두 곳에 두면 어긋납니다. */
export function balanceOf(invoice: Invoice, payments: PaymentRow[]): { paid: number; balance: number } {
  const paid = payments.filter((p) => p.invoice_id === invoice.id).reduce((n, p) => n + Number(p.amount), 0);
  return { paid, balance: Math.round(Number(invoice.total_amount) - paid) };
}

export type MatchCandidate = { invoice: Invoice; why: string };

/**
 * 이 입금이 어느 인보이스 것인지 고릅니다.
 *
 * 판단 순서(확실한 것부터):
 *   1. 메모나 입금자명에 **인보이스 번호**가 있으면 그것. 사람이 적어준 답입니다.
 *   2. 남은 잔액과 **금액이 정확히 같은** 인보이스가 하나뿐이면 그것.
 *   3. 입금자명이 학생 이름과 **같고** 잔액이 남은 인보이스가 하나뿐이면 그것.
 *
 * 하나로 좁혀지지 않으면 **아무것도 고르지 않습니다.** 후보를 함께 돌려주어 사람이 고르게 합니다.
 */
/**
 * 입금자 이름에 붙은 메모를 떼어냅니다.
 *
 * 올톡페이 청구 목록의 고객명 칸에는 이런 것들이 실제로 들어 있습니다.
 *   `강하라/치과진료비12,900원포함`  `조장훈(13,000잔돈차감)`  `김리안(2차주문)`  `송우진,윤진`
 * 금액을 조정한 사연을 이름 칸에 적어 두신 것인데, 그대로 대조하면 어느 이름과도 안 맞습니다.
 * 괄호·빗금·쉼표 뒤를 떼고 앞의 이름만 남깁니다(형제는 앞의 아이로 붙고, 나머지는 사람이 봅니다).
 */
export function cleanPayerName(v: string): string {
  return String(v ?? "")
    .replace(/[（(［[].*$/g, "")
    .split(/[/,·]/)[0]
    .replace(/\d.*$/g, "")
    .trim();
}

/**
 * 청구사유에서 **우리 청구서 번호**를 읽어냅니다.
 *
 * 내보낼 때 `[2026-0123] 1학기 교재비` 또는 `[2026-0123,2026-0124] …`(형제 합산)로 적습니다.
 * 그 글자가 되받은 엑셀에 그대로 들어 있으므로, 여기서 되읽어 정확히 그 청구서를 찾습니다.
 *
 * 대괄호 밖의 숫자는 보지 않습니다 - 금액이나 학번이 우연히 같은 모양일 수 있습니다.
 */
export function readInvoiceTags(memo: string | null | undefined): string[] {
  const m = String(memo ?? "").match(/\[([0-9]{4}-[0-9]{3,6}(?:\s*,\s*[0-9]{4}-[0-9]{3,6})*)\]/);
  return m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
}

export function matchPayment(
  p: { amount: number; payerName: string; memo: string; phone?: string },
  invoices: Invoice[],
  payments: PaymentRow[],
): { picked: Invoice | null; reason: string; candidates: MatchCandidate[] } {
  const open = invoices.filter((v) => v.status === "발행" && balanceOf(v, payments).balance > 0);
  const text = `${p.memo} ${p.payerName}`;

  // ── 0) **청구서 번호가 적혀 있으면 그게 끝입니다.** ─────────────────────────
  //
  // 우리가 올톡페이로 내보낼 때 청구사유 앞에 「[2026-0123] 1학기 교재비」처럼 번호를
  // 박습니다. 되받은 엑셀에 그 글자가 그대로 들어 있으므로, 추측할 이유가 없습니다.
  //
  // 예전에는 연락처·금액·이름 추측이 앞에 있었습니다. 그런데 실제 자료를 보면
  //   · 같은 이름이 셋이고(김재이),
  //   · 형제를 한 번호로 합쳐 보내면 연락처 하나에 청구서가 둘이며,
  //   · 청구사유가 「악기비」·「악기(바이올린)」·「악기비 (바이올린)」로 흔들립니다.
  // 추측이 앞서면 이 셋에서 엉뚱한 청구서에 돈이 붙고, 화면에는 「자동으로 붙음」으로
  // 보입니다.
  const tagged = readInvoiceTags(p.memo);
  if (tagged.length > 0) {
    const hit = tagged.map((no) => open.find((v) => v.invoice_no === no)).filter((v): v is Invoice => !!v);
    // **번호가 하나면 그것입니다.** 금액이 달라도 그 청구서에 붙입니다 - 일부만 낸
    // 경우이고, 잔액은 settlement 이 알아서 계산합니다.
    if (hit.length === 1) return { picked: hit[0], reason: `청구서 번호 ${hit[0].invoice_no}`, candidates: [] };
    // 형제를 합쳐 보낸 줄입니다. 한 입금을 둘로 나눠야 하므로 **사람이 정합니다** -
    // 아무 쪽에나 통째로 붙이면 한 아이는 완납, 다른 아이는 미납으로 남습니다.
    if (hit.length > 1) {
      return {
        picked: null,
        reason: `형제 ${hit.length}건을 합쳐 보낸 줄입니다 — 나눠 붙일 곳을 골라주세요`,
        candidates: hit.map((v) => ({ invoice: v, why: "청구사유의 번호" })),
      };
    }
    // 번호는 적혀 있는데 그 청구서가 안 보입니다. 이미 완납됐거나 취소된 것입니다.
    // **추측으로 넘어가지 않습니다** - 번호가 적힌 돈을 다른 청구서에 붙이면, 그 번호의
    // 주인은 계속 미납으로 남고 엉뚱한 아이가 완납이 됩니다.
    return {
      picked: null,
      reason: `청구사유에 ${tagged.join(", ")} 가 적혀 있는데 그 청구서가 미납 목록에 없습니다 — 이미 받았거나 취소된 건입니다`,
      candidates: [],
    };
  }

  // 1) 청구할 때 쓴 **연락처**가 그다음 단서입니다. 이름 칸에는 사연이 붙지만
  //    (`강하라/치과진료비12,900원포함`) 번호는 그대로입니다.
  const phone = (p.phone ?? "").replace(/[^\d]/g, "");
  if (phone.length >= 10) {
    const byPhone = open.filter((v) => (v.guardian_phone ?? "").replace(/[^\d]/g, "") === phone);
    if (byPhone.length === 1) return { picked: byPhone[0], reason: "청구 연락처가 같음", candidates: [] };
    // 형제라 여러 건이면 금액으로 한 번 더 좁힙니다.
    const narrowed = byPhone.filter((v) => balanceOf(v, payments).balance === Math.round(p.amount));
    if (narrowed.length === 1) return { picked: narrowed[0], reason: "연락처 + 금액 일치", candidates: [] };
    if (byPhone.length > 1) {
      return {
        picked: null,
        reason: `같은 연락처의 형제 ${byPhone.length}건 — 사람이 골라야 합니다`,
        candidates: byPhone.slice(0, 6).map((v) => ({ invoice: v, why: "연락처 일치" })),
      };
    }
  }

  // 2) 대괄호 없이 번호만 적힌 옛 줄. 우리가 번호를 박기 전에 보낸 것들입니다.
  const byNo = open.find((v) => text.includes(v.invoice_no));
  if (byNo) return { picked: byNo, reason: `번호 ${byNo.invoice_no}`, candidates: [] };

  // 3) 잔액이 딱 맞는 것.
  const exact = open.filter((v) => balanceOf(v, payments).balance === Math.round(p.amount));
  if (exact.length === 1) return { picked: exact[0], reason: "잔액과 금액 일치", candidates: [] };

  // 4) 이름이 같은 것.
  const key = norm(cleanPayerName(p.payerName));
  const byName = key.length >= 2
    ? open.filter((v) => norm(v.student_name_ko) === key || norm(v.student_name) === key)
    : [];
  if (byName.length === 1) return { picked: byName[0], reason: "입금자명이 학생 이름과 같음", candidates: [] };

  // 좁혀지지 않았습니다. 후보만 돌려주고 사람에게 맡깁니다.
  const cands: MatchCandidate[] = [
    ...exact.map((v) => ({ invoice: v, why: "금액 일치" })),
    ...byName.map((v) => ({ invoice: v, why: "이름 일치" })),
  ];
  const seen = new Set<string>();
  const uniq = cands.filter((c) => (seen.has(c.invoice.id) ? false : (seen.add(c.invoice.id), true)));
  return {
    picked: null,
    reason: uniq.length > 1 ? `후보 ${uniq.length}건 — 사람이 골라야 합니다` : "맞는 인보이스를 못 찾았습니다",
    candidates: uniq.slice(0, 6),
  };
}

/** "2026-09-01" 로 맞춥니다. 엑셀 날짜는 문자열·숫자·Date가 섞여 옵니다. */
export function toIsoDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const s = String(v ?? "").trim();
  // 2026-09-01 · 2026.09.01 · 2026/9/1
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // 엑셀 일련번호(1900-01-01 기준). 40000 근처면 날짜로 봅니다.
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return "";
}

/** "₩191,000" · "191000원" → 191000 */
export function toAmount(v: unknown): number {
  const s = String(v ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : 0;
}
