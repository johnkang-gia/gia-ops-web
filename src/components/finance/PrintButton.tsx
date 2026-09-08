"use client";

/** 인쇄 버튼. 서버 화면에서 쓰려면 클라이언트 조각이 하나 필요합니다. */
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-slate-800 px-2.5 py-1 text-[12px] font-bold text-white"
    >
      🖨 인쇄
    </button>
  );
}
