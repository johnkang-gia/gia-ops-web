import { categorize, categoryForStudent, surfacesFor } from "../../src/lib/attendanceDigest";
let pass = 0, fail = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log("✗", m, "받음:", JSON.stringify(a), "기대:", JSON.stringify(b)); }
};

// ── 셔틀 안 탐 = 픽업 ────────────────────────────────────────────────
eq(categorize("오늘 이예나 셔틀 안탑니다"), "픽업", "셔틀 안탑니다");
eq(categorize("오늘 셔틀 안타요"), "픽업", "안타요");
eq(categorize("오늘은 차 안 탑니다"), "픽업", "차 안 탑니다");
eq(categorize("오늘 셔틀 태우지 마세요"), "픽업", "태우지 마세요");
eq(categorize("버스 못 타요"), "픽업", "못 타요");
// 결석이 함께 적혀 있으면 결석입니다.
eq(categorize("오늘 아파서 결석입니다 셔틀도 안 타요"), "결석", "결석이 먼저");
// 평소대로 탄다는 말은 아무 일도 아닙니다.
eq(categorize("오늘도 셔틀 탑니다"), null, "셔틀 탑니다 → 해당 없음");
eq(categorize("기존처럼 스쿨버스 태워주세요"), null, "기존처럼");

const roster = [
  { name: "이예나", nameEn: "Eliana Lee" },
  { name: "권수호", nameEn: "Teddy Kwon" },
  { name: "황라원", nameEn: "Sophia Hwang" },
  { name: "황준호", nameEn: "June Hwang" },
];
const sur = (n: string) => surfacesFor(n, roster);
const others = (me: string) => roster.filter((r) => r.name !== me).flatMap((r) => sur(r.name));

// ── 문장 단위로 넓게 읽기 ────────────────────────────────────────────
// 쉼표에서 잘리면 이름 쪽 조각에 단서가 없습니다. 문장으로 읽어야 잡힙니다.
const t1 = "@Paul Lee @John Kang 오늘 이예나, 셔틀 안탑니다";
eq(categoryForStudent(t1, sur("이예나"), categorize(t1) ?? "픽업", [], others("이예나")), "픽업", "쉼표로 끊긴 문장");

const t2 = "오늘 이예나 셔틀 안탑니다";
eq(categoryForStudent(t2, sur("이예나"), "픽업", [], others("이예나")), "픽업", "그냥 한 문장");

// 한 문장에 아이가 여럿이면 절로 나눠 각자 읽습니다(예전 황라원 사고).
const t3 = "오늘 권수호, 황준호 픽업입니다, 라원 라윤이는 셔틀타요";
eq(categoryForStudent(t3, sur("권수호"), "픽업", [], others("권수호")), "픽업", "앞의 아이는 픽업");
eq(categoryForStudent(t3, sur("황라원"), "픽업", [], others("황라원")), null, "뒤의 아이는 해당 없음");

// 두 문장이면 각 문장이 자기 아이를 맡습니다.
const t4 = "권수호 오늘 결석입니다. 이예나는 셔틀 안 타요.";
eq(categoryForStudent(t4, sur("권수호"), "결석", [], others("권수호")), "결석", "첫 문장 = 결석");
eq(categoryForStudent(t4, sur("이예나"), "결석", [], others("이예나")), "픽업", "둘째 문장 = 픽업");

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ""}`);
process.exit(fail ? 1 : 0);
