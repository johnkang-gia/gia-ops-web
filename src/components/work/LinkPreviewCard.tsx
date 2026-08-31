"use client";

import { useEffect, useState } from "react";

type Preview = {
  title: string;
  description: string | null;
  image: string | null;
  siteName: string;
  url: string;
};

// 메시지에 링크가 있으면 그 아래에 작은 카드(제목/설명/썸네일)로 미리보기를 보여줍니다.
// 실패하면(접근 불가 사이트, 타임아웃 등) 조용히 아무것도 보여주지 않습니다 - 미리보기는
// 있으면 좋은 부가 기능이라, 실패했다고 채팅창에 에러를 남길 필요는 없습니다.
export default function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setFailed(false);
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed || !preview) return null;

  let hostname = preview.siteName;
  try {
    hostname = new URL(preview.url).hostname;
  } catch {
    // preview.url이 이상해도 siteName으로 대체되므로 무시
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-1 flex max-w-xs items-stretch gap-2 overflow-hidden g-panel-solid text-left transition hover:bg-slate-50"
    >
      {preview.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.image} alt="" className="h-16 w-16 shrink-0 object-cover" />
      )}
      <div className="min-w-0 flex-1 py-1 pr-2">
        <div className="truncate text-[11px] font-semibold text-slate-700">{preview.title}</div>
        {preview.description && <div className="line-clamp-2 text-[10px] leading-snug text-slate-500">{preview.description}</div>}
        <div className="truncate text-[9px] text-slate-400">{hostname}</div>
      </div>
    </a>
  );
}
