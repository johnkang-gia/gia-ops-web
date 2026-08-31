"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// 학생 고르기 - 검색해서 찾습니다.
//
// 담당자: "픽업 인박스 학생연결에서 검색해서 찾을 수 있게 해줘."
//
// 예전에는 <select> 하나에 137명이 들어 있었습니다. 브라우저 기본 목록은 첫 글자만으로
// 건너뛰기 때문에 "강서후"를 찾으려면 ㄱ으로 시작하는 아이들을 눈으로 훑어야 했습니다.
// 이름 두 글자만 쳐도 좁혀지는 편이 훨씬 빠릅니다.
//
// 한글·영문·학번 어느 쪽으로 쳐도 찾습니다 - 화면마다 아이를 부르는 이름이 다르기 때문입니다
// (토들은 영문, 명부는 한글).

export type PickStudent = {
  id: string;
  name: string;
  grade: string | null;
  class_name?: string | null;
  name_en?: string | null;
  student_no?: string | null;
};

export default function StudentPicker({
  students,
  onPick,
  disabled,
  label = "학생 연결",
  autoFocusQuery = "",
}: {
  students: PickStudent[];
  onPick: (s: PickStudent) => void;
  disabled?: boolean;
  label?: string;
  /** 열자마자 이 말로 검색해둡니다(AI가 읽은 이름을 넣으면 대개 바로 좁혀집니다). */
  autoFocusQuery?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(autoFocusQuery);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ(autoFocusQuery);
      // 열자마자 바로 칠 수 있게. 한 번 더 클릭하게 하지 않습니다.
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, autoFocusQuery]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 같은 이름이 여럿이면 반을 붙여 구별합니다.
  const homonyms = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of students) c.set(s.name, (c.get(s.name) ?? 0) + 1);
    return c;
  }, [students]);

  const results = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return students.slice(0, 50);
    return students
      .filter((s) =>
        [s.name, s.name_en ?? "", s.student_no ?? "", s.class_name ?? ""].some((v) => v.toLowerCase().includes(key))
      )
      .slice(0, 50);
  }, [students, q]);

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-300 px-2 py-1 text-[11px] font-semibold text-amber-700 disabled:opacity-50"
      >
        {label}
      </button>
    );
  }

  return (
    <div ref={boxRef} className="relative z-20">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          // 결과가 하나면 Enter로 바로 고릅니다.
          if (e.key === "Enter" && results.length === 1) {
            onPick(results[0]);
            setOpen(false);
          }
        }}
        placeholder="이름 · 영문 · 학번"
        className="w-40 rounded-lg border border-blue-400 px-2 py-1 text-xs outline-none"
      />
      <div className="absolute left-0 top-full mt-1 max-h-56 w-56 overflow-y-auto g-panel-solid shadow-xl">
        {results.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-slate-400">찾는 학생이 없습니다.</p>
        ) : (
          results.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
              className="flex w-full items-baseline gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-blue-50"
            >
              <span className="font-semibold text-slate-800">{s.name}</span>
              {(homonyms.get(s.name) ?? 0) > 1 && s.class_name && (
                <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-700">{s.class_name}</span>
              )}
              <span className="text-[10px] text-slate-400">
                {s.grade ? `${s.grade}학년` : ""} {s.name_en ?? ""}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
