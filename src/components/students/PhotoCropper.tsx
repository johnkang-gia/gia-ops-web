"use client";

import { useEffect, useRef, useState } from "react";
import { cropBoxOf, PHOTO_H, PHOTO_W, type Adjust } from "@/lib/passportPhoto";

// 한 장을 여권 규격에 맞춰 보여주고, 손으로 밀어 맞추게 합니다.
//
// 자동으로 잡아준 자리가 늘 맞지는 않습니다. 다시 올리라고 하는 대신 **그 자리에서 밀 수
// 있게** 두는 편이 빠릅니다 - 137장을 다시 내보내는 것보다 몇 장을 미는 것이 낫습니다.
//
// 가로 두 줄은 여권 규격의 기준선입니다. 위 선 위로 머리가 조금 나오고, 아래 선쯤에 턱이
// 오면 맞습니다.

type Props = {
  img: HTMLImageElement;
  adjust: Adjust;
  onChange: (a: Adjust) => void;
  /** 미리보기 폭(px). 높이는 규격 비율로 따라옵니다. */
  width?: number;
  guides?: boolean;
};

export default function PhotoCropper({ img, adjust, onChange, width = 140, guides = true }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const h = Math.round((width * PHOTO_H) / PHOTO_W);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const b = cropBoxOf(img.naturalWidth, img.naturalHeight, adjust);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, cv.width, cv.height);
  }, [img, adjust, width, h]);

  return (
    <div className="relative select-none" style={{ width, height: h }}>
      <canvas
        ref={ref}
        width={PHOTO_W}
        height={PHOTO_H}
        style={{ width, height: h }}
        className="cursor-move rounded border border-slate-300 bg-slate-100"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDrag({ x: e.clientX, y: e.clientY, cx: adjust.cx, cy: adjust.cy });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          // 미리보기에서 1px 민 것이 원본에서 몇 %인지로 환산합니다.
          const b = cropBoxOf(img.naturalWidth, img.naturalHeight, adjust);
          const dx = ((e.clientX - drag.x) / width) * (b.w / img.naturalWidth);
          const dy = ((e.clientY - drag.y) / h) * (b.h / img.naturalHeight);
          onChange({ ...adjust, cx: drag.cx - dx, cy: drag.cy - dy });
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onWheel={(e) => {
          const next = Math.min(1, Math.max(0.2, adjust.zoom * (e.deltaY > 0 ? 1.06 : 0.94)));
          onChange({ ...adjust, zoom: next });
        }}
      />
      {guides && (
        // 여권 규격 기준선. 머리 꼭대기가 위 선 근처, 턱이 아래 선 근처에 오면 맞습니다.
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-0 right-0 border-t border-dashed border-white/70" style={{ top: "10%" }} />
          <div className="absolute left-0 right-0 border-t border-dashed border-white/70" style={{ top: "78%" }} />
          <div className="absolute bottom-0 top-0 border-l border-dashed border-white/40" style={{ left: "50%" }} />
        </div>
      )}
    </div>
  );
}
