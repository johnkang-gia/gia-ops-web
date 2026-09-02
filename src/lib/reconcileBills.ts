// 올톡페이 청구서와 우리 계산을 맞춰보기
//
// 아이마다 항목을 등록한 뒤, **이미 보낸 청구서와 금액이 같은지**를 먼저 봅니다. 여기서
// 어긋나면 등록이 잘못된 것입니다. 대조 없이 바로 발행하면 학부모가 받은 종이와 다른
// 금액이 나가고, 그건 되돌릴 수 없습니다.
//
// 아무것도 저장하지 않습니다. 파일은 화면에서 읽고 끝입니다.
//
// 맞춰보기가 쉽지 않은 이유가 파일 안에 그대로 있습니다.
//   · 한 아이가 여러 줄입니다 - 교재비와 교복을 따로 청구하고, `2차주문`으로 또 나갑니다.
//     그래서 **아이별로 합쳐서** 비교합니다.
//   · 이름 칸에 사연이 붙습니다 - `강하라/치과진료비12,900원포함`. 이런 줄은 금액이 다른 것이
//     당연하므로, 다르다고만 하지 않고 **그 메모를 같이 보여줍니다.**
//   · 결제중단된 줄은 다시 청구한 줄과 겹칩니다. 합계에서 뺍니다.

import { cleanPayerName } from "./payments";
import { normalizePhone } from "./alltalkpay";

export type BillLine = {
  rowNo: number;
  rawName: string;
  name: string;
  phone: string | null;
  reason: string;
  amount: number;
  status: string;
  /** 이름 칸에 붙은 사연. 금액이 다른 이유일 때가 많습니다. */
  note: string | null;
};

export type StudentSide = {
  id: string;
  name: string;
  parentPhone: string | null;
  gradeLabel: string;
  /** 우리가 계산한 금액. 항목을 아직 안 넣었으면 0입니다. */
  ours: number;
};

export type MatchedRow = {
  student: StudentSide | null;
  /** 학생을 못 찾았을 때 파일에 적힌 이름 */
  billName: string;
  lines: BillLine[];
  billed: number;
  ours: number;
  diff: number;
  matchedBy: "연락처" | "이름" | null;
};

export type Reconciliation = {
  /** 금액이 같은 아이 */
  same: MatchedRow[];
  /** 금액이 다른 아이 */
  differ: MatchedRow[];
  /** 청구서에는 있는데 명부에서 못 찾은 이름 */
  unknown: MatchedRow[];
  /** 우리 표에는 금액이 있는데 청구서가 없는 아이 */
  missingBill: StudentSide[];
  skipped: number;
};

const flat = (v: string) => v.replace(/\s+/g, "").toLowerCase();

/** 이름 칸에서 사연 부분만 떼어 돌려줍니다(있으면). */
export function noteOf(raw: string): string | null {
  const clean = cleanPayerName(raw);
  const rest = raw.slice(raw.indexOf(clean) + clean.length).trim();
  return rest.replace(/^[/(（[［,·]+/, "").replace(/[)）\]］]+$/, "").trim() || null;
}

export function toBillLines(rows: Record<string, unknown>[]): BillLine[] {
  const pick = (r: Record<string, unknown>, names: string[]) => {
    const keys = Object.keys(r);
    for (const n of names) {
      const k = keys.find((k) => k.replace(/\s+/g, "").includes(n));
      if (k !== undefined && String(r[k] ?? "").trim() !== "") return String(r[k]).trim();
    }
    return "";
  };
  const out: BillLine[] = [];
  rows.forEach((r, i) => {
    const rawName = pick(r, ["고객명", "이름", "성명", "name"]);
    const amount = Math.round(Number(String(pick(r, ["청구금액", "금액", "amount"])).replace(/[^\d.-]/g, "")) || 0);
    if (!rawName || !amount) return;
    out.push({
      rowNo: i + 2,
      rawName,
      name: cleanPayerName(rawName),
      phone: normalizePhone(pick(r, ["청구핸드폰", "핸드폰", "휴대폰", "연락처", "phone"])),
      reason: pick(r, ["청구사유", "내용", "적요", "memo"]),
      amount,
      status: pick(r, ["상태", "결제상태"]),
      note: noteOf(rawName),
    });
  });
  return out;
}

export function reconcile(lines: BillLine[], students: StudentSide[]): Reconciliation {
  // 결제중단은 다시 청구한 줄과 겹칩니다. 합계에 넣으면 두 배가 됩니다.
  const live = lines.filter((l) => !/중단|취소|실패/.test(l.status));
  const skipped = lines.length - live.length;

  const byPhone = new Map<string, StudentSide[]>();
  for (const s of students) {
    const p = normalizePhone(s.parentPhone);
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), s]);
  }
  const byName = new Map<string, StudentSide[]>();
  for (const s of students) {
    const k = flat(s.name);
    byName.set(k, [...(byName.get(k) ?? []), s]);
  }

  /** 한 줄이 누구 것인지. 연락처가 먼저입니다 - 이름에는 사연이 붙습니다. */
  function findStudent(l: BillLine): { s: StudentSide | null; by: MatchedRow["matchedBy"] } {
    if (l.phone) {
      const cands = byPhone.get(l.phone) ?? [];
      if (cands.length === 1) return { s: cands[0], by: "연락처" };
      // 형제라 여럿이면 이름으로 좁힙니다.
      const narrowed = cands.filter((s) => flat(s.name) === flat(l.name));
      if (narrowed.length === 1) return { s: narrowed[0], by: "연락처" };
    }
    const named = byName.get(flat(l.name)) ?? [];
    if (named.length === 1) return { s: named[0], by: "이름" };
    return { s: null, by: null };
  }

  const groups = new Map<string, MatchedRow>();
  for (const l of live) {
    const { s, by } = findStudent(l);
    const key = s ? s.id : `?${flat(l.name)}`;
    const g = groups.get(key) ?? {
      student: s,
      billName: l.name,
      lines: [],
      billed: 0,
      ours: s?.ours ?? 0,
      diff: 0,
      matchedBy: by,
    };
    g.lines.push(l);
    g.billed += l.amount;
    // 한 아이의 여러 줄 중 하나만 연락처로 붙어도 붙은 것으로 봅니다.
    if (!g.matchedBy && by) g.matchedBy = by;
    groups.set(key, g);
  }
  for (const g of groups.values()) g.diff = g.billed - g.ours;

  const all = [...groups.values()];
  const matched = all.filter((g) => g.student);
  const billedIds = new Set(matched.map((g) => g.student!.id));

  return {
    same: matched.filter((g) => g.diff === 0).sort((a, b) => a.billName.localeCompare(b.billName, "ko")),
    differ: matched.filter((g) => g.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
    unknown: all.filter((g) => !g.student).sort((a, b) => a.billName.localeCompare(b.billName, "ko")),
    // 우리 표에 금액이 있는데 청구서가 없는 아이. 0원인 아이는 아직 항목을 안 넣은 것이라
    // 여기 넣으면 목록이 명부 전체가 되어 아무도 안 봅니다.
    missingBill: students
      .filter((s) => s.ours > 0 && !billedIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    skipped,
  };
}
