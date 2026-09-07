/**
 * 같은 아이가 두 줄로 들어간 것을 찾습니다.
 *
 * ── 근거는 **이름 하나뿐입니다** ──────────────────────────────────────
 *
 * 앞 판은 생년월일이 같거나 영문 이름이 같거나 한쪽 이름이 다른 쪽에 들어 있어도 목록에
 * 올렸습니다. 그런데 그렇게 걸린 짝은 대부분 **다른 아이**였습니다.
 *
 *   · 생년월일 — 137명 중 같은 날 태어난 아이가 여럿입니다. 학년이 같으면 더 흔합니다.
 *   · 영문 이름 — Kim, Lee 로 시작하는 짧은 표기가 겹칩니다.
 *   · 이름 포함 — 「김민준」이 「김민준서」 안에 들어갑니다.
 *
 * 합치는 일은 되돌릴 수 없습니다. 그래서 **틀린 짝을 목록에 올리지 않는 쪽**이 낫습니다 —
 * 잘못 걸린 짝이 섞이면 사람이 목록 자체를 신뢰하지 않게 되고, 그러면 진짜 중복도 넘어갑니다.
 *
 * 생년월일·영문 이름은 **판정에서 빼되 화면에는 남깁니다.** 판정 근거로 쓰지 않을 뿐,
 * 두 줄이 같은 아이인지 사람이 보고 정할 때는 그 값이 가장 큰 단서입니다.
 */

export type DupPerson = {
  id: string;
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  birth_date: string | null;
  /**
   * 재학 / 보류.
   *
   * **중복은 상태가 다른 두 줄로 나타나는 경우가 가장 많습니다.** 명부를 반영할 때 새 줄이
   * 생기고, 옛 줄은 「명부에 없음」이라 보류로 넘어갑니다. 그래서 재학생끼리만 찾으면 정작
   * 진짜 중복은 하나도 안 걸립니다.
   */
  status?: string | null;
  /** 판정에 쓰지 않습니다. 같은 집인지 보는 단서로 화면에만 씁니다. */
  mother_phone?: string | null;
  father_phone?: string | null;
  parent_phone?: string | null;
  created_at: string;
};

/**
 * 왜 같은 아이로 의심하는가.
 *
 * 둘뿐이고, **확신의 세기가 다릅니다.** 화면에서도 나눠서 보여줍니다 - 섞으면 약한 근거가
 * 강한 근거의 신뢰를 깎습니다.
 */
export type DupReason = "이름 같음" | "이름이 한쪽에 들어 있음";

export type DupGroup = { key: string; reasons: DupReason[]; people: DupPerson[] };

/** 공백·가운뎃점·마침표를 빼고 소문자로. 「강 이제」와 「강이제」가 같아집니다. */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s·.,'-]/g, "");
}

/** 이름을 낱말로 쪼갭니다. 「제이콥 딜런 마」 → ["제이콥", "딜런", "마"] */
function words(s: string | null | undefined): string[] {
  return (s ?? "")
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 한쪽 이름이 다른 쪽의 **앞부분(낱말 단위)**인가. 「제이콥」 ⊂ 「제이콥 딜런 마」
 *
 * ── 왜 낱말 단위인가 ──
 *
 * 그냥 「글자가 들어 있다」로 보면 「김민준」이 「김민준서」에 들어갑니다. 그 둘은 다른
 * 아이인데 목록에 올라오고, 그런 짝이 몇 개만 섞여도 사람이 목록 전체를 믿지 않게 됩니다.
 *
 * 실제로 나뉘는 경우는 **부르는 이름만 적힌 줄과 성·미들네임까지 적힌 줄**입니다
 * (「제이콥」/「제이콥 딜런 마」, 「Jacob」/「Jacob Dylan Ma」). 긴 쪽에는 반드시 띄어쓰기가
 * 있고, 짧은 쪽은 그 앞 낱말과 정확히 같습니다. 그 모양만 봅니다.
 *
 * 「김민준서」는 한 낱말이라 걸리지 않습니다.
 */
export function isNamePrefix(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;

  const [shortW, longW] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  // 긴 쪽이 여러 낱말이어야 합니다. 한 낱말끼리는 「같은 이름」이거나 남남입니다.
  if (longW.length < 2 || shortW.length >= longW.length) return false;

  const shortKey = normName(shortW.join(""));
  // 두 글자짜리 조각으로 잇지 않습니다 - 「이준」이 「이준 서」와 「이준 우」 둘 다에 걸립니다.
  if (shortKey.length < 3) return false;

  return shortKey === normName(longW.slice(0, shortW.length).join(""));
}

/**
 * 같은 아이일 수 있는 줄끼리 묶습니다.
 *
 * 근거는 둘입니다.
 *   ① **이름 같음** — 확신이 강한 쪽. 대부분 여기서 끝납니다.
 *   ② **이름이 한쪽에 들어 있음** — 「제이콥」과 「제이콥 딜런 마」. 부르는 이름만 적힌
 *      줄과 성·미들네임까지 적힌 줄이 따로 만들어진 경우입니다.
 *
 * 두 근거를 한 목록에 섞지 않고 `reasons` 로 구분해 내보냅니다 - 화면이 나눠서 보여줘야
 * 약한 근거가 강한 근거의 신뢰를 깎지 않습니다.
 *
 * 동명이인이 실제로 있습니다(김재이 셋, 이준서 둘). 그래서 여기서는 **묶어서 보여주기만**
 * 하고, 같은 아이인지는 화면에서 사람이 정합니다.
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
      else if (isNamePrefix(a.name, b.name) || isNamePrefix(a.name_en ?? "", b.name_en ?? "")) {
        reason = "이름이 한쪽에 들어 있음";
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
    .sort(
      (a, b) =>
        // 확신이 강한 묶음(이름 같음)이 위. 아래로 갈수록 「확인이 더 필요한」 것이 옵니다.
        Number(b.reasons.includes("이름 같음")) - Number(a.reasons.includes("이름 같음")) ||
        b.people.length - a.people.length ||
        a.people[0].name.localeCompare(b.people[0].name, "ko"),
    );
}

// ── 합치면 칸이 어떻게 되는가 ────────────────────────────────────────────
//
// merge_students 의 규칙은 하나입니다. **남기는 줄의 빈 칸만 지우는 줄의 값으로 채웁니다.**
// 양쪽에 값이 있으면 남기는 쪽을 그대로 둡니다 — 둘 다 사람이 넣은 값이라 기계가 고르면
// 안 되기 때문입니다.
//
// 그런데 그 규칙이 화면에 안 보이면, 「합치면 저쪽 번호가 들어오겠지」라고 생각하고 눌렀다가
// 실제로는 저쪽 번호가 **버려집니다.** 중고등부처럼 보호자 번호 때문에 줄이 나뉜 경우엔
// 정확히 그 값이 사라집니다.
//
// 그래서 누르기 전에 보여줍니다. 이 함수는 화면에 띄우는 칸만 봅니다 — 그 밖의 칸도 같은
// 규칙으로 처리된다는 것은 화면 문구가 말합니다.

/** 사람이 읽는 칸 이름과 값을 꺼내는 법. 여기 없는 칸은 미리보기에 안 나옵니다. */
const PREVIEW_FIELDS: { label: string; get: (p: DupPerson) => string | null | undefined }[] = [
  { label: "생년월일", get: (p) => p.birth_date },
  { label: "영문 이름", get: (p) => p.name_en },
  { label: "학년", get: (p) => p.grade },
  { label: "반", get: (p) => p.class_name },
  { label: "어머니 연락처", get: (p) => p.mother_phone },
  { label: "아버지 연락처", get: (p) => p.father_phone },
  { label: "보호자 연락처", get: (p) => p.parent_phone },
];

const blank = (v: string | null | undefined) => !v || v.trim() === "";

export type MergePreview = {
  /** 남길 줄이 비어 있어 지울 줄에서 **채워질** 칸. */
  filled: { label: string; value: string }[];
  /**
   * 양쪽에 값이 있고 **서로 달라서 지울 줄 값이 버려지는** 칸.
   *
   * 이것이 이 미리보기의 존재 이유입니다. 조용히 버려지면 나중에 「번호가 왜 옛날 것이지」가
   * 되고, 그때는 버려진 값이 어디에도 없습니다.
   */
  dropped: { label: string; keep: string; drop: string }[];
};

export function mergePreview(keep: DupPerson, drops: DupPerson[]): MergePreview {
  const filled: MergePreview["filled"] = [];
  const dropped: MergePreview["dropped"] = [];

  for (const f of PREVIEW_FIELDS) {
    const keepV = f.get(keep);
    // 지울 줄이 여럿이면 **먼저 값이 있는 줄**이 채웁니다(merge_students 가 한 줄씩 도는 순서).
    const source = drops.find((d) => !blank(f.get(d)));
    if (!source) continue;
    const dropV = (f.get(source) ?? "").trim();

    if (blank(keepV)) filled.push({ label: f.label, value: dropV });
    else if ((keepV ?? "").trim() !== dropV) dropped.push({ label: f.label, keep: (keepV ?? "").trim(), drop: dropV });
  }

  return { filled, dropped };
}
