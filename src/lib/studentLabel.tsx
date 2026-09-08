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
  /** 「이름|반」 → 학년·반. 배정 줄 이름에 「김재이(G2A)」처럼 반이 적혀 온 경우에 씁니다. */
  byNameClass: Map<string, string>;
  homonyms: Set<string>;
};

/** 반 이름 비교용. 「G2 A」·「g2a」·「G-2A」를 같게 봅니다 - 사람은 띄어쓰기를 안 지킵니다. */
function normClass(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

/** 「김재이(G2A)」 → 이름 「김재이」와 괄호 안 「G2A」. 괄호가 없으면 안쪽은 빈 값입니다. */
export function splitNameMark(raw: string): { name: string; mark: string } {
  const m = String(raw ?? "").match(/^([^（(]*)[（(]([^）)]*)[）)]/);
  if (!m) return { name: String(raw ?? "").trim(), mark: "" };
  return { name: m[1].trim(), mark: m[2].trim() };
}

export function buildWhereMaps(roster: readonly IdentifiedStudent[]): WhereMaps {
  const homonyms = buildHomonymSet(roster);
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  const byNameClass = new Map<string, string>();
  for (const s of roster) {
    const w = whereLabel(s);
    if (!w) continue;
    if (s.id) byId.set(s.id, w);
    const k = normName(s.name);
    if (!homonyms.has(k)) byName.set(k, w);
    const cls = normClass(s.class_name ?? s.className);
    if (cls) byNameClass.set(`${k}|${cls}`, w);
  }
  return { byId, byName, byNameClass, homonyms };
}

/**
 * 이 줄의 학년·반. 찾는 순서가 곧 믿는 순서입니다.
 *
 *   ① 학생 번호 - 겹치지 않으니 언제나 맞습니다
 *   ② 이름에 적혀 온 반 - 「김재이(G2A)」처럼 배정 줄에 손으로 적어둔 경우가 있습니다
 *   ③ 이름 - **한 명뿐인 이름에만** 씁니다
 *
 * **못 찾으면 null 입니다** - 엉뚱한 반을 적는 것보다 빈 것이 낫습니다. 겹치는 이름인데
 * 번호도 반 표기도 없는 줄이 여기 걸리고, 화면은 그걸 「?」로 알립니다.
 */
export function whereOf(maps: WhereMaps | null | undefined, studentId: string | null | undefined, name: string): string | null {
  if (!maps) return null;
  if (studentId) {
    const byId = maps.byId.get(studentId);
    if (byId) return byId;
  }
  // 배정 줄 이름은 「김재이(G2A)」처럼 괄호가 붙어 오기도 합니다. 괄호를 그대로 두고 찾으면
  // 명부의 「김재이」와 한 글자도 안 맞아 아무것도 안 뜹니다.
  const { name: bare, mark } = splitNameMark(name);
  const k = normName(bare);
  if (mark) {
    const hit = maps.byNameClass.get(`${k}|${normClass(mark)}`);
    if (hit) return hit;
  }
  return maps.byName.get(k) ?? null;
}

/**
 * 이 줄은 **사람이 한 번 더 봐야 하는가.**
 *
 * 같은 이름이 여럿인 아이의 줄입니다. 화면은 이 줄을 진하게 그려 「학년·반을 꼭 확인」하게
 * 합니다. 괄호를 떼고 보는 이유: 배정 줄에 「김재이(G2A)」로 적혀 있어도 그 이름은 여전히
 * 겹치는 이름입니다.
 *
 * 이름을 맞대는 판단 자체는 `buildHomonymSet` 이 이미 해뒀고, 여기서는 그 결과를 볼 뿐입니다.
 */
export function needsCheck(maps: WhereMaps | null | undefined, rawName: string): boolean {
  if (!maps) return false;
  return maps.homonyms.has(normName(splitNameMark(rawName).name));
}

/**
 * 화면에 쓸 이름. 괄호로 적힌 반은 뗍니다 - 학년·반은 옆에 따로 붙으므로 그대로 두면
 * 「김재이(G2A) 2 G2A」처럼 두 번 나옵니다.
 */
export function nameWithoutMark(raw: string): string {
  const { name, mark } = splitNameMark(raw);
  // 괄호 안이 반이 아닌 다른 말(별명 등)이면 그대로 둡니다 - 함부로 지우면 정보가 사라집니다.
  return mark && /^[A-Za-z0-9\s가-힣-]{1,8}$/.test(mark) && name ? name : String(raw ?? "");
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
