/**
 * 청구서 명단 화면이 **판단하는 일**만 모았습니다.
 *
 * ── 왜 화면에서 떼어냈나 ─────────────────────────────────────────────
 *
 * `InvoiceGridClient.tsx` 는 2,250줄이었고, 그 안에 화면 그리기와 **돈을 정하는 판단**이
 * 섞여 있었습니다. 섞여 있으면 두 가지가 생깁니다.
 *
 *   · 판단을 확인하려면 화면을 켜고 손으로 눌러봐야 합니다. 그래서 아무도 확인하지 않습니다.
 *   · 화면을 손보다가 판단을 건드려도 티가 안 납니다 - 숫자가 조금 달라질 뿐이고,
 *     조금 다른 청구서는 그대로 나갑니다.
 *
 * 여기 있는 것들은 화면을 모릅니다. 값을 넣으면 값이 나오므로 시험할 수 있습니다.
 */

/** 요금 항목 중 이름을 견주는 데 필요한 부분만. 화면의 전체 타입을 끌고 오지 않습니다. */
export type NamedItem = { name: string; name_ko?: string | null };

/**
 * 이 요금 항목이 그 학생의 악기와 맞는가.
 *
 * 이름이 딱 맞기를 기다릴 수 없습니다. 명부에는 「바이올린」, 요금표에는 「Violin 개인레슨」
 * 처럼 적히고, 띄어쓰기도 사람마다 다릅니다. 그래서 띄어쓰기를 지우고 대소문자를 맞춘 뒤
 * **한쪽이 다른 쪽을 품는지**를 봅니다.
 *
 * 두 글자 미만은 아예 안 봅니다 - 「피」 한 글자가 「피아노」와 「피리」를 다 잡으면,
 * 안 배우는 아이에게 요금이 붙습니다. 틀리게 붙이는 것보다 안 붙이는 편이 낫습니다.
 */
export function matchesInstrument(item: NamedItem, instrument: string): boolean {
  const flat = (v: string) => v.toLowerCase().replace(/\s+/g, "");
  const ins = flat(instrument);
  if (ins.length < 2) return false;
  return [item.name, item.name_ko ?? ""].some(
    (n) => flat(n).includes(ins) || (flat(n).length >= 2 && ins.includes(flat(n))),
  );
}

/**
 * 반마다 **가장 흔한 금액**. 이것과 다른 아이를 「평소와 다르다」고 짚습니다.
 *
 * 평균이 아니라 최빈값입니다. 한 명이 악기를 사면 평균이 통째로 끌려가서, 정작 멀쩡한
 * 아이들이 전부 「다름」으로 표시됩니다. 그러면 표시가 너무 많아져 아무도 안 봅니다.
 *
 * **두 명 이상이 같은 금액일 때만** 「평소」라고 부릅니다. 한 명뿐인 반에서 그 한 명이
 * 곧 평소가 되면, 견줄 것이 없는데 견준 셈이 됩니다.
 */
export function typicalByGroup(rows: { key: string; amount: number }[]): Map<string, number> {
  const buckets = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const b = buckets.get(r.key) ?? new Map<number, number>();
    b.set(r.amount, (b.get(r.amount) ?? 0) + 1);
    buckets.set(r.key, b);
  }
  const out = new Map<string, number>();
  for (const [key, b] of buckets) {
    let best = 0;
    let bestN = 0;
    for (const [amt, n] of b) if (n > bestN) ((best = amt), (bestN = n));
    if (bestN >= 2) out.set(key, best);
  }
  return out;
}

/** 그 학생이 평소와 다른가. 다르면 «평소 금액»을, 같거나 견줄 것이 없으면 null. */
export function unusualAmount(typical: Map<string, number>, key: string, amount: number): number | null {
  const t = typical.get(key);
  if (t == null) return null;
  return amount === t ? null : t;
}

export type IssueMode = "통합" | "분류별";

/**
 * 발행할 청구서 목록을 미리 세웁니다. **한 학생이 여러 장이 될 수 있습니다.**
 *
 *   · 분류 탭을 고른 상태 → 그 분류만, 학생당 한 장.
 *   · 「전체」 + 통합     → 분류를 가리지 않고 학생당 한 장.
 *   · 「전체」 + 분류별   → 그 학생에게 붙은 분류마다 한 장씩.
 *
 * 분류를 이름순으로 정렬해 담습니다. 순서가 들쭉날쭉하면 같은 학생의 청구서 번호가
 * 발행할 때마다 다른 순서로 붙어, 나중에 「이 번호가 무슨 청구서였나」를 못 맞춥니다.
 */
export function planInvoices<S extends { id: string }>(
  targets: S[],
  opts: {
    /** 지금 고른 분류 탭. 「전체」면 아래 mode 를 따릅니다. */
    cat: string;
    mode: IssueMode;
    /** 그 학생에게 붙은 분류들. 「전체 + 분류별」일 때만 씁니다. */
    categoriesOf: (student: S) => string[];
  },
): { student: S; category: string | null }[] {
  const jobs: { student: S; category: string | null }[] = [];
  for (const s of targets) {
    if (opts.cat !== "전체") {
      jobs.push({ student: s, category: opts.cat });
      continue;
    }
    if (opts.mode === "통합") {
      jobs.push({ student: s, category: null });
      continue;
    }
    for (const c of [...new Set(opts.categoriesOf(s))].sort((a, b) => a.localeCompare(b, "ko"))) {
      jobs.push({ student: s, category: c });
    }
  }
  return jobs;
}
