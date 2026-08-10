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
// 이름이 아니므로(요청), 명부 대조에 실패해 원문을 그대로 보여줘야 할 때도 이 부분은 뺍니다.
export function stripLeadingMention(text: string): string {
  const m = text.match(/^(\s*@\S+)+\s*/);
  if (!m) return text;
  const rest = text.slice(m[0].length).trim();
  return rest || text;
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
