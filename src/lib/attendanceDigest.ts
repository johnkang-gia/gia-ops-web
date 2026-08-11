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
    keywords: ["결석", "안 와", "안와", "못 와", "못와", "안 옵니다", "absent", "absence"],
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

export function categorize(text: string): AttendanceCategory | null {
  const lower = text.toLowerCase();
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
export type RosterStudent = { name: string; grade: string | null; nameEn?: string | null };

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

  const afterMatch = after.match(/^\s*\(?\s*(\d{1,2})\s*(?:학년)?\s*\)?/);
  if (afterMatch) return afterMatch[1];

  const beforeMatch = before.match(/(\d{1,2})\s*(?:학년|-\d+)?\s*$/);
  if (beforeMatch) return beforeMatch[1];

  return null;
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
        .filter((t) => t.length > 0 && !EN_NAME_STOP_WORDS.has(t.toLowerCase()));
      const last2 = tokens.slice(-2);
      if (last2.length === 2) out.push(last2.join(" "));
      if (last2.length >= 1) out.push(last2.slice(-1).join(" "));
    }
  }
  return out;
}

// 원문 미리보기에서 구글챗 멘션("@이름")을 걷어냅니다. "@"로 시작하는 토큰은 태그이지 학생
// 이름이 아니므로(요청). 처음에는 문장 맨 앞에 붙은 멘션만 지웠는데, "@쌤 확인 부탁드려요
// 정서안 결석입니다"처럼 멘션이 문장 중간에도 섞여 나오는 경우가 있어(요청: "결석에 @
// 또 나왔다"), 위치에 상관없이 문장 안의 모든 "@토큰"을 지우도록 넓혔습니다.
export function stripLeadingMention(text: string): string {
  const rest = text.replace(/@\S+/g, " ").replace(/\s+/g, " ").trim();
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
export function matchRosterStudents(text: string, roster: RosterStudent[]): MatchedStudent[] {
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
    let picked: RosterStudent | null = candidates.length === 1 ? candidates[0] : null;
    let ambiguous = false;

    if (candidates.length > 1) {
      // 학년 힌트는 원문(text)에서 찾아야 합니다 - remaining은 앞서 매칭된 구간이 공백으로
      // 지워져 있어서 힌트까지 사라졌을 수 있습니다.
      const hint = normalizeGrade(findGradeHint(text, idx, idx + name.length));
      const matched = hint ? candidates.filter((c) => normalizeGrade(c.grade) === hint) : [];
      if (matched.length === 1) {
        picked = matched[0];
      } else {
        picked = candidates[0];
        ambiguous = true;
      }
    }

    const grade = picked?.grade ?? null;
    const hasHomonym = candidates.length > 1;
    found.push({
      name,
      grade,
      displayName: hasHomonym ? `${name}(${ambiguous ? "학년 확인 필요" : `${normalizeGrade(grade) ?? "?"}학년`})` : name,
      // 동명이인이 확정된 경우에만 학년으로 구분합니다. 확정 못 한 경우는 이름만으로 묶어서
      // 같은 문장이 여러 번 들어와도 중복으로 쌓이지 않게 합니다.
      studentKey: hasHomonym && !ambiguous ? `${name}#${normalizeGrade(grade)}` : name,
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

          let picked: RosterStudent;
          let ambiguous = false;
          if (pool.length === 1) {
            picked = pool[0];
          } else {
            const hint = normalizeGrade(findGradeHint(remaining, span.start, span.end));
            const matched = hint ? pool.filter((c) => normalizeGrade(c.grade) === hint) : [];
            if (matched.length === 1) {
              picked = matched[0];
            } else {
              picked = pool[0];
              ambiguous = true;
            }
          }

          const hasHomonym = pool.length > 1;
          found.push({
            name: picked.name,
            grade: picked.grade,
            displayName: hasHomonym
              ? `${picked.name}(${ambiguous ? "학년 확인 필요" : `${normalizeGrade(picked.grade) ?? "?"}학년`})`
              : picked.name,
            studentKey: hasHomonym && !ambiguous ? `${picked.name}#${normalizeGrade(picked.grade)}` : picked.name,
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
  const byNameEn = new Map<string, RosterStudent[]>();
  for (const s of roster) {
    if (!s.nameEn) continue;
    const key = normalizeEnName(s.nameEn);
    if (!key) continue;
    const arr = byNameEn.get(key) ?? [];
    arr.push(s);
    byNameEn.set(key, arr);
  }

  if (byNameEn.size > 0) {
    const alreadyFound = new Set(found.map((f) => f.name));
    for (const candidate of findEnglishNameCandidates(text)) {
      const key = normalizeEnName(candidate);
      if (!key) continue;
      const list = byNameEn.get(key);
      if (!list || list.length === 0) continue;
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
