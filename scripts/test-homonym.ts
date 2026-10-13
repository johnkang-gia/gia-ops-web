/**
 * 동명이인 회귀 시험 — 빌드마다 돕니다(`npm run build` → `npm run test:homonym`).
 *
 * 여덟 번의 사고를 **실제 함수에 그대로 다시 넣어 봅니다.** 규칙을 고치다 예전 사고가 되살아나면
 * 빌드가 막힙니다. 사고마다 한 줄씩이고, 새 사고가 나면 여기에 한 줄을 더합니다 - 같은 사고가
 * 두 번 나지 않게 하는 가장 싼 방법입니다.
 *
 * 명부: 김재이 셋(G2A·G2C·G3JA), 이준서 둘(G3JA·9학년), 엄하율 하나.
 */
import { matchRosterStudents } from "../src/lib/attendanceDigest";
import { displayStudent, type RosterEntry } from "../src/lib/pickupParse";
import { StudentIndex, homonymKeys } from "../src/lib/studentKey";

const roster = [
  { id: "JAE_2A", name: "김재이", name_en: null, grade: "2", class_name: "G2A", birth_date: "2019-05-10" },
  { id: "JAE_2C", name: "김재이", name_en: null, grade: "2", class_name: "G2C", birth_date: "2019-08-28" },
  { id: "JAE_3JA", name: "김재이", name_en: null, grade: "3", class_name: "G3JA", birth_date: "2018-03-01" },
  { id: "JUN_3JA", name: "이준서", name_en: "Justin Lee", grade: "3", class_name: "G3JA", birth_date: null },
  { id: "JUN_9", name: "이준서", name_en: null, grade: "9", class_name: null, birth_date: null },
  { id: "UM", name: "엄하율", name_en: null, grade: "2", class_name: "G2A", birth_date: null },
] satisfies RosterEntry[];

// attendanceDigest 의 명부 모양(className·birthDate·nameEn)
const digestRoster = roster.map((s) => ({
  id: s.id,
  name: s.name,
  grade: s.grade,
  className: s.class_name,
  birthDate: s.birth_date,
  nameEn: s.name_en,
}));

let failed = 0;
function expect(what: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`  ✗ ${what}\n      기대 ${JSON.stringify(want)}\n      실제 ${JSON.stringify(got)}`);
  }
}

// ── 8번째: 매칭이 고른 아이의 번호가 그대로 나와야 합니다(이름으로 다시 찾으면 첫 번째 김재이) ──
const pick = (text: string) => matchRosterStudents(text, digestRoster, [], []).map((m) => m.studentId);
expect("「김재이(G3JA)」 → G3JA", pick("김재이(G3JA) 오늘 결석합니다"), ["JAE_3JA"]);
expect("「김재이(190828)」 생일 → G2C", pick("김재이(190828) 픽업"), ["JAE_2C"]);
expect("「3학년 김재이」 → G3JA", pick("3학년 김재이 결석"), ["JAE_3JA"]);
expect("그냥 「김재이」 → 정하지 않음(null)", pick("김재이 오늘 픽업"), [null]);
expect("한 명뿐인 이름 → 그 아이", pick("엄하율 결석"), ["UM"]);

// ── 7번째: 번호가 붙은 연락은 그 아이(이름으로 다시 대조해 «누구?»를 묻지 않음) ──
expect(
  "번호 붙은 이준서 문의 → 이준서(G3JA)",
  displayStudent({ student_id: "JUN_3JA", matched_name: "이준서", channel_label: "G3_Justin L_Office" }, roster),
  "이준서(G3JA)",
);
expect(
  "번호 없는 이준서 → 누구?",
  displayStudent({ student_id: null, matched_name: "이준서", channel_label: "x" }, roster)?.includes("누구?"),
  true,
);

// ── 6번째: 번호로 못 찾으면 «다른 아이». 겹치는 이름으로는 아무것도 꺼내지 않음 ──
const idx = new StudentIndex<string>(homonymKeys(roster));
idx.add("JAE_3JA", "김재이", "14:20 픽업");
expect("G2A 김재이는 G3JA 의 픽업을 가져가지 않음", idx.find("JAE_2A", "김재이"), undefined);
expect("번호 없는 김재이도 못 꺼냄", idx.find(null, "김재이"), undefined);
expect("G3JA 본인은 찾음", idx.find("JAE_3JA", "김재이"), "14:20 픽업");
idx.add(null, "엄하율", "결석");
expect("한 명뿐인 이름은 이름으로도 찾음", idx.find(null, "엄하율"), "결석");

if (failed > 0) {
  console.error(`✗ 동명이인 회귀 시험 ${failed}건 실패 — 예전 사고가 되살아났습니다.`);
  process.exit(1);
}
console.log("✓ 동명이인 회귀 시험 통과");
