"use client";

import { useEffect } from "react";
import type { Term } from "@/lib/types";

// 학기 고르개.
//
// 재무 화면 어디서든 **같은 학기**를 보고 있어야 합니다. 항목 화면은 이번 학기를 보는데
// 인보이스 명단은 지난 학기를 보고 있으면, 열이 안 맞는 이유를 아무도 못 찾습니다.
// 그래서 고른 학기를 이 브라우저에 기억해두고 재무 화면들이 같이 씁니다.

export const FEE_TERM_KEY = "gia.finance.term";

/** 처음 열었을 때 볼 학기. 기억해둔 것이 아직 있으면 그것, 없으면 현재 학기. */
export function initialTermId(terms: Term[]): string {
  if (terms.length === 0) return "";
  let saved: string | null = null;
  try {
    saved = typeof window === "undefined" ? null : localStorage.getItem(FEE_TERM_KEY);
  } catch {
    saved = null;
  }
  if (saved && terms.some((t) => t.id === saved)) return saved;
  return (terms.find((t) => t.status === "진행중") ?? terms[0]).id;
}

export default function FeeTermPicker({
  terms,
  value,
  onChange,
}: {
  terms: Term[];
  value: string;
  onChange: (id: string) => void;
}) {
  useEffect(() => {
    try {
      if (value) localStorage.setItem(FEE_TERM_KEY, value);
    } catch {
      // 기억해두지 못해도 화면은 돌아갑니다. 다음에 열 때 현재 학기부터 시작할 뿐입니다.
    }
  }, [value]);

  if (terms.length === 0) {
    return (
      <span className="rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-800">
        학기가 없습니다 — SQL을 먼저 실행해주세요
      </span>
    );
  }

  const picked = terms.find((t) => t.id === value);
  return (
    <span className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold text-slate-700"
        title="학기를 바꾸면 그 학기의 항목과 청구서만 보입니다"
      >
        {terms.map((t) => (
          <option key={t.id} value={t.id}>
            {t.year} {t.term_type}
            {t.status === "진행중" ? " (지금)" : ""}
          </option>
        ))}
      </select>
      {/* 지난 학기를 보고 있으면 눈에 띄어야 합니다. 모르고 지난 학기에 항목을 등록하면
          이번 학기 표에는 나타나지 않고, 왜 없는지 찾기 어렵습니다. */}
      {picked && picked.status !== "진행중" && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">지난 학기를 보는 중</span>
      )}
    </span>
  );
}
