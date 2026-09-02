"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { uploadStudentPhoto } from "@/lib/storage";
import {
  DEFAULT_ADJUST,
  hintsFromFile,
  PHOTO_H,
  PHOTO_W,
  adjustFromEyes,
  adjustFromFace,
  adjustFromHead,
  detectHeadFromPixels,
  drawCrop,
  matchStudent,
  nameFromFile,
  type Adjust,
  type PhotoStudent,
} from "@/lib/passportPhoto";
import PhotoCropper from "./PhotoCropper";
import { filesFromDataTransfer, pickImages } from "@/lib/dropFiles";
import { findFace, loadFaceDetector } from "@/lib/faceDetect";

// 학생 사진 일괄 등록.
//
// 졸업앨범 폴더를 통째로 끌어다 놓으면, 파일명으로 아이를 찾아 붙이고 여권 규격으로 잘라
// 미리 보여줍니다. 사람이 훑어보고 한 번에 저장합니다.
//
// **원본은 저장하지 않습니다.** 자른 것만 올립니다 - 원본은 앨범 폴더에 이미 있고, 여기 또
// 쌓으면 용량이 몇 배가 되며 지울 때도 두 번 지워야 합니다.
//
// 자르는 자리는 자동으로 잡되 손으로 밀 수 있습니다. 앨범 사진은 대개 같은 구도로 찍혀서,
// 한 장을 맞춘 뒤 `전체에 같은 값 적용` 을 누르면 나머지도 대개 맞습니다.

type Item = {
  key: string;
  fileName: string;
  img: HTMLImageElement;
  studentId: string | null;
  candidates: PhotoStudent[];
  reason: string;
  adjust: Adjust;
  /** 자를 자리를 어떻게 잡았는지. 기본으로 잡힌 것은 사람이 봐야 합니다. */
  how: "눈" | "얼굴" | "배경" | "기본";
  saved: boolean;
  error: string | null;
};

type Props = {
  roster: PhotoStudent[];
  /** 이미 사진이 있는 학생 id. 덮어쓰기 전에 알려주기 위해서입니다. */
  hasPhoto: string[];
  currentUserEmail: string;
};

/**
 * 자를 자리를 스스로 잡습니다.
 *
 * 세 가지를 차례로 시도합니다. 앞의 것일수록 정확하고, 앞의 것이 되면 뒤는 안 봅니다.
 *   1) **두 눈** — 학생증 사진은 사실 눈높이로 맞춥니다. 눈 사이 거리로 크기를, 눈높이로
 *      위아래를, 두 눈을 잇는 선으로 기울기를 한 번에 정합니다. 아이들 사진이 실제로
 *      똑같아지는 것은 이 방법뿐입니다.
 *   2) **얼굴 상자** — 눈을 못 잡았을 때. 상자 위로 얼굴 높이의 30%를 더해 정수리를 잡습니다.
 *   3) **배경 빼기** — 얼굴 찾기가 아예 안 될 때. 배경이 한 가지 색이면 정수리 줄이 보입니다.
 * 다 안 되면 가운데로 두고 사람이 맞춥니다.
 */
async function autoAdjust(img: HTMLImageElement): Promise<{ adjust: Adjust; how: Item["how"] }> {
  const face = await findFace(img);
  if (face?.leftEye && face.rightEye) {
    return { adjust: adjustFromEyes(img.naturalWidth, img.naturalHeight, face.leftEye, face.rightEye), how: "눈" };
  }
  if (face) {
    return { adjust: adjustFromFace(img.naturalWidth, img.naturalHeight, face.box), how: "얼굴" };
  }

  try {
    // 픽셀을 다 볼 필요는 없습니다. 가로 240px로 줄여서 봐도 정수리 줄은 그대로 나옵니다.
    const sw = 240;
    const sh = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * sw));
    const cv = document.createElement("canvas");
    cv.width = sw;
    cv.height = sh;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, sw, sh);
      const box = detectHeadFromPixels(ctx.getImageData(0, 0, sw, sh).data, sw, sh);
      if (box && box.confident) {
        const k = img.naturalWidth / sw;
        return {
          adjust: adjustFromHead(img.naturalWidth, img.naturalHeight, box.top * k, box.bottom * k, box.centerX * k),
          how: "배경",
        };
      }
    }
  } catch {
    // 그림을 다른 곳에서 가져온 것이면 픽셀을 못 읽을 수 있습니다. 기본값으로 갑니다.
  }

  return { adjust: DEFAULT_ADJUST, how: "기본" };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("그림을 열지 못했습니다"));
    img.src = URL.createObjectURL(file);
  });
}

async function toJpeg(img: HTMLImageElement, a: Adjust): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = PHOTO_W;
  cv.height = PHOTO_H;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("캔버스를 못 만들었습니다");
  // 기울여 자를 때 모서리에 빈 곳이 생길 수 있습니다. 검게 두면 인쇄에서 티가 나므로
  // 흰색으로 깔아둡니다.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
  drawCrop(ctx, img, a, PHOTO_W, PHOTO_H);
  return await new Promise<Blob>((resolve, reject) =>
    cv.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("사진을 만들지 못했습니다"))), "image/jpeg", 0.92),
  );
}

export default function StudentPhotosClient({ roster, hasPhoto, currentUserEmail }: Props) {
  const notify = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * 읽는 중 표시.
   *
   * 137장을 읽는 데 시간이 걸립니다. 그동안 화면에 아무 변화가 없으면 **되고 있는지 아닌지
   * 알 수가 없어서** 다시 끌어다 놓게 되고, 그러면 같은 사진이 두 벌 생깁니다.
   */
  const [reading, setReading] = useState<{ done: number; total: number; label: string } | null>(null);
  /** 그림이 아니어서 빠진 파일. 조용히 빼면 "몇 장이 없네"가 됩니다. */
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [done, setDone] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dirRef = useRef<HTMLInputElement | null>(null);
  const withPhoto = useMemo(() => new Set(hasPhoto), [hasPhoto]);

  // 얼굴 찾기 모델을 화면을 열 때 미리 받아둡니다. 사진을 놓은 뒤에 받기 시작하면 첫 장이
  // 눈에 띄게 느립니다.
  useEffect(() => {
    void loadFaceDetector();
  }, []);

  const byId = useMemo(() => new Map(roster.map((s) => [s.id, s])), [roster]);
  const taken = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) if (it.studentId) m.set(it.studentId, (m.get(it.studentId) ?? 0) + 1);
    return m;
  }, [items]);

  async function addFiles(files: File[]) {
    const { images, skipped: skip } = pickImages(files);
    setSkipped(skip);
    if (images.length === 0) {
      setReading(null);
      notify(
        files.length === 0
          ? "놓으신 것에서 파일을 찾지 못했습니다. 폴더째 끌어다 놓거나 '폴더 고르기'를 눌러주세요."
          : `그림 파일이 없습니다. ${files.length}개를 봤는데 전부 그림이 아니었습니다.`,
        "error",
      );
      return;
    }

    setReading({ done: 0, total: images.length, label: "사진을 읽는 중" });
    const next: Item[] = [];
    for (let i = 0; i < images.length; i++) {
      const f = images[i];
      try {
        const img = await loadImage(f);
        const m = matchStudent(f.name, roster);
        const auto = await autoAdjust(img);
        next.push({
          key: `${f.name}-${f.size}-${i}`,
          fileName: f.name,
          img,
          studentId: m.student?.id ?? null,
          candidates: m.candidates,
          reason: m.reason,
          adjust: auto.adjust,
          how: auto.how,
          saved: false,
          error: null,
        });
      } catch {
        next.push({
          key: `${f.name}-${f.size}-${i}`,
          fileName: f.name,
          img: new Image(),
          studentId: null,
          candidates: [],
          reason: "그림을 열지 못했습니다",
          adjust: DEFAULT_ADJUST,
          how: "기본",
          saved: false,
          error: "그림을 열지 못했습니다",
        });
      }
      setReading({ done: i + 1, total: images.length, label: "사진을 읽는 중" });
      // 화면이 멈춘 것처럼 보이지 않게 한 장마다 그릴 틈을 줍니다.
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    setItems((p) => [...p, ...next]);
    setReading(null);
    const got = next.filter((it) => it.studentId).length;
    notify(`${next.length}장을 읽었습니다. ${got}장은 학생이 붙었습니다.`, "success");
  }

  function setAdjust(key: string, a: Adjust) {
    setItems((p) => p.map((it) => (it.key === key ? { ...it, adjust: a } : it)));
  }

  /** 전체를 조금씩 함께 움직입니다. 한 판을 뽑았을 때 줄이 맞아야 하기 때문입니다. */
  function nudgeAll(d: { zoom?: number; cy?: number }) {
    setItems((p) =>
      p.map((it) =>
        it.saved
          ? it
          : {
              ...it,
              adjust: {
                ...it.adjust,
                zoom: Math.min(1, Math.max(0.05, it.adjust.zoom + (d.zoom ?? 0))),
                cy: Math.min(1, Math.max(0, it.adjust.cy + (d.cy ?? 0))),
              },
            },
      ),
    );
  }

  /** 얼굴·배경을 다시 찾습니다. 손으로 밀어놓은 것을 되돌리고 싶을 때. */
  async function redetectAll() {
    setReading({ done: 0, total: items.length, label: "자리를 다시 잡는 중" });
    const next = [...items];
    for (let i = 0; i < next.length; i++) {
      if (next[i].saved || next[i].error) continue;
      const auto = await autoAdjust(next[i].img);
      next[i] = { ...next[i], adjust: auto.adjust, how: auto.how };
      setReading({ done: i + 1, total: next.length, label: "자리를 다시 잡는 중" });
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    setItems(next);
    setReading(null);
  }

  /** 앨범 사진은 대개 같은 구도라, 한 장을 맞추면 나머지도 대개 맞습니다. */
  function applyToAll(a: Adjust) {
    setItems((p) => p.map((it) => (it.saved ? it : { ...it, adjust: { ...a } })));
    notify("나머지 사진에도 같은 자리를 적용했습니다.", "success");
  }

  async function saveAll() {
    const targets = items.filter((it) => it.studentId && !it.saved && !it.error);
    if (targets.length === 0) {
      notify("저장할 사진이 없습니다. 학생이 붙지 않은 사진은 먼저 골라주세요.", "error");
      return;
    }
    setBusy(true);
    setDone(0);
    const supabase = createClient();
    let ok = 0;
    const failed: string[] = [];
    for (const it of targets) {
      try {
        const blob = await toJpeg(it.img, it.adjust);
        const path = await uploadStudentPhoto(blob, it.studentId as string);
        const { error } = await supabase
          .from("wr_students")
          .update({ photo_path: path, photo_updated_at: new Date().toISOString(), photo_updated_by: currentUserEmail })
          .eq("id", it.studentId as string);
        if (error) throw new Error(error.message);
        ok += 1;
        setItems((p) => p.map((x) => (x.key === it.key ? { ...x, saved: true, error: null } : x)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failed.push(`${it.fileName}(${msg})`);
        setItems((p) => p.map((x) => (x.key === it.key ? { ...x, error: msg } : x)));
      }
      setDone((n) => n + 1);
    }
    setBusy(false);
    // 한 장이 실패해도 나머지는 계속하되, **누가 실패했는지 반드시 말합니다.**
    if (failed.length > 0) notify(`${ok}장 저장 · ${failed.length}장 실패: ${failed.join(", ")}`, "error");
    else notify(`${ok}장 저장했습니다.`, "success");
  }

  const byEyes = items.filter((it) => it.how === "눈").length;
  const needEye = items.filter((it) => it.how === "기본" && !it.error).length;
  const matched = items.filter((it) => it.studentId).length;
  const unmatched = items.length - matched;
  const overwrite = items.filter((it) => it.studentId && withPhoto.has(it.studentId) && !it.saved).length;
  const dup = [...taken.values()].filter((n) => n > 1).length;
  const noPhotoYet = roster.filter((s) => !withPhoto.has(s.id) && !taken.has(s.id));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">📸 학생 사진 등록</h1>
        <span className="text-xs text-slate-400">여권 규격(35×45mm)으로 잘라서 저장합니다</span>
        <span className="ml-auto flex items-center gap-2">
          {/* 명부가 비어 있으면 사진마다 "명부에서 못 찾았습니다"가 뜹니다. 원인은 사진이
              아니라 명부인데, 그렇게는 안 보입니다. 그래서 여기에 수를 적어둡니다. */}
          <span className={"text-[12px] font-bold " + (roster.length === 0 ? "text-rose-700" : "text-slate-400")}>
            명부 {roster.length}명
          </span>
          <a href="/students" className="text-[12px] font-semibold text-teal-700 underline">
            학생 조회로 →
          </a>
        </span>
      </div>
      {roster.length === 0 && (
        <p className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
          명부를 한 명도 읽지 못했습니다. 사진을 올려도 학생이 붙지 않습니다 — 먼저 학생 조회에서 명부가 보이는지 확인해주세요.
        </p>
      )}
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        졸업앨범 폴더를 통째로 끌어다 놓으세요. <b>파일명으로 아이를 찾아</b> 붙이고 규격에 맞게 잘라 미리 보여드립니다.
        <b>두 눈을 찾아</b> 크기·높이·기울기를 규격대로 맞추므로, 아이마다 찍힌 거리가 달라도 결과는 같은 구도로 나옵니다.
        자른 자리가 어색하면 사진을 <b>끌어서 옮기고 휠로 크기</b>를 맞추면 됩니다. 한 장을 맞춘 뒤 <b>전체에 같은 값 적용</b>을
        누르면 나머지에도 같은 자리가 적용됩니다. <b>원본은 저장하지 않습니다</b> — 자른 것만 올라갑니다.
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // 끌어다 놓자마자 표시를 켭니다. 폴더를 훑는 데도 시간이 걸리는데, 그동안
          // 화면이 그대로면 놓인 건지 아닌지 알 수가 없습니다.
          setReading({ done: 0, total: 0, label: "폴더를 여는 중" });
          void filesFromDataTransfer(e.dataTransfer).then(addFiles);
        }}
        className="mb-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        {/* 폴더 고르기 - 끌어다 놓기가 안 되는 환경이 있습니다. */}
        <input
          ref={dirRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error 폴더 고르기는 표준에 없지만 크롬·엣지·사파리가 모두 지원합니다.
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />

        {reading ? (
          <>
            <span className="text-[13px] font-bold text-teal-700">
              {reading.label}… {reading.total > 0 ? `${reading.done} / ${reading.total}장` : ""}
            </span>
            <span className="mt-2 block h-1.5 w-64 overflow-hidden rounded-full bg-slate-200">
              <span
                className="block h-full bg-teal-500 transition-all"
                style={{ width: reading.total > 0 ? `${Math.round((reading.done / reading.total) * 100)}%` : "20%" }}
              />
            </span>
            <span className="mt-1 text-[11px] text-slate-400">사진이 많으면 한동안 걸립니다. 창을 닫지 마세요.</span>
          </>
        ) : (
          <>
            <span className="text-[13px] font-bold text-slate-600">폴더나 사진을 여기에 끌어다 놓으세요</span>
            <span className="mt-1 text-[11px] text-slate-400">JPG · PNG · WEBP · 폴더 안의 폴더까지 찾아봅니다</span>
            <span className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => dirRef.current?.click()}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-[12px] font-bold text-white"
              >
                📁 폴더 고르기
              </button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-600"
              >
                사진 고르기
              </button>
            </span>
          </>
        )}
      </div>

      {/* 그림이 아니어서 빠진 파일. 조용히 빼면 "몇 장이 없네"가 되고, 왜 없는지는 알 수 없습니다. */}
      {skipped.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1 text-[11px] font-bold text-amber-900">넣지 않은 파일 {skipped.length}개</p>
          <ul className="flex flex-wrap gap-1.5">
            {skipped.slice(0, 12).map((s) => (
              <li key={s.name} className="rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] text-amber-900">
                {s.name} <span className="opacity-60">{s.reason}</span>
              </li>
            ))}
            {skipped.length > 12 && <li className="text-[10px] text-amber-700">외 {skipped.length - 12}개</li>}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <span className="text-[12px] font-bold text-slate-700">{items.length}장</span>
            <span className="text-[11px] text-emerald-700">붙음 {matched}</span>
            {unmatched > 0 && <span className="text-[11px] font-bold text-amber-700">못 붙임 {unmatched}</span>}
            {dup > 0 && <span className="text-[11px] font-bold text-rose-700">같은 아이에 두 장 {dup}건</span>}
            {overwrite > 0 && <span className="text-[11px] text-slate-500">덮어쓰기 {overwrite}장</span>}
            {/* 눈으로 잡힌 것이 많을수록 한 판이 고르게 나옵니다. */}
            <span className="text-[11px] text-emerald-700">눈으로 맞춤 {byEyes}</span>
            {needEye > 0 && <span className="text-[11px] font-bold text-slate-600">손볼 것 {needEye}</span>}
            {/* 한 판을 뽑았을 때 눈에 띄는 것은 개별 사진이 아니라 **줄이 맞는가**입니다.
                전체를 조금씩 함께 움직일 수 있어야 그게 맞습니다. */}
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              전체
              <button onClick={() => nudgeAll({ zoom: -0.04 })} className="rounded border border-slate-300 px-1.5 font-bold">
                축소
              </button>
              <button onClick={() => nudgeAll({ zoom: 0.04 })} className="rounded border border-slate-300 px-1.5 font-bold">
                확대
              </button>
              <button onClick={() => nudgeAll({ cy: -0.02 })} className="rounded border border-slate-300 px-1.5 font-bold">
                ↑
              </button>
              <button onClick={() => nudgeAll({ cy: 0.02 })} className="rounded border border-slate-300 px-1.5 font-bold">
                ↓
              </button>
            </span>
            <button
              onClick={() => void redetectAll()}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
              title="얼굴·배경을 다시 찾아 규격대로 자리를 잡습니다"
            >
              자동으로 다시 잡기
            </button>
            <button
              onClick={() => setItems([])}
              disabled={busy}
              className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
            >
              전부 비우기
            </button>
            <button
              onClick={() => void saveAll()}
              disabled={busy || matched === 0}
              className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? `저장 중… ${done}/${matched}` : `${matched}장 저장`}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((it) => {
              const s = it.studentId ? byId.get(it.studentId) : null;
              const isDup = it.studentId ? (taken.get(it.studentId) ?? 0) > 1 : false;
              return (
                <div
                  key={it.key}
                  className={
                    "rounded-xl border bg-white p-2 " +
                    (it.saved ? "border-emerald-300" : it.error ? "border-rose-300" : s ? "border-slate-200" : "border-amber-300")
                  }
                >
                  <div className="flex justify-center">
                    {it.error && !it.img.naturalWidth ? (
                      <div className="flex h-[180px] w-[140px] items-center justify-center rounded bg-slate-100 text-[11px] text-slate-400">
                        열지 못함
                      </div>
                    ) : (
                      <PhotoCropper img={it.img} adjust={it.adjust} onChange={(a) => setAdjust(it.key, a)} />
                    )}
                  </div>

                  <p className="mt-1 truncate text-[10px] text-slate-400" title={it.fileName}>
                    {it.fileName}
                  </p>
                  {/* 파일명에서 무엇을 이름으로 읽었는지. 안 붙었을 때 원인이 바로 보입니다. */}
                  {!s && (
                    <p className="truncate text-[10px] text-slate-500">
                      읽은 이름: <b>{nameFromFile(it.fileName) || "(없음)"}</b>
                      {hintsFromFile(it.fileName).length > 0 && (
                        <span className="ml-1 text-slate-400">· 반 표기 {hintsFromFile(it.fileName).join(",")}</span>
                      )}
                    </p>
                  )}

                  {s ? (
                    <p className="text-[12px] font-bold text-slate-800">
                      {s.name}
                      <span className="ml-1 text-[10px] font-medium text-slate-400">{s.gradeLabel}</span>
                    </p>
                  ) : (
                    <p className="text-[11px] font-bold text-amber-700">{it.reason}</p>
                  )}

                  {/* 못 붙였거나 동명이인이면 여기서 고릅니다. 파일명을 고쳐 다시 올리게 두면
                      137장 중 몇 장 때문에 폴더를 다시 만들게 됩니다. */}
                  {(!s || it.candidates.length > 0) && (
                    <select
                      value={it.studentId ?? ""}
                      onChange={(e) =>
                        setItems((p) => p.map((x) => (x.key === it.key ? { ...x, studentId: e.target.value || null } : x)))
                      }
                      className="mt-1 w-full rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                    >
                      <option value="">— 학생 고르기 —</option>
                      {(it.candidates.length > 0 ? it.candidates : roster).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} {r.gradeLabel}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {/* 자리를 어떻게 잡았는지. `기본` 은 못 찾아서 그냥 가운데로 둔 것이라
                        사람이 봐야 합니다. */}
                    <span
                      className={
                        "rounded px-1 text-[10px] font-bold " +
                        (it.how === "눈"
                          ? "bg-emerald-100 text-emerald-800"
                          : it.how === "얼굴"
                            ? "bg-violet-100 text-violet-800"
                            : it.how === "배경"
                              ? "bg-sky-100 text-sky-800"
                              : "bg-slate-200 text-slate-600")
                      }
                      title={
                        it.how === "눈"
                          ? "두 눈을 찾아 크기·높이·기울기를 규격대로 맞췄습니다"
                          : it.how === "얼굴"
                            ? "얼굴을 찾아 규격대로 잡았습니다(눈은 못 잡음)"
                            : it.how === "배경"
                              ? "배경을 빼서 정수리를 찾아 잡았습니다"
                              : "얼굴도 배경도 못 찾아 가운데로 두었습니다 — 손으로 맞춰주세요"
                      }
                    >
                      {it.how}
                    </span>
                    {it.saved && <span className="rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-800">저장됨</span>}
                    {isDup && <span className="rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-800">두 장 붙음</span>}
                    {it.studentId && withPhoto.has(it.studentId) && !it.saved && (
                      <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">덮어씀</span>
                    )}
                    {it.error && <span className="text-[10px] font-bold text-rose-700">{it.error}</span>}
                    {/* 고개를 기울이고 찍은 아이. 한 판을 늘어놓으면 그 몇 장만 눈에 띕니다. */}
                    <button
                      onClick={() => setAdjust(it.key, { ...it.adjust, rot: (it.adjust.rot ?? 0) - 0.02 })}
                      className="rounded border border-slate-200 px-1 text-[10px] font-bold text-slate-500"
                      title="왼쪽으로 조금 돌리기"
                    >
                      ⟲
                    </button>
                    <button
                      onClick={() => setAdjust(it.key, { ...it.adjust, rot: (it.adjust.rot ?? 0) + 0.02 })}
                      className="rounded border border-slate-200 px-1 text-[10px] font-bold text-slate-500"
                      title="오른쪽으로 조금 돌리기"
                    >
                      ⟳
                    </button>
                    <button
                      onClick={() => applyToAll(it.adjust)}
                      className="ml-auto text-[10px] font-semibold text-teal-700 underline"
                      title="이 사진의 자르는 자리를 나머지 전부에 적용합니다"
                    >
                      전체 적용
                    </button>
                    <button
                      onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}
                      className="text-[10px] font-bold text-slate-400"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 아직 사진이 없는 아이. 이게 없으면 137명 중 누가 빠졌는지 세어봐야 압니다. */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-1.5 text-[12px] font-bold text-slate-700">
          아직 사진이 없는 학생 {noPhotoYet.length}명
          <span className="ml-1 font-medium text-slate-400">/ 전체 {roster.length}명</span>
        </p>
        {noPhotoYet.length === 0 ? (
          <p className="text-[12px] text-emerald-700">모두 등록됐습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {noPhotoYet.map((s) => (
              <span key={s.id} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                {s.name}
                <span className="ml-1 text-[10px] text-slate-400">{s.gradeLabel}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 && (
        <p className="mt-3 text-[11px] text-slate-400">
          파일명은 <code>고서윤.jpg</code> 처럼 이름만 있어도 되고, <code>2학년 고서윤 (2).jpg</code> 처럼 앞뒤에 뭐가 붙어도
          찾아냅니다. {nameFromFile("2학년 고서윤 (2).jpg")} 처럼 읽습니다.
        </p>
      )}
    </div>
  );
}
