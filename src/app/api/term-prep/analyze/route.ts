import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { callClaudeJsonWithWebSearch } from "@/lib/ai/claude";
import { SHARED_CACHE_CONTEXT } from "@/lib/ai/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 학기 준비 AI 분석·제안(요청 ⑧, 사용자 선택: "AI가 분석 및 제안"). 지난 회차들의 돌아보기
// (잘된점/개선점/제안)와 준비 과정 회의록을 근거로, ① 종합 분석과 ② 타 학교(국제학교·마이크로
// 스쿨·대안학교 등) 참고 제안을 웹 검색을 곁들여 만들어 줍니다.
type Reflection = { year: string; good: string; lack: string; suggest: string };
type MeetingIn = { date: string; content: string };

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    termType?: string;
    year?: string;
    reflections?: Reflection[];
    meetings?: MeetingIn[];
  };
  const termType = (body.termType ?? "").trim();
  const year = (body.year ?? "").trim();
  if (!termType) return NextResponse.json({ error: "학기 유형이 없습니다." }, { status: 400 });

  const reflections = (body.reflections ?? []).filter((r) => r.good || r.lack || r.suggest);
  const meetings = (body.meetings ?? []).slice(0, 15);

  const reflectionText =
    reflections.length > 0
      ? reflections
          .map((r) => `- ${r.year}년\n  · 잘된 점: ${r.good || "(없음)"}\n  · 개선점: ${r.lack || "(없음)"}\n  · 제안: ${r.suggest || "(없음)"}`)
          .join("\n")
      : "(지난 회차 돌아보기 기록이 아직 없습니다.)";
  const meetingText =
    meetings.length > 0
      ? meetings.map((m) => `- ${m.date}: ${(m.content ?? "").slice(0, 400)}`).join("\n")
      : "(관련 회의록 없음)";

  const system =
    SHARED_CACHE_CONTEXT +
    "\n\n너는 GIA국제학교 행정팀이 다음 학기를 준비하도록 돕는 분석가다. " +
    "학교가 남긴 지난 회차 돌아보기와 회의록을 근거로, 과장 없이 실행 가능한 조언을 한국어로 준다. " +
    "타 학교 참고 제안은 웹 검색으로 실제 국제학교·마이크로스쿨·대안학교·영어 몰입 프로그램의 사례를 찾아 " +
    "구체적으로 제시하되, 출처(학교/기관명 또는 웹사이트)를 함께 적는다. GIA 상황(소규모 영어 국제 마이크로스쿨, " +
    "유치부·초등부·중고등부, 학기제 + 여름·겨울 캠프)에 맞게 현실적으로 조정한다.";

  const user =
    `준비 대상 학기: ${year}년 ${termType}\n\n` +
    `[지난 회차 돌아보기]\n${reflectionText}\n\n` +
    `[준비 과정 회의록 발췌]\n${meetingText}\n\n` +
    "위를 근거로 아래 JSON 하나만 출력해라(코드펜스 없이):\n" +
    "{\n" +
    '  "summary": "이 학기를 준비할 때 핵심적으로 챙길 점 2~3문장",\n' +
    '  "strengths": ["지난 회차에서 잘 되어 이어갈 점", "..."],\n' +
    '  "improvements": ["개선하거나 미리 대비할 점", "..."],\n' +
    '  "checklist": ["이번 학기 준비 체크리스트 항목", "..."],\n' +
    '  "otherSchools": [{"idea": "타 학교 참고 아이디어", "detail": "GIA에 어떻게 적용할지", "source": "학교/기관명 또는 URL"}]\n' +
    "}\n" +
    "strengths·improvements·checklist는 각 3~6개, otherSchools는 3~5개. 모든 문장은 한국어.";

  try {
    const result = await callClaudeJsonWithWebSearch(system, user, {
      route: "term-prep-analyze",
      maxTokens: 3500,
      maxSearches: 5,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
