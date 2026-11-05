/**
 * 캠프 수강료 시험 — 2026 윈터캠프 요금표 24칸을 campFee 로 다시 셉니다.
 * 요금표가 바뀌면 이 표를 새 요금표로 고칩니다. 식이 표와 어긋나면 빌드가 멈춥니다.
 */
import { matchCampStudent, campGroupOf } from "../src/lib/campMatch";
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

// 2027 윈터캠프 실제 폼 머리줄(값은 지어낸 것)
const w = readCampForm({
  Timestamp: "2026-11-03T05:10:00.000Z",
  "Student Name (Korean)\n학생 이름 (한글)": "홍길동",
  "Student Name (English)\n학생 이름 (영문)": "Gildong Hong",
  "Guardian Phone Number\n보호자 연락처": "010-0000-0000",
  "I would like to sign up for the shuttle bus service.\n셔틀버스 이용을 신청합니다.": "Yes: One-way (Going home)",
  "Current Address (for Shuttle Bus)\n현재 거주 중인 주소 (셔틀버스 이용 시)": "서울 어딘가",
  "Name of the current elementary school the student is attending\n현재 재학 중인 초등학교": "어느초",
  "Is this your first time at GIA Micro Lab Camp?\nGIA Micro Lab 캠프에 참여하는 것이 이번이 처음입니까?": "No",
  "Once you complete the application form, we will review it and send you a message with details regarding the level test and payment. If you have any additional questions, please feel free to write them below.\n신청서 작성을 완료하시면 확인 후 레벨테스트 및 입금 관련 안내 문자를 보내드립니다. 기타 문의사항이 있으시면 아래에 적어주세요.": "여동생 함께 신청합니다. week1은 어렵습니다",
  "How did you hear about GIA Micro Lab Camp?\nGIA 마이크로랩 캠프를 어떤 경로로 알게 되셨나요?": "Current GIA Parent (재학생 학부모)",
});
eq("윈터 이름", w.applicant_name, "홍길동");
eq("윈터 셔틀 편도", w.shuttle, "편도");
eq("윈터 재수강", w.returning, true);
eq("윈터 재학 대답", w.says_current, true);
eq("윈터 형제 언급", w.sibling, true);
eq("윈터 주 기본 3", [w.weeks, w.weeks_assumed], [3, true]);
eq("윈터 문의 글", !!w.note, true);
eq("셔틀 아니오", parseShuttle("No."), "미이용");
eq("셔틀 왕복", parseShuttle("Yes: Round-trip"), "왕복");

// 자동 연결 — 확실한 것만 잇는다
{
  const roster = [
    { id: "a", name: "김재이", birth_date: "2017-03-01", status: "active" },
    { id: "b", name: "김재이", birth_date: "2016-05-02", status: "active" },
    { id: "c", name: "박하늘", name_en: "Haneul Park", birth_date: null, status: "active" },
    { id: "d", name: "이서준", birth_date: "2018-01-01", status: "inactive" },
    { id: "e", name: "이서준", birth_date: null, status: "active" },
  ];
  eq("한 명뿐인 이름", matchCampStudent({ applicant_name: "박 하늘" }, roster), { studentId: "c", by: "이름" });
  eq("동명이인 + 생일로 한 명", matchCampStudent({ applicant_name: "김재이", birth_date: "2016-05-02" }, roster), { studentId: "b", by: "이름+생일" });
  eq("동명이인 + 생일 없음 → 사람이", matchCampStudent({ applicant_name: "김재이" }, roster), { ambiguous: 2 });
  eq("명부 생일이 비어 있으면 이름으로", matchCampStudent({ applicant_name: "박하늘", birth_date: "2015-01-01" }, roster), { studentId: "c", by: "이름" });
  eq("생일이 다른 동명이인은 빠짐", matchCampStudent({ applicant_name: "이서준", birth_date: "2019-09-09" }, roster), { studentId: "e", by: "이름" });
  eq("동명이인 + 재학 답 → 재학생 한 명", matchCampStudent({ applicant_name: "이서준", says_current: true }, roster), { studentId: "e", by: "이름+재학" });
  eq("영문 이름", matchCampStudent({ applicant_name: "", applicant_name_en: "haneul park" }, roster), { studentId: "c", by: "영문 이름" });
  eq("명부에 없음", matchCampStudent({ applicant_name: "최외부" }, roster), null);
  eq("묶음: 이어진 재학생", campGroupOf("active", false), "재학생");
  eq("묶음: 이어진 캠프 학생", campGroupOf("캠프", true), "외부");
  eq("묶음: 안 이음 + 재학 답", campGroupOf(null, true), "재학생");
}

if (fail) {
  console.error(`캠프 수강료 시험 ${fail}건 실패`);
  process.exit(1);
}
console.log("✓ 캠프 수강료 시험 통과");
