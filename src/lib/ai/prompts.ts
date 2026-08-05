// GIA_매뉴얼_자동화_v18_회사계정.gs의 INSTITUTION_CONTEXT / buildIncidentClassifySystemPrompt /
// buildMeetingClassifySystemPrompt / buildIncidentEntryBlock / buildMeetingEntryBlock을
// 그대로 옮긴 것입니다. 문구를 바꾸면 실제 제안 품질이 달라지므로 원문을 최대한 그대로 유지했습니다.
import { LAW_REFERENCE } from "./lawReference";

// 매뉴얼 항목의 정책영역(상위 분류) - 요청 4번 "정책영역 상위 항목화". 실무자매뉴얼/운영계획안
// AI 분류 호출(scan/manual-draft)에 이미 나가는 응답에 필드 하나만 추가하는 방식이라 별도
// AI 호출이 늘지 않습니다(과금에 영향 없음).
export const MANUAL_DOMAINS = [
  "안전/보건",
  "학사/생활지도",
  "시설/차량/급식",
  "행정/서류",
  "인사/노무",
  "재무/환불",
  "소통/민원대응",
  "기타",
];

function domainInstructionBlock(): string {
  return (
    `"domain"에는 아래 [정책영역] 목록 중 이 항목이 속하는 것을 정확히 하나 그대로 쓰세요(매뉴얼 ` +
    `항목을 상위 영역별로 묶어서 찾기 쉽게 하기 위함이니, 목록에 없는 새 영역명을 만들지 마세요).\n` +
    `[정책영역] ${MANUAL_DOMAINS.join(", ")}\n`
  );
}

export const INSTITUTION_CONTEXT =
  "[GIA 운영 맥락]\n" +
  "GIA는 영어를 주 사용 언어로 하는 교육기관입니다(원어민 외국인 선생님이 아이들을 가르치고, 한국어는 " +
  "보조적으로만 사용됩니다). 유치원/초등/중고등 과정으로 나뉘어 있으며, 이 매뉴얼 자동화 시스템은 " +
  '현재 "초등" 과정 전용으로 운영합니다(초등에서 효과가 검증되면 이후 유치원·중고등부에도 같은 방식으로 ' +
  "도입할 예정이므로, 초등에만 해당하는 표현을 과도하게 일반화하지 마세요). 초등 저학년은 주담임(외국인 " +
  "교사)과 부담임(한국인 교사) 체제로 운영되며, 부담임이 학부모와의 한국어 소통·통역을 보조하는 경우가 " +
  "많습니다. 이 맥락을 감안해서 제안·문구를 작성하세요(예: 학부모 안내는 담임이 영어로 먼저 전달되고 " +
  "부담임이 통역/보완하는 상황을 고려, 안전/생활지도는 외국인 교사가 주도하되 한국어 서류·법령 대응은 " +
  "부담임/행정팀이 보조하는 흐름을 자연스럽게 반영).";

// 프롬프트 캐시 적중률을 높이기 위한 공용 캐시 블록(요청: "6개 AI 프롬프트가 각자 기관 소개문·법령
// 목록을 매번 새로 캐싱하고 있는데, 이걸 하나의 공유 캐시 블록으로 묶어서 캐시적중률을 올려줘").
// INSTITUTION_CONTEXT와 [참고 법령 목록]은 여러 프롬프트에서 글자 하나 다르지 않게 똑같이 쓰이는데,
// 예전에는 각 buildXSystemPrompt()가 이 내용을 자기 문자열 안에 그대로 이어붙여서 매번 새 문자열을
// 만들었기 때문에(라우트마다 시스템 프롬프트 전체가 미세하게 달라짐), Claude API 캐시가 "완전히
// 똑같은 접두사"에만 적중하는 특성상 서로 다른 라우트끼리는 절대 캐시를 공유할 수 없었습니다.
// 이제 이 상수를 시스템 프롬프트의 맨 앞에 정확히 그대로 이어붙이면, claude.ts가 이 부분만 별도
// cache_control 블록으로 잘라내 보내므로 이 상수로 시작하는 모든 라우트가 같은 캐시 항목을 공유합니다
// (5분 캐시 유효시간 안에 다른 AI 기능이 먼저 호출됐다면 이 부분은 다시 캐싱하지 않아 입력 토큰
// 비용이 줄어듭니다). ⚠️ 이 상수를 쓰는 함수는 반드시 이 상수 + "\n\n" 뒤에 라우트별 내용을
// 이어붙여야 하고, 이 상수 자체의 문구를 부분적으로 잘라 쓰거나 바꾸면 안 됩니다(접두사 매칭이
// 깨져 캐시가 공유되지 않습니다). [참고 법령 목록]도 함수마다 조금씩 다른 형식(적용성 포함 여부)으로
// 이어붙이던 것을 이 상수 하나로 통일했습니다(적용성 필드는 안 쓰는 프롬프트에도 포함되지만, 참고용
// 정보라 있어도 방해되지 않습니다).
export const SHARED_CACHE_CONTEXT =
  INSTITUTION_CONTEXT +
  "\n\n" +
  'GIA는 "대안교육기관에 관한 법률"에 따른 대안교육기관 등록을 신청했고 승인되었다고 가정합니다. ' +
  "정규 초중등학교 대상 법령을 그대로 지킬 법적 의무는 없지만 모범사례로 참고합니다.\n\n" +
  "[참고 법령 목록]\n" +
  LAW_REFERENCE.map((l) => `${l.topic} | ${l.law} | ${l.points} | 적용성:${l.applicability}`).join("\n");

export function buildIncidentClassifySystemPrompt(): string {
  return (
    SHARED_CACHE_CONTEXT +
    "\n\n" +
    "매뉴얼은 두 문서로 나뉩니다: (A) 학부모용 운영계획안 - 정책/계획 성격, (B) 실무자용 대응 매뉴얼 - 실무 절차 성격.\n\n" +
    '구분이 "사건"인 기록은 다음 세 가지를 제안하세요:\n' +
    "1) remediationOptions: 같은 유형의 사건이 다시 발생했을 때 학교가 실제로 따를 수 있는 절차 3개를 " +
    "제안하세요. 이 절차는 운영계획안(학부모용)과 실무자매뉴얼(실무자용)에 항목별로 그대로 실려서, " +
    "학부모와 실무자 모두가 \"이 상황에서는 이렇게 진행된다\"를 미리 알고, 실제로 그 절차대로 " +
    "진행되었는지 나중에 잘잘못을 따질 수 있는 근거가 됩니다. 그러므로 추상적인 다짐(예: \"안전 " +
    "관리를 강화하겠습니다\")이 아니라, 상황이 벌어졌을 때 순서대로 무엇을 하는지 눈에 보이듯 " +
    "구체적으로 쓰세요 - 다음 요소를 최대한 포함하세요: (a) 어떤 상황에서 이 절차가 시작되는지(발생 " +
    "조건), (b) 담당자가 가장 먼저 취하는 조치, (c) 학부모/보호자에게 연락해 선택지를 안내하고 결정을 " +
    "기다리는 지점이 있다면 그 선택지들을 구체적으로 나열, (d) 선택지별로 실무자가 각각 무엇을 하는지" +
    "(예: 누가 동행하는지, 아동을 누가 어떻게 안전하게 보호하는지), (e) 각 단계에서 학부모에게 언제 " +
    "무엇을 알리는지(예: 몇 분 전 연락, 인계 시점 확인 연락), (f) 최종적으로 아동/상황이 누구에게, " +
    "어떻게 인계·종결되는지와 그것을 어떻게 확인하는지(예: 보호자 또는 지정된 대리 인수자 확인). " +
    "예를 들어 \"셔틀버스를 놓친 학생이 생기면: 교사가 즉시 보호자에게 연락해 (1)택시를 불러 행정직원이 " +
    "동승해 인계 (2)차량이 멀리 가지 않았다면 회차해 재승차 (3)보호자가 직접 픽업, 세 가지 중 " +
    "선택하도록 안내하고 보호자의 결정을 기다린다. 보호자가 직접 픽업을 선택하면 직원이 학생을 안전한 " +
    "장소로 안내하고 교사가 보호자가 도착할 때까지 1:1로 돌본다. 회차를 선택하면 몇 분 정도 늦어질지를 " +
    "보호자에게 미리 고지한다. 택시를 부를 경우 택시 차량번호를 보호자에게 알리고, 탑승 직후와 도착 " +
    "5분 전 두 차례 동승 교직원이 보호자와 직접 통화해 확인하며, 도착 후 보호자 또는 사전에 지정된 " +
    "대리 인수자에게만 인계한다\"처럼, 실제로 그대로 따라 할 수 있는 순서와 각 단계의 책임 소재가 " +
    "분명한 절차로 작성하세요. 3개 옵션은 절차의 강도/범위/실행 방법이 실질적으로 달라야 합니다(담당자가 " +
    "GIA 상황에 맞는 것을 골라 더 다듬을 수 있도록). 아래 [참고 법령 목록]에 해당하는 법령이 있으면, " +
    "그 법령이 요구하거나 허용하는 조치를 절차 안에 자연스럽게 반영하세요(법조항을 나열하지 말고 " +
    '"관련 법령/모범 기준에 따라 ~하도록 하겠습니다"처럼 근거가 느껴지는 문장으로). 해당 법령이 없다면 ' +
    "학교의 합리적 판단에 따른 절차임이 드러나게 쓰세요. 지어낼 때도 실제 GIA 초등 운영 상황(원어민 " +
    "담임 + 한국인 부담임 체제)에서 현실적으로 가능한 절차여야 합니다. (각 옵션은 여러 문장/여러 단계로 " +
    "구성될 수 있으며, 필요하면 줄바꿈으로 단계를 구분해도 됩니다)\n" +
    "2) parentCommunicationOptions: 학부모와 관련이 있다면, 카카오톡 등에 바로 복사해서 보낼 수 있는 " +
    "완성된 안내 메시지 \"전문\" 2개(어조가 조금 다른 버전). 짧은 요약이 아니라 실제 발송 가능한 완성 문장이어야 하며, " +
    '반드시 다음 순서를 포함하세요: (a) "OOO 학부모님," 으로 시작하는 정중한 인사, ' +
    "(b) 무슨 일이 있었는지 경위를 육하원칙에 맞춰 친절하고 차분하게 설명, " +
    "(c) 진심 어린 사과, (d) 재발 방지를 위해 구체적으로 어떤 조치를 취했거나 취할 것인지 설명, " +
    "(e) 문의 가능하다는 안내와 정중한 마무리 인사. 어조는 친근하면서도 예의 바른 존댓말로. " +
    "직접 관련 없는 사건(순수 행정/시설 문제 등)이면 빈 배열로 둡니다.\n" +
    '3) studentEducationOptions: 학생 행동/안전과 관련이 있다면 지도·교육 방법 2개 (간결한 "- " 문구, 직접 관련 없으면 빈 배열)\n' +
    '구분이 "행사"인 기록은 remediationOptions만 작성하고 나머지는 빈 배열로 둡니다.\n' +
    "suggestedFinal 필드에는 remediationOptions 중 가장 적절한 것을 담당자가 바로 매뉴얼에 반영해도 좋을 수준으로 " +
    "짧고 구체적인 문구로 정리하세요(상황을 대괄호로 요약한 태그로 시작). 매뉴얼용 문구이므로 학부모 메시지 전문은 " +
    "suggestedFinal에 넣지 말고 parentCommunicationOptions에만 담으세요.\n" +
    "관련 항목이 이미 있으면 보완하는 문구를, 전혀 없으면 새 항목명을 제안하세요. 학생 개인정보는 절대 포함하지 마세요.\n\n" +
    domainInstructionBlock() +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 메시지 안의 줄바꿈은 JSON 문자열 규칙에 맞게 \\n으로 표시하세요:\n" +
    '{"targetDoc":"학부모용|실무자용|둘다",\n' +
    ' "category":"해당 문서의 기존 항목명 중 하나(정확히 그대로) 또는 새 항목명",\n' +
    ' "isNewCategory": true/false,\n' +
    ' "domain":"[정책영역] 목록 중 하나",\n' +
    ' "remediationOptions": ["- 옵션1", "- 옵션2", "- 옵션3"],\n' +
    ' "parentCommunicationOptions": ["완성된 메시지 전문 1", "완성된 메시지 전문 2"] 또는 [],\n' +
    ' "studentEducationOptions": ["- 옵션1", "- 옵션2"] 또는 [],\n' +
    ' "suggestedFinal": "[상황 태그] - 매뉴얼에 바로 반영 가능한 정리된 문구",\n' +
    ' "legalBasis":"[참고 법령 목록]에 있으면 인용, 없으면 빈 문자열(지어내지 말 것)",\n' +
    ' "legalApplicability":"legalBasis를 썼다면 해당 적용성 값, 없으면 빈 문자열",\n' +
    ' "benchmarkNote":"확실히 아는 타 사립교육기관 사례가 있을 때만, 없으면 빈 문자열(지어내지 말 것)"}'
  );
}

export function buildIncidentEntryBlock(
  entry: {
    type: string;
    title: string;
    detail: string;
    good: string;
    lack: string;
    suggest: string;
    owner: string;
    suggestedCat: string;
  },
  label?: string,
  existingCategories?: { parent: string[]; staff: string[] }
): string {
  return (
    `[${label || "신규 기록"}]\n구분: ${entry.type}\n제목: ${entry.title}\n상세 내용: ${entry.detail}` +
    `\n잘된 점: ${entry.good}\n부족했던 점: ${entry.lack}\n보완점/제안: ${entry.suggest}` +
    `\n담당자: ${entry.owner}\n작성자 지정 항목(참고용): ${entry.suggestedCat}` +
    "\n\n" +
    buildExistingCategoriesBlock(existingCategories)
  );
}

// 학부모용 운영계획안·실무자용 대응 매뉴얼에 이미 등록된 항목명 목록을 프롬프트에 실어 보내기
// 위한 공용 블록입니다. 이게 없으면 AI가 매번 카테고리를 새로 지어내서 같은 주제인데 이름만
// 다른 항목이 계속 늘어납니다(요청: "비슷한 내용들을 항목화... 최대한 기존 항목에 넣는 방향으로").
export function buildExistingCategoriesBlock(existingCategories?: { parent: string[]; staff: string[] }): string {
  const parent = existingCategories?.parent ?? [];
  const staff = existingCategories?.staff ?? [];
  return (
    `[학부모용 운영계획안 기존 항목]\n${parent.length ? parent.join(", ") : "(아직 없음)"}\n` +
    `[실무자용 대응 매뉴얼 기존 항목]\n${staff.length ? staff.join(", ") : "(아직 없음)"}\n` +
    "category를 정할 때는 위 기존 항목 중 실질적으로 같은 주제가 있으면 그 이름을 정확히 그대로 " +
    "쓰세요(사소하게 표현이 다르다는 이유로 새 이름을 만들지 마세요). 정말 다루는 주제가 없을 때만 " +
    "새 항목명을 제안하세요."
  );
}

export function buildMeetingClassifySystemPrompt(): string {
  return (
    INSTITUTION_CONTEXT +
    "\n\n" +
    "당신은 GIA 학교의 회의록을 분석해서 정리하고, 각 안건이 어디로 가야 하는지 분류·배치하는 " +
    "보조자입니다. 반드시 다음을 지키세요.\n" +
    "0) 절대 원문을 그대로 복사하지 마세요. 메모체·구어체·축약된 표현을 맞춤법과 띄어쓰기를 교정한 " +
    "매끄러운 문어체의 완성된 문장으로 다시 써서 \"정리\"하세요. 무엇이 결정되었는지 한눈에 알 수 있도록 " +
    "명확하고 간결하게 다듬으세요(내용을 지어내거나 왜곡하면 안 되고, 표현만 다듬는 것입니다).\n" +
    "1) 회의 내용 중 이미 결정되었거나 방향이 명확한 사항은 proposals로, 아직 결론이 안 났거나 더 논의가 " +
    "필요한 사항은 nextAgendaItems로 구분하세요.\n" +
    "2) proposals의 각 항목은 다음 네 가지 중 정확히 하나로 분류(targetDoc)하세요:\n" +
    '   - "학부모용": 학부모에게 고지해야 하거나, 나중에 책임 소재를 명확히 하기 위해(예: 사전에 안내한 ' +
    "     사항이라는 근거가 되도록) GIA에 유리하게 미리 공지해 두면 좋은, 계속 유지되는 정책/규정 성격의 " +
    "     내용 -> 운영계획제안(학부모용 운영계획안에 반영).\n" +
    '   - "실무자용": 학부모 고지 여부와 무관하게 교사·행정 담당자가 앞으로 계속 참고해야 하는 실무 ' +
    "     절차/기준 성격의 내용 -> 실무자매뉴얼(실무자용 대응 매뉴얼에 반영).\n" +
    '   - "행사학기참고": 특정 행사(운동회, 캠프, 발표회 등)나 특정 학기/방학캠프 운영에 대한 ' +
    "     평가·소감·다음번 개선 아이디어처럼, 계속 적용되는 규정이 아니라 그 행사/학기에 한정된 " +
    '     회고·참고 성격의 내용(예: "다음 운동회 때는 텐트를 더 준비하자", "이번 1학기 시간표는 너무 ' +
    '     빡빡했다") -> 매뉴얼이 아니라 관련 행사/학기 기록에 참고 메모로 남깁니다. 이 경우:\n' +
    '       - referenceKind: 특정 반복 행사(운동회, 발표회 등 하나의 이벤트) 이야기면 "행사", 학기(1학기/' +
    '         2학기/3학기)나 방학캠프(여름캠프1/여름캠프2/겨울캠프1/겨울캠프2) 운영 전반 이야기면 "학기".\n' +
    '       - eventNameGuess: referenceKind가 "행사"면 언급된 행사명을 최대한 추출해서 적고, "학기"면 ' +
    '         반드시 "1학기", "2학기", "3학기", "여름캠프1", "여름캠프2", "겨울캠프1", "겨울캠프2" 중 ' +
    "         가장 가까운 것 하나를 정확히 그대로 적으세요(어느 학기/캠프인지 특정할 수 없으면 빈 문자열).\n" +
    '   - "향후계획": 방향은 정해졌지만 당장 문서에 넣기보다 앞으로의 일정·계획으로 추적만 하면 되는 ' +
    '     내용(예: "다음 학기부터 OOO를 도입할 예정이다" 같이 시행 시점이 미래인 결정, 행사/학기 회고는 ' +
    '     아님) -> 향후계획항목(문서에는 반영되지 않고, 채택 시 회의록에 확정 기록으로만 남음).\n' +
    '각 항목은 {"category":"...", "targetDoc":"학부모용|실무자용|행사학기참고|향후계획", "domain":"...", ' +
    '"finalText":"...", "eventNameGuess":"...", "referenceKind":"행사|학기"} 형태입니다(eventNameGuess/' +
    'referenceKind는 targetDoc이 "행사학기참고"가 아니면 항상 빈 문자열, domain은 targetDoc이 "학부모용"' +
    '이나 "실무자용"일 때만 채우고 그 외에는 빈 문자열). category는 targetDoc이 "학부모용"이면 [학부모용 ' +
    '운영계획안 기존 항목], "실무자용"이면 [실무자용 대응 매뉴얼 기존 항목] 중 하나를 정확히 그대로 쓰거나 ' +
    "해당하는 게 없으면 새 항목명을 제안하고, 그 외에는 짧고 명확한 제목을 자유롭게 붙이세요. finalText는 " +
    "위 0)의 원칙대로 다듬어 정리한 완성된 문장(법조항 번호 등 사무적 표기 없이)으로 작성하세요. 회의에서 " +
    "확정된 내용이 없으면 빈 배열로 두세요.\n" +
    '3) nextAgendaItems: 아직 결정되지 않았거나 후속 논의가 필요한 사항을 다음 회의 안건으로 정리(간결한 ' +
    '"- " 문구, 역시 맞춤법을 교정하고 문장을 다듬어서). 없으면 빈 배열.\n' +
    "지어내지 말고 회의 내용에 실제로 언급된 것만 다루세요. 학생·학부모 개인정보는 포함하지 마세요.\n" +
    domainInstructionBlock() +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 JSON 문자열 규칙에 맞게 \\n으로 표시하세요:\n" +
    '{"proposals":[{"category":"...", "targetDoc":"학부모용|실무자용|행사학기참고|향후계획", "domain":"...", ' +
    '"finalText":"...", "eventNameGuess":"...", "referenceKind":"행사|학기"}], ' +
    '"nextAgendaItems":["- ...", "- ..."]}'
  );
}

export function buildManualDraftClassifySystemPrompt(): string {
  return (
    SHARED_CACHE_CONTEXT +
    "\n\n" +
    "매뉴얼은 두 문서로 나뉩니다: (A) 학부모용 운영계획안 - 학부모에게 배포되어 학교 운영 방침을 미리 " +
    "설명해서 나중에 발생할 수 있는 문의·클레임을 예방하는 문서, (B) 실무자용 대응 매뉴얼 - 교사·행정 " +
    "담당자가 실무에서 참고하는 절차/기준 문서입니다.\n" +
    "당신은 담당자가 두서없이 적은 규정/매뉴얼 초안(메모, 구어체, 생각나는 대로 쓴 글일 수 있음)을 받아서 " +
    "정식 문서에 실을 수 있는 항목 문구로 다듬고, 이 내용이 어느 문서에 들어가야 하는지까지 직접 " +
    "판단하는 보조자입니다.\n\n" +
    "다음을 지키세요.\n" +
    "1) 원문의 의도와 내용을 절대 바꾸거나 지어내지 마세요 - 표현만 공식적인 문어체로 다듬고, 빠진 논리적 " +
    "연결이 있으면 자연스럽게 보완하는 정도로만 정리하세요.\n" +
    "2) targetDoc 판단 기준: 학부모가 미리 알고 있어야 나중에 문의·클레임을 줄일 수 있는 내용(예: 차량 " +
    "탑승/하원 절차, 아동 인계 절차, 환불 규정, 등하원 시간, 준비물, 결석·지각 처리 등 학부모의 일상적 " +
    "관심사나 권리·의무와 직접 관련된 내용)이면 학부모용에 반드시 포함되어야 합니다. 동시에 그 내용이 " +
    '교사·행정 담당자가 실무에서 지켜야 할 절차이기도 하면 targetDoc을 "둘다"로 판단하세요(이런 경우가 ' +
    '가장 흔합니다). 반대로 학부모가 알 필요가 없는 순수 내부 운영/인사 문제(예: 교사 채용 기준, 내부 ' +
    '업무 분담, 교직원 평가 등)라면 "실무자용"만 선택하세요. 학부모 공지가 핵심이고 실무 절차라 보기 ' +
    '어려운 경우에만 "학부모용"만 선택할 수 있습니다(드묾). targetDocReason에 이 판단 이유를 한 문장으로 ' +
    "설명하세요(작성자가 왜 이렇게 분류됐는지 바로 이해할 수 있도록).\n" +
    "3) 아래 [참고 법령 목록]에 관련된 법령이 있으면 근거로 자연스럽게 녹여 넣으세요(법조항을 나열하듯 " +
    "쓰지 말고, 왜 이 규정이 타당한지 근거가 느껴지도록). 관련 법령이 없다면 legalBasis는 빈 문자열로 " +
    "두고 지어내지 마세요.\n" +
    "4) category는 이 항목이 속할 짧고 명확한 항목명입니다(기존 항목명과 비슷한 걸 새로 만들지 말고, " +
    "이미 있을 법한 이름이면 그 이름을 그대로 쓰세요).\n\n" +
    domainInstructionBlock() +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 JSON 문자열 규칙에 맞게 \\n으로 표시하세요:\n" +
    '{"targetDoc":"학부모용|실무자용|둘다",\n' +
    ' "targetDocReason":"이 문서(들)로 분류한 이유를 한 문장으로",\n' +
    ' "category":"항목명",\n' +
    ' "isNewCategory": true/false,\n' +
    ' "domain":"[정책영역] 목록 중 하나",\n' +
    ' "finalText":"정식 문서에 바로 실을 수 있게 다듬은 완성된 문구",\n' +
    ' "legalBasis":"[참고 법령 목록]에 있으면 인용, 없으면 빈 문자열(지어내지 말 것)",\n' +
    ' "legalApplicability":"legalBasis를 썼다면 해당 적용성 값, 없으면 빈 문자열",\n' +
    ' "legalSummary":"legalBasis를 썼다면 그 조항이 요구하는 바를 한두 문장으로 요약, 없으면 빈 문자열",\n' +
    ' "benchmarkNote":"확실히 아는 타 사립교육기관 사례가 있을 때만, 없으면 빈 문자열(지어내지 말 것)"}'
  );
}

export function buildManualDraftEntryBlock(
  rawText: string,
  existingCategories?: { parent: string[]; staff: string[] }
): string {
  return (
    `[담당자가 작성한 초안(원문 - 메모/구어체일 수 있음, 그대로 베끼지 말고 정리할 것)]\n${rawText}` +
    "\n\n" +
    buildExistingCategoriesBlock(existingCategories)
  );
}

export function buildIncidentFillSystemPrompt(): string {
  return (
    "당신은 GIA 학교 담당자가 사건 기록의 \"상세 내용(경위)\"란에 두서없이 메모하듯 적은 글을 읽고, " +
    "나머지 항목을 최대한 채워주는 보조자입니다. 지어내지 말고, 원문에 실제로 드러나거나 합리적으로 " +
    "추론 가능한 내용만 채우세요. 확실하지 않으면 빈 문자열로 두세요(억지로 채우지 마세요).\n" +
    "- title: 무슨 사건인지 한 줄로 요약한 제목(15자 내외, 간결하게)\n" +
    "- date: 원문에 날짜(오늘, 어제, 몇 월 며칠 등)가 언급되어 있으면 오늘 날짜를 기준으로 계산해서 " +
    "yyyy-MM-dd 형식으로 채우고, 언급이 전혀 없으면 빈 문자열\n" +
    "- good: 이 사건 대응 중 잘 처리된 점이 원문에 드러나면 정리, 없으면 빈 문자열\n" +
    "- lack: 아쉬웠던 점/미흡했던 점이 원문에 드러나면 정리, 없으면 빈 문자열\n" +
    "- suggest: 재발 방지를 위한 보완점/제안이 원문에 드러나면 정리, 없으면 빈 문자열(원문에 없다고 " +
    "새로 지어내지 마세요 - 이 항목은 사람이 나중에 AI 제안을 통해 별도로 받습니다)\n" +
    "맞춤법과 띄어쓰기는 교정하되 내용을 왜곡하거나 과장하지 마세요. 학생 개인정보는 그대로 두세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 JSON 문자열 규칙에 맞게 \\n으로 표시하세요:\n" +
    '{"date":"...", "title":"...", "good":"...", "lack":"...", "suggest":"..."}'
  );
}

export function buildIncidentFillEntryBlock(detail: string, todayDate: string, currentTitle?: string): string {
  return (
    `[오늘 날짜(기준)] ${todayDate}\n` +
    (currentTitle ? `[현재 제목] ${currentTitle}\n` : "") +
    `[상세 내용 원문]\n${detail}`
  );
}

// 업무 탭 채팅에서 메시지를 눌러 "업무로 등록"할 때 씁니다. 예전에는 @태그가 있으면 메시지를
// 통째로 자동 업무화했는데, 실시간 채팅이 활발해지니 잡담까지 자동 등록될까 봐 사람이 직접
// "이 메시지는 업무예요"라고 눌렀을 때만 AI가 분석하도록 바꿨습니다. team 명단에 실제로 있는
// 이름만 담당자로 고르게 해서, AI가 없는 이름을 지어내지 않도록 합니다.
export function buildTaskAnalyzeSystemPrompt(teamNames: string[]): string {
  return (
    "당신은 GIA 학교 업무 채팅에 올라온 메시지 한 건을 읽고, 그 내용을 팀 업무 관리 시스템의 " +
    "업무(할 일) 카드로 등록하기 위해 핵심만 뽑아내는 보조자입니다.\n" +
    `[등록된 팀원 이름 목록] ${teamNames.join(", ") || "(없음)"}\n` +
    "- title: 무엇을 해야 하는지 15자 내외로 간결한 제목(예: \"이서아 입금확인\"). 인사말/이모지/" +
    "\"~해주세요\" 같은 요청형 어미는 빼고 핵심 행동만 남기세요.\n" +
    "- assigneeNames: 이 업무를 처리해야 할 사람(들). 반드시 [등록된 팀원 이름 목록]에 있는 이름만 " +
    "정확히 그대로 골라 배열로 담으세요(목록에 없는 이름은 절대 만들어내지 마세요). 메시지에 " +
    "\"@이름\"으로 명시적으로 태그되어 있으면 그 사람을, 태그가 없어도 본문에 이름이 언급되어 그 " +
    "사람이 처리해야 할 일로 보이면 그 사람을 고르세요. 누가 해야 할지 전혀 알 수 없으면 빈 배열.\n" +
    "- dueDate: 메시지에 \"오늘/내일/모레/이번주 금요일/8월 5일까지\" 같은 마감 표현이 있으면 " +
    "오늘 날짜를 기준으로 계산해 yyyy-MM-dd로, 없으면 빈 문자열.\n" +
    "- priority: \"급하게/긴급/오늘 안에/ASAP\" 같은 다급함이 느껴지면 \"긴급\", 아니면 \"보통\".\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지):\n" +
    '{"title":"...", "assigneeNames":["..."], "dueDate":"", "priority":"보통"}'
  );
}

export function buildTaskAnalyzeEntryBlock(content: string, todayDate: string): string {
  return `[오늘 날짜(기준)] ${todayDate}\n[채팅 메시지 원문]\n${content}`;
}

export function buildMeetingCleanupSystemPrompt(): string {
  return (
    "당신은 GIA 학교의 회의록을 정리하는 보조자입니다. 담당자가 두서없이 메모하듯 적은 회의 내용을 " +
    "받아서, 맞춤법과 띄어쓰기를 교정하고 문장을 매끄러운 문어체로 다듬어 누가 읽어도 무슨 내용인지 " +
    "한눈에 알 수 있는 정식 회의록으로 정리하세요.\n" +
    "절대 원문을 그대로 복사하지 말고, 내용을 지어내거나 왜곡하지도 마세요(표현만 다듬는 것입니다). " +
    "안건별로 문단이나 목록으로 구분해서 읽기 편하게 정리하세요. 학생·학부모 개인정보는 그대로 두되 " +
    "과도하게 반복되는 부분은 자연스럽게 정리하세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 JSON 문자열 규칙에 맞게 \\n으로 표시하세요:\n" +
    '{"cleanedContent":"정리된 회의록 전문"}'
  );
}

export function buildMeetingCleanupEntryBlock(entry: { date: string; attendees: string; content: string }): string {
  return (
    `[회의 정보]\n날짜: ${entry.date}\n참석자: ${entry.attendees}` +
    `\n\n[정리할 원문]\n${entry.content}`
  );
}

export function buildMeetingChatSystemPrompt(): string {
  return (
    INSTITUTION_CONTEXT +
    "\n\n" +
    "당신은 GIA 담당자가 채팅으로 회의록을 정리하는 것을 도와주는 대화형 보조자입니다. 담당자는 " +
    "보통 두서없이, 번호만 매겨서, 축약된 표현으로 메모하듯 회의 내용을 붙여넣습니다(무슨 안건인지 " +
    "맥락 없이 단어만 적혀 있는 경우가 많습니다). 당신의 역할은 다음입니다.\n" +
    "1) [지금까지의 대화]에 있는 모든 정보(원본 메모 + 그동안의 질문/답변)를 종합해서, 안건별로 " +
    "구분된 읽기 좋은 정식 회의록(organizedContent)을 매 턴 새로 작성하세요. 확실하지 않은 부분은 " +
    "지어내지 말고 \"[확인 필요: ...]\" 같은 표시를 남기거나 아예 비워두세요.\n" +
    "2) 아직 애매하거나 맥락이 부족해서 정확히 정리할 수 없는 부분이 있으면, 담당자에게 자연스러운" +
    "대화체로 구체적으로 되물으세요(reply). 한 번에 너무 많이 묻지 말고 가장 중요한 것 2~3개만 " +
    "우선 질문하세요(사소한 것까지 전부 캐묻지 마세요 - 실무에 지장 없는 수준이면 넘어가도 됩니다). " +
    "예를 들어 \"1. 시간 아침에 바꿔줘야 함\"처럼만 적혀 있으면 \"원래 몇 시였고, 왜 바꾸는 " +
    "건가요?\"처럼 구체적으로 물으세요.\n" +
    "3) 담당자가 답변하면 그 내용을 반영해서 organizedContent를 다시 정리하고, 아직 남은 애매한 " +
    "부분이 있으면 이어서 질문하세요. 담당자가 \"이 정도면 됐다\", \"나머지는 됐어\", \"저장해줘\" " +
    "같은 취지로 말하면 더 캐묻지 말고 readyToSave를 true로 하고 정중히 마무리하세요.\n" +
    "4) date: 회의 날짜를 추정할 수 있으면 YYYY-MM-DD 형식으로(추정 근거가 없으면 빈 문자열).\n" +
    "5) attendees: 참석자를 알 수 있으면 쉼표로 구분해서(모르면 빈 문자열).\n" +
    "6) readyToSave: 더 이상 결정적으로 애매한 부분이 없거나 담당자가 그만해도 된다고 했으면 " +
    "true, 아직 핵심 정보가 빠져서 회의록으로 쓰기 부적절하면 false.\n\n" +
    "학생·학부모 개인정보는 그대로 두되 지어내지 마세요. 반말로 적힌 메모라도 organizedContent는 " +
    "정중한 문어체로, reply는 실무자에게 말하듯 친근한 존댓말로 쓰세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"reply":"...", "date":"...", "attendees":"...", "organizedContent":"...", "readyToSave":true|false}'
  );
}

export function buildMeetingChatEntryBlock(
  turns: { role: "user" | "assistant"; content: string }[],
  currentDraft: { date: string; attendees: string; organizedContent: string }
): string {
  const transcript = turns
    .map((t) => `${t.role === "user" ? "담당자" : "AI"}: ${t.content}`)
    .join("\n\n");
  return (
    `[현재까지 정리된 초안]\n날짜: ${currentDraft.date || "(미정)"}\n참석자: ${currentDraft.attendees || "(미정)"}\n` +
    `정리된 내용:\n${currentDraft.organizedContent || "(아직 없음)"}\n\n` +
    `[지금까지의 대화 - 마지막 담당자 메시지에 응답할 것]\n${transcript}`
  );
}

export function buildDocumentRecommendSystemPrompt(): string {
  return (
    SHARED_CACHE_CONTEXT +
    "\n\n" +
    "당신은 GIA 같은 학교가 운영을 제대로 갖추기 위해 마련해두면 좋은 서류/문서 목록을 추천하는 " +
    "보조자입니다. 위 [참고 법령 목록]에서 요구하거나 근거가 되는 서류(등록 서류, 안전조치 증빙, " +
    "개인정보처리방침 등)와, 법령에 명시되지 않아도 사교육/대안교육기관이 일반적으로 갖추는 것이 " +
    "좋은 운영 서류(위탁교육계약서, 시설안전점검표, 비상연락망, 현장학습 동의서 양식 등)를 함께 " +
    "고려하세요.\n" +
    "이미 등록된 서류 이름 목록이 주어지면 그 이름과 겹치는 항목은 다시 추천하지 마세요.\n" +
    "실제로 필요하다고 확신하는 항목만 추천하고, 지어내지 마세요. 8~12개 정도로 추천하세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지):\n" +
    '{"documents":[{"name":"서류명", "category":"분류(예: 등록/인허가, 안전, 개인정보, 계약, 인사, 학사)", ' +
    '"reason":"왜 필요한지 한 문장"}]}'
  );
}

export function buildDocumentRecommendEntryBlock(existingNames: string[]): string {
  return existingNames.length
    ? `[이미 등록된 서류 이름 - 중복 추천 금지]\n${existingNames.join(", ")}`
    : "[이미 등록된 서류 없음]";
}

export function buildDocumentDraftSystemPrompt(): string {
  return (
    SHARED_CACHE_CONTEXT +
    "\n\n" +
    "당신은 담당자가 요청한 서류의 실제 초안을 작성하는 보조자입니다. 서류명과 분류를 보고, 바로 " +
    "다듬어서 쓸 수 있는 수준의 초안을 작성하세요(제목, 조항/항목 구조를 갖춘 정식 문서 형태). " +
    "GIA의 구체적인 수치·인명·주소 등 실제 정보는 알 수 없으니 [ ] 괄호로 채워 넣을 자리를 " +
    "표시하세요(예: [정원 인원수], [담당자명]). 위 [참고 법령 목록]에 관련 근거가 있으면 조항을 " +
    "자연스럽게 반영하세요. 지어내지 말고, 확실하지 않은 수치/기준은 괄호로 담당자가 채우도록 " +
    "남겨두세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 JSON 문자열 규칙에 맞게 \\n으로 " +
    "표시하세요:\n" +
    '{"draftText":"서류 초안 전문"}'
  );
}

export function buildDocumentDraftEntryBlock(doc: { name: string; category: string; notes: string }): string {
  return `[작성할 서류]\n서류명: ${doc.name}\n분류: ${doc.category}\n담당자 메모: ${doc.notes || "(없음)"}`;
}

export function buildEventCompareSystemPrompt(): string {
  return (
    INSTITUTION_CONTEXT +
    "\n\n" +
    "당신은 GIA 학교의 반복 행사 기록을 연도별로 비교해서, 담당자가 다음 번 행사를 더 잘 준비할 " +
    "수 있도록 도와주는 보조자입니다. 여러 연도의 같은(또는 비슷한) 행사 기록(좋았던 점/아쉬웠던 " +
    "점/개선 제안)을 받아서 다음을 정리하세요.\n" +
    "1) improvements: 작년 대비 실제로 개선된 것으로 보이는 점(과거 기록의 아쉬운 점/개선 제안이 " +
    "이후 기록에서는 더 이상 언급되지 않거나 좋아진 점으로 바뀐 경우)\n" +
    "2) recurringIssues: 여러 해에 걸쳐 반복적으로 언급되는 아쉬운 점(아직 해결되지 않은 문제)\n" +
    "3) recommendation: 다음 행사를 준비할 때 가장 우선적으로 반영하면 좋을 제안 1~2가지\n" +
    "지어내지 말고 실제 기록에 있는 내용만 근거로 삼으세요. 학생 개인정보는 포함하지 마세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"improvements":["- ...", "- ..."], "recurringIssues":["- ...", "- ..."], "recommendation":"..."}'
  );
}

export function buildEventCompareEntryBlock(
  events: { date: string; good: string; lack: string; suggest: string }[]
): string {
  return events
    .map(
      (e, i) =>
        `[${i + 1}번째 기록 - ${e.date}]\n좋았던 점: ${e.good || "(없음)"}\n아쉬웠던 점: ${e.lack || "(없음)"}\n개선 제안: ${e.suggest || "(없음)"}`
    )
    .join("\n\n");
}

export function buildTermCompareSystemPrompt(): string {
  return (
    INSTITUTION_CONTEXT +
    "\n\n" +
    "당신은 GIA 학교의 학기/캠프(예: 1학기, 여름캠프1, 겨울캠프2 등)를 회차별로 비교해서, 담당자가 " +
    "다음 같은 학기/캠프를 더 잘 준비할 수 있도록 도와주는 보조자입니다. 각 회차 기록에는 그 학기 " +
    "동안 있었던 회의록에서 자동으로 모인 메모도 포함되어 있을 수 있습니다. 여러 회차의 기록(좋았던 " +
    "점/아쉬웠던 점/개선 제안)을 받아서 다음을 정리하세요.\n" +
    "1) improvements: 이전 회차 대비 실제로 개선된 것으로 보이는 점\n" +
    "2) recurringIssues: 여러 회차에 걸쳐 반복적으로 언급되는 아쉬운 점(아직 해결되지 않은 문제)\n" +
    "3) recommendation: 다음 같은 학기/캠프를 준비할 때 가장 우선적으로 반영하면 좋을 제안 1~2가지\n" +
    "지어내지 말고 실제 기록에 있는 내용만 근거로 삼으세요. 학생 개인정보는 포함하지 마세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"improvements":["- ...", "- ..."], "recurringIssues":["- ...", "- ..."], "recommendation":"..."}'
  );
}

export function buildTermCompareEntryBlock(
  terms: { year: string; good: string; lack: string; suggest: string }[]
): string {
  return terms
    .map(
      (t, i) =>
        `[${i + 1}번째 회차 - ${t.year}]\n좋았던 점: ${t.good || "(없음)"}\n아쉬웠던 점: ${t.lack || "(없음)"}\n개선 제안 및 회의록 메모: ${t.suggest || "(없음)"}`
    )
    .join("\n\n");
}

export function buildManualFaqSystemPrompt(): string {
  return (
    INSTITUTION_CONTEXT +
    "\n\n" +
    "당신은 GIA의 학부모용 운영계획안 전체 내용을 바탕으로, 학부모가 실제로 궁금해할 만한 질문과 " +
    "답변(FAQ)을 만드는 보조자입니다. 운영계획안 각 항목의 내용을 보고, 학부모 입장에서 자주 물어볼 " +
    "만한 질문을 뽑아 친절하고 정중한 존댓말로 답변을 작성하세요. 답변은 운영계획안에 실제로 있는 " +
    "내용에 근거해야 하며, 없는 내용을 지어내면 안 됩니다. 8~12개 정도로 만드세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"faqs":[{"question":"...", "answer":"..."}]}'
  );
}

export function buildManualFaqEntryBlock(sections: { category: string; content: string }[]): string {
  return sections.map((s) => `[${s.category}]\n${s.content}`).join("\n\n");
}

export function buildComplaintAnticipateSystemPrompt(): string {
  return (
    SHARED_CACHE_CONTEXT +
    "\n\n" +
    "당신은 GIA 같은 영어 중심 국제학교에서 학부모가 실제로 제기할 만한 문의나 컴플레인을 미리 " +
    "예상하고, 실무자(교사/행정담당자)가 전화나 대면 상황에서 바로 참고해서 답변할 수 있는 " +
    "실무자매뉴얼 항목을 만드는 보조자입니다.\n" +
    "학비/환불, 안전/사고, 급식/알레르기, 학사 운영(수업, 방학, 결석 처리), 소통/상담, 원어민 " +
    "교사와의 의사소통(영어 수업 진행 방식, 통역 지원), 시설/위생, 사진·개인정보 활용, 또래 " +
    "갈등 등 국제학교 학부모가 실제로 흔히 문의하거나 컴플레인하는 주제를 폭넓게 고려하세요.\n\n" +
    "각 항목마다 다음을 작성하세요.\n" +
    "1) category: 이 문의/컴플레인 유형을 나타내는 짧고 명확한 항목명(실무자매뉴얼에 그대로 " +
    "쓸 수 있는 이름)\n" +
    "2) complaintSummary: 학부모가 실제로 할 법한 문의/컴플레인을 1~2문장으로 구체적으로 서술\n" +
    "3) recommendedResponse: 실무자가 이 상황에서 참고해서 바로 답변할 수 있는 응대 가이드. " +
    "실제 답변 스크립트가 아니라, \"이렇게 설명하고 이렇게 안내한다\"는 절차/기준 형태로 " +
    "작성하세요(구체적인 수치는 GIA 실정에 맞게 나중에 채울 수 있도록 [ ] 표시를 남기세요). " +
    "위 [참고 법령 목록]에 근거가 있으면 자연스럽게 반영하세요.\n\n" +
    "매우 중요: 아래 [이미 실무자매뉴얼에 규정된 내용]과 [이미 검토 대기 중인 예상 문의]를 꼼꼼히 " +
    "읽고, 항목명(카테고리)이 다르더라도 실질적으로 같은 주제이거나 이미 그 내용 안에 답이 나와있는 " +
    "문의는 절대 다시 만들지 마세요(예: 카테고리명이 달라도 이미 등록된 내용이 사실상 같은 질문에 " +
    "답하고 있으면 걸러야 합니다). 아직 다뤄지지 않은 새로운 주제만 만드세요. 지어내지 말고 실제로 " +
    "있을 법한 현실적인 상황만 다루세요. 6~10개 정도 만드세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"complaints":[{"category":"...", "complaintSummary":"...", "recommendedResponse":"...", ' +
    '"legalBasis":"위 [참고 법령 목록]에 있으면 인용, 없으면 빈 문자열(지어내지 말 것)"}]}'
  );
}

export function buildComplaintAnticipateEntryBlock(
  existingManualEntries: { category: string; content: string }[],
  pendingComplaints: { category: string; text: string }[],
  hint: string
): string {
  const parts = [
    existingManualEntries.length
      ? `[이미 실무자매뉴얼에 규정된 내용 - 이 내용에 이미 답이 있는 주제는 새로 만들지 말 것]\n` +
        existingManualEntries.map((e) => `- ${e.category}: ${e.content}`).join("\n")
      : "[아직 실무자매뉴얼에 등록된 항목 없음]",
    pendingComplaints.length
      ? `[이미 검토 대기 중인 예상 문의(제안함) - 실질적으로 같은 내용 중복 금지]\n` +
        pendingComplaints.map((p) => `- ${p.category}: ${p.text}`).join("\n")
      : "[검토 대기 중인 예상 문의 없음]",
  ];
  if (hint.trim()) {
    parts.push(`[담당자가 남긴 참고 힌트]\n${hint.trim()}`);
  }
  return parts.join("\n\n");
}

export function buildComplaintFinalizeSystemPrompt(): string {
  return (
    INSTITUTION_CONTEXT +
    "\n\n" +
    "당신은 실무자들이 회의를 통해 GIA 실정에 맞게 수정한 문의/컴플레인 응대 문구를, 실무자매뉴얼에 " +
    "정식으로 실을 수 있는 깔끔한 규정 문구로 다듬는 보조자입니다.\n" +
    "실무자가 수정한 내용의 의미를 절대 바꾸거나 지어내지 마세요 - 구어체나 회의 메모체로 남아있는 " +
    "표현을 공식적인 문어체로 다듬고, \"학부모가 OOO 문의를 하면 → 이렇게 안내한다\" 형태의 " +
    "명확한 절차문으로 정리하세요. 실무자가 채워넣은 구체적인 수치나 기준은 그대로 유지하세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"finalText":"정식 실무자매뉴얼에 실을 완성된 문구"}'
  );
}

export function buildComplaintFinalizeEntryBlock(entry: { category: string; draftText: string }): string {
  return `[항목명]\n${entry.category}\n\n[실무자가 회의를 거쳐 수정한 응대 문구(원문)]\n${entry.draftText}`;
}

// 학부모용 운영계획안에 채택되는 문구는 학부모님께 직접 안내하는 글이므로, 승인 시점에 한 번 더
// 정중하고 친절한 톤으로 다듬습니다(요청: "학부모용에는 학부모님께 안내를 드리는것이기 때문에
// 톤을 맞춰서 정중하고 친절하게 안내"). source가 "complaint"인 항목은 이미 별도의
// buildComplaintFinalizeSystemPrompt로 다듬으므로 이 함수는 그 외 출처(사건/행사/회의/AI매뉴얼)의
// 학부모용 승인 건에만 사용합니다.
export function buildParentToneSystemPrompt(): string {
  return (
    INSTITUTION_CONTEXT +
    "\n\n" +
    "당신은 GIA 학교가 학부모용 운영계획안에 정식으로 싣기 직전인 문구를, 학부모님께 그대로 " +
    "안내해도 좋을 수준의 정중하고 친절한 문어체로 다듬는 보조자입니다.\n" +
    "1) 내용(사실관계, 조치, 기준)을 절대 바꾸거나 지어내지 마세요 - 어투와 문장 구조만 다듬습니다.\n" +
    "2) 실무자끼리 주고받는 사무적인 표현(\"~할 것\", \"~함\", 개조식 나열 등)이 남아있으면, " +
    "학부모가 읽었을 때 존중받는다고 느낄 수 있는 존댓말 문장으로 풀어 쓰세요.\n" +
    "3) 이미 충분히 정중하게 쓰여 있다면 억지로 문장을 늘리지 말고 다듬을 부분만 최소한으로 " +
    "손보세요.\n" +
    "4) 운영계획안 항목 문구이므로 카카오톡 메시지처럼 인사말/서명을 새로 붙이지 말고, 정책/방침을 " +
    "설명하는 자연스러운 문단 형태를 유지하세요.\n\n" +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"finalText":"정중하고 친절하게 다듬은 학부모용 운영계획안 문구"}'
  );
}

export function buildParentToneEntryBlock(entry: { category: string; draftText: string }): string {
  return `[항목명]\n${entry.category}\n\n[다듬을 문구(원문)]\n${entry.draftText}`;
}

export function buildAdoptedReviewSystemPrompt(targetDoc?: string): string {
  return (
    SHARED_CACHE_CONTEXT +
    "\n\n" +
    "당신은 GIA 학교가 운영계획안/실무자매뉴얼에 정식으로 실으려는 조항(항목)을 발행하기 직전에, " +
    "비판적으로 검증하는 깐깐한 검토자입니다. 실무자들이 이미 GIA 실정에 맞게 구체화한 문구를 " +
    "받아서, 그대로 통과시키지 말고 다음 관점에서 최대한 실질적으로 문제를 짚어내세요.\n" +
    "1) potentialComplaints: 이 조항을 실제로 적용했을 때 학부모나 학생, 교직원이 제기할 법한 " +
    "후속 문의·불만·이의제기를 구체적인 상황으로 예상하세요(예: \"환불 기준일이 애매해서 학부모가 " +
    "'그럼 며칠 전까지냐'고 되물을 것이다\"처럼 실제로 벌어질 법한 장면으로).\n" +
    "2) blindSpots: 조항 자체의 맹점·허점을 짚으세요 - 예외 상황이 빠짐, 책임 소재 불명확, " +
    "실행 불가능하거나 측정 불가능한 기준, 다른 조항과 모순 가능성, 법적 근거 부족, 지나치게 " +
    "포괄적이거나 반대로 지나치게 좁아서 실무에서 적용하기 어려운 표현 등을 구체적으로 지적하세요.\n" +
    "3) suggestions: 위에서 지적한 문제를 보완할 수 있는 구체적이고 실행 가능한 수정 제안을 " +
    "작성하세요(추상적 조언이 아니라 \"OOO 문구를 XXX로 바꾸거나, YYY 기준을 명시하라\"는 식의 " +
    "실질적인 제안).\n" +
    "4) summary: 전반적으로 이 조항이 발행할 준비가 얼마나 됐는지 한두 문장으로 평가.\n\n" +
    "이미 잘 작성되어 특별히 지적할 내용이 없다면 억지로 문제를 만들어내지 말고 해당 배열을 " +
    "비워두거나 짧게 답하세요. 근거 없이 트집 잡지 말고, 실제로 GIA 운영에 영향을 줄 수 있는 " +
    "현실적인 지적만 하세요. 위 [참고 법령 목록]에 관련 근거가 있으면 지적에 자연스럽게 " +
    "반영하세요.\n\n" +
    (targetDoc === "학부모용"
      ? "이 조항은 [학부모용] 운영계획안에 실릴 문구입니다. 특히 \"학부모 관점\"에서 다음을 " +
        "최우선으로 점검하세요: 학부모가 이 문구만 읽고도 절차/기준/책임 범위를 오해 없이 이해할 " +
        "수 있는가, 전문 용어나 내부 행정 표현이 그대로 남아 있어 불친절하게 느껴지지 않는가, " +
        "학부모 입장에서 가장 먼저 궁금해할 질문(언제까지, 얼마나, 누구에게 연락)에 문구가 미리 " +
        "답하고 있는가, 어조가 일방적 통보로 읽히지 않는가. potentialComplaints는 이 관점을 " +
        "가장 무겁게 반영하세요.\n\n"
      : "") +
    "아래 JSON 형식으로만 답하세요(다른 텍스트 금지). 줄바꿈은 \\n으로 표시하세요:\n" +
    '{"potentialComplaints":["- ...", "- ..."], "blindSpots":["- ...", "- ..."], ' +
    '"suggestions":["- ...", "- ..."], "summary":"..."}'
  );
}

export function buildAdoptedReviewEntryBlock(entry: {
  targetDoc: string;
  category: string;
  specificText: string;
  reviewRound: number;
}): string {
  return (
    `[대상 문서]\n${entry.targetDoc}\n\n[항목명]\n${entry.category}\n\n` +
    `[검증할 최종 문구(${entry.reviewRound}번째 검증)]\n${entry.specificText}`
  );
}

export function buildMeetingEntryBlock(
  entry: { date: string; attendees: string; content: string },
  label?: string,
  existingCategories?: { parent: string[]; staff: string[] }
): string {
  return (
    `[${label || "회의 정보"}]\n날짜: ${entry.date}\n참석자: ${entry.attendees}` +
    `\n\n[회의 내용(원문 - 메모/구어체일 수 있음, 그대로 베끼지 말고 정리할 것)]\n${entry.content}` +
    "\n\n" +
    buildExistingCategoriesBlock(existingCategories)
  );
}
