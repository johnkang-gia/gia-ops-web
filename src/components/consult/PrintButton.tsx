"use client";

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white">
      🖨️ 인쇄
    </button>
  );
}
