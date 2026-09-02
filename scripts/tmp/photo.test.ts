import { adjustFromEyes, HEAD_PER_EYE_GAP, EYE_LINE, nameFromFile, matchStudent, cropBoxOf, adjustFromFace, adjustFromHead, detectHeadFromPixels, HEAD_RATIO, TOP_MARGIN, DEFAULT_ADJUST, PHOTO_RATIO, type PhotoStudent } from "../../src/lib/passportPhoto";
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
  { id: "a", name: "고서윤", nameEn: "Jenny Go", gradeLabel: "2학년 G2C", className: "G2C", grade: "2" },
  { id: "b", name: "김재이", nameEn: "Jay Kim", gradeLabel: "2학년 G2A", className: "G2A", grade: "2" },
  { id: "c", name: "김재이", nameEn: "Jay Kim", gradeLabel: "2학년 G2C", className: "G2C", grade: "2" },
  { id: "d", name: "김재이", nameEn: "Jay Kim", gradeLabel: "3학년 G3JA", className: "G3JA", grade: "3" },
  { id: "e", name: "강여명(Ryeomyeong Kang)", nameEn: "Ryeomyeong Kang", gradeLabel: "6학년", className: null, grade: "6" },
];
eq(matchStudent("고서윤.jpg", roster).student?.id, "a", "한글 이름으로 찾기");
eq(matchStudent("Jenny Go.jpg", roster).student?.id, "a", "영문 이름으로 찾기");
eq(matchStudent("김재이.jpg", roster).student, null, "동명이인은 사람이 골라야");
eq(matchStudent("김재이.jpg", roster).candidates.length, 3, "동명이인 후보 3명");

// 맥에서 끌어온 파일명은 한글이 자모로 나뉘어 옵니다. 이게 안 되면 **전부** 안 붙습니다.
eq(matchStudent("고서윤.jpg".normalize("NFD"), roster).student?.id, "a", "맥 파일명(NFD)도 붙음");
eq(matchStudent("김재이(G3J).jpg".normalize("NFD"), roster).student?.id, "d", "맥 파일명 + 반 표기");

// 동명이인은 파일명 괄호 안의 반 표기로 가릅니다.
eq(matchStudent("김재이(G3J).jpg", roster).student?.id, "d", "반 표기 줄임말로 가름 (G3J → G3JA)");
eq(matchStudent("김재이(G2A).jpg", roster).student?.id, "b", "반 표기 전체로 가름");
eq(matchStudent("김재이(G5).jpg", roster).candidates.length, 3, "없는 반을 적으면 후보를 그대로 보여줌");

// 명부 이름에 영문이 괄호로 붙어 있어도 붙습니다.
eq(matchStudent("강여명.jpg", roster).student?.id, "e", "명부 이름의 괄호 표기 무시");
eq(matchStudent("홍길동.jpg", roster).student, null, "명부에 없는 이름");
eq(matchStudent("2학년 고서윤 졸업사진.jpg", roster).student?.id, "a", "파일명 안에 이름");

// 자르는 자리 — 비율이 항상 35:45 여야 합니다.
const b1 = cropBoxOf(3000, 2000, DEFAULT_ADJUST);
near(b1.w / b1.h, PHOTO_RATIO, "가로가 긴 사진도 규격 비율");
const b2 = cropBoxOf(1000, 4000, DEFAULT_ADJUST);
near(b2.w / b2.h, PHOTO_RATIO, "세로가 아주 긴 사진도 규격 비율");
// 원본에 머리 위 여백이 거의 없는 사진이 있어서, 조금 밖으로 나가는 것은 허용합니다
// (그 자리는 흰색으로 채웁니다). 억지로 안쪽에 붙이면 정수리가 잘립니다.
const b3 = cropBoxOf(1000, 1000, { zoom: 1, cx: 0, cy: 0 });
eq(b3.x >= -b3.w * 0.2 - 0.01 && b3.y >= -b3.h * 0.2 - 0.01, true, "밖으로 나가도 20%까지만");
const b4 = cropBoxOf(1000, 1000, { zoom: 1, cx: 9, cy: 9 });
eq(b4.x <= 1000 - b4.w * 0.8 + 0.01, true, "반대쪽도 20%까지만");

// ── 눈으로 잡을 때 머리가 잘리지 않아야 합니다 ────────────────────────
// 눈 사이 거리로 머리 높이를 가늠하는데, 그 값을 작게 잡으면 과하게 확대되어 정수리가
// 밖으로 나갑니다. 실제로 그 일이 있었습니다.
function crownInside(imgW: number, imgH: number, gap: number, eyeY: number) {
  const left = { x: imgW / 2 - gap / 2, y: eyeY };
  const right = { x: imgW / 2 + gap / 2, y: eyeY };
  const a = adjustFromEyes(imgW, imgH, left, right);
  const box = cropBoxOf(imgW, imgH, a);
  // 눈은 머리 높이의 45%쯤 아래에 있습니다. 거기서 거꾸로 정수리를 구합니다.
  const headH = gap * HEAD_PER_EYE_GAP;
  const crown = eyeY - headH * 0.45;
  const chin = eyeY + headH * 0.55;
  return { topGap: (crown - box.y) / box.h, chinAt: (chin - box.y) / box.h, eyeAt: (eyeY - box.y) / box.h };
}
{
  const r = crownInside(1200, 1600, 90, 620);
  eq(r.topGap > 0.03, true, `정수리 위에 여백이 남음 (${r.topGap.toFixed(3)})`);
  eq(r.chinAt < 0.95, true, `턱이 사진 안에 있음 (${r.chinAt.toFixed(3)})`);
  near(r.eyeAt, EYE_LINE, "눈이 규격 높이에 옴", 0.03);
  // 얼굴이 크게 찍힌 사진도 마찬가지여야 합니다.
  const r2 = crownInside(1200, 1600, 180, 700);
  eq(r2.topGap > 0.03, true, `크게 찍힌 사진도 정수리 여백 (${r2.topGap.toFixed(3)})`);
}

// 얼굴을 찾았을 때 — 얼굴 높이가 사진 높이의 70% 근처가 되어야 합니다.
const a = adjustFromFace(1000, 1500, { x: 400, y: 300, width: 200, height: 260 });
const bf = cropBoxOf(1000, 1500, a);
// 얼굴 상자는 이마~턱이라, 머리(정수리 포함)가 70%면 얼굴만으로는 53%쯤입니다.
near(260 / bf.h, 0.7 / 1.32, "얼굴(이마~턱)이 사진 높이의 53%쯤", 0.05);
near((400 + 100 - bf.x) / bf.w, 0.5, "얼굴이 가로 가운데", 0.05);


// ── 규격대로 자리 잡기 ──────────────────────────────────────────────
// 머리 높이가 사진의 70%, 머리 위 여백이 10%. 찍힌 거리가 달라도 결과는 같아야 합니다.
function framed(imgW: number, imgH: number, top: number, bottom: number, cx: number) {
  const a = adjustFromHead(imgW, imgH, top, bottom, cx);
  const b = cropBoxOf(imgW, imgH, a);
  return { headShare: (bottom - top) / b.h, topMargin: (top - b.y) / b.h, box: b };
}
{
  // 멀리서 찍혀 얼굴이 작은 사진
  const f1 = framed(2000, 3000, 400, 800, 1000);
  near(f1.headShare, HEAD_RATIO, "작게 찍혀도 머리가 70%");
  near(f1.topMargin, TOP_MARGIN, "작게 찍혀도 위 여백 10%");
  // 가까이서 찍혀 얼굴이 큰 사진
  const f2 = framed(2000, 3000, 300, 1500, 1000);
  near(f2.headShare, HEAD_RATIO, "크게 찍혀도 머리가 70%");
  near(f2.topMargin, TOP_MARGIN, "크게 찍혀도 위 여백 10%");
  // 두 사진의 머리 크기가 결과에서 같아야 합니다 - 이게 "같은 구도"의 뜻입니다.
  near(f1.headShare, f2.headShare, "두 사진의 머리 크기가 같아짐");
}

// ── 배경을 빼서 머리 찾기 ───────────────────────────────────────────
// 흰 배경에 어두운 타원(머리)을 그린 가짜 사진을 만들어 확인합니다.
function fakePortrait(w: number, h: number, headTop: number, headW: number) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const cx = w / 2;
  const rx = headW / 2;
  const ry = (headW * 1.32) / 2;
  const cyc = headTop + ry;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inHead = ((x - cx) / rx) ** 2 + ((y - cyc) / ry) ** 2 <= 1;
      // 어깨: 머리 아래로 넓게
      const inBody = y > cyc + ry * 0.8 && Math.abs(x - cx) < headW * 1.1;
      if (inHead || inBody) {
        const i = (y * w + x) * 4;
        data[i] = 40; data[i + 1] = 40; data[i + 2] = 40;
      }
    }
  }
  return data;
}
{
  const w = 300, h = 400;
  const box = detectHeadFromPixels(fakePortrait(w, h, 40, 90), w, h);
  if (!box) { fail++; console.log("✗ 머리를 못 찾음"); }
  else {
    near(box.top, 40, "정수리 위치", 8);
    near(box.centerX, w / 2, "얼굴 가운데", 8);
    near(box.bottom - box.top, 90 * 1.32, "머리 높이 추정", 20);
    eq(box.confident, true, "믿을 만한 결과");
  }
  // 얼룩덜룩한 배경이면 스스로 못 믿겠다고 해야 합니다.
  const noisy = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < noisy.length; i++) noisy[i] = Math.floor(Math.random() * 255);
  const nb = detectHeadFromPixels(noisy, w, h);
  eq(nb === null || nb.confident === false, true, "얼룩진 배경은 못 믿겠다고 함");
}

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ""}`);
process.exit(fail ? 1 : 0);
