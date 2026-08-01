import type { TeamMember } from "./types";

// 이름이 아직 없는 계정(온보딩 전 레거시 데이터 등)을 위한 안전한 대체 표시입니다.
export function nameFor(team: TeamMember[], email: string): string {
  const member = team.find((t) => t.email === email);
  if (member?.name) return member.name;
  return email.split("@")[0];
}

// 채팅 메시지의 "@이름" 태그를 팀원 이름과 매칭해 실제 이메일 목록으로 변환합니다.
// 이메일이 길어서(예: hong.gildong@giamicro.com) 태그하기 불편하다는 이유로 이름 기반으로
// 바꿨습니다. 이름이 없는 사람은 태그로 지목할 수 없습니다(먼저 온보딩을 완료해야 함).
export function extractMentionedEmails(text: string, team: TeamMember[]): string[] {
  const tags = [...text.matchAll(/@([a-zA-Z0-9가-힣._-]+)/g)].map((m) => m[1]);
  return team.filter((t) => t.name && tags.includes(t.name)).map((t) => t.email);
}
