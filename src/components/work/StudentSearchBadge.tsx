"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// 업무보드 머리줄의 "학생 검색" 팝업.
//
// 업무를 보다가 학생 기록을 남기거나 자료를 확인해야 하는 일이 자주 생깁니다. 지금까지는
// 학교 → 학생 조회로 화면을 옮겨야 했고, 돌아오면 보던 업무 자리를 다시 찾아야 했습니다.
// 화면을 떠나지 않고 찾을 수 있으면 하던 일을 놓지 않습니다.
//
// 명부는 한 번만 읽고 브라우저 안에서 걸러냅니다(137명). 글자를 칠 때마다 서버에 묻는 것은
// 이 규모에서는 느리기만 하고 얻는 것이 없습니다.

type Row = { id: string; name: string; nameEn: string | null; grade: string | null; className: string | null; studentNo: string | null };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export default function StudentSearchBadge() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || rows) return;
    (async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("wr_students_basic")
        .select("id, name, name_en, grade, class_name, student_no")
        .eq("status", "active")
        .order("name");
      if (err) {
        setError(`명부를 읽지 못했습니다: ${err.message}`);
        return;
      }
      setRows(
        (data ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
          nameEn: (s.name_en as string | null) ?? null,
          grade: (s.grade as string | null) ?? null,
          className: (s.class_name as string | null) ?? null,
          studentNo: (s.student_no as string | null) ?? null,
        })),
      );
    })();
  }, [open, rows]);

  // 열면 바로 칠 수 있어야 합니다. 창을 연 뒤 칸을 한 번 더 누르게 하면 두 동작이 됩니다.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hits = useMemo(() => {
    const k = norm(q);
    if (!rows) return [];
    if (!k) return rows.slice(0, 30);
    return rows
      .filter(
        (s) =>
          norm(s.name).includes(k) ||
          norm(s.nameEn ?? "").includes(k) ||
          norm(s.studentNo ?? "").includes(k) ||
          norm(s.className ?? "").includes(k),
      )
      .slice(0, 40);
  }, [rows, q]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="학생 검색 (이름 · 영문이름 · 학번 · 반)"
        className="shrink-0 whitespace-nowrap rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
      >
        🔎 학생 검색
      </button>

      {open && (
        <div className="fixed inset-0 z-[999] flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={() => setOpen(false)}>
          <div className="flex max-h-[70vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 p-3">
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름 · 영문이름 · 학번 · 반"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {error ? (
                <p className="rounded-lg bg-orange-50 px-3 py-2 text-[12px] leading-relaxed text-orange-800">{error}</p>
              ) : !rows ? (
                <p className="p-4 text-center text-[12px] text-slate-400">명부를 읽는 중…</p>
              ) : hits.length === 0 ? (
                <p className="p-4 text-center text-[12px] text-slate-400">찾는 학생이 없습니다.</p>
              ) : (
                hits.map((s) => (
                  <Link
                    key={s.id}
                    href={`/students/${s.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-baseline gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                  >
                    <span className="text-sm font-bold text-slate-800">{s.name}</span>
                    {s.nameEn && <span className="text-[11px] text-slate-400">{s.nameEn}</span>}
                    <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                      {[s.grade ? `${s.grade}학년` : null, s.className].filter(Boolean).join(" ")}
                    </span>
                  </Link>
                ))
              )}
            </div>
            <div className="border-t border-slate-100 px-3 py-2 text-right">
              <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700">
                닫기 (Esc)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
