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

/** 왜 같은 아이로 의심하는가. 이제 하나뿐입니다. */
export type DupReason = "이름 같음";

export type DupGroup = { key: string; reasons: DupReason[]; people: DupPerson[] };

/** 공백·가운뎃점·마침표를 빼고 소문자로. 「강 이제」와 「강이제」가 같아집니다. */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s·.,'-]/g, "");
}

/**
 * 이름이 같은 줄끼리 묶습니다.
 *
 * 동명이인이 실제로 있습니다(김재이 셋, 이준서 둘). 그래서 여기서는 **묶어서 보여주기만**
 * 하고, 같은 아이인지는 화면에서 사람이 정합니다 - 붙어 있는 기록·반·생년월일을 보고
 * 판단할 수 있게 화면이 그 값들을 함께 보여줍니다.
 */
export function findDuplicateGroups(people: DupPerson[]): DupGroup[] {
  const byName = new Map<string, DupPerson[]>();
  for (const p of people) {
    const key = normName(p.name);
    if (!key) continue;
    (byName.get(key) ?? byName.set(key, []).get(key)!).push(p);
  }

  return [...byName.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      key: g[0].id,
      reasons: ["이름 같음"] as DupReason[],
      // 먼저 만들어진 줄이 위. 대개 그쪽에 기록이 더 붙어 있습니다.
      people: g.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }))
    .sort((a, b) => b.people.length - a.people.length || a.people[0].name.localeCompare(b.people[0].name, "ko"));
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
