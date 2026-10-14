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

export const BILL_STATUS: Record<BillStatus, { label: string; cls: string; hint: string }> = {
  미청구: { label: "미청구", cls: "bg-white text-slate-500 ring-1 ring-slate-300", hint: "아직 청구서에 안 담겼습니다" },
  청구됨: { label: "청구됨", cls: "bg-sky-600 text-white", hint: "청구서가 나갔고 아직 안 들어왔습니다" },
  일부: { label: "일부 받음", cls: "bg-amber-500 text-white", hint: "일부만 들어왔습니다 — 미납금 화면에서 남은 금액만 다시 청구할 수 있습니다" },
  완납: { label: "완납", cls: "bg-emerald-600 text-white", hint: "다 받았습니다" },
  연체: { label: "연체", cls: "bg-rose-600 text-white", hint: "납부 기한이 지났는데 안 들어왔습니다" },
  이월: { label: "이월됨", cls: "bg-slate-300 text-slate-700", hint: "남은 돈이 다음 청구서로 넘어갔습니다" },
  결손: { label: "결손", cls: "bg-violet-600 text-white", hint: "받지 않기로 결재된 금액이 있습니다" },
};

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
