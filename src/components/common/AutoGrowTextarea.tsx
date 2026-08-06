"use client";

import { useEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

// 여러 입력폼(사건기록 등)에서 재사용하는 자동 높이조절 textarea입니다(요청: "각 텍스트박스들
// 10줄이내이면 전문이 다 보이고, 10줄이상이면 스크롤되도록"). 입력할 때마다 실제 내용 높이에
// 맞춰 늘어나다가 maxRows에 닿으면 그 높이에서 멈추고 안쪽 스크롤로 전환됩니다.
export default function AutoGrowTextarea({
  value,
  onChange,
  minRows = 2,
  maxRows = 10,
  className = "",
  ...rest
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  minRows?: number;
  maxRows?: number;
  className?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows">) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20") || 20;
    const maxHeight = lineHeight * maxRows;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxRows]);

  return <textarea ref={ref} value={value} onChange={onChange} rows={minRows} className={className} {...rest} />;
}
