"use client";

import { createPortal } from "react-dom";

export type GuideSection = { title: string; lines: string[] };

// 화면 우상단 ❓ 버튼을 누르면 뜨는 공용 사용 가이드 모달입니다. 원래 업무 페이지 전용으로
// 만들었던 WorkGuideModal의 구조를 그대로 가져오되, title/sections를 props로 받도록
// 일반화해서 모든 메뉴에서 재사용합니다(요청: "각 메뉴 사용가이드... 업무와 똑같이").
export default function GuideModal({
  title,
  sections,
  onClose,
}: {
  title: string;
  sections: GuideSection[];
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
          <span className="text-sm font-bold text-slate-800">❓ {title}</span>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <div key={section.title}>
                <div className="mb-1 text-[13px] font-bold text-slate-700">{section.title}</div>
                <ul className="flex flex-col gap-1">
                  {section.lines.map((line, i) => (
                    <li key={i} className="text-[12px] leading-relaxed text-slate-500">
                      · {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
