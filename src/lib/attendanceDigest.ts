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

// 학생 명부 한 명분(이름 대조에 필요한 최소 정보).
export type RosterStudent = { name: string; grade: string | null };

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
};

// 같은 학생이 같은 분류로 두 번 올라오지 않도록 정리합니다(요청: "단어를 대조해서 중복되는
// 아동이 체크안되도록"). 구글챗과 부서메모에 같은 내용이 겹쳐 적히는 상황이 실제로 흔해서,
// 학생(동명이인 구분 포함)+분류를 키로 첫 번째 것만 남깁니다.
export function dedupeEntries(entries: AttendanceEntry[]): AttendanceEntry[] {
  const seen = new Set<string>();
  const out: AttendanceEntry[] = [];
  for (const e of entries) {
    const key = `${e.category}::${e.studentKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
