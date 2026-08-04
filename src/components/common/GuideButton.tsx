"use client";

import { useState } from "react";
import GuideModal, { type GuideSection } from "./GuideModal";

// 각 화면 우상단에 두는 ❓ 사용가이드 버튼입니다. 서버 컴포넌트(page.tsx)에서도 그냥
// import해서 바로 넣을 수 있도록 상태를 이 컴포넌트 안에서 자체적으로 관리합니다.
export default function GuideButton({
  title,
  sections,
  className,
}: {
  title: string;
  sections: GuideSection[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="사용 가이드"
        className={
          className ??
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[12px] font-bold text-slate-600 transition hover:bg-black/10"
        }
      >
        ❓
      </button>
      {open && <GuideModal title={title} sections={sections} onClose={() => setOpen(false)} />}
    </>
  );
}
