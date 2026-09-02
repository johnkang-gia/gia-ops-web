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

/** 얼굴 자리를 알면 여권 규격에 맞는 조정값으로 바꿉니다.
 *
 * 규격은 머리 꼭대기 위로 조금 띄우고 턱 아래로 어깨가 조금 나오게 잡습니다. 얼굴 높이가
 * 사진 높이의 약 70%가 되도록 잡으면 그 모양이 나옵니다. */
export function adjustFromFace(
  imgW: number,
  imgH: number,
  face: { x: number; y: number; width: number; height: number },
): Adjust {
  const targetH = face.height / 0.7;
  const targetW = targetH * PHOTO_RATIO;
  const base = Math.min(imgW, imgH * PHOTO_RATIO);
  const zoom = Math.min(Math.max(targetW / base, 0.2), 1);
  // 얼굴 중심보다 살짝 아래를 사진의 가운데로 둡니다(위에 머리 여백, 아래에 어깨).
  const cy = (face.y + face.height * 0.62) / imgH;
  return { zoom, cx: (face.x + face.width / 2) / imgW, cy: Math.min(Math.max(cy, 0.2), 0.8) };
}

// ── 파일명으로 학생 찾기 ─────────────────────────────────────────────
//
// 파일명이 곧 이름입니다. 다만 실제 폴더에는 `고서윤 (2).jpg`, `2학년 고서윤.JPG`,
// `Jenny Go.jpeg` 처럼 앞뒤에 뭐가 붙습니다. 붙은 것을 떼고 남은 글자로 찾습니다.

export type PhotoStudent = { id: string; name: string; nameEn: string | null; gradeLabel: string };

const flat = (v: string) => v.toLowerCase().replace(/\s+/g, "");

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
