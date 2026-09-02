import { nameFromFile, matchStudent, cropBoxOf, adjustFromFace, DEFAULT_ADJUST, PHOTO_RATIO, type PhotoStudent } from "../../src/lib/passportPhoto";
let pass = 0, fail = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log("✗", m, "\n  받음:", JSON.stringify(a), "\n  기대:", JSON.stringify(b)); }
};
const near = (a: number, b: number, m: string, tol = 0.02) => {
  if (Math.abs(a - b) <= tol) pass++; else { fail++; console.log("✗", m, "받음:", a, "기대:", b); }
};

eq(nameFromFile("고서윤.jpg"), "고서윤", "그냥 이름");
eq(nameFromFile("고서윤 (2).JPG"), "고서윤", "괄호 번호");
eq(nameFromFile("2학년 고서윤.jpeg"), "고서윤", "학년 표기");
eq(nameFromFile("01_고서윤.png"), "고서윤", "앞의 순번");
eq(nameFromFile("Jenny Go.jpeg"), "Jenny Go", "영문 이름");
eq(nameFromFile("고서윤-copy.jpg"), "고서윤", "copy 꼬리표");
eq(nameFromFile("고서윤2.jpg"), "고서윤", "뒤에 붙은 숫자");

const roster: PhotoStudent[] = [
  { id: "a", name: "고서윤", nameEn: "Jenny Go", gradeLabel: "2학년 G2C" },
  { id: "b", name: "김재이", nameEn: "Jay Kim", gradeLabel: "2학년 G2A" },
  { id: "c", name: "김재이", nameEn: "Jay Kim", gradeLabel: "2학년 G2C" },
];
eq(matchStudent("고서윤.jpg", roster).student?.id, "a", "한글 이름으로 찾기");
eq(matchStudent("Jenny Go.jpg", roster).student?.id, "a", "영문 이름으로 찾기");
eq(matchStudent("김재이.jpg", roster).student, null, "동명이인은 사람이 골라야");
eq(matchStudent("김재이.jpg", roster).candidates.length, 2, "동명이인 후보 2명");
eq(matchStudent("홍길동.jpg", roster).student, null, "명부에 없는 이름");
eq(matchStudent("2학년 고서윤 졸업사진.jpg", roster).student?.id, "a", "파일명 안에 이름");

// 자르는 자리 — 비율이 항상 35:45 여야 합니다.
const b1 = cropBoxOf(3000, 2000, DEFAULT_ADJUST);
near(b1.w / b1.h, PHOTO_RATIO, "가로가 긴 사진도 규격 비율");
const b2 = cropBoxOf(1000, 4000, DEFAULT_ADJUST);
near(b2.w / b2.h, PHOTO_RATIO, "세로가 아주 긴 사진도 규격 비율");
eq(b2.x >= 0 && b2.y >= 0 && b2.x + b2.w <= 1000 && b2.y + b2.h <= 4000, true, "그림 밖으로 안 나감");

const b3 = cropBoxOf(1000, 1000, { zoom: 1, cx: 0, cy: 0 });
eq(b3.x, 0, "왼쪽 끝으로 밀어도 0에서 멈춤");
eq(b3.y, 0, "위쪽 끝으로 밀어도 0에서 멈춤");

// 얼굴을 찾았을 때 — 얼굴 높이가 사진 높이의 70% 근처가 되어야 합니다.
const a = adjustFromFace(1000, 1500, { x: 400, y: 300, width: 200, height: 260 });
const bf = cropBoxOf(1000, 1500, a);
near(260 / bf.h, 0.7, "얼굴이 사진 높이의 70%쯤", 0.05);
near((400 + 100 - bf.x) / bf.w, 0.5, "얼굴이 가로 가운데", 0.05);

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ""}`);
process.exit(fail ? 1 : 0);
