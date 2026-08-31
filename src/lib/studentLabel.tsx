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
  return [s.grade ? `${s.grade}` : null, cls].filter(Boolean).join(" ").trim();
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
