"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StudentSelect, { type SelectableStudent } from "@/components/common/StudentSelect";
import { useToast } from "@/components/common/ToastProvider";
import { ITEM_LOOK, bucketOf, toMinutes, whenLabel, type DayBoard, type DayItem, type StudentDay, type UnknownItem } from "@/lib/studentDay";
import { NOTE_KINDS, KIND_LOOK, type NoteKind } from "@/lib/studentDayNotes";

/**
 * **오늘 학생 — 「누가 오늘 평소와 다른가」를 한 곳에 모은 보드.**
 *
 * ── 어지럽지 않게 만드는 규칙 넷 ────────────────────────────────────────────
 *
 * 139명입니다. 규칙 없이 늘어놓으면 첫날부터 아무도 안 봅니다.
 *
 *  ① **한 아이 = 한 줄.** 백서아의 픽업과 약이 두 줄로 나뉘면 보는 사람이 다시 눈으로
 *     이어야 합니다. 여러 건은 한 줄 안에 작은 칩으로 늘어섭니다.
 *  ② **갈래로 가르지 않습니다.** 사람이 하는 질문은 「누가 몇 시에 무엇을」이지 「결석이
 *     몇 명인가」가 아닙니다. 갈래로 칸을 나누면 백서아가 두 칸에 나뉩니다.
 *  ③ **지난 것과 앞날은 접습니다.** 펼쳐두면 지금 할 일이 그 사이에 묻힙니다. 숫자는
 *     늘 보이므로 「없어진 것」과 「접힌 것」이 구별됩니다.
 *  ④ **적는 폼은 접어둡니다.** 보는 일은 하루에 수십 번, 적는 일은 몇 번입니다. 폼이
 *     펼쳐져 있으면 칸의 절반을 늘 먹습니다.
 */

type Draft = { studentId: string | null; kind: NoteKind; content: string; onDate: string; atTime: string };

export default function StudentDayBoard({ students }: { students: SelectableStudent[] }) {
  const notify = useToast();
  const [board, setBoard] = useState<DayBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMin, setNowMin] = useState(() => nowMinutesKst());

  const [q, setQ] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showPast, setShowPast] = useState(false);
  const [showAhead, setShowAhead] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/student-day", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) return setLoadError(body?.error ?? `보드를 읽지 못했습니다 (${res.status}).`);
      setLoadError(null);
      setBoard(body as DayBoard);
    } catch (e) {
      // 조용히 빈 칸을 띄우면 「오늘은 아무 일 없구나」로 읽힙니다. 다른 말입니다.
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      setNowMin(nowMinutesKst());
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const date = board?.date ?? "";

  /** 검색·필터를 먼저 걸고, 그 다음에 묶음으로 가릅니다. */
  const { today, past, ahead, unknown } = useMemo(() => {
    const empty = { today: [] as StudentDay[], past: [] as StudentDay[], ahead: [] as StudentDay[], unknown: [] as UnknownItem[] };
    if (!board) return empty;
    const needle = q.trim().toLowerCase();
    const hit = (d: StudentDay) =>
      !needle ||
      d.name.toLowerCase().includes(needle) ||
      (d.className ?? "").toLowerCase().includes(needle) ||
      d.items.some((i) => i.text.toLowerCase().includes(needle));

    const days = board.days.filter((d) => hit(d) && (!onlyPending || d.pendingCount > 0));
    const out = { ...empty, unknown: board.unknown };
    for (const d of days) {
      const b = bucketOf(d, board.date, nowMin);
      if (b === "오늘") out.today.push(d);
      else if (b === "지남") out.past.push(d);
      else out.ahead.push(d);
    }
    return out;
  }, [board, q, onlyPending, nowMin]);

  const pendingTotal = (board?.days.reduce((n, d) => n + d.pendingCount, 0) ?? 0) + (board?.unknown.length ?? 0);

  /**
   * 잘못 적은 특이사항 내리기.
   *
   * **보드에서 내릴 수 있어야 합니다.** 적는 자리와 내리는 자리가 갈리면, 오타로 들어간
   * 줄이 영영 남습니다 - 내리러 다른 화면을 찾아가는 일은 대개 안 하게 됩니다.
   *
   * 내릴 수 있는 것은 **사람이 적은 특이사항뿐**입니다. 픽업·결석·문의는 각자 제 화면에서
   * 처리되어야 하고, 여기서 지우면 그 화면과 답이 갈립니다.
   */
  async function dropNote(item: DayItem) {
    const id = item.id.startsWith("note:") ? item.id.slice(5) : null;
    if (!id) return;
    try {
      const res = await fetch("/api/student-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        notify(body?.error ?? "내리지 못했습니다.", "error");
        return;
      }
      // 서버가 정답입니다. 화면에서만 빼면 다음 갱신에 되살아날 수 있습니다.
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
      {/* ── 머리: 숫자 한 줄 ────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-baseline gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-bold text-slate-800">📋 오늘 학생</h2>
        <span className="text-[11px] text-slate-500">{today.length}명</span>
        {pendingTotal > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">확인 {pendingTotal}</span>
        )}
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="ml-auto rounded-lg border border-slate-300 px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
        >
          {formOpen ? "닫기" : "+ 특이사항"}
        </button>
      </div>

      {formOpen && <NoteForm students={students} today={date} onSaved={() => void load()} onClose={() => setFormOpen(false)} />}

      {/* ── 찾기 한 줄. 139명 중에서 한 아이를 볼 때 씁니다. ─────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 반 · 내용으로 좁히기"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-[12px]"
        />
        <button
          type="button"
          onClick={() => setOnlyPending((v) => !v)}
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold transition " +
            (onlyPending ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300" : "text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50")
          }
        >
          확인 필요만
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loadError ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
            {loadError}
            <button type="button" onClick={() => void load()} className="ml-2 font-bold underline">
              다시 시도
            </button>
          </div>
        ) : !board ? (
          <p className="py-4 text-center text-[12px] text-slate-400">불러오는 중…</p>
        ) : (
          <>
            {/* 읽다 실패한 갈래가 있으면 숨기지 않습니다 - 「조용히 빠진 갈래」가 가장 나쁩니다. */}
            {board.problems.length > 0 && (
              <ul className="mb-2 space-y-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-800">
                {board.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}

            {/* ── 오늘 ──────────────────────────────────────────────── */}
            {today.length === 0 && past.length === 0 && ahead.length === 0 && unknown.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-slate-400">
                오늘 평소와 다른 아이가 없습니다. 연락이 오면 여기 모입니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {today.map((d) => (
                  <Row
                    key={d.studentId}
                    day={d}
                    date={date}
                    nowMin={nowMin}
                    open={open.has(d.studentId)}
                    onToggle={() => toggle(d.studentId)}
                    onDrop={dropNote}
                  />
                ))}
              </ul>
            )}

            {/* ── 누구인지 모름. 접지 않습니다 — 여기 남아 있으면 누군가 놓칩니다. ── */}
            {unknown.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
                <p className="mb-1 text-[11px] font-bold text-amber-800">❓ 누구인지 아직 모릅니다 · {unknown.length}건</p>
                <ul className="space-y-1">
                  {unknown.slice(0, 6).map((u) => (
                    <li key={u.id} className="flex items-baseline gap-1.5 text-[12px]">
                      <span>{ITEM_LOOK[u.kind].icon}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700">{u.text}</span>
                      {u.hint && <span className="shrink-0 text-[10px] text-amber-700">{u.hint}</span>}
                    </li>
                  ))}
                </ul>
                <a href="/pickup/inbox" className="mt-1 inline-block text-[11px] font-bold text-amber-800 underline">
                  픽업 인박스에서 학생 연결 →
                </a>
              </div>
            )}

            {/* ── 접어두는 둘 ──────────────────────────────────────────── */}
            <Folded label="지난 것" n={past.length} open={showPast} onToggle={() => setShowPast((v) => !v)}>
              {past.map((d) => (
                <Row key={d.studentId} day={d} date={date} nowMin={nowMin} dim open={open.has(d.studentId)} onToggle={() => toggle(d.studentId)} onDrop={dropNote} />
              ))}
            </Folded>
            <Folded label="앞날" n={ahead.length} open={showAhead} onToggle={() => setShowAhead((v) => !v)}>
              {ahead.map((d) => (
                <Row key={d.studentId} day={d} date={date} nowMin={nowMin} dim open={open.has(d.studentId)} onToggle={() => toggle(d.studentId)} onDrop={dropNote} />
              ))}
            </Folded>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * **한 아이 한 줄.** 시각 · 이름 · 반 · 그리고 할 일들이 작은 칩으로.
 *
 * 누르면 그 줄만 펼쳐져 전체 글과 출처가 보입니다 - 보드는 훑는 곳이고, 자세한 것은
 * 필요한 한 줄에서만 봅니다.
 */
function Row({
  day,
  date,
  nowMin,
  open,
  onToggle,
  onDrop,
  dim,
}: {
  day: StudentDay;
  date: string;
  nowMin: number;
  open: boolean;
  onToggle: () => void;
  /** 사람이 적은 특이사항을 내립니다. 다른 갈래에는 안 붙습니다. */
  onDrop: (item: DayItem) => void;
  dim?: boolean;
}) {
  const soon = day.firstTime !== null && toMinutes(day.firstTime) - nowMin <= 30 && toMinutes(day.firstTime) - nowMin >= -20;
  return (
    <li
      className={
        "rounded-lg border px-2 py-1.5 " +
        (dim ? "border-slate-100 bg-slate-50" : soon ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white")
      }
    >
      <button type="button" onClick={onToggle} className="flex w-full items-baseline gap-1.5 text-left">
        {/* 시각이 이름보다 먼저입니다 — 몇 시가 움직이는 시점을 정합니다. */}
        {day.firstTime && (
          <b className={"shrink-0 tabular-nums text-[13px] " + (dim ? "text-slate-400" : "text-slate-900")}>{day.firstTime}</b>
        )}
        <b className={"shrink-0 text-[13px] " + (dim ? "text-slate-500" : "text-slate-900")}>{day.name}</b>
        <span className="shrink-0 text-[10px] text-slate-400">{day.className ?? day.grade ?? ""}</span>

        {/* 할 일들. 접혀 있을 때는 아이콘 + 짧은 글만. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1">
          {day.items.map((i) => (
            <span
              key={i.id}
              className={"max-w-[11rem] truncate rounded px-1 text-[11px] font-semibold " + (dim ? "bg-slate-100 text-slate-500" : ITEM_LOOK[i.kind].chip)}
            >
              {ITEM_LOOK[i.kind].icon} {shortOf(i, date)}
            </span>
          ))}
        </span>

        {day.pendingCount > 0 && (
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">확인 {day.pendingCount}</span>
        )}
        <span className="shrink-0 text-[10px] text-slate-300">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <ul className="mt-1.5 space-y-1 border-t border-slate-100 pt-1.5">
          {day.items.map((i) => (
            <li key={i.id} className="flex items-baseline gap-1.5 text-[12px]">
              <span className={"shrink-0 rounded px-1 text-[10px] font-bold " + ITEM_LOOK[i.kind].chip}>
                {ITEM_LOOK[i.kind].icon} {i.kind}
              </span>
              {whenLabel(i.onDate, i.at, date) && (
                <b className="shrink-0 tabular-nums text-slate-600">{whenLabel(i.onDate, i.at, date)}</b>
              )}
              <span className="min-w-0 flex-1 break-words text-slate-700">{i.text}</span>
              {/* 어디서 온 줄인지. 이게 없으면 사람은 보드를 못 믿고 원래 화면을 다시 엽니다. */}
              <a href={i.from.screen} className="shrink-0 text-[10px] text-slate-400 underline hover:text-slate-700">
                원래 화면
              </a>
              {/* 사람이 적은 특이사항만 여기서 내립니다. 픽업·결석·문의는 각자 제 화면에서
                  처리되어야 하고, 여기서 지우면 그 화면과 답이 갈립니다. */}
              {i.from.table === "student_day_notes" && (
                <button
                  type="button"
                  onClick={() => onDrop(i)}
                  title="잘못 적었으면 내립니다"
                  className="shrink-0 rounded px-1 text-[11px] text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** 접힌 묶음. **숫자는 접혀 있어도 보입니다** — 「없는 것」과 「접힌 것」은 다른 말입니다. */
function Folded({
  label,
  n,
  open,
  onToggle,
  children,
}: {
  label: string;
  n: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (n === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>
          {label} {n}명
        </span>
      </button>
      {open && <ul className="mt-1 space-y-1">{children}</ul>}
    </div>
  );
}

/** 접힌 줄에 들어갈 짧은 글. 칩 하나가 줄을 통째로 먹으면 「몇 건인가」가 안 보입니다. */
function shortOf(i: DayItem, date: string): string {
  const when = i.onDate === date ? "" : `${whenLabel(i.onDate, null, date)} `;
  const body = i.text.trim() || i.kind;
  return `${when}${body}`;
}

function nowMinutesKst(): number {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * 특이사항 적는 폼. **접어둡니다** — 보는 일은 하루에 수십 번, 적는 일은 몇 번입니다.
 *
 * 저장하는 창구는 `/api/student-notes` 그대로입니다. 보드는 읽기만 하고, 적는 일은 원래
 * 있던 자리에서 합니다 - 저장을 두 곳에 두면 어느 날 한쪽에만 칸이 늘어납니다.
 */
function NoteForm({
  students,
  today,
  onSaved,
  onClose,
}: {
  students: SelectableStudent[];
  today: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const notify = useToast();
  const [d, setD] = useState<Draft>({ studentId: null, kind: "약", content: "", onDate: today, atTime: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setD((p) => ({ ...p, onDate: p.onDate || today }));
  }, [today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.studentId) return notify("학생을 먼저 골라주세요.", "error");
    if (!d.content.trim()) return notify("무엇을 해야 하는지 적어주세요.", "error");
    setBusy(true);
    try {
      const res = await fetch("/api/student-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: d.studentId,
          kind: d.kind,
          content: d.content.trim(),
          onDate: d.onDate || today,
          atTime: d.atTime || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) return notify(body?.error ?? "저장하지 못했습니다.", "error");
      setD({ studentId: null, kind: "약", content: "", onDate: today, atTime: "" });
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="shrink-0 space-y-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <StudentSelect
          students={students}
          value={d.studentId}
          onChange={(v) => setD((p) => ({ ...p, studentId: v }))}
          placeholder="학생 검색…"
          className="min-w-[150px] flex-1"
          disabled={busy}
          autoOpen
        />
        <input
          type="date"
          value={d.onDate}
          min={today}
          onChange={(e) => setD((p) => ({ ...p, onDate: e.target.value }))}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
          title="어느 날의 일인가요. 기본은 오늘입니다."
        />
        <input
          type="time"
          value={d.atTime}
          onChange={(e) => setD((p) => ({ ...p, atTime: e.target.value }))}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
          title="몇 시에 할 일인가요. 적어두면 5분 전에 알림이 뜹니다. 비워도 됩니다."
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {NOTE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setD((p) => ({ ...p, kind: k }))}
            disabled={busy}
            className={
              "rounded-full px-2 py-0.5 text-[11px] font-bold transition " +
              (d.kind === k ? KIND_LOOK[k].chip : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100")
            }
          >
            {KIND_LOOK[k].icon} {k}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        <input
          value={d.content}
          onChange={(e) => setD((p) => ({ ...p, content: e.target.value }))}
          disabled={busy}
          maxLength={300}
          placeholder="예: 점심 먹고 감기약 한 봉 / 픽업 오실 때 교재비 결제 예정"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
        >
          등록
        </button>
      </div>
    </form>
  );
}
