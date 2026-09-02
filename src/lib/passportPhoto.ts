// 여권 규격 사진으로 자르기
//
// 졸업앨범 사진은 크기도 구도도 제각각이라 학생증·도서관 카드에 그대로 못 씁니다. 규격을
// 하나로 정해두고 **넣을 때 잘라서** 보관합니다 - 쓸 때 자르면 쓰는 화면마다 자르는 코드가
// 생기고, 그러면 화면마다 조금씩 다르게 잘립니다.
//
// 35mm × 45mm, 300dpi 기준입니다. 여권·주민등록증·학생증이 모두 이 비율을 씁니다.

export const PHOTO_W = 413;
export const PHOTO_H = 531;
export const PHOTO_RATIO = 35 / 45;

/** 자를 자리. 원본 그림 위의 사각형입니다(픽셀). */
export type CropBox = { x: number; y: number; w: number; h: number };

/**
 * 조정값. 사람이 손으로 미는 값이라 **원본 크기와 무관한 비율**로 들고 있습니다.
 * 사진마다 해상도가 다른데 픽셀로 들고 있으면 "전체에 같은 값 적용"이 안 됩니다.
 */
export type Adjust = {
  /** 1이면 규격에 꽉 차게, 작을수록 더 넓게(멀리서) 잡습니다. */
  zoom: number;
  /** 가로 중심. 0.5가 한가운데. */
  cx: number;
  /** 세로 중심. 0.5가 한가운데. */
  cy: number;
};

/**
 * 처음 잡아주는 값.
 *
 * 앨범 사진은 대개 얼굴이 **가운데 위쪽**에 옵니다. 정확히 맞히려는 것이 아니라, 사람이
 * 조금만 밀면 되는 자리에서 시작하려는 것입니다. 얼굴 위치를 찾아낼 수 있으면 그것을 씁니다.
 */
export const DEFAULT_ADJUST: Adjust = { zoom: 1, cx: 0.5, cy: 0.42 };

/** 조정값을 실제로 자를 사각형으로 바꿉니다. 그림 밖으로 나가지 않게 안쪽으로 밀어 넣습니다. */
export function cropBoxOf(imgW: number, imgH: number, a: Adjust): CropBox {
  const z = Math.min(Math.max(a.zoom, 0.2), 1);
  // 규격 비율에 맞는 가장 큰 사각형에서 시작해, zoom 만큼 줄입니다.
  let w = Math.min(imgW, imgH * PHOTO_RATIO) * z;
  let h = w / PHOTO_RATIO;
  if (h > imgH) {
    h = imgH;
    w = h * PHOTO_RATIO;
  }
  let x = a.cx * imgW - w / 2;
  let y = a.cy * imgH - h / 2;
  x = Math.min(Math.max(x, 0), imgW - w);
  y = Math.min(Math.max(y, 0), imgH - h);
  return { x, y, w, h };
}

/**
 * 여권 규격의 자리 잡기.
 *
 * 규격이 정하는 것은 두 가지입니다 - **머리가 사진에서 얼마나 크게 나오는가**, 그리고
 * **머리 위 여백이 얼마인가**. 이 둘을 고정하면 아이마다 찍힌 거리가 달라도 결과는 같은
 * 크기·같은 구도로 나옵니다. 그것이 학생증 한 판을 뽑았을 때 눈에 띄는 차이입니다.
 */
export const HEAD_RATIO = 0.7; // 머리(정수리~턱)가 사진 높이에서 차지하는 비율
export const TOP_MARGIN = 0.1; // 사진 위쪽 여백

/**
 * 머리 위치를 알면 규격대로 자리를 잡습니다.
 *
 * @param headTop 정수리의 y(픽셀)
 * @param headBottom 턱의 y(픽셀)
 * @param centerX 얼굴 가운데의 x(픽셀)
 */
export function adjustFromHead(
  imgW: number,
  imgH: number,
  headTop: number,
  headBottom: number,
  centerX: number,
): Adjust {
  const headH = Math.max(headBottom - headTop, 1);
  const cropH = headH / HEAD_RATIO;
  const cropW = cropH * PHOTO_RATIO;
  const base = Math.min(imgW, imgH * PHOTO_RATIO);
  const zoom = Math.min(Math.max(cropW / base, 0.05), 1);
  // 실제로 잘리는 높이는 zoom 이 1로 잘릴 수 있으니 다시 계산해서 중심을 맞춥니다.
  const realW = base * zoom;
  const realH = realW / PHOTO_RATIO;
  const cy = (headTop - TOP_MARGIN * realH + realH / 2) / imgH;
  return { zoom, cx: centerX / imgW, cy: Math.min(Math.max(cy, 0), 1) };
}

/** 얼굴 자리를 알면 여권 규격에 맞는 조정값으로 바꿉니다.
 *
 * 규격은 머리 꼭대기 위로 조금 띄우고 턱 아래로 어깨가 조금 나오게 잡습니다. 얼굴 높이가
 * 사진 높이의 약 70%가 되도록 잡으면 그 모양이 나옵니다. */
export function adjustFromFace(
  imgW: number,
  imgH: number,
  face: { x: number; y: number; width: number; height: number },
): Adjust {
  // 얼굴 찾기가 돌려주는 상자는 대개 **이마부터 턱까지**라 머리카락 위쪽이 빠져 있습니다.
  // 그 위로 얼굴 높이의 30%쯤을 더해야 정수리가 됩니다.
  const headTop = face.y - face.height * 0.3;
  const headBottom = face.y + face.height * 1.02;
  return adjustFromHead(imgW, imgH, headTop, headBottom, face.x + face.width / 2);
}

// ── 배경을 빼서 머리를 찾기 ────────────────────────────────────────────
//
// 졸업앨범 사진은 **배경이 한 가지 색**입니다. 그래서 얼굴 찾기 모델이 없어도 머리 위치를
//꽤 정확히 알 수 있습니다 - 위에서 내려오다가 배경이 아닌 점이 처음 나오는 줄이 정수리입니다.
//
// 얼굴 찾기가 되는 브라우저면 그것을 먼저 쓰고, 안 되면 이 방법을 씁니다. 둘 다 안 되면
// 기본 자리에서 시작하고 사람이 밉니다.

export type HeadBox = { top: number; bottom: number; centerX: number; confident: boolean };

/**
 * 픽셀에서 머리 상자를 찾습니다. (캔버스에서 꺼낸 RGBA 배열)
 *
 * 턱의 위치는 따로 찾지 않고 **머리 너비로 추정**합니다. 사람 머리는 세로가 가로의 1.3배쯤
 * 이고, 턱 아래는 목·어깨라 배경만으로는 경계가 잡히지 않습니다.
 */
export function detectHeadFromPixels(data: Uint8ClampedArray, w: number, h: number): HeadBox | null {
  const at = (x: number, y: number) => (y * w + x) * 4;
  // 배경색은 위쪽 두 모서리에서 봅니다. 사람은 가운데 있고 위 모서리는 거의 늘 배경입니다.
  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(w / 40));
  for (let x = 0; x < w; x += step) {
    for (let y = 0; y < Math.max(2, Math.floor(h * 0.03)); y++) {
      const i = at(x, y);
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (samples.length === 0) return null;
  const bg = [0, 1, 2].map((k) => samples.reduce((n, s) => n + s[k], 0) / samples.length) as [number, number, number];
  // 배경이 얼마나 고른지. 고르지 않으면(야외 사진 등) 이 방법을 믿으면 안 됩니다.
  const spread =
    Math.sqrt(
      samples.reduce((n, s) => n + (s[0] - bg[0]) ** 2 + (s[1] - bg[1]) ** 2 + (s[2] - bg[2]) ** 2, 0) / samples.length,
    ) || 0;
  const thr = Math.max(38, spread * 2.5);

  const isSubject = (x: number, y: number) => {
    const i = at(x, y);
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    return d > thr;
  };

  // 정수리: 위에서 내려오며 배경이 아닌 점이 **연속 여러 줄** 나오는 곳. 한 줄만 보면
  // 먼지나 얼룩에 걸립니다.
  const minCount = Math.max(3, Math.floor(w * 0.02));
  let top = -1;
  let run = 0;
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (isSubject(x, y)) c++;
    if (c >= minCount) {
      if (run === 0) top = y;
      run++;
      if (run >= Math.max(3, Math.floor(h * 0.01))) break;
    } else {
      run = 0;
      top = -1;
    }
  }
  if (top < 0 || top > h * 0.8) return null;

  // 머리 너비: 정수리 아래 얼마간에서 가장 넓은 가로 폭. 그보다 더 내려가면 어깨가 섞입니다.
  const band = Math.max(2, Math.floor(h * 0.12));
  let minX = w;
  let maxX = 0;
  for (let y = top; y < Math.min(h, top + band); y++) {
    for (let x = 0; x < w; x++) {
      if (isSubject(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX <= minX) return null;
  const headW = maxX - minX;
  // 너비가 사진 폭의 대부분이면 배경 판정이 실패한 것입니다(배경이 얼룩덜룩한 사진).
  const confident = headW < w * 0.9 && headW > w * 0.05;
  return { top, bottom: top + headW * 1.32, centerX: (minX + maxX) / 2, confident };
}

// ── 파일명으로 학생 찾기 ─────────────────────────────────────────────
//
// 파일명이 곧 이름입니다. 다만 실제 폴더에는 `고서윤 (2).jpg`, `2학년 고서윤.JPG`,
// `Jenny Go.jpeg` 처럼 앞뒤에 뭐가 붙습니다. 붙은 것을 떼고 남은 글자로 찾습니다.

export type PhotoStudent = { id: string; name: string; nameEn: string | null; gradeLabel: string };

/**
 * 대조용으로 다듬습니다.
 *
 * 명부의 이름에 영문 표기가 괄호로 붙어 있는 줄이 있습니다(`강여명(Ryeomyeong Kang)`).
 * 그대로 대조하면 `강여명.jpg` 가 어디에도 안 걸립니다.
 */
const flat = (v: string) =>
  v
    .replace(/[（(［[][^)）\]］]*[)）\]］]/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");

/** 확장자·번호·학년 표기 따위를 떼고 이름만 남깁니다. */
export function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[（(［[][^)）\]］]*[)）\]］]/g, " ")
    .replace(/\d+\s*(학년|반|호)/g, " ")
    .replace(/^\d+[-_.\s]*/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s*copy\s*$/i, "")
    .replace(/\d+$/, "")
    .trim();
}

export type PhotoMatch = { student: PhotoStudent | null; candidates: PhotoStudent[]; reason: string };

export function matchStudent(fileName: string, roster: PhotoStudent[]): PhotoMatch {
  const key = flat(nameFromFile(fileName));
  if (!key) return { student: null, candidates: [], reason: "파일명에서 이름을 못 읽었습니다" };

  const exact = roster.filter((s) => flat(s.name) === key || flat(s.nameEn ?? "") === key);
  if (exact.length === 1) return { student: exact[0], candidates: [], reason: "이름이 같음" };
  if (exact.length > 1) {
    return { student: null, candidates: exact, reason: `같은 이름 ${exact.length}명 — 골라주세요` };
  }

  // 파일명 안에 이름이 들어 있는 경우(`2학년 고서윤 졸업`).
  const inside = roster.filter((s) => key.includes(flat(s.name)) || (s.nameEn && key.includes(flat(s.nameEn))));
  if (inside.length === 1) return { student: inside[0], candidates: [], reason: "파일명 안에 이름이 있음" };
  if (inside.length > 1) return { student: null, candidates: inside, reason: `여러 명이 걸립니다 — 골라주세요` };

  return { student: null, candidates: [], reason: "명부에서 못 찾았습니다" };
}
