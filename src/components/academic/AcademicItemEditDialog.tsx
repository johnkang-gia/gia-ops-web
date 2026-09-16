"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import type { ChecklistItem } from "@/lib/types";

/**
 * **학사일정 한 줄 고치기 — 누구나, 대신 내력을 남깁니다.**
 *
 * ── 왜 누구나인가 ──────────────────────────────────────────────────────────
 *
 * 학사 일정은 여러 사람이 함께 준비합니다. 등록한 사람만 고칠 수 있으면 그 사람이 자리에
 * 없는 날 아무것도 못 고치고, 결국 옆에 **새 줄을 하나 더** 만듭니다 - 같은 일이 두 줄이
 * 되면 어느 쪽이 맞는지 아무도 모릅니다.
 *
 * 그래서 잠그는 대신 **보이게** 합니다. 고친 내력이 남아 있으면 되돌릴 수 있고, 무엇보다
 * 물어볼 사람을 알 수 있습니다.
 *
 * ── 행사와 준비 ────────────────────────────────────────────────────────────
 *
 * 「행사」로 표시하면 준비 기간이 달력에 막대로 그려지지 않습니다. 대신 준비 시작·회의·
 * 당일에만 점이 서고, 달력 아래 한 줄이 「D-93 · 다음 회의 9/24」를 늘 보여줍니다.
 *
 * 행사 당일을 **안 정했으면 비워 둡니다.** 가짜 날짜를 넣으면 그 날짜가 확정처럼 읽혀
 * 준비가 그날에 맞춰 굳습니다. 대신 「12월 중」처럼 말로 적어둡니다.
 */

type Meeting = { id: string; item_id: string; seq: number; meet_date: string; title: string | null; done: boolean };
type LogRow = { id: string; action: string; changes: Record<string, [unknown, unknown]> | null; changed_by_name: string | null; changed_by: string; changed_at: string };

const FIELD_LABEL: Record<string, string> = {
  title: "제목",
  description: "설명",
  due_date: "준비 시작",
  end_date: "준비 마감",
  kind: "종류",
  event_date: "행사 당일",
  event_when_note: "행사 시기(말로)",
  done: "완료",
};

export default function AcademicItemEditDialog({
  item,
  currentUserEmail,
  currentUserName,
  onClose,
  onSaved,
}: {
  item: ChecklistItem;
  currentUserEmail: string;
  currentUserName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useToast();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [kind, setKind] = useState<"일반" | "행사">((item.kind as "일반" | "행사") ?? "일반");
  const [dueDate, setDueDate] = useState(item.due_date);
  const [endDate, setEndDate] = useState(item.end_date ?? "");
  const [eventDate, setEventDate] = useState(item.event_date ?? "");
  const [whenNote, setWhenNote] = useState(item.event_when_note ?? "");
  const [busy, setBusy] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [m, l] = await Promise.all([
      supabase.from("academic_checklist_meetings").select("id, item_id, seq, meet_date, title, done").eq("item_id", item.id).order("seq"),
      supabase
        .from("academic_item_log")
        .select("id, action, changes, changed_by, changed_by_name, changed_at")
        .eq("item_id", item.id)
        .order("changed_at", { ascending: false })
        .limit(10),
    ]);
    setMeetings((m.data as Meeting[] | null) ?? []);
    setLogs((l.data as LogRow[] | null) ?? []);
  }, [item.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!title.trim()) return notify("제목을 넣어주세요.", "error");
    setBusy(true);
    const patch = {
      title: title.trim(),
      description: description.trim() || null,
      kind,
      due_date: dueDate,
      end_date: endDate || null,
      // 행사가 아니면 행사 칸은 비웁니다 - 종류를 바꿔놓고 옛 값이 남아 있으면 달력이
      // 그 날짜를 계속 행사로 그립니다.
      event_date: kind === "행사" ? eventDate || null : null,
      event_when_note: kind === "행사" ? whenNote.trim() || null : null,
    };

    /** 무엇이 무엇으로 바뀌었는지. 안 바뀐 칸은 적지 않습니다 - 기록이 길면 안 읽힙니다. */
    const changes: Record<string, [unknown, unknown]> = {};
    const before: Record<string, unknown> = {
      title: item.title,
      description: item.description ?? null,
      kind: item.kind ?? "일반",
      due_date: item.due_date,
      end_date: item.end_date ?? null,
      event_date: item.event_date ?? null,
      event_when_note: item.event_when_note ?? null,
    };
    for (const [k, v] of Object.entries(patch)) if (before[k] !== v) changes[k] = [before[k], v];

    if (Object.keys(changes).length === 0) {
      setBusy(false);
      onClose();
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.from("academic_checklist_items").update(patch).eq("id", item.id);
    if (error) {
      setBusy(false);
      // 조용히 넘기지 않습니다 - 안 고쳐진 줄 모르고 닫으면 옛 날짜로 준비가 굴러갑니다.
      return notify(`고치지 못했습니다: ${error.message}`, "error");
    }

    // 고친 내력. **여기 실패해도 고친 것은 되돌리지 않습니다** - 기록이 없는 것이 고친
    // 것을 되돌리는 것보다 낫습니다. 다만 사람에게는 알립니다.
    const { error: logErr } = await supabase.from("academic_item_log").insert({
      item_id: item.id,
      item_title: patch.title,
      action: "고침",
      changes,
      changed_by: currentUserEmail,
      changed_by_name: currentUserName,
    });
    setBusy(false);
    if (logErr) notify(`고쳤지만 기록은 남기지 못했습니다: ${logErr.message}`, "error");
    else notify("고쳤습니다. 누가 무엇을 바꿨는지 아래에 남습니다.", "success");
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[960] flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <b className="text-[14px] text-slate-900">🎓 학사일정 고치기</b>
          <span className="text-[11px] text-slate-400">누구나 고칠 수 있고, 고친 내력이 남습니다</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-slate-800 px-3 py-1 text-[12px] font-bold text-white">
            닫기
          </button>
        </div>

        <div className="max-h-[70vh] space-y-2.5 overflow-y-auto p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="설명(선택)"
            className="w-full rounded-lg border border-slate-300 p-2 text-[12px]"
          />

          {/* **종류가 달력 모양을 정합니다.** 행사로 두면 준비 기간이 막대로 안 그려집니다. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(["일반", "행사"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={
                  "rounded-full px-3 py-1 text-[12px] font-bold transition " +
                  (kind === k ? "bg-fuchsia-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                }
              >
                {k === "행사" ? "🎉 행사" : "📋 일반"}
              </button>
            ))}
            <span className="text-[10px] text-slate-500">
              {kind === "행사"
                ? "준비 기간은 달력에 막대로 안 그립니다 — 준비 시작·회의·당일에만 점이 섭니다."
                : "2주 이하면 막대로, 그보다 길면 마디에 점으로 그립니다."}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-slate-500">
              준비 시작
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="ml-1 rounded border border-slate-300 px-1.5 py-1 text-[12px]" />
            </label>
            <label className="text-[11px] text-slate-500">
              준비 마감
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="ml-1 rounded border border-slate-300 px-1.5 py-1 text-[12px]" />
            </label>
          </div>

          {kind === "행사" && (
            <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 p-2.5">
              <p className="mb-1.5 text-[11px] font-bold text-fuchsia-900">🎉 행사 당일</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-[12px]" />
                <span className="text-[11px] text-slate-500">또는</span>
                <input
                  value={whenNote}
                  onChange={(e) => setWhenNote(e.target.value.slice(0, 40))}
                  placeholder="예: 12월 중 (아직 미정)"
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-[12px]"
                />
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-fuchsia-800">
                <b>정해지지 않았으면 날짜를 비워 두세요.</b> 임시 날짜를 넣으면 확정처럼 읽혀 준비가 그날에 맞춰 굳습니다.
                비워 두면 달력 아래 줄에 「12월 중(날짜 미정)」으로 뜨고, 날짜 칸은 한 개도 안 먹습니다.
              </p>
            </div>
          )}

          {/* 회의는 이 일이 굴러가는 방식 자체입니다 - 날짜만 있으면 달력에 점이 서고,
              그날 업무보드에도 올라갑니다. */}
          <div className="rounded-lg bg-slate-50 p-2.5">
            <p className="mb-1 text-[11px] font-bold text-slate-600">🗣️ 회의 {meetings.length}회</p>
            {meetings.length === 0 ? (
              <p className="text-[11px] text-slate-400">회의가 없습니다. 학사일정 화면에서 회의를 넣으면 달력에 점으로 섭니다.</p>
            ) : (
              <ul className="space-y-0.5">
                {meetings.map((m) => (
                  <li key={m.id} className="flex items-center gap-1.5 text-[11px]">
                    <span className={m.done ? "text-slate-400 line-through" : "font-semibold text-slate-700"}>
                      {m.title?.trim() || `${m.seq}차 회의`}
                    </span>
                    <span className="tabular-nums text-slate-500">{m.meet_date}</span>
                    {m.done && <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-500">마침</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* **고친 내력.** 누구나 고칠 수 있게 한 대가로 반드시 보여야 하는 자리입니다. */}
          <div className="rounded-lg border border-slate-200 p-2.5">
            <p className="mb-1 text-[11px] font-bold text-slate-600">📜 고친 내력</p>
            {logs.length === 0 ? (
              <p className="text-[11px] text-slate-400">아직 고친 적이 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {logs.map((l) => (
                  <li key={l.id} className="text-[11px] leading-relaxed text-slate-600">
                    <b className="text-slate-800">{l.changed_by_name || l.changed_by}</b>{" "}
                    <span className="text-slate-400">{new Date(l.changed_at).toLocaleString("ko-KR")}</span>
                    <div className="pl-2 text-[10px] text-slate-500">
                      {Object.entries(l.changes ?? {}).map(([k, v]) => (
                        <div key={k}>
                          {FIELD_LABEL[k] ?? k}: {String(v[0] ?? "—")} → <b>{String(v[1] ?? "—")}</b>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-lg bg-fuchsia-600 px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            저장
          </button>
          <span className="text-[10px] text-slate-400">고친 사람과 바뀐 칸이 위 내력에 남습니다.</span>
        </div>
      </div>
    </div>
  );
}
