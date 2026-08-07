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

// 문장에서 실제 학생 명부에 있는 이름만 골라냅니다.
//
// 예전에는 정규식으로 한글 2~4자를 그냥 집어냈는데, 그러면 "정서안만 픽업"에서 "정서안만"이
// 통째로 이름처럼 잡혔습니다(요청에서 지적된 문제). 이제는 명부(roster)에 실제로 있는 이름과만
// 대조하므로 "정서안만"에서는 명부에 있는 "정서안"이 잡히고, "만"은 자연스럽게 버려집니다.
//
// 겹치는 이름 처리: 긴 이름부터 먼저 찾고, 한 번 잡힌 구간은 다른 이름이 다시 못 쓰도록
// 지워가며 진행합니다. 그래서 "정서우"와 "정서안"이 둘 다 명부에 있어도 "정서안만 픽업"은
// 정서안 한 명만 잡히고(정서우는 글자가 실제로 없으므로 애초에 안 잡힘), "김민"과 "김민준"이
// 함께 있는 경우 "김민준 결석"은 더 긴 "김민준"으로만 잡혀 두 명이 중복 등록되지 않습니다.
export function matchRosterNames(text: string, rosterNames: string[]): string[] {
  const sorted = [...new Set(rosterNames.filter(Boolean))].sort((a, b) => b.length - a.length);
  let remaining = text;
  const found: string[] = [];
  for (const name of sorted) {
    if (name.length < 2) continue; // 한 글자 이름은 오탐이 너무 많아 제외합니다.
    const idx = remaining.indexOf(name);
    if (idx === -1) continue;
    found.push(name);
    // 이미 이 이름으로 소비한 구간은 빈칸으로 바꿔, 더 짧은 이름이 같은 글자를 다시 집지 않게 합니다.
    remaining = remaining.slice(0, idx) + " ".repeat(name.length) + remaining.slice(idx + name.length);
  }
  return found;
}

// 한 건의 출결 항목입니다. sourceLabel은 이 내용이 어디서 왔는지("구글챗"/"부서메모") 표시용.
export type AttendanceEntry = {
  key: string;
  category: AttendanceCategory;
  studentName: string;
  rawText: string;
  time: string | null;
  sourceLabel: string;
};

// 같은 학생이 같은 분류로 두 번 올라오지 않도록 정리합니다(요청: "단어를 대조해서 중복되는
// 아동이 체크안되도록"). 구글챗과 부서메모에 같은 내용이 겹쳐 적히는 상황이 실제로 흔해서,
// 학생이름+분류를 키로 첫 번째 것만 남깁니다.
export function dedupeEntries(entries: AttendanceEntry[]): AttendanceEntry[] {
  const seen = new Set<string>();
  const out: AttendanceEntry[] = [];
  for (const e of entries) {
    const key = `${e.category}::${e.studentName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
