/**
 * 현금영수증 번호 — 서식과 검사를 한 곳에서.
 *
 * 이 번호는 **사람이 단말기에 손으로 쳐 넣습니다.** 그래서 화면과 종이에 나오는 모양이
 * 곧 정확도입니다. 하이픈 없이 `01012345678` 로 붙여 놓으면 단말기 앞에서 자리를 세다가
 * 한 자리를 놓치고, 그렇게 끊긴 현금영수증은 **남의 앞으로 나갑니다.** 그건 취소 발행으로만
 * 되돌릴 수 있습니다.
 *
 * 서식과 검사를 화면마다 다시 만들지 않습니다. 수납 등록 화면과 현금영수증 화면이 서로
 * 다른 기준으로 검사하면, 한쪽에서 통과한 번호가 다른 쪽에서 빨갛게 뜹니다.
 */

export type ReceiptPurpose = "소득공제" | "지출증빙";

/** 구분에 따라 무엇을 받는지. 화면 라벨과 안내 문구가 같은 곳에서 나옵니다. */
export const IDENTIFIER_LABEL: Record<ReceiptPurpose, string> = {
  소득공제: "휴대폰번호",
  지출증빙: "사업자등록번호",
};

/** 숫자만 남깁니다. 저장은 항상 이 모양입니다 - 하이픈을 섞어 저장하면 같은 번호가 두 벌이 됩니다. */
export function digitsOnly(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^0-9]/g, "");
}

/**
 * 사람이 읽는 모양으로. 종이와 화면 둘 다 이걸 씁니다.
 *
 * 자릿수가 안 맞으면 **억지로 끼워 넣지 않고 있는 그대로 돌려줍니다.** 잘못된 번호를
 * 그럴듯한 모양으로 보여주면 잘못된 줄 모르고 그대로 칩니다.
 */
export function formatIdentifier(purpose: ReceiptPurpose, raw: string | null | undefined): string {
  const v = digitsOnly(raw);
  if (!v) return "";
  if (purpose === "지출증빙") {
    return v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : v;
  }
  if (v.length === 11) return `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7)}`;
  if (v.length === 10) return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
  return v;
}

/**
 * 이 번호로 끊어도 되는가. 문제가 없으면 null, 있으면 **사람이 읽을 이유**를 돌려줍니다.
 *
 * 「올바르지 않습니다」로만 말하면 무엇을 고쳐야 하는지 모릅니다. 자릿수가 몇인지까지
 * 말해줘야 그 자리에서 학부모께 다시 여쭐 수 있습니다.
 */
export function identifierProblem(purpose: ReceiptPurpose, raw: string | null | undefined): string | null {
  const v = digitsOnly(raw);
  if (!v) return "번호가 없습니다";

  if (purpose === "지출증빙") {
    if (v.length !== 10) return `사업자등록번호는 10자리입니다 (지금 ${v.length}자리)`;
    return null;
  }

  // 휴대폰은 10자리(011·016 등 옛 번호)와 11자리가 모두 살아 있습니다.
  if (v.length !== 10 && v.length !== 11) return `휴대폰번호는 10~11자리입니다 (지금 ${v.length}자리)`;
  if (!v.startsWith("01")) return "휴대폰번호는 01로 시작합니다";
  return null;
}

/**
 * 종이에 세울 순서.
 *
 * ① 번호 없는 건이 맨 위 — 종이에 빈칸으로 나가면 단말기 앞에서 막힙니다. 뽑기 전에
 *    번호부터 받아야 한다는 것이 목록 맨 위에 보여야 합니다.
 * ② 번호가 이상한 건 그다음 — 칠 수는 있지만 틀릴 가능성이 큽니다.
 * ③ 나머지는 오래 기다린 순서. 늦게 온 건이 위에 있으면 오래된 건이 계속 밀립니다.
 */
export function pendingSortKey(r: { purpose: ReceiptPurpose; identifier: string | null; created_at: string }): [number, string] {
  const problem = identifierProblem(r.purpose, r.identifier);
  const rank = !digitsOnly(r.identifier) ? 0 : problem ? 1 : 2;
  return [rank, r.created_at];
}
