"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import { getMeetingAudioUrl } from "@/lib/storage";
import type { Meeting } from "@/lib/types";
import MeetingChatComposer from "./MeetingChatComposer";
import AiSourcePanel from "@/components/ai/AiSourcePanel";

type FormState = {
  date: string;
  attendees: string;
  content: string;
  status: string;
  next_agenda: string;
  final_record: string;
};

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  attendees: "",
  content: "",
  status: "",
  next_agenda: "",
  final_record: "",
};

function oneLine(text: string, maxLen = 40) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

// 왼쪽(날짜별 목록) · 가운데(채팅 작성창, 항상 표시) · 오른쪽(AI 제안) 3단 레이아웃입니다.
export default function MeetingsClient({
  initialItems,
}: {
  initialItems: Meeting[];
}) {
  const [items, setItems] = useRealtimeTable<Meeting>("meetings", initialItems);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [composerKey, setComposerKey] = useState(0);

  async function loadAudioUrl(it: Meeting) {
    if (!it.audio_path || audioUrls[it.id]) return;
    const url = await getMeetingAudioUrl(it.audio_path);
    if (url) setAudioUrls((prev) => ({ ...prev, [it.id]: url }));
  }

  function startEdit(it: Meeting) {
    setEditingId(it.id);
    setForm({
      date: it.date,
      attendees: it.attendees ?? "",
      content: it.content,
      status: it.status ?? "",
      next_agenda: it.next_agenda ?? "",
      final_record: it.final_record ?? "",
    });
  }

  function stopEditing() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.content.trim()) {
      setError("회의 내용을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();

    const { data, error: err } = await supabase
      .from("meetings")
      .update({ ...form })
      .eq("id", editingId)
      .select()
      .single();
    if (err) {
      setError(err.message);
    } else if (data) {
      setItems((prev) => prev.map((it) => (it.id === editingId ? (data as Meeting) : it)));
      stopEditing();
    }
    setSaving(false);
  }

  async function handleCleanUp() {
    if (!form.content.trim()) {
      setError("정리할 회의 내용을 먼저 입력해주세요.");
      return;
    }
    setCleaning(true);
    setError("");
    const res = await fetch("/api/ai/clean-meeting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: form.date, attendees: form.attendees, content: form.content }),
    });
    const data = await res.json();
    setCleaning(false);
    if (!res.ok) {
      setError(data.error || "정리하지 못했습니다.");
      return;
    }
    setForm((f) => ({ ...f, content: data.cleanedContent }));
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_340px] lg:items-start">
      {/* 왼쪽: 날짜별 목록 */}
      <div className="order-2 flex flex-col gap-2 lg:order-1">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-bold text-slate-700">회의 ({items.length}건)</h1>
          {editingId && (
            <button
              onClick={stopEditing}
              className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700"
            >
              + 새 회의
            </button>
          )}
        </div>
        <div className="flex max-h-[75vh] flex-col gap-1.5 overflow-y-auto lg:max-h-[calc(100vh-8rem)]">
          {items.length === 0 && (
            <div className="rounded-lg bg-white p-3 text-xs text-slate-400 shadow-sm">등록된 회의가 없습니다.</div>
          )}
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => {
                startEdit(it);
                loadAudioUrl(it);
              }}
              className={
                "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left shadow-sm transition " +
                (editingId === it.id
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 bg-white hover:border-slate-300")
              }
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{oneLine(it.content)}</span>
                {it.audio_path && <span className="shrink-0 text-[10px]">🎙️</span>}
              </div>
              <span className="text-[10px] text-slate-400">{it.date}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 가운데: 채팅 작성창(신규) 또는 수정 폼 */}
      <div className="order-1 lg:order-2">
        {!editingId && (
          <p className="mb-3 text-xs text-slate-500">
            회의 안건은 AI 분석을 거쳐 실무자매뉴얼/운영계획안이나 관련 행사·학기 기록에 자동으로
            반영됩니다. 아래 채팅으로 두서없는 메모를 붙여넣거나, 음성 파일을 올리거나, 회의를 라이브로
            녹음하면서 정리할 수 있습니다.
          </p>
        )}

        {!editingId && (
          <MeetingChatComposer
            key={composerKey}
            onSaved={(meeting) => {
              setItems((prev) => [meeting, ...prev]);
              setComposerKey((k) => k + 1);
              fetch("/api/ai/scan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ type: "meetings", id: meeting.id }),
              }).catch(() => {});
            }}
            onCancel={() => setComposerKey((k) => k + 1)}
          />
        )}

        {editingId && (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">회의록 수정</h2>
              <button
                type="button"
                onClick={stopEditing}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                새로 작성하기
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                날짜
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                참석자
                <input
                  type="text"
                  value={form.attendees}
                  onChange={(e) => setForm({ ...form, attendees: e.target.value })}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              <div className="flex items-center justify-between">
                <span>회의 내용(주요 논의사항)</span>
                <button
                  type="button"
                  onClick={handleCleanUp}
                  disabled={cleaning || !form.content.trim()}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {cleaning ? "정리 중..." : "🧹 AI로 정리"}
                </button>
              </div>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={5}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              확정된 안건 기록(채택된 내용의 최종 정리본)
              <textarea
                value={form.final_record}
                onChange={(e) => setForm({ ...form, final_record: e.target.value })}
                rows={2}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              다음 회의 안건
              <textarea
                value={form.next_agenda}
                onChange={(e) => setForm({ ...form, next_agenda: e.target.value })}
                rows={2}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              처리상태
              <input
                type="text"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {editingId && audioUrls[editingId] && (
              <audio controls src={audioUrls[editingId]} className="h-9 w-full max-w-sm" />
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? "저장 중..." : "수정 저장"}
              </button>
              <button
                type="button"
                onClick={stopEditing}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 오른쪽: AI 제안 */}
      <div className="order-3">
        <AiSourcePanel source="meetings" scanType="meetings" />
      </div>
    </div>
  );
}
