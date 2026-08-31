"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AppUser } from "@/lib/types";
import Pagination from "@/components/Pagination";

const PAGE_SIZE = 15;

// 학생 검색(StudentSearchClient)과 같은 패턴입니다 - 이름/이메일로 찾아서 클릭하면 그 교직원의
// 통합 프로필(/staff/[email])로 이동합니다.
const DEPTS = ["유치부", "초등부", "중고등부"] as const;
const POSITIONS = ["교사", "행정직원", "관리자"] as const;

export default function StaffSearchClient({ staff, homeroomMap = {} }: { staff: AppUser[]; homeroomMap?: Record<string, string> }) {
  const [query, setQuery] = useState("");
  // 담당자: "교직원 정보조회 - 각 부서와, 권한별로 볼 수 있게 해줘."
  //
  // 이름으로 찾는 것은 **누구인지 이미 알 때** 쓰는 도구입니다. 실제로 자주 필요한 물음은
  // "초등부 선생님이 누구누구지", "행정 쪽에 누가 있지"처럼 **묶어서 보는 것**인데, 지금까지는
  // 이름을 하나씩 쳐보는 수밖에 없었습니다.
  const [dept, setDept] = useState<string>("");
  const [position, setPosition] = useState<string>("");
  // 퇴사자는 기본으로 감춥니다. 계정이 남아 있어 목록에 섞이면 "지금 누가 있나"가 흐려집니다.
  const [includeRetired, setIncludeRetired] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (!includeRetired && s.leave_date) return false;
      // 부서·직위가 비어 있는 계정은 "미지정"으로 골라야만 나옵니다 - 부서를 골랐는데
      // 소속 없는 사람까지 섞이면 그 부서 명단으로 쓸 수가 없습니다.
      if (dept && (dept === "미지정" ? !!s.department : s.department !== dept)) return false;
      if (position && (position === "미지정" ? !!s.position : s.position !== position)) return false;
      if (!q) return true;
      return (s.name ?? "").toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
    });
  }, [staff, query, dept, position, includeRetired]);

  /** 다른 조건은 그대로 두고 이 칸만 바꿨을 때 몇 명인지. 눌러보기 전에 알 수 있어야 합니다. */
  function countBy(kind: "dept" | "position", value: string): number {
    return staff.filter((s) => {
      if (!includeRetired && s.leave_date) return false;
      const d = kind === "dept" ? value : dept;
      const p = kind === "position" ? value : position;
      if (d && (d === "미지정" ? !!s.department : s.department !== d)) return false;
      if (p && (p === "미지정" ? !!s.position : s.position !== p)) return false;
      return true;
    }).length;
  }

  const [page, setPage] = useState(1);
  const pageItems = useMemo(() => results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [results, page]);
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [query, dept, position, includeRetired]);

  function chip(active: boolean, tone: "dept" | "position") {
    return (
      "rounded-lg px-2.5 py-1 text-xs font-bold transition " +
      (active
        ? tone === "dept"
          ? "bg-gia-navy text-white"
          : "bg-slate-700 text-white"
        : "border border-slate-300 text-slate-600 hover:bg-slate-50")
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름 또는 이메일로 검색"
        className="mb-2 w-full shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="w-8 text-[11px] font-bold text-slate-400">부서</span>
        <button type="button" onClick={() => setDept("")} className={chip(dept === "", "dept")}>
          전체 {countBy("dept", "")}
        </button>
        {DEPTS.map((d) => (
          <button key={d} type="button" onClick={() => setDept(d)} className={chip(dept === d, "dept")}>
            {d} {countBy("dept", d)}
          </button>
        ))}
        <button type="button" onClick={() => setDept("미지정")} className={chip(dept === "미지정", "dept")}>
          미지정 {countBy("dept", "미지정")}
        </button>
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="w-8 text-[11px] font-bold text-slate-400">권한</span>
        <button type="button" onClick={() => setPosition("")} className={chip(position === "", "position")}>
          전체 {countBy("position", "")}
        </button>
        {POSITIONS.map((p) => (
          <button key={p} type="button" onClick={() => setPosition(p)} className={chip(position === p, "position")}>
            {p} {countBy("position", p)}
          </button>
        ))}
        <button type="button" onClick={() => setPosition("미지정")} className={chip(position === "미지정", "position")}>
          미지정 {countBy("position", "미지정")}
        </button>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
          퇴사자 포함
        </label>
      </div>

      {results.length === 0 && <p className="shrink-0 text-sm text-slate-400">검색 결과가 없습니다.</p>}

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {pageItems.map((s) => {
          const retired = !!s.leave_date;
          return (
            <Link
              key={s.email}
              href={`/staff/${encodeURIComponent(s.email)}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-gia-navy hover:bg-gia-gold-soft/10"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{s.name || "(이름 미입력)"}</span>
                <span className="text-xs text-slate-400">
                  {[s.department, s.position, homeroomMap[s.email.toLowerCase()] ? `담임 ${homeroomMap[s.email.toLowerCase()]}` : null]
                    .filter(Boolean)
                    .join(" · ") || "-"}
                </span>
                {retired && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">퇴사</span>
                )}
              </div>
              <span className="text-[11px] text-slate-400">{s.email}</span>
            </Link>
          );
        })}
      </div>
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
