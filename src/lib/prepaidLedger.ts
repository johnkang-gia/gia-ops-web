/**
 * **선입금 대장** — 어느 청구서에도 안 붙은 돈을 사람이 볼 수 있게 묶습니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 선입금은 `payments.invoice_id = null` 로만 표시됩니다. 영리한 방법이지만, 그 줄들을
 * **모아서 보는 자리가 어디에도 없었습니다.** 실제로 두 줄이 떠 있었는데
 * (곽세린 250,000 · 고진우 450,000) 화면 어디에서도 보이지 않았고, 고칠 수도 지울 수도
 * 없었습니다. 다음에 그 아이 청구서를 만들면 저절로 깎이는데, 왜 깎였는지 알 방법이 없습니다.
 *
 * 돈이 보이지 않는 것은 없는 것과 다릅니다 - 없으면 아무 일도 안 일어나지만, 안 보이는 돈은
 * 나중에 혼자 움직입니다.
 *
 * ── 어디서 왔는가를 반드시 적습니다 ─────────────────────────────────────────
 *
 * 선입금 한 줄은 출처가 셋입니다. 화면에는 똑같이 「안 붙은 돈」으로 보이는데, 사람이 할
 * 일이 다릅니다.
 *
 *   · **미리 받음**      — 청구서 전에 먼저 받은 돈. 그대로 두면 됩니다.
 *   · **청구 취소로 떼어냄** — 취소 때 떨어져 나온 돈. 다시 붙이거나 돌려줘야 합니다.
 *   · **주인을 못 찾음**  — 통장에서 읽었는데 누구 것인지 모르는 돈. **가장 급합니다.**
 *
 * 급한 순서대로 화면이 세웁니다 - 목록을 금액순으로 세우면 제일 급한 줄이 가운데 묻힙니다.
 */

export type PrepaidRow = {
  id: string;
  student_id: string | null;
  paid_at: string;
  amount: number | string;
  method: string | null;
  method_kind: string | null;
  payer_name: string | null;
  memo: string | null;
  source: string | null;
  matched_by: string | null;
  created_at?: string | null;
};

/** 이 돈이 어쩌다 여기 있게 됐나. */
export type PrepaidOrigin = "주인 미상" | "청구 취소" | "미리 받음";

export const ORIGIN_NOTE: Record<PrepaidOrigin, string> = {
  "주인 미상": "누구 것인지 모르는 돈입니다. 학생을 이어주세요.",
  "청구 취소": "청구서를 취소하면서 떨어져 나온 돈입니다. 다시 붙이거나 돌려주세요.",
  "미리 받음": "청구서보다 먼저 받은 돈입니다. 다음 청구서에 저절로 충당됩니다.",
};

/** 급한 순서. 숫자가 작을수록 위. */
const ORIGIN_RANK: Record<PrepaidOrigin, number> = {
  "주인 미상": 0,
  "청구 취소": 1,
  "미리 받음": 2,
};

/**
 * 한 줄의 출처. **학생이 안 이어진 줄이 가장 급합니다** - 그 돈은 아무에게도 충당되지
 * 않고 영영 떠 있습니다.
 */
export function originOf(r: PrepaidRow): PrepaidOrigin {
  if (!r.student_id) return "주인 미상";
  if ((r.matched_by ?? "").includes("취소")) return "청구 취소";
  return "미리 받음";
}

export type PrepaidItem = PrepaidRow & { origin: PrepaidOrigin; won: number };

export type PrepaidGroup = {
  studentId: string | null;
  /** 화면에 적을 이름. 학생이 안 이어졌으면 입금자명을 씁니다. */
  label: string;
  total: number;
  rows: PrepaidItem[];
  /** 이 묶음에서 가장 급한 출처. 묶음 순서를 이걸로 정합니다. */
  worst: PrepaidOrigin;
};

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 학생별로 묶습니다.
 *
 * **학생 번호로 묶습니다.** 이름으로 묶으면 김재이 셋의 돈이 한 칸에 섞이고, 그러면 남의
 * 돈이 다른 아이 청구서에서 깎입니다(CLAUDE.md 2-4-1). 번호가 없는 줄은 **묶지 않고 한 줄씩
 * 따로** 세웁니다 - 누구 것인지 모르는 돈끼리 합쳐 봐야 아무 뜻이 없습니다.
 */
export function groupPrepaid(rows: readonly PrepaidRow[], nameOf: (id: string) => string | null): PrepaidGroup[] {
  const byStudent = new Map<string, PrepaidItem[]>();
  const orphans: PrepaidItem[] = [];

  for (const r of rows) {
    const item: PrepaidItem = { ...r, origin: originOf(r), won: num(r.amount) };
    if (item.student_id) {
      const list = byStudent.get(item.student_id) ?? [];
      list.push(item);
      byStudent.set(item.student_id, list);
    } else {
      orphans.push(item);
    }
  }

  const groups: PrepaidGroup[] = [];
  for (const [studentId, list] of byStudent) {
    groups.push({
      studentId,
      label: nameOf(studentId) ?? list[0].payer_name ?? "이름 미확인",
      total: list.reduce((n, x) => n + x.won, 0),
      rows: list.sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
      worst: list.reduce<PrepaidOrigin>((w, x) => (ORIGIN_RANK[x.origin] < ORIGIN_RANK[w] ? x.origin : w), "미리 받음"),
    });
  }
  for (const o of orphans) {
    groups.push({
      studentId: null,
      label: o.payer_name?.trim() || "입금자명 없음",
      total: o.won,
      rows: [o],
      worst: "주인 미상",
    });
  }

  // 급한 것부터, 같으면 큰 금액부터. 「무엇을 먼저 손대야 하나」가 목록 순서로 보여야 합니다.
  return groups.sort(
    (a, b) => ORIGIN_RANK[a.worst] - ORIGIN_RANK[b.worst] || b.total - a.total || a.label.localeCompare(b.label, "ko"),
  );
}

/** 화면 맨 위 한 줄. 「떠 있는 돈이 얼마인가」는 숨기면 안 되는 숫자입니다. */
export function summarize(rows: readonly PrepaidRow[]) {
  let total = 0;
  let unknown = 0;
  let unknownCount = 0;
  for (const r of rows) {
    const won = num(r.amount);
    total += won;
    if (!r.student_id) {
      unknown += won;
      unknownCount += 1;
    }
  }
  return { total, count: rows.length, unknown, unknownCount };
}
