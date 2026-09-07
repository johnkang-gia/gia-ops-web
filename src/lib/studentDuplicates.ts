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
