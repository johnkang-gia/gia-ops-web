/**
 * 캠프 수강료 시험 — 2026 윈터캠프 요금표 24칸을 campFee 로 다시 셉니다.
 * 요금표가 바뀌면 이 표를 새 요금표로 고칩니다. 식이 표와 어긋나면 빌드가 멈춥니다.
 */
import { campDiscountOf, campFee, parseShuttle, parseWeeks, readCampForm, type CampDiscount, type CampShuttle } from "../src/lib/campFee";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.error(`✗ ${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  }
};

// 만원 단위 요금표 (3주, 2주)
const TABLE: Record<CampShuttle, Record<CampDiscount, [number, number]>> = {
  왕복: { 없음: [270, 180], 재학생: [189, 126], 형제: [243, 162], 재수강: [256.5, 171] },
  미이용: { 없음: [255, 170], 재학생: [178.5, 119], 형제: [229.5, 153], 재수강: [242.25, 161.5] },
  편도: { 없음: [262.5, 175], 재학생: [183.75, 122.5], 형제: [236.25, 157.5], 재수강: [249.375, 166.25] },
};
for (const [sh, row] of Object.entries(TABLE) as [CampShuttle, Record<CampDiscount, [number, number]>][]) {
  for (const [dc, [w3, w2]] of Object.entries(row) as [CampDiscount, [number, number]][]) {
    eq(`${sh} ${dc} 3주`, campFee(3, sh, dc)?.amount, Math.round(w3 * 10_000));
    eq(`${sh} ${dc} 2주`, campFee(2, sh, dc)?.amount, Math.round(w2 * 10_000));
  }
}
eq("주 모름", campFee(null, "왕복", "없음"), null);

// 할인은 하나만
eq("재학생+형제+재수강 → 재학생", campDiscountOf({ isCurrent: true, sibling: true, returning: true }), "재학생");
eq("외부 형제+재수강 → 형제", campDiscountOf({ isCurrent: false, sibling: true, returning: true }), "형제");
eq("외부 재수강 → 재수강", campDiscountOf({ isCurrent: false, sibling: false, returning: true }), "재수강");
eq("사람이 고른 것 우선", campDiscountOf({ isCurrent: true, sibling: false, returning: false, override: "없음" }), "없음");

eq("2~3주차", parseWeeks("2주 참여 (2~3주차)"), 2);
eq("3주 전체", parseWeeks("3주 전체 참여 (1~3주차)"), 3);
eq("셔틀 편도", parseShuttle("편도(등원만)"), "편도");
eq("셔틀 미이용", parseShuttle("이용하지 않음"), "미이용");
eq("셔틀 이용", parseShuttle("이용"), "왕복");

const f = readCampForm({
  타임스탬프: "2026-11-03T05:10:00.000Z",
  "학생 이름(한글)": "홍길동",
  "학생 영문 이름": "Gildong Hong",
  "보호자 성함": "홍아버지",
  "보호자 연락처": "010-1234-5678",
  학년: "3",
  "참여 기간": "2주 (2~3주차)",
  "셔틀 이용": "편도",
  "GIA 재학생입니까?": "아니오",
  "형제자매가 함께 참여하나요?": "예",
});
eq("폼 이름", f.applicant_name, "홍길동");
eq("폼 영문", f.applicant_name_en, "Gildong Hong");
eq("폼 보호자", f.guardian_name, "홍아버지");
eq("폼 연락처", f.guardian_phone, "010-1234-5678");
eq("폼 주", f.weeks, 2);
eq("폼 셔틀", f.shuttle, "편도");
eq("폼 재학", f.says_current, false);
eq("폼 형제", f.sibling, true);

if (fail) {
  console.error(`캠프 수강료 시험 ${fail}건 실패`);
  process.exit(1);
}
console.log("✓ 캠프 수강료 시험 통과");
