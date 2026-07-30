"use client";

import { useEffect, useState } from "react";
import { uploadEventPhoto, getEventPhotoUrl, deleteEventPhoto } from "@/lib/storage";

export default function PhotoUploader({
  paths,
  onChange,
  folder,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
  folder: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = paths.filter((p) => !urls[p]);
      if (missing.length === 0) return;
      const entries = await Promise.all(
        missing.map(async (p) => [p, await getEventPhotoUrl(p)] as const)
      );
      if (cancelled) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const [p, url] of entries) {
          if (url) next[p] = url;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const newPaths: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const path = await uploadEventPhoto(file, folder);
        newPaths.push(path);
      }
      onChange([...paths, ...newPaths]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진을 올리지 못했습니다.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(path: string) {
    if (!confirm("이 사진을 삭제할까요?")) return;
    await deleteEventPhoto(path);
    onChange(paths.filter((p) => p !== path));
  }

  return (
    <div>
      {paths.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {paths.map((p) => (
            <div key={p} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
              {urls[p] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[p]} alt="행사 사진" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                  불러오는 중...
                </div>
              )}
              <button
                type="button"
                onClick={() => handleDelete(p)}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-0 group-hover:opacity-100"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="inline-block cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
        {uploading ? "업로드 중..." : "📷 사진 추가"}
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          disabled={uploading}
          className="hidden"
        />
      </label>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
