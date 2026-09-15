"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StudentSelect, { type SelectableStudent } from "@/components/common/StudentSelect";
import { useToast } from "@/components/common/ToastProvider";
import { KIND_LOOK, NOTE_KINDS, dayLabel, sortNotes, type DayNote, type NoteKind } from "@/lib/studentDayNotes";

/**
 * **학생 특이사항 — 오늘 이 아이에 대해 알아야 할 것을 적는 자리.**
 *
 * ── 왜 이 자리인가 ──────────────────────────────────────────────────────────
 *
 * 예전에는 여기가 구글챗이었습니다. 직원들은 어차피 구글챗을 따로 띄워놓고 일하므로,
 * 같은 대화를 이 좁은 칸에 한 번 더 비추는 것은 자리만 먹었습니다.
 *
 * 그 자리에 들어오는 것은 **적을 데가 없던 말들**입니다 — 「서후 약 점심에 챙겨주세요」,
 * 「오늘 어머니 픽업 오시면서 교재비 결제하신대요」. 출결도 픽업도 업무도 아니라서
 * 지금까지는 포스트잇이나 「제가 기억할게요」였고, 그 사람이 자리를 비우면 사라졌습니다.
 *
 * ── 학생은 반드시 명부에서 고릅니다 ─────────────────────────────────────────
 *
 * 이름을 손으로 적게 하면 김재이가 셋인데 어느 김재이인지 알 수 없습니다(CLAUDE.md
 * §2-4-1). 그 상태로 약을 주는 것은 안 주는 것보다 나쁩니다. 그래서 검색해서 고르고,
 * 저장되는 것은 **학생 번호**입니다.
 */

export default function StudentDayNotes({ students }: { students: SelectableStudent[] }) {
  const notify = useToast();
  const [notes, setNotes] = useState<DayNote[]>([]);
  const [today, setToday] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [studentId, setStudentId] = useState<string | null>(null);
  const [kind, setKind] = useState<NoteKind>("약");
  const [content, setContent] = useState("");
  const [onDate, setOnDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/student-notes", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body?.error ?? `특이사항을 읽지 못했습니다 (${res.status}).`);
        return;
      }
      setLoadError(null);
      setToday(body.today as string);
      setOnDate((prev) => prev || (body.today as string));
      setNotes((body.notes as DayNote[]) ?? []);
    } catch (e) {
      // 조용히 빈 칸을 띄우면 「오늘은 없구나」로 읽힙니다. 다른 말입니다.
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 여러 사람이 각자 자리에서 적습니다. 열어둔 화면이 안 따라오면 같은 것을 두 번 적거나,
    // 옆자리가 적어둔 것을 못 보고 지나갑니다.
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const sorted = useMemo(() => sortNotes(notes, today), [notes, today]);
  const todayCount = useMemo(() => notes.filter((n) => n.onDate === today).length, [notes, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) {
      notify("학생을 먼저 골라주세요.", "error");
      return;
    }
    if (!content.trim()) {
      notify("무엇을 해야 하는지 적어주세요.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/student-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, kind, content: content.trim(), onDate: onDate || today }),
      });
      const body = await res.json();
      if (!res.ok) {
        notify(body?.error ?? "저장하지 못했습니다.", "error");
        return;
      }
      setNotes((prev) => [...prev, body.note as DayNote]);
      setContent("");
      setStudentId(null);
      setOnDate(today);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function drop(note: DayNote) {
    // 화면에서 먼저 뺍니다. 실패하면 되돌리고 이유를 말합니다.
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    try {
      const res = await fetch("/api/student-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: note.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        notify(body?.error ?? "내리지 못했습니다.", "error");
        setNotes((prev) => [...prev, note]);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
      setNotes((prev) => [...prev, note]);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-bold text-slate-800">📌 학생 특이사항</h2>
        <span className="text-[11px] text-slate-500">오늘 {todayCount}건</span>
        <span className="ml-auto text-[11px] text-slate-400">중앙 대시보드에 함께 뜹니다</span>
      </div>

      {/* ── 적는 자리. 맨 위에 둡니다 — 전화를 받으면서 바로 적어야 합니다. ───── */}
      <form onSubmit={submit} className="shrink-0 space-y-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StudentSelect
            students={students}
            value={studentId}
            onChange={setStudentId}
            placeholder="학생 검색…"
            className="min-w-[150px] flex-1"
            disabled={busy}
          />
          <input
            type="date"
            value={onDate}
            min={today}
            onChange={(e) => setOnDate(e.target.value)}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
            title="어느 날의 일인가요. 기본은 오늘입니다."
          />
        </div>

        {/* 종류는 단추입니다. 목록에서 고르면 한 번 더 눌러야 하고, 다섯 개뿐이라
            펼쳐두는 편이 빠릅니다. */}
        <div className="flex flex-wrap gap-1">
          {NOTE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              disabled={busy}
              className={
                "rounded-full px-2 py-0.5 text-[11px] font-bold transition " +
                (kind === k ? KIND_LOOK[k].chip : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100")
              }
            >
              {KIND_LOOK[k].icon} {k}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
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

      {/* ── 목록 ────────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loadError ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
            {loadError}
            <button type="button" onClick={() => void load()} className="ml-2 font-bold underline">
              다시 시도
            </button>
          </div>
        ) : loading ? (
          <p className="py-4 text-center text-[12px] text-slate-400">불러오는 중…</p>
        ) : sorted.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-slate-400">
            오늘 챙길 것이 없습니다. 전화로 들은 것이 있으면 위에 적어두세요.
          </p>
        ) : (
          <ul className="space-y-1">
            {sorted.map((n) => {
              const look = KIND_LOOK[n.kind];
              const isToday = n.onDate === today;
              return (
                <li
                  key={n.id}
                  className={
                    "flex items-start gap-2 rounded-lg border px-2 py-1.5 " +
                    (isToday ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50")
                  }
                >
                  <span className={"shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold " + look.chip}>
                    {look.icon} {n.kind}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <b className={"text-[13px] " + (isToday ? "text-slate-900" : "text-slate-500")}>{n.studentName}</b>
                      {/* 앞날 것은 날짜를 반드시 적습니다 - 오늘 화면에서 내일 것이 오늘
                          것처럼 읽히면 사람이 하루 일찍 움직입니다. */}
                      {!isToday && (
                        <span className="rounded bg-slate-200 px-1 text-[10px] font-bold text-slate-600">
                          {dayLabel(n.onDate, today)}
                        </span>
                      )}
                    </div>
                    <p className={"break-words text-[12px] " + (isToday ? "text-slate-700" : "text-slate-500")}>{n.content}</p>
                    {n.createdByName && <p className="text-[10px] text-slate-400">{n.createdByName}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => void drop(n)}
                    title="잘못 적었으면 내립니다"
                    className="shrink-0 rounded px-1 text-[12px] text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
