import { settle, type SettleInvoice, type SettlePayment } from "@/lib/settlement";

/**
 * **청구 상태의 말과 색** — 재무 모든 화면이 이 표 하나를 씁니다.
 *
 * 화면마다 같은 상태를 다르게 불렀습니다(학비 표 「입금완료·일부입금·청구됨」, 학비외 표 「납부완료·
 * 일부받음·청구됨」과 「완납·미납·부분납부」, 학생별 회계 「미수」). 색도 달라서 같은 청구서가 한 화면에서는
 * 회색, 다른 화면에서는 초록으로 보였습니다. 사람은 색으로 먼저 읽으므로 색이 다르면 다른 상태로 읽습니다.
 *
 * 판정(얼마를 받았나)은 `settlement.ts`·`billedItems.ts` 가 하고, 여기서는 **보이는 모양만** 정합니다.
 */
export type BillStatus = "미청구" | "청구됨" | "일부" | "완납" | "연체" | "이월" | "결손";

/**
 * `cls` 는 뱃지(진한 색), `bg` 는 **표의 칸·줄을 칠하는 옅은 색**입니다.
 *
 * 뱃지만으로는 139명 표에서 «누가 다 냈나»가 한눈에 안 읽혔습니다 - 글자를 하나씩 읽어야 했습니다. 칸 바탕을
 * 상태 색으로 칠하면 표 전체가 초록(완납)·노랑(일부)·하늘(청구됨)·분홍(연체) 덩어리로 보이고, 남은 것이 어디
 * 몰려 있는지가 글자를 읽기 전에 보입니다. 뱃지와 바탕이 **같은 색 계열**이어야 같은 상태로 읽힙니다.
 */
export const BILL_STATUS: Record<BillStatus, { label: string; cls: string; bg: string; hint: string }> = {
  미청구: { label: "미청구", cls: "bg-white text-slate-500 ring-1 ring-slate-300", bg: "", hint: "아직 청구서에 안 담겼습니다" },
  청구됨: { label: "청구됨", cls: "bg-sky-600 text-white", bg: "bg-sky-50", hint: "청구서가 나갔고 아직 안 들어왔습니다" },
  일부: { label: "일부 받음", cls: "bg-amber-500 text-white", bg: "bg-amber-100", hint: "일부만 들어왔습니다 — 미납금 화면에서 남은 금액만 다시 청구할 수 있습니다" },
  완납: { label: "완납", cls: "bg-emerald-600 text-white", bg: "bg-emerald-100", hint: "다 받았습니다" },
  연체: { label: "연체", cls: "bg-rose-600 text-white", bg: "bg-rose-100", hint: "납부 기한이 지났는데 안 들어왔습니다" },
  이월: { label: "이월됨", cls: "bg-slate-300 text-slate-700", bg: "bg-slate-100", hint: "남은 돈이 다음 청구서로 넘어갔습니다" },
  결손: { label: "결손", cls: "bg-violet-600 text-white", bg: "bg-violet-50", hint: "받지 않기로 결재된 금액이 있습니다" },
};

/**
 * **한 학생 줄의 상태** — 청구액·받은 돈·남은 돈만으로 정합니다. 학비 표·학비외 표·학생별 회계가 같은 함수를
 * 써야 같은 아이가 세 화면에서 같은 색입니다.
 *
 * · 청구가 없으면 null(칠하지 않음) · 남은 돈이 없으면 완납 · 받은 돈이 있으면 일부 · 그 밖은 청구됨(연체면 연체)
 * · `toBill`(아직 청구 안 한 금액)이 남아 있으면 완납이라 부르지 않습니다 - 낸 것은 다 냈어도 **할 일이 남았습니다.**
 */
export function rowStatus(m: { billed: number; paid: number; due: number; toBill?: number; overdue?: boolean }): BillStatus | null {
  if (m.billed <= 0) return m.paid > 0 ? "완납" : null;
  if (m.due <= 0) return (m.toBill ?? 0) > 0 ? "일부" : "완납";
  if (m.paid > 0) return "일부";
  return m.overdue ? "연체" : "청구됨";
}

/** `settlement.ts` 의 상태 글자 → 화면 상태. */
export function statusFromSettle(state: string): BillStatus | null {
  switch (state) {
    case "완납":
      return "완납";
    case "부분납부":
    case "일부":
      return "일부";
    case "연체":
      return "연체";
    case "이월됨":
      return "이월";
    case "결손":
      return "결손";
    case "미납":
    case "청구됨":
      return "청구됨";
    case "취소":
      return null;
    default:
      return "청구됨";
  }
}

/**
 * **청구서 한 장의 화면 상태 — 이 함수 하나로.** 받은 돈·마감일로 판정(`settle`)하고 화면 상태로 옮깁니다.
 * 화면마다 `settle` 결과를 저마다 다시 해석하면 같은 장이 화면마다 다른 말로 읽힙니다(김에스더 건).
 * 취소된 장은 null 입니다.
 */
export function invoiceStatus(inv: SettleInvoice, payments: SettlePayment[], today: string): { status: BillStatus; balance: number } | null {
  const s = settle(inv, payments, today);
  const st = statusFromSettle(s.state);
  return st ? { status: st, balance: s.balance } : null;
}
