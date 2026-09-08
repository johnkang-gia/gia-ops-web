import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * 학생을 **반에 붙이는 한 곳**입니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 학생의 반이 두 칸에 나뉘어 있습니다.
 *
 *   · `wr_students.class_name` — 반 **이름**(글자). 「G2C」
 *   · `wr_students.class_id`   — 반 **연결**(wr_classes 의 id)
 *
 * 화면 대부분은 이름을 읽어 보여주고, 반 배정·시간표·교실 태블릿·담임 판정은 연결을
 * 읽습니다. 그런데 **쓰는 곳마다 둘 중 하나만** 채우고 있었습니다.
 *
 *   · 학생 추가·명부 표 → 이름만 씀. 그래서 반을 적어도 **배정이 안 됐습니다**
 *   · 구글시트 반영    → 이름만 씀. 같은 문제가 조용히 났습니다
 *   · 반 배정 화면     → 둘 다 씀(맞음)
 *
 * 화면에는 반 이름이 잘 보이니 사람은 다 된 줄 압니다. 그리고 반 배정 화면에 가서야
 * 「이 아이가 미배정에 있네」를 발견합니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * **반을 정하는 일은 이 함수만 합니다.** 이름을 받아 명부의 반을 찾고, 이름·연결·학년을
 * 한 번에 돌려줍니다. 어느 화면에서 고치든 같은 값이 들어갑니다.
 *
 * 못 찾으면 **연결을 비워 둡니다**(이름은 그대로 둡니다). 없는 반을 만들어내지 않습니다 -
 * 오타로 만들어진 반이 명부에 늘면 아무도 못 지웁니다. 대신 부르는 쪽이 「그런 반이
 * 없습니다」를 사람에게 알려줍니다.
 */

export type ClassRow = {
  id: string;
  grade: string | null;
  class_name: string | null;
};

/** 반 이름 비교용. 「G2 C」·「g2c」·「G-2C」를 같게 봅니다 - 사람은 띄어쓰기를 안 지킵니다. */
function norm(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

export type ClassAssignment = {
  class_id: string | null;
  class_name: string | null;
  /** 반을 찾았을 때 그 반의 학년. 학생에게 학년이 없으면 이걸로 채웁니다. */
  grade?: string | null;
};

/**
 * 반 이름으로 반을 찾습니다.
 *
 * 학년을 함께 주면 먼저 학년으로 좁힙니다 - 다른 학년에 같은 이름의 반이 있을 수 있습니다.
 */
export function findClass(className: string | null | undefined, classes: ClassRow[], grade?: string | null): ClassRow | null {
  const k = norm(className);
  if (!k) return null;
  const hits = classes.filter((c) => norm(c.class_name) === k);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1 && grade) {
    const g = norm(grade).replace(/[^0-9]/g, "");
    const byGrade = hits.filter((c) => norm(c.grade).replace(/[^0-9]/g, "") === g);
    if (byGrade.length === 1) return byGrade[0];
  }
  // 여럿인데 못 좁혔으면 고르지 않습니다. 엉뚱한 반에 넣는 것보다 미배정이 낫습니다 -
  // 미배정은 화면에 보이지만, 엉뚱한 반은 아무에게도 안 보입니다.
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 학생 표에 넣을 **반 관련 칸 전체**를 만듭니다. 저장하는 쪽은 이 결과를 그대로 펼쳐 씁니다.
 *
 * ```ts
 * const cls = assignClass("G2C", classes, "2");
 * await supabase.from("wr_students").insert({ name, ...cls });
 * ```
 */
export function assignClass(
  className: string | null | undefined,
  classes: ClassRow[],
  grade?: string | null,
): ClassAssignment {
  const name = String(className ?? "").trim();
  if (!name) return { class_id: null, class_name: null };
  const hit = findClass(name, classes, grade);
  return {
    class_id: hit?.id ?? null,
    // 찾았으면 **명부에 적힌 그대로** 씁니다. 「g2c」로 적어도 명부의 「G2C」로 통일됩니다 -
    // 표기가 갈리면 반별로 세는 화면이 두 줄로 나옵니다.
    class_name: hit?.class_name ?? name,
    ...(hit?.grade && !grade ? { grade: hit.grade } : {}),
  };
}

/** 지금 있는 반 목록. 부르는 쪽이 매번 같은 조건을 다시 쓰지 않게 여기 둡니다. */
export async function loadClasses(supabase: SupabaseClient): Promise<ClassRow[]> {
  const { data } = await supabase.from("wr_classes").select("id, grade, class_name").eq("is_demo", false);
  return (data as ClassRow[] | null) ?? [];
}
