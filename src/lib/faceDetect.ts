"use client";

// 얼굴 찾기 (MediaPipe BlazeFace)
//
// 브라우저에 들어 있는 `FaceDetector` 는 쓸 수 있는 곳이 거의 없습니다(크롬에서도 기본으로는
// 꺼져 있습니다). 학생증에 쓸 사진이라 **눈 위치까지** 알아야 하므로, 실제로 도는 모델을
// 한 번 받아서 씁니다.
//
// 모델은 처음 한 번만 내려받고(약 230KB) 그 뒤로는 브라우저가 캐시합니다. 인터넷이 막혀
// 있거나 실패하면 조용히 포기하고, 부르는 쪽에서 배경 빼기로 넘어갑니다 - 사진 등록이
// 통째로 멈추는 것보다 낫습니다.

const VERSION = "0.10.14";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export type Keypoint = { x: number; y: number };
export type FaceHit = {
  box: { x: number; y: number; width: number; height: number };
  /** 화면 기준 왼쪽 눈 / 오른쪽 눈(원본 픽셀 좌표). */
  leftEye: Keypoint | null;
  rightEye: Keypoint | null;
  score: number;
};

type Detector = {
  detect(img: HTMLImageElement | HTMLCanvasElement): {
    detections: {
      boundingBox?: { originX: number; originY: number; width: number; height: number };
      keypoints?: { x: number; y: number }[];
      categories?: { score: number }[];
    }[];
  };
};

let cached: Promise<Detector | null> | null = null;

/** 모델을 한 번만 준비합니다. 실패하면 null 을 기억해 다시 시도하지 않습니다. */
export function loadFaceDetector(): Promise<Detector | null> {
  if (cached) return cached;
  cached = (async () => {
    try {
      // 웹팩이 이 주소를 빌드에 끌어넣지 않도록 런타임에 부릅니다.
      const importUrl = new Function("u", "return import(u)") as (u: string) => Promise<{
        FilesetResolver: { forVisionTasks(p: string): Promise<unknown> };
        FaceDetector: { createFromOptions(f: unknown, o: unknown): Promise<Detector> };
      }>;
      const vision = await importUrl(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
      return await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.4,
      });
    } catch (e) {
      console.error("[얼굴 찾기] 모델을 준비하지 못했습니다:", e);
      return null;
    }
  })();
  return cached;
}

/**
 * 한 장에서 가장 큰 얼굴을 찾습니다.
 *
 * 여럿이 잡히면 **가장 큰 것**을 씁니다. 졸업앨범 사진에 뒤쪽 사람이 살짝 걸리는 경우가
 * 있는데, 그건 언제나 더 작게 잡힙니다.
 */
export async function findFace(img: HTMLImageElement): Promise<FaceHit | null> {
  const det = await loadFaceDetector();
  if (!det) return null;
  try {
    const res = det.detect(img);
    const list = res?.detections ?? [];
    if (list.length === 0) return null;
    const best = list.reduce((a, b) =>
      (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0) >
      (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0)
        ? b
        : a,
    );
    const bb = best.boundingBox;
    if (!bb) return null;

    // BlazeFace 가 주는 점 6개 중 앞의 둘이 눈입니다. 좌표는 0~1 비율로 옵니다.
    const kps = best.keypoints ?? [];
    const toPx = (k: { x: number; y: number }) => ({ x: k.x * img.naturalWidth, y: k.y * img.naturalHeight });
    const eyes = kps.length >= 2 ? [toPx(kps[0]), toPx(kps[1])] : null;
    // 화면 기준 왼쪽이 먼저 오도록 정렬합니다(모델이 순서를 뒤집어 주는 경우가 있습니다).
    if (eyes) eyes.sort((a, b) => a.x - b.x);

    return {
      box: { x: bb.originX, y: bb.originY, width: bb.width, height: bb.height },
      leftEye: eyes?.[0] ?? null,
      rightEye: eyes?.[1] ?? null,
      score: best.categories?.[0]?.score ?? 0,
    };
  } catch (e) {
    console.error("[얼굴 찾기] 찾는 중 오류:", e);
    return null;
  }
}
