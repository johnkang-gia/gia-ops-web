/**
 * **화면 설명은 접어 둡니다.** 재무 화면마다 제목 아래에 두세 줄짜리 설명이 늘 펼쳐져 있어서,
 * 매일 쓰는 사람에게는 표를 아래로 밀어내는 글이 됐습니다. 처음 쓰는 사람만 펼쳐 보면 됩니다.
 *
 * `<details>` 라 자바스크립트 없이도 열리고, 서버·클라이언트 어느 화면에서나 씁니다.
 */
export default function Explain({ children, className = "mb-2" }: { children: React.ReactNode; className?: string }) {
  return (
    <details className={"group text-xs text-slate-500 " + className}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
        <span className="transition group-open:rotate-90">›</span> ⓘ 이 화면 설명
      </summary>
      <div className="mt-1 leading-relaxed">{children}</div>
    </details>
  );
}
