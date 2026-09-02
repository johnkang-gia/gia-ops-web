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

type Row = { id: string; name: string; nameEn: string | null; grade: string | null; className: string | null; room: string | null };

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
      // 반의 위치("A동 2F")는 반 표(wr_classes.room)에 있습니다. 학생 표에는 없어서 따로
      // 읽어 이어 붙입니다 - 아이를 찾아가야 하는 사람에게는 반 이름보다 이게 필요합니다.
      const [stuRes, clsRes] = await Promise.all([
        supabase.from("wr_students_basic").select("id, name, name_en, grade, class_name, class_id").eq("status", "active").order("name"),
        supabase.from("wr_classes").select("id, grade, class_name, room").eq("is_demo", false),
      ]);
      if (stuRes.error) {
        setError(`명부를 읽지 못했습니다: ${stuRes.error.message}`);
        return;
      }
      // 반 표를 못 읽어도 검색은 됩니다. 위치만 비게 두고 넘어갑니다 - 위치 하나 때문에
      // 학생 검색 자체가 막히면 손해가 더 큽니다.
      if (clsRes.error) console.error("[학생 검색] 반 위치를 읽지 못했습니다:", clsRes.error.message);
      const classes = clsRes.data ?? [];
      const roomById = new Map(classes.map((c) => [c.id as string, (c.room as string | null) ?? null]));
      // class_id가 비어 있는 학생도 있어서 학년+반 이름으로도 찾습니다.
      const roomByGradeClass = new Map(classes.map((c) => [`${c.grade ?? ""}|${c.class_name ?? ""}`, (c.room as string | null) ?? null]));
      setRows(
        (stuRes.data ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
          nameEn: (s.name_en as string | null) ?? null,
          grade: (s.grade as string | null) ?? null,
          className: (s.class_name as string | null) ?? null,
          room:
            (s.class_id ? roomById.get(s.class_id as string) : null) ??
            roomByGradeClass.get(`${s.grade ?? ""}|${s.class_name ?? ""}`) ??
            null,
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
          norm(s.room ?? "").includes(k) ||
          norm(s.className ?? "").includes(k),
      )
      .slice(0, 40);
  }, [rows, q]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="학생 검색 (이름 · 영문이름 · 반 · 교실 위치)"
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
                placeholder="이름 · 영문이름 · 반 · 위치"
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
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-bold text-slate-800">{s.name}</span>
                      {s.nameEn && <span className="ml-1.5 text-[11px] text-slate-400">{s.nameEn}</span>}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">
                        {[s.grade ? `${s.grade}학년` : null, s.className].filter(Boolean).join(" ") || "반 없음"}
                      </span>
                      {/* 교실 위치. 아이를 찾아가야 하는 사람에게는 반 이름보다 이게 필요합니다. */}
                      {s.room && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">📍 {s.room}</span>
                      )}
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
