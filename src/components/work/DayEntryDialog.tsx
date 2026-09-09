"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

/**
 * 달력에서 날짜를 눌렀을 때 뜨는 **갈래 고르기** 창.
 *
 * ── 왜 가르나 ────────────────────────────────────────────────────────
 *
 * 지금까지 날짜를 누르면 무조건 업무 등록이었습니다. 그런데 달력에 적히는 것은 세 종류이고
 * 셋의 수명이 전혀 다릅니다.
 *
 *   🔔 알림 — 그날에만 뜻이 있는 한 줄. 「점심 후 OO 약」, 「OO 3시 병원, 미리 내려보내기」
 *            맡을 사람도 진행 상태도 없습니다. 그날 지나면 끝입니다.
 *   📋 업무 — 행정실이 해내야 할 일. 「사물함 파손 수리」, 「행사 3시 세팅」
 *            맡을 사람이 있고 등록→진행→완료로 흐릅니다.
 *   🎓 학사 — 되풀이되는 일정과 큰 행사. 「졸업식」, 「PBL」, 「크리스마스 콘서트」,
 *            「다음 학기 준비」. 올해만이 아니라 **내년에도** 있어야 합니다.
 *
 * 셋을 한 자리에 섞으면 하루살이 쪽지가 흐름판을 덮어 며칠씩 굴러가는 일이 묻히고,
 * 해마다 오는 행사가 그해 업무 한 줄로만 남아 이듬해에는 아무도 모릅니다.
 * 무엇을 적는지는 적는 사람이 가장 잘 아니, 그 순간에 한 번 고르게 합니다.
 */

export type DayEntryKind = "알림" | "업무" | "학사";

const KINDS: { kind: DayEntryKind; icon: string; what: string; example: string; tone: string }[] = [
  {
    kind: "알림",
    icon: "🔔",
    what: "그날 챙길 한 가지",
    example: "점심 후 OO 약 · OO 3시 병원",
    tone: "border-amber-300 bg-amber-50 hover:bg-amber-100",
  },
  {
    kind: "업무",
    icon: "📋",
    what: "행정실이 해낼 일",
    example: "사물함 수리 · 행사 3시 세팅",
    tone: "border-blue-300 bg-blue-50 hover:bg-blue-100",
  },
  {
    kind: "학사",
    icon: "🎓",
    what: "되풀이 일정 · 큰 행사",
    example: "졸업식 · PBL · 다음 학기 준비",
    tone: "border-violet-300 bg-violet-50 hover:bg-violet-100",
  },
];

export default function DayEntryDialog({
  day,
  onPick,
  onClose,
}: {
  day: string;
  onPick: (kind: DayEntryKind) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <b className="text-sm text-slate-800">{day} 에 무엇을 남길까요?</b>
          <button onClick={onClose} className="rounded px-2 text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => onPick(k.kind)}
              className={"flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition " + k.tone}
            >
              <span className="text-lg">{k.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-slate-800">
                  {k.kind} <span className="font-medium text-slate-500">— {k.what}</span>
                </span>
                {/* 보기를 붙입니다. 이름만 있으면 「행사 세팅」이 업무인지 학사인지 매번
                    망설이게 되고, 망설이는 화면은 결국 아무거나 고르게 만듭니다. */}
                <span className="block text-[11px] text-slate-500">{k.example}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 🔔 알림 등록 — 한 줄과 (선택) 시각. 짧게 끝나야 하는 창이라 칸을 더 늘리지 않습니다. */
export function DayReminderDialog({
  day,
  department,
  authorEmail,
  authorName,
  onClose,
  onSaved,
}: {
  day: string;
  department: string;
  authorEmail: string;
  authorName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useToast();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [atTime, setAtTime] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) {
      notify("무엇을 챙길지 한 줄만 적어주세요.", "error");
      return;
    }
    setBusy(true);
    const { error } = await createClient().from("day_reminders").insert({
      day,
      title: title.trim(),
      note: note.trim() || null,
      department,
      at_time: atTime || null,
      author_email: authorEmail,
      author_name: authorName ?? null,
    });
    setBusy(false);
    if (error) {
      // 조용히 닫지 않습니다. 창이 닫히면 사람은 등록된 줄 알고, 그날 아무도 안 챙깁니다.
      notify(`알림을 저장하지 못했습니다: ${error.message}`, "error");
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <b className="text-sm text-slate-800">🔔 {day} 알림</b>
          <button onClick={onClose} className="rounded px-2 text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
          }}
          placeholder="무엇을 챙기나요? (예: 점심 후 김OO 약)"
          className="mb-2 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
        />
        <div className="mb-2 flex gap-2">
          <input
            type="time"
            value={atTime}
            onChange={(e) => setAtTime(e.target.value)}
            title="몇 시에 챙길지. 「오늘 중」이면 비워둡니다."
            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="덧붙임(선택) — 약 이름, 연락처 등"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
        </div>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="w-full rounded-lg bg-amber-500 py-2 text-[13px] font-bold text-white hover:bg-amber-600 disabled:opacity-40"
        >
          {busy ? "저장 중…" : "알림 등록"}
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          그날 달력에 뜨고, 오늘 것은 달력 위에 따로 모아 보여줍니다. 챙긴 뒤에는 눌러서 표시해주세요 —
          지우지 않고 남겨두어야 나중에 「언제부터 그랬더라」를 되짚을 수 있습니다.
        </p>
      </div>
    </div>
  );
}
