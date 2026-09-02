"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { uploadStudentPhoto } from "@/lib/storage";
import {
  DEFAULT_ADJUST,
  PHOTO_H,
  PHOTO_W,
  adjustFromFace,
  cropBoxOf,
  matchStudent,
  nameFromFile,
  type Adjust,
  type PhotoStudent,
} from "@/lib/passportPhoto";
import PhotoCropper from "./PhotoCropper";

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
  saved: boolean;
  error: string | null;
};

type Props = {
  roster: PhotoStudent[];
  /** 이미 사진이 있는 학생 id. 덮어쓰기 전에 알려주기 위해서입니다. */
  hasPhoto: string[];
  currentUserEmail: string;
};

/** 브라우저가 얼굴을 찾아줄 수 있으면 씁니다. 없으면 기본 자리에서 시작합니다. */
async function detectFace(img: HTMLImageElement): Promise<Adjust | null> {
  type FD = { detect(i: HTMLImageElement): Promise<{ boundingBox: DOMRectReadOnly }[]> };
  const Ctor = (window as unknown as { FaceDetector?: new (o?: unknown) => FD }).FaceDetector;
  if (!Ctor) return null;
  try {
    const faces = await new Ctor({ fastMode: true, maxDetectedFaces: 1 }).detect(img);
    const b = faces[0]?.boundingBox;
    if (!b) return null;
    return adjustFromFace(img.naturalWidth, img.naturalHeight, { x: b.x, y: b.y, width: b.width, height: b.height });
  } catch {
    // 얼굴 찾기는 있으면 좋은 것일 뿐입니다. 실패해도 화면은 그대로 돌아가야 합니다.
    return null;
  }
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
  // 줄일 때 계단이 지지 않게.
  ctx.imageSmoothingQuality = "high";
  const b = cropBoxOf(img.naturalWidth, img.naturalHeight, a);
  ctx.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, PHOTO_W, PHOTO_H);
  return await new Promise<Blob>((resolve, reject) =>
    cv.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("사진을 만들지 못했습니다"))), "image/jpeg", 0.9),
  );
}

export default function StudentPhotosClient({ roster, hasPhoto, currentUserEmail }: Props) {
  const notify = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(0);
  const [done, setDone] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const withPhoto = useMemo(() => new Set(hasPhoto), [hasPhoto]);

  const byId = useMemo(() => new Map(roster.map((s) => [s.id, s])), [roster]);
  const taken = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) if (it.studentId) m.set(it.studentId, (m.get(it.studentId) ?? 0) + 1);
    return m;
  }, [items]);

  async function addFiles(files: File[]) {
    const pics = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (pics.length === 0) {
      notify("그림 파일이 없습니다.", "error");
      return;
    }
    setReading(pics.length);
    const next: Item[] = [];
    for (const f of pics) {
      try {
        const img = await loadImage(f);
        const m = matchStudent(f.name, roster);
        const auto = await detectFace(img);
        next.push({
          key: `${f.name}-${f.size}-${next.length}`,
          fileName: f.name,
          img,
          studentId: m.student?.id ?? null,
          candidates: m.candidates,
          reason: m.reason,
          adjust: auto ?? DEFAULT_ADJUST,
          saved: false,
          error: null,
        });
      } catch {
        next.push({
          key: `${f.name}-${f.size}-err`,
          fileName: f.name,
          img: new Image(),
          studentId: null,
          candidates: [],
          reason: "그림을 열지 못했습니다",
          adjust: DEFAULT_ADJUST,
          saved: false,
          error: "그림을 열지 못했습니다",
        });
      }
      setReading((n) => n - 1);
    }
    setItems((p) => [...p, ...next]);
    setReading(0);
  }

  function setAdjust(key: string, a: Adjust) {
    setItems((p) => p.map((it) => (it.key === key ? { ...it, adjust: a } : it)));
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
        <a href="/students" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          학생 조회로 →
        </a>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        졸업앨범 폴더를 통째로 끌어다 놓으세요. <b>파일명으로 아이를 찾아</b> 붙이고 규격에 맞게 잘라 미리 보여드립니다.
        자른 자리가 어색하면 사진을 <b>끌어서 옮기고 휠로 크기</b>를 맞추면 됩니다. 한 장을 맞춘 뒤 <b>전체에 같은 값 적용</b>을
        누르면 나머지에도 같은 자리가 적용됩니다. <b>원본은 저장하지 않습니다</b> — 자른 것만 올라갑니다.
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles([...e.dataTransfer.files]);
        }}
        onClick={() => inputRef.current?.click()}
        className="mb-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-teal-400"
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
        <span className="text-[13px] font-bold text-slate-600">
          {reading > 0 ? `읽는 중… ${reading}장 남음` : "폴더나 사진을 여기에 끌어다 놓으세요"}
        </span>
        <span className="mt-1 text-[11px] text-slate-400">눌러서 고를 수도 있습니다 · JPG · PNG · WEBP</span>
      </div>

      {items.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <span className="text-[12px] font-bold text-slate-700">{items.length}장</span>
            <span className="text-[11px] text-emerald-700">붙음 {matched}</span>
            {unmatched > 0 && <span className="text-[11px] font-bold text-amber-700">못 붙임 {unmatched}</span>}
            {dup > 0 && <span className="text-[11px] font-bold text-rose-700">같은 아이에 두 장 {dup}건</span>}
            {overwrite > 0 && <span className="text-[11px] text-slate-500">덮어쓰기 {overwrite}장</span>}
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
                    {it.saved && <span className="rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-800">저장됨</span>}
                    {isDup && <span className="rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-800">두 장 붙음</span>}
                    {it.studentId && withPhoto.has(it.studentId) && !it.saved && (
                      <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">덮어씀</span>
                    )}
                    {it.error && <span className="text-[10px] font-bold text-rose-700">{it.error}</span>}
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
