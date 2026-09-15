"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * **학생을 고르는 자리는 전부 검색입니다.**
 *
 * ── 왜 <select> 를 쓰지 않나 ────────────────────────────────────────────────
 *
 * 재학생이 139명입니다. 브라우저 기본 목록은 **첫 글자로만 건너뜁니다.** 「강서후」를 찾으려면
 * ㄱ으로 시작하는 아이들을 눈으로 훑어야 하고, 좁은 칸에서는 한 번에 예닐곱 명만 보입니다.
 * 그래서 사람들은 목록에서 고르는 대신 **이름을 손으로 적는 쪽**으로 갔고, 손으로 적힌 이름은
 * 명부와 안 이어집니다 - 이 저장소에서 「이름만 적힌 줄」이 반복해서 문제가 된 뿌리입니다.
 *
 * ── 왜 이름이 아니라 번호를 돌려주나 ────────────────────────────────────────
 *
 * 김재이가 셋입니다. 고른 결과를 이름으로 넘기면 받는 쪽이 다시 명부를 뒤져야 하고, 그때
 * 셋 중 누구인지 알 수 없습니다(CLAUDE.md §2-4-1). 그래서 `onChange` 는 **학생 번호**를
 * 넘깁니다.
 *
 * ── 겹치는 이름에는 반을 붙입니다 ───────────────────────────────────────────
 *
 * 139명 전부에 반을 붙이면 정작 구분이 필요한 이름이 묻힙니다. 겹치는 이름에만 붙입니다.
 */

export type SelectableStudent = {
  id: string;
  name: string;
  grade?: string | null;
  class_name?: string | null;
  name_en?: string | null;
  student_no?: string | null;
  /**
   * 생일. **김재이 셋이 영문명을 모두 「Jay Kim」으로 씁니다.** 선생님들은 그래서
   * 「김재이(190828)」처럼 생일을 붙여 부르고, 그 글자로도 찾을 수 있어야 합니다
   * (CLAUDE.md §2-4).
   */
  birth_date?: string | null;
};

export default function StudentSelect({
  students,
  value,
  onChange,
  placeholder = "학생 고르기…",
  clearLabel,
  className = "",
  autoOpen = false,
  disabled,
  initialQuery = "",
}: {
  students: SelectableStudent[];
  /** 지금 고른 학생 번호. 없으면 null. */
  value: string | null;
  onChange: (studentId: string | null) => void;
  placeholder?: string;
  /** 있으면 「비우기」 줄이 목록 맨 위에 붙습니다(연결 해제 등). */
  clearLabel?: string;
  className?: string;
  /** 열린 채로 시작합니다. 「고치기」를 눌러 들어온 자리에 씁니다. */
  autoOpen?: boolean;
  disabled?: boolean;
  /** 열자마자 이 말로 검색해 둡니다. 자동이 읽은 이름을 넣으면 대개 바로 좁혀집니다. */
  initialQuery?: string;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState(initialQuery);
  /**
   * 목록을 **화면 꼭대기 층에 띄웁니다.**
   *
   * 고르는 칸은 대개 표 안이나 팝업 안에 있습니다. 그 상자들은 `overflow-hidden` 이거나
   * 자기 쌓임 맥락을 만들어서, 상자 안에 그린 목록은 **잘리거나 뒤에 깔립니다.** 화면에는
   * 오류가 아니라 「안 열리는 단추」로 보입니다.
   */
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const homonyms = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of students) c.set(s.name, (c.get(s.name) ?? 0) + 1);
    return c;
  }, [students]);

  const picked = useMemo(() => students.find((s) => s.id === value) ?? null, [students, value]);

  const results = useMemo(() => {
    const key = q.trim().toLowerCase();
    const list = key
      ? students.filter((s) =>
          [
            s.name,
            s.name_en ?? "",
            s.student_no ?? "",
            s.class_name ?? "",
            s.grade ?? "",
            // 「190828」로도 찾습니다 - 겹치는 이름을 가르는 마지막 재료입니다.
            (s.birth_date ?? "").replace(/-/g, "").slice(2),
          ].some((v) => String(v).toLowerCase().includes(key)),
        )
      : students;
    // 50줄에서 끊습니다. 그 아래는 어차피 안 읽고, 다 그리면 표가 있는 화면이 느려집니다.
    return list.slice(0, 50);
  }, [students, q]);

  function place() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 224) });
  }

  useEffect(() => {
    if (!open) return;
    place();
    setQ(initialQuery);
    setTimeout(() => inputRef.current?.select(), 0);
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // 스크롤하면 단추가 움직이는데 목록은 화면 기준이라 그 자리에 남습니다. 따라가게 합니다.
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, initialQuery]);

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  const label = picked
    ? `${picked.name}${(homonyms.get(picked.name) ?? 0) > 1 && picked.class_name ? ` (${picked.class_name})` : ""}`
    : placeholder;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={
          className ||
          "flex w-full items-center justify-between gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-left text-[12px] text-slate-700 transition hover:border-indigo-400 disabled:opacity-40"
        }
        title="눌러서 이름·영문·학번으로 검색합니다"
      >
        <span className={"truncate " + (picked ? "font-semibold" : "text-slate-400")}>{label}</span>
        <span className="shrink-0 text-[10px] text-slate-400">🔍</span>
      </button>

      {open &&
        rect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={boxRef}
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 3000 }}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // 하나로 좁혀졌으면 Enter 로 바로 고릅니다.
                if (e.key === "Enter" && results.length === 1) pick(results[0].id);
              }}
              placeholder="이름 · 영문 · 학번 · 반"
              className="w-full border-b border-slate-200 px-2.5 py-2 text-[13px] outline-none"
            />
            <div className="max-h-64 overflow-y-auto">
              {clearLabel && (
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="w-full px-2.5 py-1.5 text-left text-[12px] font-semibold text-rose-600 hover:bg-rose-50"
                >
                  {clearLabel}
                </button>
              )}
              {results.length === 0 ? (
                <p className="px-2.5 py-4 text-center text-[11px] text-slate-400">찾는 학생이 없습니다.</p>
              ) : (
                results.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick(s.id)}
                    className={
                      "flex w-full items-baseline gap-1.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-indigo-50 " +
                      (s.id === value ? "bg-indigo-50/60" : "")
                    }
                  >
                    <span className="font-semibold text-slate-800">{s.name}</span>
                    {/* 겹치는 이름에만 반을 붙입니다. 전부에 붙이면 정작 구분이 필요한
                        이름이 묻힙니다(CLAUDE.md §2-4-2). */}
                    {(homonyms.get(s.name) ?? 0) > 1 && s.class_name && (
                      <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-700">
                        {s.class_name}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">
                      {s.grade ? `${s.grade}학년` : ""} {s.name_en ?? ""}
                      {/* 반까지 같은 동명이인이 있습니다. 그때는 생일이 유일한 구분입니다. */}
                      {(homonyms.get(s.name) ?? 0) > 1 && s.birth_date
                        ? ` ${s.birth_date.replace(/-/g, "").slice(2)}`
                        : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
            {students.length > results.length && (
              <p className="border-t border-slate-100 px-2.5 py-1 text-[10px] text-slate-400">
                {students.length}명 중 {results.length}명 — 더 좁히려면 이름을 더 쳐주세요.
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
