"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

export type ImportIssue = {
  id: string;
  source: string;
  kind: string;
  student_name: string | null;
  detail: string;
  resolved: boolean;
  created_at: string;
};

const KIND_STYLE: Record<string, { bg: string; text: string }> = {
  동명이인: { bg: "bg-red-100", text: "text-red-700" },
  생년월일불일치: { bg: "bg-amber-100", text: "text-amber-700" },
  생년월일없음: { bg: "bg-slate-100", text: "text-slate-600" },
};

export default function DataCheckIssues({ initialIssues }: { initialIssues: ImportIssue[] }) {
  const notify = useToast();
  const [issues, setIssues] = useState(initialIssues);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const open = issues.filter((i) => !i.resolved);
  const done = issues.filter((i) => i.resolved);
  const visible = showResolved ? issues : open;

  async function toggleResolved(issue: ImportIssue) {
    const next = !issue.resolved;
    setBusyId(issue.id);
    // 화면을 먼저 바꾸고 저장이 실패하면 되돌립니다 - 목록이 길 때 반응이 느리면 두 번 누르게 됩니다.
    setIssues((prev) => prev.map((i) => (i.id === issue.id ? { ...i, resolved: next } : i)));
    const supabase = createClient();
    const { error } = await supabase.from("wr_import_issues").update({ resolved: next }).eq("id", issue.id);
    setBusyId(null);
    if (error) {
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? { ...i, resolved: !next } : i)));
      notify("변경하지 못했습니다: " + error.message, "error");
    }
  }

  if (issues.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
        확인이 필요한 건이 없습니다. 명부가 문제없이 반영되었습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {done.length > 0 && (
        <label className="flex items-center gap-1.5 self-end text-[11px] text-slate-400">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          확인 완료한 {done.length}건도 보기
        </label>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
          남은 건이 없습니다.
        </p>
      ) : (
        visible.map((issue) => {
          const style = KIND_STYLE[issue.kind] ?? { bg: "bg-slate-100", text: "text-slate-600" };
          return (
            <div
              key={issue.id}
              className={"rounded-xl border p-3 " + (issue.resolved ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${style.bg} ${style.text}`}>{issue.kind}</span>
                <span className={"text-sm font-bold " + (issue.resolved ? "text-slate-400 line-through" : "text-slate-800")}>
                  {issue.student_name ?? "(이름 없음)"}
                </span>
                <span className="text-[11px] text-slate-400">{issue.source}</span>
                <button
                  type="button"
                  disabled={busyId === issue.id}
                  onClick={() => toggleResolved(issue)}
                  className={
                    "ml-auto rounded-lg border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 " +
                    (issue.resolved
                      ? "border-slate-300 text-slate-500 hover:bg-slate-100"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100")
                  }
                >
                  {issue.resolved ? "되돌리기" : "확인 완료"}
                </button>
              </div>
              <p className={"mt-1.5 text-xs leading-relaxed " + (issue.resolved ? "text-slate-400" : "text-slate-600")}>
                {issue.detail}
              </p>
              <Link
                href={`/weekly-report/admin/students?q=${encodeURIComponent(issue.student_name ?? "")}`}
                className="mt-1.5 inline-block text-[11px] font-semibold text-blue-600 hover:underline"
              >
                학생 관리에서 찾아보기 →
              </Link>
            </div>
          );
        })
      )}
    </div>
  );
}
