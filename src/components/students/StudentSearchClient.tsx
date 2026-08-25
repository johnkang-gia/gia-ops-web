"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { WrStudent } from "@/lib/types";

// 통합 학생 조회(요청 ⑤): 재학/졸업/퇴학 탭으로 나누고, 상단에 검색과 학년별 분포를 두어
// 한눈에 파악되게 합니다. 카드를 누르면 통합 프로필(/students/[id])로 이동합니다.
type Bucket = "active" | "graduated" | "withdrawn";

function bucketOf(status: string | null): Bucket {
  if (status === "졸업" || status === "graduated") return "graduated";
  if (status === "퇴학" || status === "전출" || status === "withdrawn") return "withdrawn";
  return "active";
}

const TAB_LABEL: Record<Bucket, string> = { active: "재학", graduated: "졸업", withdrawn: "퇴학·전출" };
const TAB_COLOR: Record<Bucket, string> = { active: "#7c3aed", graduated: "#0ea5e9", withdrawn: "#64748b" };

export default function StudentSearchClient({ students }: { students: WrStudent[] }) {
  const [tab, setTab] = useState<Bucket>("active");
  const [query, setQuery] = useState("");

  const byBucket = useMemo(() => {
    const m: Record<Bucket, WrStudent[]> = { active: [], graduated: [], withdrawn: [] };
    for (const s of students) m[bucketOf(s.status)].push(s);
    for (const k of Object.keys(m) as Bucket[]) m[k].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return m;
  }, [students]);

  const list = byBucket[tab];
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return list;
    return list.filter((s) => s.name.includes(q) || (s.student_no ?? "").includes(q) || (s.name_en ?? "").toLowerCase().includes(q.toLowerCase()));
  }, [list, query]);

  // 현재 탭의 학년별 분포
  const gradeBars = useMemo(() => {
    const g = new Map<string, number>();
    for (const s of list) {
      const key = (s.grade ?? "미지정").toString().trim() || "미지정";
      g.set(key, (g.get(key) ?? 0) + 1);
    }
    return [...g.entries()].map(([grade, count]) => ({ grade, count })).sort((a, b) => a.grade.localeCompare(b.grade, "ko", { numeric: true }));
  }, [list]);
  const maxGrade = Math.max(1, ...gradeBars.map((x) => x.count));
  const barColors = ["#8b5cf6", "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

  return (
    <div className="flex flex-col gap-3">
      {/* 탭 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["active", "graduated", "withdrawn"] as Bucket[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setTab(b)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition " +
                (tab === b ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700")
              }
              style={tab === b ? { color: TAB_COLOR[b] } : undefined}
            >
              {TAB_LABEL[b]} <span className="tabular-nums">{byBucket[b].length}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 이름 · 학번 · 영문이름"
          className="ml-auto w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-purple-400"
        />
      </div>

      {/* 학년별 분포 */}
      {gradeBars.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          {gradeBars.map((d, i) => (
            <div key={d.grade} className="flex min-w-[52px] flex-col items-center gap-1">
              <span className="text-xs font-bold tabular-nums" style={{ color: barColors[i % barColors.length] }}>
                {d.count}
              </span>
              <div className="flex h-16 w-6 items-end overflow-hidden rounded-md bg-slate-100">
                <div
                  className="w-full rounded-md transition-all duration-700"
                  style={{ height: `${(d.count / maxGrade) * 100}%`, background: barColors[i % barColors.length] }}
                />
              </div>
              <span className="text-[11px] text-slate-500">{d.grade}</span>
            </div>
          ))}
          <span className="ml-auto self-center text-xs text-slate-400">{TAB_LABEL[tab]} 총 {list.length}명</span>
        </div>
      )}

      {/* 학생 그리드 */}
      {results.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">해당하는 학생이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((s) => (
            <Link
              key={s.id}
              href={`/students/${s.id}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-purple-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-slate-800">{s.name}</span>
                  {s.name_en && <span className="truncate text-[11px] text-slate-400">{s.name_en}</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {s.grade ? `${s.grade}학년` : ""} {s.class_name ? `${s.class_name}반` : ""}
                </div>
              </div>
              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{s.student_no}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
