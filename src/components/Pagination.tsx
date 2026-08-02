"use client";

// 긴 목록을 스크롤 대신 게시판처럼 "1 2 3 ..." 페이지 번호로 나눠 보여주기 위한 공용
// 컴포넌트입니다. 각 목록 화면(사건기록/회의기록/제안함/채택예정/매뉴얼/서류함/문의/사용자관리/
// 학생검색/학기/위클리 리포트 관리 화면 등)에서 동일하게 재사용합니다.
//
// 사용법: 부모 컴포넌트에서 `page` state를 두고, 전체 배열을
// `items.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)`로 잘라 렌더링한 뒤, 이 컴포넌트를 목록
// 맨 아래에 붙이면 됩니다. totalPages가 1 이하면 아무것도 그리지 않습니다.
export default function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  // 페이지가 많아지면 현재 페이지 주변 + 처음/끝만 보여주고 나머지는 "…"으로 생략합니다.
  const pages: (number | "…")[] = [];
  const windowSize = 1;
  for (let p = 1; p <= totalPages; p++) {
    const isEdge = p === 1 || p === totalPages;
    const isNear = Math.abs(p - page) <= windowSize;
    if (isEdge || isNear) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  return (
    <div className="mt-3 flex shrink-0 items-center justify-center gap-1 pt-2">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
      >
        ‹ 이전
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-300">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={
              "min-w-[26px] rounded-md px-2 py-1 text-xs font-semibold transition " +
              (p === page ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-100")
            }
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
      >
        다음 ›
      </button>
    </div>
  );
}
