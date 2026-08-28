// 행선지를 그날 물어보고 정하는 학생(choice_group)을 다루는 규칙 한 곳.
//
// 담당자: "학원 요일이 고정이 아니고 꽤 자주 바뀌어서 특정해 놓으면 놓칠 수가 있어.
//          그리고 둘 다 안 타는 경우도 많아서, 애들은 둘 다 비워두고 행선지 물어보고
//          결정하면 그때 둘 중 하나로 배정하는 걸로 해줘."
//
// 규칙은 한 줄입니다: **choice_group이 있는 배정은, 오늘 탑승 줄이 생기기 전까지 어느
// 명단에도 나오지 않습니다.**
//
// 이 규칙을 화면마다 따로 쓰면 반드시 한 곳이 빠집니다. 그러면 한 화면에서는 안 보이는
// 아이가 다른 화면에서는 타는 것으로 나와, 지금 두 노선에 중복 배정된 것과 똑같은 위험이
// 생깁니다. 그래서 함수 하나로 모읍니다.

export type ChoiceAware = { choice_group?: string | null };

/**
 * 오늘 명단에서 숨겨야 하는 줄인가.
 *
 * @param assignment 배정(choice_group 칸 포함)
 * @param todayBoarding 오늘 이 배정의 탑승 줄. 없으면 null/undefined.
 */
export function isUndecidedChoice(assignment: ChoiceAware, todayBoarding: unknown): boolean {
  return !!assignment.choice_group && !todayBoarding;
}

/** 아직 행선지를 안 정한 묶음이 있는지. 화면 위쪽 경고를 띄울지 판단하는 데 씁니다. */
export function pendingChoiceNames(
  assignments: (ChoiceAware & { student_name_raw?: string | null })[],
  hasBoarding: (a: ChoiceAware & { id?: string }) => boolean
): string[] {
  const names = new Set<string>();
  for (const a of assignments) {
    if (!a.choice_group) continue;
    if (hasBoarding(a)) continue;
    const n = (a.student_name_raw ?? "").trim();
    if (n) names.add(n);
  }
  return [...names].sort((x, y) => x.localeCompare(y, "ko"));
}
