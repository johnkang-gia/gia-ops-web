import type { ReactNode } from "react";

// 동명이인 표기 — 한 곳에서만 정합니다.
//
// 담당자: "업무보드든 어디든 동명이인 아이들이 나오는 경우(예를 들어 김재이) 반드시 학년과
//         반을 옆에 작게 표기해줘."
//
// **왜 공용 함수로 만드는가:** 지금까지 이 판단이 화면마다 따로 있었습니다. 출결 파서에는
// homonymLabel이, 탑승 배정에는 또 다른 표기가, 픽업 인박스에는 생년월일 괄호가 각각
// 있었습니다. 그래서 어떤 화면은 "김재이(G3JA)"로 뜨고 어떤 화면은 그냥 "김재이"로 떴습니다.
// 같은 아이를 두 화면에서 다르게 부르면, 그 둘이 같은 아이인지조차 확신할 수 없습니다.
//
// **왜 항상 붙이지 않는가:** 한 명뿐인 이름에까지 학년·반을 붙이면 화면이 글자로 가득 차고,
// 정작 구분이 필요한 이름이 묻힙니다. 그래서 **같은 이름이 둘 이상일 때만** 붙입니다.

export type NamedStudent = {
  name: string;
  grade?: string | null;
  class_name?: string | null;
  className?: string | null;
};

/**
 * 명부에서 **둘 이상 있는 이름**만 골라냅니다.
 *
 * 이름 앞뒤 공백과 가운데 공백은 무시합니다 - "김 재이"와 "김재이"는 같은 사람으로
 * 적히는 일이 흔합니다(교재비 시트에서 실제로 8쌍을 찾았습니다).
 */
export function buildHomonymSet(roster: readonly NamedStudent[]): Set<string> {
  const count = new Map<string, number>();
  for (const s of roster) {
    const k = normName(s.name);
    if (!k) continue;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

export function normName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, "").trim();
}

/** "3학년 Brown A" 처럼 사람이 읽는 한 덩이. 둘 다 없으면 빈 문자열. */
export function whereLabel(s: NamedStudent | null | undefined): string {
  if (!s) return "";
  const cls = s.class_name ?? s.className ?? null;
  // 반이 없는 학년(중고등)은 숫자만 뜨면 무슨 뜻인지 모릅니다. "9"가 아니라 "9학년"입니다.
  const grade = s.grade ? (cls ? `${s.grade}` : `${s.grade}학년`) : null;
  return [grade, cls].filter(Boolean).join(" ").trim();
}

export type IdentifiedStudent = NamedStudent & { id?: string | null };

/**
 * 화면에서 «이 줄은 몇 학년 몇 반인가»를 찾는 표 — **한 곳에서만 만듭니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 화면마다 `Map<이름, 학년·반>` 을 손으로 만들었습니다. 김재이가 셋인 학교에서 이름 하나에
 * 값 하나만 담기니 **마지막에 넣은 한 명의 반이 셋 모두에게** 붙었습니다.
 *
 *     16-1 김재이(G2A) → 화면에는 (G3JA)
 *     20호 김재이(G2C) → 화면에는 (G3JA)
 *
 * 구분하려고 붙인 표시가 오히려 셋을 하나로 만들었고, 오류가 아니라 «적혀 있는 값»이라
 * 보는 사람은 그대로 믿습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * **번호가 먼저입니다.** 번호는 겹치지 않습니다. 이름으로 찾는 길은 한 명뿐인 이름에만
 * 남깁니다 - 배정 줄에 번호가 안 붙은 옛 자료가 있어 아주 없앨 수는 없지만, 겹치는 이름에
 * 쓰면 다시 엉뚱한 반이 붙습니다.
 */
export type WhereMaps = {
  byId: Map<string, string>;
  /** 한 명뿐인 이름만 들어 있습니다. */
  byName: Map<string, string>;
  homonyms: Set<string>;
};

export function buildWhereMaps(roster: readonly IdentifiedStudent[]): WhereMaps {
  const homonyms = buildHomonymSet(roster);
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const s of roster) {
    const w = whereLabel(s);
    if (!w) continue;
    if (s.id) byId.set(s.id, w);
    const k = normName(s.name);
    if (!homonyms.has(k)) byName.set(k, w);
  }
  return { byId, byName, homonyms };
}

/**
 * 이 줄의 학년·반. **못 찾으면 null 입니다** - 엉뚱한 반을 적는 것보다 빈 것이 낫습니다.
 * 겹치는 이름인데 번호가 없는 줄이 여기 걸리고, 화면은 그걸 「?」로 알립니다.
 */
export function whereOf(maps: WhereMaps | null | undefined, studentId: string | null | undefined, name: string): string | null {
  if (!maps) return null;
  return (studentId ? maps.byId.get(studentId) : null) ?? maps.byName.get(normName(name)) ?? null;
}

/**
 * 이름 + (동명이인일 때만) 학년·반.
 *
 * `homonyms`를 넘기지 않으면 **항상** 붙입니다 - 이미 "이 이름은 겹친다"를 아는 자리에서
 * 쓰라는 뜻입니다.
 */
export function StudentName({
  student,
  homonyms,
  className = "",
  nameClassName = "",
  markClassName = "",
}: {
  student: NamedStudent;
  homonyms?: Set<string>;
  className?: string;
  nameClassName?: string;
  markClassName?: string;
}): ReactNode {
  const dup = !homonyms || homonyms.has(normName(student.name));
  const where = whereLabel(student);
  return (
    <span className={"inline-flex items-baseline gap-1 " + className}>
      <span className={nameClassName}>{student.name}</span>
      {dup && where && (
        <span
          className={"shrink-0 text-[9px] font-semibold text-[var(--g-muted)] " + markClassName}
          title={`같은 이름이 여러 명이라 ${where}을 함께 적습니다`}
        >
          {where}
        </span>
      )}
    </span>
  );
}
