import { isSharedAccount } from "./sharedAccounts";

/**
 * 업무 확인(✅)을 **누를 사람이 있는 계정인가.**
 *
 * 공용 계정(도서관 노트북 · 오리엔테이션 교육용)은 자리에 딸린 계정이지 사람이 아닙니다.
 * 도서관 노트북은 운영앱에 들어오지도 못하고, 오리엔테이션 계정은 신입교사 교육용이라
 * 실제 업무를 받지 않습니다.
 *
 * 그런데 [전체]로 업무를 등록하면 이 둘까지 담당자로 들어갔습니다. 아무도 못 누르니
 * 확인 현황이 영영 «3/5»에 멈춥니다. 몇 번 겪고 나면 그 숫자를 아무도 안 보게 되고,
 * 정작 진짜 안 누른 사람이 있어도 눈에 띄지 않습니다.
 */
export function isRealPerson(email: string | null | undefined): boolean {
  const v = (email ?? "").trim();
  if (!v) return false;
  return !isSharedAccount(v);
}

/** 사람이 쓰는 계정만 남긴 팀 목록. 담당자 고르기·[전체] 배정에 씁니다. */
export function realPeople<T extends { email: string }>(team: T[]): T[] {
  return team.filter((t) => isRealPerson(t.email));
}

/**
 * 이 업무를 **확인해야 하는 사람들.**
 *
 * 두 가지를 뺍니다.
 *   · 등록한 사람 — 자기가 낸 일을 자기가 확인할 이유가 없습니다.
 *   · 공용 계정 — 누를 사람이 없습니다.
 *
 * TaskCard 와 TaskDetailPanel 이 각자 같은 계산을 들고 있었습니다. 기준이 바뀔 때 한
 * 곳만 고치고 다른 곳을 잊으면 카드와 상세가 서로 다른 숫자를 보여주는데, 그러면 어느
 * 쪽이 맞는지 아무도 모릅니다.
 */
export function ackRequiredEmails(task: { assignee_emails: string[]; owner_email: string | null }): string[] {
  return (task.assignee_emails ?? []).filter((e) => e !== task.owner_email && isRealPerson(e));
}
