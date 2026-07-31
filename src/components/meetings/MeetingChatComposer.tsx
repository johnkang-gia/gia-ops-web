"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadMeetingAudio } from "@/lib/storage";
import { genCaseId } from "@/lib/caseId";
import type { Meeting } from "@/lib/types";

type ChatTurn = { role: "user" | "assistant"; content: string };
type Draft = { date: string; attendees: string; organizedContent: string };

export default function MeetingChatComposer({
  onSaved,
  onCancel,
}: {
  onSaved: (meeting: Meeting) => void;
  onCancel: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<Draft>({
    date: new Date().toISOString().slice(0, 10),
    attendees: "",
    organizedContent: "",
  });
  const [readyToSave, setReadyToSave] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    const nextTurns = [...turns, { role: "user" as const, content }];
    setTurns(nextTurns);
    setInput("");
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/ai/meeting-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turns: nextTurns, currentDraft: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "AI 응답을 받지 못했습니다.");
        setSending(false);
        return;
      }
      const result = data.result as {
        reply: string;
        date: string;
        attendees: string;
        organizedContent: string;
        readyToSave: boolean;
      };
      setTurns((prev) => [...prev, { role: "assistant", content: result.reply }]);
      setDraft({
        date: result.date || draft.date,
        attendees: result.attendees || draft.attendees,
        organizedContent: result.organizedContent || draft.organizedContent,
      });
      setReadyToSave(!!result.readyToSave);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
    setSending(false);
  }

  async function handleAudioFile(file: File) {
    setUploadingAudio(true);
    setError("");
    try {
      const path = await uploadMeetingAudio(file, "meetings");
      setAudioPath(path);
      const res = await fetch("/api/ai/transcribe-audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      setUploadingAudio(false);
      if (!res.ok) {
        setError(data.error || "음성을 텍스트로 바꾸지 못했습니다.");
        return;
      }
      await sendMessage(data.text);
    } catch (err) {
      setUploadingAudio(false);
      setError(err instanceof Error ? err.message : "음성 파일 업로드에 실패했습니다.");
    }
  }

  async function handleSave() {
    if (!draft.organizedContent.trim()) {
      setError("아직 저장할 내용이 없습니다. 먼저 회의 내용을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("meetings")
      .insert({
        case_id: genCaseId("MTG"),
        date: draft.date || new Date().toISOString().slice(0, 10),
        attendees: draft.attendees,
        content: draft.organizedContent,
        status: "",
        next_agenda: "",
        final_record: "",
        source_chat: turns,
        audio_path: audioPath,
      })
      .select()
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data) onSaved(data as Meeting);
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">💬 채팅으로 회의록 작성</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          닫기
        </button>
      </div>

      {turns.length === 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          두서없이 적은 회의 메모를 그대로 붙여넣으세요. AI가 애매한 부분은 되물어가며 정식
          회의록으로 정리해 드립니다. 다음부터는 회의를 녹음해서 그 음성 파일을 올려도 됩니다
          (자동으로 텍스트로 바꿔서 정리를 시작합니다).
        </p>
      )}

      {turns.length > 0 && (
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                (t.role === "user"
                  ? "self-end bg-slate-900 text-white"
                  : "self-start bg-white text-slate-700 shadow-sm")
              }
            >
              {t.content}
            </div>
          ))}
          {sending && (
            <div className="self-start rounded-lg bg-white px-3 py-2 text-sm text-slate-400 shadow-sm">
              AI가 정리하는 중...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(input);
            }
          }}
          rows={3}
          placeholder={turns.length === 0 ? "여기에 회의 메모를 붙여넣으세요..." : "답변을 입력하세요..."}
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={sending || !input.trim()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            전송
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAudio || sending}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {uploadingAudio ? "변환 중..." : "🎙️ 음성"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAudioFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {draft.organizedContent && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold text-blue-800">📝 정리 중인 회의록</span>
            <span
              className={
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                (readyToSave ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
              }
            >
              {readyToSave ? "✅ 저장 준비됨" : "💬 정리 중"}
            </span>
          </div>
          <div className="mb-1 text-blue-700">
            날짜: {draft.date || "(미정)"} · 참석자: {draft.attendees || "(미정)"}
          </div>
          <p className="whitespace-pre-wrap text-slate-700">{draft.organizedContent}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !draft.organizedContent.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? "저장 중..." : "회의록으로 저장"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
