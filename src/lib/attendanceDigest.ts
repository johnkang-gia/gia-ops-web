// 출결알림(구글챗 미러링)과 부서 메모에서 "누가 결석/픽업/지각/조퇴인지"를 뽑아내는 규칙입니다.
// AI를 쓰지 않고 학생 명부 대조 + 키워드 규칙으로만 처리합니다(추가 비용 0, 즉시 반영).

export type AttendanceCategory = "픽업" | "결석" | "지각" | "조퇴";

// 화면에 보여주는 순서입니다(요청: "픽업,결석,지각순서로").
export const ATTENDANCE_CATEGORIES: {
  key: AttendanceCategory;
  label: string;
  icon: string;
  color: string;
  chipClass: string;
  keywords: string[];
}[] = [
  {
    key: "픽업",
    label: "픽업",
    icon: "🚗",
    color: "text-blue-600",
    chipClass: "bg-blue-50 text-blue-600",
    keywords: ["픽업", "픽엄", "데리러", "하원", "pick up", "pickup", "pick-up"],
  },
  {
    key: "결석",
    label: "결석",
    icon: "🚫",
    color: "text-red-600",
    chipClass: "bg-red-50 text-red-600",
    // 주의: "not here / isn't here / not here yet"는 담임 선생님이 "아이가 아직 교실에 안 왔다"고
    // 문의하는 문구라 결석 판단이 아닙니다(요청). 그래서 결석 키워드에서 제외합니다 - 이런 문의는
    // 행정실이 학부모께 등원/지각/결석을 되물어 확인합니다. 확실한 결석 표현만 남깁니다.
    keywords: ["결석", "안 와", "안와", "못 와", "못와", "안 옵니다", "absent", "absence", "not coming"],
  },
  {
    key: "지각",
    label: "지각",
    icon: "⏰",
    color: "text-amber-600",
    chipClass: "bg-amber-50 text-amber-600",
    keywords: ["지각", "늦게", "늦어", "late"],
  },
  {
    key: "조퇴",
    label: "조퇴",
    icon: "🏃",
    color: "text-purple-600",
    chipClass: "bg-purple-50 text-purple-600",
    keywords: ["조퇴", "일찍", "early"],
  },
];

// "he will be late", "she is not coming" 처럼 **주어가 대명사뿐이고 이름이 없는** 문장은
// 대개 다른 사람 메시지에 대한 답글입니다(요청: "he will be late의 경우 seojun in G2A is not
// here에 관한 답변인데 이걸 그냥 긁어왔더라고"). 이런 문장은 그 자체로 새 결석/지각 통보가
// 아니므로, 문장에서 학생 이름을 전혀 못 찾았을 때 이 함수가 true면 집계에서 제외합니다.
export function looksLikePronounReply(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase();
  // 문장 앞이 he/she/they + (is/will/won't/isn't ...) 로 시작.
  return /^(he|she|they|he's|she's|they're)\b/.test(t);
}

// ── 사람이 가르친 규칙 ────────────────────────────────────────────────────────
//
// 출결내역은 AI가 아니라 규칙으로 돌아갑니다. 그래서 처음 보는 표기(영문 이름 'Maya',
// 오탈자 '조영운')나 처음 보는 표현("일찍 데려갈게요")은 못 잡고 🔎가 붙습니다. 그 🔎를 보는
// 사람이 답을 알고 있으므로, 한 번 눌러 알려주면 그 교정이 규칙으로 저장되어 다음부터
// 자동으로 적용됩니다(attendance_learning_rules). AI 호출이 없어 비용이 들지 않고 즉시 반영됩니다.
export type LearningRule = {
  kind: "alias" | "category" | "ignore";
  pattern: string;
  student_name?: string | null;
  category?: string | null;
};

// 비교는 소문자·공백 제거 후에 합니다("Maya Kim"과 "maya  kim"이 같게 취급되도록).
export function normalizeRulePattern(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

export function categorize(text: string, rules?: LearningRule[]): AttendanceCategory | null {
  const lower = text.toLowerCase();
  // 사람이 가르친 분류가 기본 키워드보다 우선입니다 - 기본 규칙이 틀렸을 때 고치려고 가르친
  // 것이므로, 기본 규칙이 이기면 아무리 가르쳐도 안 바뀝니다.
  const flat = normalizeRulePattern(text);
  for (const r of rules ?? []) {
    if (r.kind !== "category" || !r.category) continue;
    if (flat.includes(normalizeRulePattern(r.pattern))) {
      return r.category as AttendanceCategory;
    }
  }
  for (const c of ATTENDANCE_CATEGORIES) {
    if (c.keywords.some((k) => lower.includes(k.toLowerCase()))) return c.key;
  }
  return null;
}

// ── 날짜/요일 인식 ────────────────────────────────────────────────────────────
// "조영윤 금요일 결석입니다"처럼 오늘이 아닌 날의 출결을 미리 알려주는 경우가 많아서, 문장에
// 적힌 날짜/요일을 읽어 "언제의 출결인지"를 따로 계산합니다(요청). 이게 없으면 금요일 결석이
// 오늘 결석으로 잘못 집계됩니다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayKey(base: Date = new Date()): string {
  return toDateKey(base);
}

// 문장에서 대상 날짜를 뽑습니다. baseDate는 그 문장이 적힌 날(구글챗 메시지 시각/오늘)이고,
// 상대 표현(내일, 금요일 등)은 이 날을 기준으로 계산합니다. 날짜 언급이 전혀 없으면 null을
// 돌려주고, 호출하는 쪽에서 "적힌 날 당일"로 봅니다.
export function extractTargetDate(text: string, baseDate: Date): string | null {
  // 1) 명시적 날짜: "8/12", "8월 12일", "12일"
  const md = text.match(/(\d{1,2})\s*[./월]\s*(\d{1,2})\s*일?/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(baseDate.getFullYear(), month - 1, day);
      // 지난 달로 읽히면 내년이 아니라 올해 기준 그대로 둡니다(과거 날짜는 어차피 걸러집니다).
      return toDateKey(d);
    }
  }
  const dayOnly = text.match(/(?:^|[^\d])(\d{1,2})\s*일(?![가-힣])/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (day >= 1 && day <= 31) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
      // 이미 지난 날짜면 다음 달로 봅니다("30일 결석"을 월초에 적는 경우는 드물지만 안전하게).
      if (d < new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())) d.setMonth(d.getMonth() + 1);
      return toDateKey(d);
    }
  }

  // 2) 상대 표현
  if (/모레|내일모레/.test(text)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 2);
    return toDateKey(d);
  }
  if (/내일/.test(text)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    return toDateKey(d);
  }
  if (/오늘/.test(text)) return toDateKey(baseDate);

  // 3) 요일: 문장이 적힌 날 기준으로 "다음에 오는 그 요일"로 봅니다(같은 요일이면 그날 당일).
  const wd = text.match(/([월화수목금토일])\s*요일/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    if (target >= 0) {
      const d = new Date(baseDate);
      const diff = (target - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + diff);
      return toDateKey(d);
    }
  }

  return null;
}

// 학생 명부 한 명분(이름 대조에 필요한 최소 정보). nameEn은 영어이름 대조용(요청: "영어이름의
// 경우 학생목록에서 대조해서 한글이름(영어이름)으로 병기표기").
// birthDate는 생년월일("2019-05-10")입니다. 같은 학년에 같은 이름이 둘 있으면 학년으로는
// 구분이 안 되어(요청: "김재이가 3명인데 두 명은 학년까지 같아서 생일을 적어 구분한다"),
// 선생님들이 "김재이(190510)"처럼 생일을 붙여 씁니다. 그걸 알아듣기 위한 칸입니다.
export type RosterStudent = { name: string; grade: string | null; nameEn?: string | null; birthDate?: string | null };

// 문장에서 찾아낸 학생 한 명.
export type MatchedStudent = {
  name: string;
  grade: string | null;
  // 화면에 보여줄 이름 - 동명이인이 있는 경우에만 "김재이(2학년)"처럼 학년을 덧붙입니다.
  displayName: string;
  // 중복 제거용 키(동명이인을 서로 다른 사람으로 구분하기 위해 학년까지 포함).
  studentKey: string;
  // 동명이인인데 문장에 학년 힌트가 없어서 누구인지 확정하지 못한 경우 true - 화면에서 "?"로
  // 표시해 사람이 직접 확인하도록 합니다(임의로 한 명을 골라버리면 조용히 틀립니다).
  ambiguous: boolean;
};

// 문장 안에서 이름 주변에 적힌 학년 힌트를 찾습니다(요청: "동명이인이 있을 수 있으니까,
// 그럴경우 이름 뒤에 괄호로 숫자가 써있던지(학년표시) 아니면 앞에 표시 2학년 김재이 이런식으로").
// 지원하는 형태:
//   앞:  "2학년 김재이", "2학년김재이", "초2 김재이", "2-3 김재이"
//   뒤:  "김재이(2)", "김재이 (2학년)", "김재이2", "김재이 2학년"
function findGradeHint(text: string, nameStart: number, nameEnd: number): string | null {
  const before = text.slice(Math.max(0, nameStart - 8), nameStart);
  const after = text.slice(nameEnd, nameEnd + 8);

  // (?!\d)가 없으면 "김재이(190510)"의 앞 두 자리를 학년 19로 잘못 읽습니다 - 생년월일
  // 표기가 들어오면서 실제로 부딪히는 경우라, 숫자가 더 이어지면 학년이 아닌 것으로 봅니다.
  const afterMatch = after.match(/^\s*\(?\s*(\d{1,2})(?!\d)\s*(?:학년)?\s*\)?/);
  if (afterMatch) return afterMatch[1];

  const beforeMatch = before.match(/(\d{1,2})\s*(?:학년|-\d+)?\s*$/);
  if (beforeMatch) return beforeMatch[1];

  return null;
}

// ── 생년월일 힌트 ────────────────────────────────────────────────────────────
// 같은 학년에 동명이인이 있으면 학년으로는 갈라지지 않습니다. 그럴 때 선생님들은 이름 뒤
// 괄호에 생일을 적습니다(요청: "김재이(190510), 김재이(190828)").
//
// 받아들이는 형태(괄호 안 숫자만 뽑아 자릿수로 판단):
//   8자리 20190510 / 2019-05-10 / 2019.05.10   → 연월일 전체
//   6자리 190510                                → 연(뒤 2자리)월일
//   4자리 0510                                  → 월일만
// 4자리(월일)는 같은 이름·같은 학년이면 생일 연도가 대개 같으므로 실무에서 충분히 구분됩니다.
function findBirthHint(text: string, nameEnd: number): string | null {
  const after = text.slice(nameEnd, nameEnd + 16);
  const m = after.match(/^\s*\(\s*([\d.\-/]{4,12})\s*\)/);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  return digits.length === 4 || digits.length === 6 || digits.length === 8 ? digits : null;
}

// 명부의 생년월일(2019-05-10)이 문장에 적힌 힌트와 같은 사람을 가리키는지 봅니다.
function birthMatches(birthDate: string | null | undefined, hint: string): boolean {
  if (!birthDate) return false;
  const d = String(birthDate).replace(/\D/g, "");
  if (d.length < 8) return false;
  const ymd = d.slice(0, 8); // 20190510
  if (hint.length === 8) return ymd === hint;
  if (hint.length === 6) return ymd.slice(2) === hint; // YYMMDD
  if (hint.length === 4) return ymd.slice(4) === hint; // MMDD
  return false;
}

// 화면에 보여줄 때 쓰는 짧은 생일 표기("2019-05-10" → "190510").
function shortBirth(birthDate: string | null | undefined): string | null {
  if (!birthDate) return null;
  const d = String(birthDate).replace(/\D/g, "");
  return d.length >= 8 ? d.slice(2, 8) : null;
}

// 동명이인 후보 중 한 명을 고릅니다. 생일이 학년보다 구체적이므로 생일을 먼저 봅니다
// (같은 학년 동명이인은 학년으로 아무리 봐도 갈라지지 않기 때문입니다).
function pickHomonym(
  candidates: RosterStudent[],
  text: string,
  nameStart: number,
  nameEnd: number
): { picked: RosterStudent; ambiguous: boolean; by: "birth" | "grade" | null } {
  const birthHint = findBirthHint(text, nameEnd);
  if (birthHint) {
    const hit = candidates.filter((c) => birthMatches(c.birthDate, birthHint));
    if (hit.length === 1) return { picked: hit[0], ambiguous: false, by: "birth" };
  }
  const gradeHint = normalizeGrade(findGradeHint(text, nameStart, nameEnd));
  if (gradeHint) {
    const hit = candidates.filter((c) => normalizeGrade(c.grade) === gradeHint);
    if (hit.length === 1) return { picked: hit[0], ambiguous: false, by: "grade" };
  }
  // 확정하지 못하면 임의로 한 명을 고르지 않고 "확인 필요"로 표시합니다 - 조용히 틀리는 것이
  // 가장 나쁩니다.
  return { picked: candidates[0], ambiguous: true, by: null };
}

// 동명이인일 때 화면에 붙일 꼬리표. 무엇으로 갈랐는지가 보여야 사람이 검증할 수 있습니다.
function homonymLabel(picked: RosterStudent, ambiguous: boolean, by: "birth" | "grade" | null): string {
  if (ambiguous) {
    // 같은 학년에 같은 이름이 또 있으면 학년을 물어봐야 소용없으니 생일을 물어봅니다.
    return "확인 필요";
  }
  if (by === "birth") return shortBirth(picked.birthDate) ?? "생일 확인";
  return `${normalizeGrade(picked.grade) ?? "?"}학년`;
}

// 중복 제거 키. 같은 학년 동명이인까지 갈라야 하므로 생일이 있으면 생일까지 씁니다.
function homonymKey(picked: RosterStudent): string {
  const b = shortBirth(picked.birthDate);
  return b ? `${picked.name}#${b}` : `${picked.name}#${normalizeGrade(picked.grade)}`;
}

// 학년 표기를 비교 가능한 형태로 정규화합니다("2", "2학년", "초2" → "2").
function normalizeGrade(g: string | null): string | null {
  if (!g) return null;
  const m = g.match(/\d{1,2}/);
  return m ? m[0] : null;
}

// ── 영어 이름 대조 ────────────────────────────────────────────────────────────
// 구글챗 출결알림 중에는 "@Teneqha Form Jino Park will be absent tomorrow"처럼 학생 이름이
// 영어로 적힌 경우가 있습니다. 이때 "@"로 시작하는 부분은 실제 학생 이름이 아니라 구글챗이
// 자동으로 붙이는 멘션/태그이고(요청: "@로시작되는 글자는 태그라서 실제 학생의 이름이 아니야"),
// 진짜 이름은 "will be absent" 같은 출결 문구 바로 앞에 있습니다. 그래서 문장 전체에서 영어
// 단어를 아무거나 이름으로 추측하지 않고, 이 출결 문구 바로 앞 1~2단어만 후보로 보고 학생
// 명부의 영어이름과 대조합니다(요청: "will be absent가 나오면 그 앞에 두 블럭인 한블럭을
// 학생목록과 대조하고, 이름이 있으면 그 이름 표기").
const EN_NAME_STOP_WORDS = new Set([
  "will", "be", "is", "are", "was", "were", "the", "a", "an", "to", "today",
  "tomorrow", "not", "student", "child", "kids", "and", "for", "this", "that",
  "he", "she", "they", "pick", "picked", "up", "from", "at", "on", "in",
  "early", "late", "school", "class", "please", "hi", "hello", "dear", "im", "i",
]);

function normalizeEnName(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ATTENDANCE_CATEGORIES에 이미 등록된 키워드 중 영어로만 된 것들을 "이 문구 앞에 이름이 있다"는
// 닻(anchor)으로 재사용합니다 - 별도 문구 목록을 새로 관리할 필요가 없습니다.
const EN_NAME_ANCHORS = ATTENDANCE_CATEGORIES.flatMap((c) => c.keywords.filter((k) => /^[a-z][a-z\s-]*$/i.test(k)));

function findEnglishNameCandidates(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const anchor of EN_NAME_ANCHORS) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(anchor, from);
      if (idx === -1) break;
      from = idx + anchor.length;
      const tokens = text
        .slice(0, idx)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, ""))
        // 'G2A'·'2A'처럼 학년/반 표기는 이름이 아니므로 후보에서 뺍니다(숫자가 섞인 토큰).
        .filter((t) => t.length > 0 && !/\d/.test(t) && !EN_NAME_STOP_WORDS.has(t.toLowerCase()));
      const last2 = tokens.slice(-2);
      if (last2.length === 2) out.push(last2.join(" "));
      // 마지막 두 토막뿐 아니라 각 토막도 후보로 넣습니다 - 'Benecia will be absent'나
      // 'seojun ... is not here'처럼 이름(first name)만 적힌 경우를 first-name 색인으로 잡기 위함.
      for (const t of tokens.slice(-3)) out.push(t);
    }
  }
  return out;
}

// 문장에서 'G2A'·'G2'·'2A'·'grade 2' 같은 학년 힌트를 뽑습니다(영문 first-name 동명이인 구분용).
function extractGradeHintFromText(text: string): string | null {
  const m = text.match(/\bG\s?(\d{1,2})\b/i) || text.match(/\bgrade\s?(\d{1,2})\b/i) || text.match(/\b(\d{1,2})\s?[A-Za-z]\b/);
  return m ? m[1] : null;
}

// 원문 미리보기에서 구글챗 멘션("@이름")을 걷어냅니다. "@"로 시작하는 토큰은 태그이지 학생
// 이름이 아니므로(요청). 처음에는 문장 맨 앞에 붙은 멘션만 지웠는데, "@쌤 확인 부탁드려요
// 정서안 결석입니다"처럼 멘션이 문장 중간에도 섞여 나오는 경우가 있어(요청: "결석에 @
// 또 나왔다"), 위치에 상관없이 문장 안의 모든 "@토큰"을 지우도록 넓혔습니다.
//
// 요청: "@뒤에는 이름/성으로 이루어져있어서 무조건 제거해주고, 그 이후에 이름을 유추하는
// 필터링이 되었으면 좋겠어" - 구글챗 멘션은 "이름 성" 두 단어로 된 경우가 있는데(예:
// "@Teneqha Form Jino Park will be absent tomorrow"에서 실제 멘션은 "Teneqha Form"),
// 이전에는 "@" 뒤 첫 한 단어만 지워서 두 번째 단어("Form")가 그대로 남아 이름처럼 잘못
// 뽑히곤 했습니다. 영문 멘션은 대문자로 시작하는 단어가 바로 이어지면 최대 두 단어(이름+성)
// 까지 함께 지우고, 한글 멘션은 원래대로 공백 전까지 한 단어만 지웁니다(한글 이름은 성+이름을
// 띄어쓰지 않고 붙여 쓰므로 애초에 한 단어입니다) - 뒤에 이어지는 실제 문장(예: "Jino Park
// will be absent tomorrow")까지 지워버리지 않도록 정확히 두 단어까지만으로 제한합니다.
export function stripLeadingMention(text: string): string {
  const rest = text
    .replace(/@[A-Za-z][A-Za-z'.-]*\s+[A-Z][A-Za-z'.-]*|@\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return rest || text;
}

// 이름이 아닌 흔한 한글 단어입니다 - matchRosterStudents가 명부에서 아무도 못 찾았을 때, 원문
// 앞부분을 그냥 잘라 보여주는 대신 "그나마 이름처럼 생긴 한글 단어"를 먼저 찾아보는데(요청:
// "대조하고 없으니까 그냥 아무거나 표시하는거 같아... 한글이름을 메인으로 뽑아줘"), 이 단어들은
// 후보에서 제외합니다.
const NON_NAME_WORDS = new Set([
  "오늘", "내일", "모레", "선생님", "학부모", "어머니", "아버지", "보호자", "학생", "저희",
  "합니다", "입니다", "안녕하세요", "죄송합니다", "감사합니다", "부탁드립니다", "부탁드려요",
  "오전", "오후", "지금", "확인", "안내", "말씀", "학년", "우리", "관련", "때문", "그리고",
  "다름", "아이", "친구", "학교", "차량", "버스", "셔틀", "동생", "학원", "연락", "번호",
  "문의", "부탁", "안녕", "감사",
  ...ATTENDANCE_CATEGORIES.flatMap((c) => c.keywords.filter((k) => /[가-힣]/.test(k))),
]);

// 토큰이 흔한 단어(위 목록)에서 시작하는지도 봅니다 - "선생님께", "결석입니다"처럼 흔한 단어
// 뒤에 조사·어미가 붙어 정확히 같은 글자로는 안 걸리는 경우가 많아서(요청: "저거같은 경우
// 글을 해석해서 이름을 따오게 할 수 있어?"), 완전히 같을 때만 거르던 것보다 훨씬 잘 걸러집니다.
function looksLikeNonName(token: string): boolean {
  for (const w of NON_NAME_WORDS) {
    if (token === w || token.startsWith(w)) return true;
  }
  return false;
}

// 이름 뒤에 흔히 붙는 조사 한 글자입니다("정서안은" → "정서안"). 4글자 낱말에만 적용합니다 -
// 2~3글자 낱말은 "김재이"처럼 조사와 똑같은 글자(이/가 등)로 끝나는 진짜 이름이 실제로 있어서,
// 함부로 떼면 오히려 이름이 망가집니다. 4글자는 "이름(2~3자)+조사(1자)" 조합일 가능성이
// 훨씬 높아 비교적 안전합니다.
const TRAILING_PARTICLES = new Set(["은", "는", "이", "가", "을", "를", "도", "만", "과", "와", "의", "께"]);

function trimTrailingParticle(word: string): string {
  if (word.length !== 4) return word;
  const last = word[word.length - 1];
  return TRAILING_PARTICLES.has(last) ? word.slice(0, -1) : word;
}

// 문장에서 "이름일 법한 한글 낱말" 후보를 순서대로 뽑습니다. 예전에는 한글 2~4자를 그냥
// 정해진 길이로 잘라냈는데, 그러면 "문의드립니다"의 중간 토막인 "니다"가 이름처럼 남는 등
// 낱말 경계를 무시한 문제가 있었습니다. 이제는 공백·문장부호 등 한글이 아닌 글자를 기준으로
// 먼저 진짜 낱말 단위로 나눈 뒤, 그중 이름 길이(2~4자)에 맞고 흔한 단어가 아닌 것만 후보로
// 남깁니다.
function extractNameCandidates(text: string): string[] {
  const words = text.split(/[^가-힣]+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const trimmed = trimTrailingParticle(w);
    if (trimmed.length < 2 || trimmed.length > 4) continue;
    if (looksLikeNonName(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

// 명부 대조(matchRosterStudents)가 실패했을 때 마지막으로 시도하는 추정입니다. "정서안
// 결석입니다"처럼 이름은 대개 결석/픽업 같은 출결 키워드 바로 앞에 오므로, 어떤 분류로
// 잡혔는지(category) 알고 있으면 그 키워드 바로 앞 구간에서 먼저 후보를 찾습니다 - 문장
// 앞쪽에 섞인 다른 한글 단어("확인 부탁드려요")를 이름으로 잘못 고르는 일을 줄여줍니다
// (요청: "저거같은 경우 글을 해석해서 이름을 따오게 할 수 있어?"). 키워드 근처에서 못 찾으면
// 문장 전체에서 낱말을 순서대로 훑어 첫 후보를 씁니다. 완벽하지 않지만(오탈자·전학생 등은
// 여전히 놓칠 수 있음), 문장을 아무 데서나 잘라 보여주는 것보다는 실제 이름일 확률이 훨씬
// 높습니다.
export function guessKoreanName(text: string, category?: AttendanceCategory | null): string | null {
  const stripped = stripLeadingMention(text);

  if (category) {
    const cat = ATTENDANCE_CATEGORIES.find((c) => c.key === category);
    if (cat) {
      const lower = stripped.toLowerCase();
      for (const kw of cat.keywords) {
        const idx = lower.indexOf(kw.toLowerCase());
        if (idx === -1) continue;
        const before = stripped.slice(Math.max(0, idx - 12), idx);
        const nearCandidates = extractNameCandidates(before);
        // 키워드에 가장 가까운(=배열 맨 뒤) 낱말을 우선합니다.
        if (nearCandidates.length > 0) return nearCandidates[nearCandidates.length - 1];
      }
    }
  }

  const candidates = extractNameCandidates(stripped);
  return candidates[0] ?? null;
}

// ── 형제자매(성 공유) 이름 대조 도우미 ──────────────────────────────────────
// 요청: "박라온, 박다온 같은 형제자매가 있을 경우 잘 안돼고... 박라온,다온/라온다온과 같이
// 한쪽만 성을 쓰거나 아니면 둘 다 안 쓰는 경우도 있어 이 경우도 각각 파악해서 각각이름을
// 대조해서 명단이 올라오도록". 성은 한 글자로 가정하고(대부분의 한국 성이 그렇습니다 - 남궁·
// 선우 같은 두 글자 성은 이 로직으로는 못 잡습니다) 명부 이름의 첫 글자를 성, 나머지를
// 이름(given name)으로 나눠 대조에 씁니다.
function hangulWordSpans(text: string): { word: string; start: number; end: number }[] {
  const spans: { word: string; start: number; end: number }[] = [];
  const re = /[가-힣]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    spans.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function blankSpan(text: string, start: number, end: number): string {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

// 토큰이 사전(givenNameIndex)의 이름과 정확히 같거나, 조사 한 글자가 붙은 채로 같으면
// 매칭합니다(예: "다온이" → "다온"). 사전에 있는 것만 인정하므로, "재이"처럼 우연히 조사로
// 끝나는 진짜 이름도 사전에 그대로 있으면 먼저 그대로 매칭되어 안전합니다.
function resolveGivenNameToken(
  token: string,
  givenNameIndex: Map<string, RosterStudent[]>
): { candidates: RosterStudent[] } | null {
  const exact = givenNameIndex.get(token);
  if (exact) return { candidates: exact };
  if (token.length >= 3 && TRAILING_PARTICLES.has(token[token.length - 1])) {
    const trimmed = token.slice(0, -1);
    const list = givenNameIndex.get(trimmed);
    if (list) return { candidates: list };
  }
  return null;
}

// 문장에서 실제 학생 명부에 있는 이름만 골라냅니다.
//
// 예전에는 정규식으로 한글 2~4자를 그냥 집어냈는데, 그러면 "정서안만 픽업"에서 "정서안만"이
// 통째로 이름처럼 잡혔습니다. 이제는 명부에 실제로 있는 이름과만 대조하므로 "정서안만"에서는
// 명부의 "정서안"이 잡히고 "만"은 자연스럽게 버려집니다.
//
// 겹치는 이름 처리: 긴 이름부터 먼저 찾고, 한 번 잡힌 구간은 다른 이름이 다시 못 쓰도록
// 지워가며 진행합니다. 한국 이름은 대부분 세 글자라 "김민"(2자)과 "김민준"(3자)이 함께 있으면
// "김민준 결석"은 더 긴 "김민준"으로만 잡혀 두 명이 중복 등록되지 않습니다.
//
// 동명이인: 같은 이름이 명부에 여러 명 있으면 문장의 학년 힌트로 좁히고, 힌트가 없으면 임의로
// 고르지 않고 ambiguous로 표시해 사람이 확인하게 합니다.
//
// 형제자매: 정식 이름 대조가 끝난 뒤, 이미 찾은 학생과 성이 같은 형제자매를 성 없이 이름만
// 적힌 경우("박라온, 다온")에도 찾고, 성을 아예 안 쓰고 이름끼리 붙여 쓴 경우("라온다온")도
// 명부 이름 사전으로 둘로 쪼개 찾습니다(요청: "박라온, 박다온 같은 형제자매가 있을 경우...
// 한쪽만 성을 쓰거나 아니면 둘 다 안 쓰는 경우도 있어 이 경우도 각각 파악해서").
export function matchRosterStudents(text: string, roster: RosterStudent[], rules?: LearningRule[]): MatchedStudent[] {
  // ── 0단계: 사람이 가르친 별칭을 가장 먼저 봅니다 ───────────────────────────
  //
  // 'Maya', '조영운'(오탈자)처럼 명부 이름과 글자가 다른 표기는 아래 어떤 단계로도 못 잡습니다.
  // 사람이 한 번 "이건 김마야예요"라고 알려준 것이 있으면 그게 가장 확실한 근거이므로 먼저
  // 적용하고, 찾은 부분은 지워서 뒤 단계가 같은 자리를 다시 읽지 않게 합니다.
  const learned: MatchedStudent[] = [];
  let scratch = text;
  const aliasRules = (rules ?? []).filter((r) => r.kind === "alias" && r.student_name);
  // 긴 표기부터 봅니다("Maya Kim"이 "Maya"보다 먼저 잡히도록).
  for (const r of [...aliasRules].sort((a, b) => b.pattern.length - a.pattern.length)) {
    const idx = scratch.toLowerCase().indexOf(r.pattern.toLowerCase());
    if (idx === -1) continue;
    const name = r.student_name as string;
    if (learned.some((m) => m.name === name)) continue;
    const hit = roster.find((s) => s.name === name) ?? null;
    learned.push({
      name,
      grade: hit?.grade ?? null,
      displayName: name,
      studentKey: name,
      ambiguous: false,
    });
    scratch = scratch.slice(0, idx) + " ".repeat(r.pattern.length) + scratch.slice(idx + r.pattern.length);
  }

  // 사람이 "이건 학생 이름이 아니다"라고 알려준 낱말도 미리 지웁니다(선생님 이름·흔한 낱말).
  for (const r of (rules ?? []).filter((x) => x.kind === "ignore")) {
    let idx = scratch.toLowerCase().indexOf(r.pattern.toLowerCase());
    while (idx !== -1) {
      scratch = scratch.slice(0, idx) + " ".repeat(r.pattern.length) + scratch.slice(idx + r.pattern.length);
      idx = scratch.toLowerCase().indexOf(r.pattern.toLowerCase());
    }
  }

  const base = matchRosterStudentsCore(scratch, roster);
  // 별칭으로 이미 찾은 학생은 중복해서 넣지 않습니다.
  const seen = new Set(learned.map((m) => m.name));
  return [...learned, ...base.filter((m) => !seen.has(m.name))];
}

function matchRosterStudentsCore(text: string, roster: RosterStudent[]): MatchedStudent[] {
  // 같은 이름을 가진 학생들을 묶어둡니다(동명이인 판정용).
  const byName = new Map<string, RosterStudent[]>();
  for (const s of roster) {
    if (!s.name) continue;
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }

  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  let remaining = text;
  const found: MatchedStudent[] = [];

  for (const name of names) {
    if (name.length < 2) continue; // 한 글자 이름은 오탐이 너무 많아 제외합니다.
    const idx = remaining.indexOf(name);
    if (idx === -1) continue;

    const candidates = byName.get(name)!;
    const hasHomonym = candidates.length > 1;

    // 힌트는 원문(text)에서 찾아야 합니다 - remaining은 앞서 매칭된 구간이 공백으로 지워져
    // 있어서 힌트까지 사라졌을 수 있습니다.
    const { picked, ambiguous, by } = hasHomonym
      ? pickHomonym(candidates, text, idx, idx + name.length)
      : { picked: candidates[0], ambiguous: false, by: null as "birth" | "grade" | null };

    found.push({
      name,
      grade: picked.grade ?? null,
      displayName: hasHomonym ? `${name}(${homonymLabel(picked, ambiguous, by)})` : name,
      // 동명이인이 확정된 경우에만 학년/생일로 구분합니다. 확정 못 한 경우는 이름만으로 묶어서
      // 같은 문장이 여러 번 들어와도 중복으로 쌓이지 않게 합니다.
      studentKey: hasHomonym && !ambiguous ? homonymKey(picked) : name,
      ambiguous,
    });

    remaining = remaining.slice(0, idx) + " ".repeat(name.length) + remaining.slice(idx + name.length);
  }

  const foundNames = new Set(found.map((f) => f.name));

  // ── 2단계: 이미 정식 이름으로 찾은 학생(anchor)과 성이 같은 형제자매를, 성 없이 이름만
  // 적힌 경우에도 찾습니다(예: "박라온, 다온" → "다온"을 "박다온"으로 인식). 이름(성 뗀
  // 나머지)이 두 글자 이상인 경우만 다룹니다 - 한 글자는 흔한 낱말과 겹쳐 오탐이 너무 많습니다.
  if (found.length > 0) {
    const siblingsBySurname = new Map<string, RosterStudent[]>();
    for (const s of roster) {
      if (!s.name || s.name.length < 3 || foundNames.has(s.name)) continue;
      const givenName = s.name.slice(1);
      if (givenName.length < 2) continue;
      const arr = siblingsBySurname.get(s.name[0]) ?? [];
      arr.push(s);
      siblingsBySurname.set(s.name[0], arr);
    }

    if (siblingsBySurname.size > 0) {
      const givenNameIndex = new Map<string, RosterStudent[]>();
      for (const list of siblingsBySurname.values()) {
        for (const s of list) {
          const givenName = s.name.slice(1);
          const arr = givenNameIndex.get(givenName) ?? [];
          arr.push(s);
          givenNameIndex.set(givenName, arr);
        }
      }

      for (const anchor of [...found]) {
        const siblings = siblingsBySurname.get(anchor.name[0]);
        if (!siblings || siblings.length === 0) continue;

        for (const span of hangulWordSpans(remaining)) {
          const resolved = resolveGivenNameToken(span.word, givenNameIndex);
          if (!resolved) continue;
          const candidates = resolved.candidates.filter((c) => !foundNames.has(c.name));
          if (candidates.length === 0) continue;
          // 성이 같은 후보(형제자매일 가능성이 가장 높음)를 우선합니다.
          const sameSurname = candidates.filter((c) => c.name[0] === anchor.name[0]);
          const pool = sameSurname.length > 0 ? sameSurname : candidates;

          const hasHomonym = pool.length > 1;
          const { picked, ambiguous, by } = hasHomonym
            ? pickHomonym(pool, remaining, span.start, span.end)
            : { picked: pool[0], ambiguous: false, by: null as "birth" | "grade" | null };

          found.push({
            name: picked.name,
            grade: picked.grade,
            displayName: hasHomonym ? `${picked.name}(${homonymLabel(picked, ambiguous, by)})` : picked.name,
            studentKey: hasHomonym && !ambiguous ? homonymKey(picked) : picked.name,
            ambiguous,
          });
          foundNames.add(picked.name);
          remaining = blankSpan(remaining, span.start, span.end);
        }
      }
    }
  }

  // ── 3단계: 성 없이 형제자매 이름을 붙여 쓴 경우("라온다온")를 다룹니다. 명부의 모든 학생
  // 이름에서 성을 뗀 나머지(이름)로 사전을 만들어 두 조각으로 쪼개봅니다. 양쪽 조각이 모두
  // 실제 명부 이름일 때만 인정하므로, 아무 낱말이나 두 학생으로 잘못 읽힐 위험은 낮습니다.
  // 성이 같은 조합(형제자매)을 우선하고, 그런 조합이 없으면 양쪽 다 명부 전체에서 유일한
  // 이름일 때만 인정합니다(후보가 여러 명이면 누구인지 특정할 수 없어 건너뜁니다).
  {
    const globalGivenNameIndex = new Map<string, RosterStudent[]>();
    for (const s of roster) {
      if (!s.name || s.name.length < 3 || foundNames.has(s.name)) continue;
      const givenName = s.name.slice(1);
      if (givenName.length < 2) continue;
      const arr = globalGivenNameIndex.get(givenName) ?? [];
      arr.push(s);
      globalGivenNameIndex.set(givenName, arr);
    }

    if (globalGivenNameIndex.size > 0) {
      for (const span of hangulWordSpans(remaining)) {
        const word = span.word;
        if (word.length < 4) continue; // 최소 두 글자 + 두 글자
        let matchedPair: RosterStudent[] | null = null;
        for (let i = 2; i <= word.length - 2; i++) {
          const leftCandidates = (globalGivenNameIndex.get(word.slice(0, i)) ?? []).filter((c) => !foundNames.has(c.name));
          const rightCandidates = (globalGivenNameIndex.get(word.slice(i)) ?? []).filter((c) => !foundNames.has(c.name));
          if (leftCandidates.length === 0 || rightCandidates.length === 0) continue;
          let pair: RosterStudent[] | null = null;
          for (const l of leftCandidates) {
            const r = rightCandidates.find((c) => c.name[0] === l.name[0] && c.name !== l.name);
            if (r) {
              pair = [l, r];
              break;
            }
          }
          if (!pair && leftCandidates.length === 1 && rightCandidates.length === 1) {
            pair = [leftCandidates[0], rightCandidates[0]];
          }
          if (pair) {
            matchedPair = pair;
            break;
          }
        }

        if (!matchedPair) continue;
        for (const s of matchedPair) {
          if (foundNames.has(s.name)) continue;
          found.push({ name: s.name, grade: s.grade, displayName: s.name, studentKey: s.name, ambiguous: false });
          foundNames.add(s.name);
        }
        remaining = blankSpan(remaining, span.start, span.end);
      }
    }
  }

  // 한글 이름으로 아무도 못 찾은 경우에만 영어 이름 대조를 시도합니다(한글 문장에 우연히 영어
  // 단어가 섞여 있어도 이미 한글로 찾은 학생과 중복으로 잡히지 않도록).
  // 영어 이름 색인: (1) 전체 이름("benecia kim") (2) 이름(first name)만("benecia"). 학부모가
  // 성 없이 이름만 적는 경우("Benecia will be absent", "seojun is not here")가 흔해서, 이름만으로도
  // 대조되게 first-name 색인을 함께 둡니다. 같은 이름이 여러 명이면 문장의 학년(G2A 등)으로 좁힙니다.
  const byNameEn = new Map<string, RosterStudent[]>();
  const byFirstEn = new Map<string, RosterStudent[]>();
  for (const s of roster) {
    if (!s.nameEn) continue;
    const key = normalizeEnName(s.nameEn);
    if (!key) continue;
    (byNameEn.get(key) ?? byNameEn.set(key, []).get(key)!).push(s);
    const first = key.split(" ")[0];
    if (first && first.length >= 2) (byFirstEn.get(first) ?? byFirstEn.set(first, []).get(first)!).push(s);
  }

  if (byNameEn.size > 0) {
    const alreadyFound = new Set(found.map((f) => f.name));
    const gradeHint = normalizeGrade(extractGradeHintFromText(text));
    for (const candidate of findEnglishNameCandidates(text)) {
      const key = normalizeEnName(candidate);
      if (!key) continue;
      // 전체 이름 우선, 없으면 first-name으로.
      let list = byNameEn.get(key) ?? byFirstEn.get(key) ?? [];
      if (list.length === 0) continue;
      // 여러 명이면 학년으로 좁혀 한 명만 남을 때 채택(못 좁히면 건너뜀 - 엉뚱한 아이 방지).
      if (list.length > 1 && gradeHint) {
        const narrowed = list.filter((s) => normalizeGrade(s.grade) === gradeHint);
        if (narrowed.length >= 1) list = narrowed;
      }
      const picked = list[0];
      if (alreadyFound.has(picked.name)) continue;
      const hasHomonym = list.length > 1;
      found.push({
        name: picked.name,
        grade: picked.grade,
        // 영어이름으로 대조된 경우 "한글이름(영어이름)"으로 병기합니다(요청).
        displayName: `${picked.name}(${picked.nameEn})`,
        studentKey: hasHomonym ? `${picked.name}#${normalizeGrade(picked.grade)}` : picked.name,
        ambiguous: hasHomonym,
      });
      alreadyFound.add(picked.name);
    }
  }

  return found;
}

// 한 건의 출결 항목입니다. sourceLabel은 이 내용이 어디서 왔는지("구글챗"/"부서메모") 표시용.
export type AttendanceEntry = {
  key: string;
  category: AttendanceCategory;
  studentName: string;
  // 동명이인 구분까지 반영한 중복 제거용 키.
  studentKey: string;
  ambiguous: boolean;
  // 명부 대조에 실패해 studentName이 확정된 이름이 아니라 추정치(guessKoreanName) 또는
  // 원문 일부라는 표시입니다. true면 UI에서 확정 매칭과 구분해 보여줘야 합니다.
  unmatched: boolean;
  rawText: string;
  time: string | null;
  sourceLabel: string;
  // 이 출결이 "언제"의 것인지(YYYY-MM-DD). 문장에 날짜/요일이 적혀 있으면 그 날, 없으면 적힌 날.
  targetDate: string;
};

// 날짜를 "오늘/내일/8월 12일 (금)" 형태로 보여줍니다.
export function dateChipLabel(dateKey: string, base: Date = new Date()): string {
  const d = new Date(dateKey + "T00:00:00");
  const today = toDateKey(base);
  const tomorrowDate = new Date(base);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  if (dateKey === today) return "오늘";
  if (dateKey === toDateKey(tomorrowDate)) return "내일";
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

// 같은 학생이 같은 분류로 두 번 올라오지 않도록 정리합니다(요청: "단어를 대조해서 중복되는
// 아동이 체크안되도록"). 구글챗과 부서메모에 같은 내용이 겹쳐 적히는 상황이 실제로 흔해서,
// 학생(동명이인 구분 포함)+분류를 키로 첫 번째 것만 남깁니다.
export function dedupeEntries(entries: AttendanceEntry[]): AttendanceEntry[] {
  const seen = new Set<string>();
  const out: AttendanceEntry[] = [];
  for (const e of entries) {
    // 날짜까지 키에 넣습니다 - 같은 학생이 오늘도 결석, 금요일도 결석인 경우는 서로 다른 건입니다.
    const key = `${e.targetDate}::${e.category}::${e.studentKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
