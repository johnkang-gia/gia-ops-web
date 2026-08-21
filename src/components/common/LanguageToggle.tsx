"use client";

import { useLang } from "@/components/common/LanguageProvider";
import type { Lang } from "@/lib/lang";

// 한국어 ↔ English 전환 버튼입니다.
//
// 드롭다운이 아니라 두 칸짜리 토글로 만든 이유는, 선택지가 둘뿐일 때 드롭다운은 "열고 → 고르고
// → 닫는" 세 동작이 필요한 반면 토글은 한 번만 누르면 되기 때문입니다. 지금 어느 쪽인지도
// 한눈에 보입니다.
//
// variant
//  - "shell": 로그인 후 사이드바/헤더용. 셸 테마(라이트/다크/글래스)에 맞춰 색이 따라갑니다.
//  - "plain": 로그인·온보딩처럼 흰 카드 위에 놓이는 경우용.

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export default function LanguageToggle({
  variant = "shell",
  className = "",
}: {
  variant?: "shell" | "plain";
  className?: string;
}) {
  const { lang, setLang } = useLang();

  const wrap =
    variant === "shell"
      ? "inline-flex shrink-0 items-center rounded-full border border-[var(--shell-border)] p-0.5"
      : "inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 p-0.5";

  return (
    <div className={`${wrap} ${className}`} role="group" aria-label="Language / 언어">
      {OPTIONS.map((opt) => {
        const active = lang === opt.value;
        const base = "rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors";
        const on = variant === "shell" ? "bg-[var(--shell-hover-bg)] text-[var(--shell-text)]" : "bg-white text-slate-800 shadow-sm";
        const off = variant === "shell" ? "text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]" : "text-slate-400 hover:text-slate-600";
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !active && setLang(opt.value)}
            aria-pressed={active}
            className={`${base} ${active ? on : off}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
