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
  /**
   * 기울기(라디안). 두 눈을 잇는 선이 수평이 되도록 돌립니다.
   *
   * 고개를 살짝 기울이고 찍은 아이가 꼭 몇 명 있습니다. 학생증을 한 판 뽑아 늘어놓으면
   * 그 몇 장만 눈에 띕니다.
   */
  rot?: number;
};

/**
 * 처음 잡아주는 값.
 *
 * 앨범 사진은 대개 얼굴이 **가운데 위쪽**에 옵니다. 정확히 맞히려는 것이 아니라, 사람이
 * 조금만 밀면 되는 자리에서 시작하려는 것입니다. 얼굴 위치를 찾아낼 수 있으면 그것을 씁니다.
 */
export const DEFAULT_ADJUST: Adjust = { zoom: 1, cx: 0.5, cy: 0.42, rot: 0 };

/** 조정값을 실제로 자를 사각형으로 바꿉니다. 그림 밖으로 나가지 않게 안쪽으로 밀어 넣습니다. */
export function cropBoxOf(imgW: number, imgH: number, a: Adjust): CropBox {
  const z = Math.min(Math.max(a.zoom, 0.05), 1);
  // 규격 비율에 맞는 가장 큰 사각형에서 시작해, zoom 만큼 줄입니다.
  let w = Math.min(imgW, imgH * PHOTO_RATIO) * z;
  let h = w / PHOTO_RATIO;
  if (h > imgH) {
    h = imgH;
    w = h * PHOTO_RATIO;
  }
  let x = a.cx * imgW - w / 2;
  let y = a.cy * imgH - h / 2;
  // 그림 밖으로 조금 나가는 것을 허용합니다. 원본에 머리 위 여백이 거의 없는 사진이 있는데,
  // 억지로 안쪽에 붙이면 **정수리가 잘립니다.** 흰 여백이 조금 생기는 편이 낫습니다.
  const slack = 0.2;
  x = Math.min(Math.max(x, -w * slack), imgW - w * (1 - slack));
  y = Math.min(Math.max(y, -h * slack), imgH - h * (1 - slack));
  return { x, y, w, h };
}

/**
 * 여권 규격의 자리 잡기.
 *
 * 규격이 정하는 것은 두 가지입니다 - **머리가 사진에서 얼마나 크게 나오는가**, 그리고
 * **머리 위 여백이 얼마인가**. 이 둘을 고정하면 아이마다 찍힌 거리가 달라도 결과는 같은
 * 크기·같은 구도로 나옵니다. 그것이 학생증 한 판을 뽑았을 때 눈에 띄는 차이입니다.
 */
/**
 * 머리(정수리~턱)가 사진 높이에서 차지하는 비율.
 *
 * 여권 규격은 45mm 사진에서 얼굴 길이를 32~36mm로 정합니다(71~80%). 그런데 **위쪽을 택하면
 * 머리가 잘립니다** - 자동으로 잡은 머리 크기가 조금만 작게 나와도 정수리가 밖으로 나갑니다.
 * 규격 안에서 가장 여유 있는 쪽을 씁니다. 조금 넉넉한 사진은 학생증에서 티가 안 나지만,
 * 정수리가 잘린 사진은 한눈에 보입니다.
 */
export const HEAD_RATIO = 0.66;
export const TOP_MARGIN = 0.1; // 사진 위쪽 여백(규격은 3~5mm, 45mm 기준 7~11%)

/**
 * 눈높이가 사진 위에서 얼마쯤에 오는가.
 *
 * 신분증 사진은 사실 **눈높이로 맞춥니다.** 여권 규격도 눈이 아래에서 50~60% 사이에 오도록
 * 정하고 있습니다(위에서 보면 40~50%). 정수리는 머리 모양과 머리카락에 따라 들쭉날쭉하지만
 * 눈은 그렇지 않아서, 눈을 기준으로 잡으면 아이들 사진이 실제로 똑같아집니다.
 */
export const EYE_LINE = 0.4;

/**
 * 두 눈 사이 거리로 머리 높이를 가늠하는 비율.
 *
 * 머리 높이(정수리~턱)는 두 눈동자 사이 거리의 약 3.6배입니다. 어른은 눈 사이 62mm에 머리
 * 230mm, 아이는 55mm에 200mm쯤이라 비율은 거의 같습니다.
 *
 * 이 값을 작게 잡으면 머리를 작게 본 것이 되어 **그만큼 과하게 확대되고, 정수리가 잘립니다.**
 * 처음에 3배로 두었다가 실제로 잘리는 사진이 나왔습니다.
 */
export const HEAD_PER_EYE_GAP = 3.6;

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

/**
 * **두 눈으로** 자리를 잡습니다. 가장 정확하고, 아이들 사진이 실제로 똑같아집니다.
 *
 * 세 가지를 한 번에 정합니다.
 *   · 크기 — 눈 사이 거리로 머리 높이를 가늠해, 머리가 사진의 70%가 되게.
 *   · 높이 — 눈높이가 위에서 44%에 오도록.
 *   · 기울기 — 두 눈을 잇는 선이 수평이 되도록 돌립니다.
 */
export function adjustFromEyes(
  imgW: number,
  imgH: number,
  left: { x: number; y: number },
  right: { x: number; y: number },
  /** 얼굴 상자(이마~턱)를 함께 주면 더 안전하게 잡습니다. */
  faceBox?: { height: number },
): Adjust {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const gap = Math.hypot(dx, dy);
  if (!(gap > 1)) return DEFAULT_ADJUST;

  // 머리 높이를 **두 가지로 재고 큰 쪽**을 씁니다. 눈 사이 거리는 고개를 옆으로 돌리면
  // 짧게 잡히고, 그러면 머리를 작게 본 것이 되어 과하게 확대됩니다. 얼굴 상자는 그때도
  // 줄지 않습니다. 크게 잡아 틀리면 여백이 조금 넓을 뿐이고, 작게 잡아 틀리면 잘립니다.
  const headH = Math.max(gap * HEAD_PER_EYE_GAP, (faceBox?.height ?? 0) * 1.45);
  const cropH = headH / HEAD_RATIO;
  const cropW = cropH * PHOTO_RATIO;
  const base = Math.min(imgW, imgH * PHOTO_RATIO);
  const zoom = Math.min(Math.max(cropW / base, 0.05), 1);

  // 실제로 잘리는 크기로 다시 계산합니다(zoom 이 1에서 막혔을 수 있습니다).
  const realH = (base * zoom) / PHOTO_RATIO;
  const eyeX = (left.x + right.x) / 2;
  const eyeY = (left.y + right.y) / 2;
  // 눈이 위에서 EYE_LINE 에 오려면, 자르는 네모의 한가운데는 눈보다 조금 아래여야 합니다.
  const cy = (eyeY + (0.5 - EYE_LINE) * realH) / imgH;

  return {
    zoom,
    cx: Math.min(Math.max(eyeX / imgW, 0), 1),
    cy: Math.min(Math.max(cy, 0), 1),
    rot: Math.atan2(dy, dx),
  };
}

/**
 * 자르기를 그립니다. 미리보기와 저장이 **같은 함수**를 씁니다.
 *
 * 둘을 따로 만들면 화면에서 본 것과 저장된 것이 조금씩 달라집니다. 그 차이는 늘 나중에,
 * 인쇄한 뒤에 발견됩니다.
 */
export function drawCrop(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number },
  a: Adjust,
  outW: number,
  outH: number,
) {
  const iw = img.naturalWidth || (img.width as number) || 1;
  const ih = img.naturalHeight || (img.height as number) || 1;
  const box = cropBoxOf(iw, ih, a);
  const scale = outW / box.w;
  ctx.save();
  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(outW / 2, outH / 2);
  if (a.rot) ctx.rotate(-a.rot);
  ctx.scale(scale, scale);
  // 자르는 네모의 한가운데가 화면 한가운데에 오도록.
  ctx.drawImage(img, -(box.x + box.w / 2), -(box.y + box.h / 2));
  ctx.restore();
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

export type PhotoStudent = {
  id: string;
  name: string;
  nameEn: string | null;
  gradeLabel: string;
  /** 동명이인을 가르는 데 씁니다. 파일명의 `김재이(G3J)` 같은 표기와 맞춰봅니다. */
  className: string | null;
  grade: string | null;
};

/**
 * 대조용으로 다듬습니다.
 *
 * **맥에서 끌어온 파일명은 한글이 자모로 나뉘어(NFD) 옵니다.** `고서윤` 이 글자로는 같아
 * 보여도 명부의 `고서윤`(NFC)과 다른 문자열이라 어디에도 안 걸립니다. 눈으로는 절대 못 찾는
 * 종류의 어긋남이라, 양쪽을 반드시 같은 방식으로 합쳐놓고 비교합니다.
 *
 * 명부 이름에 영문 표기가 괄호로 붙은 줄도 있습니다(`강여명(Ryeomyeong Kang)`). 괄호 안은 뗍니다.
 */
const flat = (v: string) =>
  (v ?? "")
    .normalize("NFC")
    .replace(/[（(［[][^)）\]］]*[)）\]］]/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");

/** 파일명 괄호 안에 적어둔 것(반 표기 등)을 꺼냅니다. */
export function hintsFromFile(fileName: string): string[] {
  const base = fileName.normalize("NFC").replace(/\.[a-z0-9]+$/i, "");
  return [...base.matchAll(/[（(［[]([^)）\]］]+)[)）\]］]/g)].map((m) => m[1].trim()).filter((v) => v.length > 0);
}

/** 확장자·번호·학년 표기 따위를 떼고 이름만 남깁니다. */
export function nameFromFile(fileName: string): string {
  // 맥에서 온 파일명은 한글이 자모로 나뉘어 있습니다. 먼저 합쳐야 아래 규칙들이 먹습니다.
  return fileName
    .normalize("NFC")
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

/**
 * 힌트(파일명 괄호 안)가 이 학생을 가리키는가.
 *
 * `김재이(G3J)` 처럼 반을 줄여 적으신 경우가 있어서, 반 이름이 힌트로 **시작하기만 해도**
 * 같은 것으로 봅니다(G3J → G3JA). 학년만 적었을 수도 있어 학년도 함께 봅니다.
 */
function hintMatches(hint: string, s: PhotoStudent): boolean {
  const h = flat(hint);
  if (!h) return false;
  const cls = flat(s.className ?? "");
  const grade = flat(s.grade ?? "");
  if (cls && (cls.startsWith(h) || h.startsWith(cls))) return true;
  if (grade && (h === grade || h === `${grade}학년`)) return true;
  return false;
}

export function matchStudent(fileName: string, roster: PhotoStudent[]): PhotoMatch {
  const key = flat(nameFromFile(fileName));
  const hints = hintsFromFile(fileName);
  if (!key) return { student: null, candidates: [], reason: "파일명에서 이름을 못 읽었습니다" };

  /** 후보가 여럿이면 괄호 안 표기로 좁힙니다. 그래도 하나가 안 되면 사람이 고릅니다. */
  const narrow = (list: PhotoStudent[], why: string): PhotoMatch | null => {
    if (list.length === 1) return { student: list[0], candidates: [], reason: why };
    if (list.length > 1 && hints.length > 0) {
      const byHint = list.filter((s) => hints.some((h) => hintMatches(h, s)));
      if (byHint.length === 1) return { student: byHint[0], candidates: [], reason: `${why} + 반 표기` };
      if (byHint.length > 1) return { student: null, candidates: byHint, reason: "반 표기로도 여럿 — 골라주세요" };
    }
    if (list.length > 1) return { student: null, candidates: list, reason: `같은 이름 ${list.length}명 — 골라주세요` };
    return null;
  };

  const exact = roster.filter((s) => flat(s.name) === key || flat(s.nameEn ?? "") === key);
  const byExact = narrow(exact, "이름이 같음");
  if (byExact) return byExact;

  // 파일명 안에 이름이 들어 있는 경우(`2학년 고서윤 졸업`).
  const inside = roster.filter((s) => {
    const n = flat(s.name);
    const e = flat(s.nameEn ?? "");
    return (n.length >= 2 && key.includes(n)) || (e.length >= 3 && key.includes(e));
  });
  const byInside = narrow(inside, "파일명 안에 이름이 있음");
  if (byInside) return byInside;

  return { student: null, candidates: [], reason: "명부에서 못 찾았습니다" };
}
