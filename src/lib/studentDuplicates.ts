/**
 * 같은 아이가 두 줄로 들어간 것을 찾습니다.
 *
 * 지금까지는 **이름이 정확히 같을 때만** 찾았습니다. 그래서 조하윤은 잡혔지만
 * 「제이콥」과 「제이콥 딜런 마」는 못 잡았습니다 — 같은 아이인데 한쪽은 성과 미들네임까지,
 * 한쪽은 부르는 이름만 들어간 것입니다. 중고등부 명부에서 실제로 이런 줄이 여럿 나옵니다.
 *
 * 그래서 근거를 넷으로 늘렸습니다. 근거를 **화면에 적어서** 사람이 판단하게 합니다 —
 * 자동으로 합치지 않습니다. 김재이가 셋, 이준서가 둘인 학교라 «이름이 비슷하다»가 곧
 * «같은 아이»는 아닙니다. 잘못 합치면 되돌릴 수 없습니다.
 */

export type DupPerson = {
  id: string;
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  birth_date: string | null;
  /**
   * 재학 / 보류 / 퇴원.
   *
   * **중복은 상태가 다른 두 줄로 나타나는 경우가 가장 많습니다.** 명부를 반영할 때 새 줄이
   * 생기고, 옛 줄은 「명부에 없음」이라 보류로 넘어갑니다. 그래서 재학생끼리만 찾으면 정작
   * 진짜 중복은 하나도 안 걸립니다 — 중고등부 제이콥이 그랬습니다.
   */
  status?: string | null;
  created_at: string;
};

/** 왜 같은 아이로 의심하는가. 화면에 그대로 적습니다. */
export type DupReason = "이름 같음" | "생년월일 같음" | "이름이 다른 이름에 들어 있음" | "영문 이름 같음";

export type DupGroup = { key: string; reasons: DupReason[]; people: DupPerson[] };

/** 공백·가운뎃점·마침표를 빼고 소문자로. 「제이콥·딜런」과 「제이콥 딜런」이 같아집니다. */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s·.,'-]/g, "");
}

/**
 * 한쪽 이름이 다른 쪽 안에 들어 있는가. 「제이콥」 ⊂ 「제이콥딜런마」
 *
 * 두 글자로는 보지 않습니다. 「이준」이 「이준서」와 「이준우」 둘 다에 들어가는데, 그 둘은
 * 실제로 다른 아이입니다. 짧은 조각으로 이으면 남남을 한 사람으로 만듭니다.
 */
export function containsName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y || x === y) return false;
  const [shortOne, longOne] = x.length <= y.length ? [x, y] : [y, x];
  if (shortOne.length < 3) return false;
  return longOne.includes(shortOne);
}

/**
 * 서로 이어진 것들을 한 덩어리로 모읍니다(연결 요소).
 *
 * A와 B가 이름으로 이어지고 B와 C가 생일로 이어지면 셋은 한 덩어리입니다. 짝만 보여주면
 * 사람이 같은 아이를 두 번 합쳐야 하고, 그 사이에 한쪽이 이미 지워져 오류가 납니다.
 */
export function findDuplicateGroups(people: DupPerson[]): DupGroup[] {
  const n = people.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };
  // 어떤 근거로 이어졌는지. 나중에 화면에 적습니다.
  const reasonsByRoot = new Map<number, Set<DupReason>>();
  const addReason = (i: number, r: DupReason) => {
    const root = find(i);
    (reasonsByRoot.get(root) ?? reasonsByRoot.set(root, new Set()).get(root)!).add(r);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = people[i];
      const b = people[j];
      let reason: DupReason | null = null;

      if (normName(a.name) && normName(a.name) === normName(b.name)) reason = "이름 같음";
      else if (a.birth_date && a.birth_date === b.birth_date) reason = "생년월일 같음";
      else if (
        normName(a.name_en) &&
        normName(a.name_en) === normName(b.name_en)
      )
        reason = "영문 이름 같음";
      else if (containsName(a.name, b.name) || containsName(a.name_en ?? "", b.name_en ?? "")) {
        reason = "이름이 다른 이름에 들어 있음";
      }

      if (!reason) continue;
      union(i, j);
      addReason(i, reason);
    }
  }

  const byRoot = new Map<number, DupPerson[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(people[i]);
  }

  return [...byRoot.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([root, g]) => ({
      key: g[0].id,
      reasons: [...(reasonsByRoot.get(root) ?? new Set<DupReason>())],
      // 먼저 만들어진 줄이 위. 대개 그쪽에 기록이 더 붙어 있습니다.
      people: g.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }))
    .sort((a, b) => b.people.length - a.people.length || a.people[0].name.localeCompare(b.people[0].name, "ko"));
}
