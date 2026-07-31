"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import { getMeetingAudioUrl } from "@/lib/storage";
import type { Meeting } from "@/lib/types";
import MeetingChatComposer from "./MeetingChatComposer";

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

function oneLine(text: string, maxLen = 60) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default function MeetingsClient({
  initialItems,
}: {
  initialItems: Meeting[];
}) {
  const [items, setItems] = useRealtimeTable<Meeting>("meetings", initialItems);
  const [showChat, setShowChat] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});

  async function loadAudioUrl(it: Meeting) {
    if (!it.audio_path || audioUrls[it.id]) return;
    const url = await getMeetingAudioUrl(it.audio_path);
    if (url) setAudioUrls((prev) => ({ ...prev, [it.id]: url }));
  }

  function startEdit(it: Meeting) {
    setEditingId(it.id);
    setExpandedId(it.id);
    setForm({
      date: it.date,
      attendees: it.attendees ?? "",
      content: it.content,
      status: it.status ?? "",
      next_agenda: it.next_agenda ?? "",
      final_record: it.final_record ?? "",
    });
    setShowChat(false);
  }

  function resetForm() {
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

    if (editingId) {
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
        resetForm();
      }
    } else {
      const { data, error: err } = await supabase
        .from("meetings")
        .insert({ ...form, case_id: genCaseId("MTG") })
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => [data as Meeting, ...prev]);
        resetForm();
      }
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
    <div className="mx-auto max-w-3xl">
      <p className="mb-3 text-xs text-slate-500">
        회의 안건은 AI 분석을 거쳐 실무자매뉴얼/운영계획안이나 관련 행사·학기 기록에 자동으로
        반영됩니다. 아래 채팅으로 두서없는 메모를 붙여넣거나, 음성 파일을 올리거나, 회의를 라이브로
        녹음하면서 정리할 수 있습니다.
      </p>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">회의 ({items.length}건)</h1>
        <button
          onClick={() => {
            setShowChat((v) => !v);
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          {showChat ? "닫기" : "+ 새로 입력(채팅)"}
        </button>
      </div>

      {showChat && !editingId && (
        <MeetingChatComposer
          onSaved={(meeting) => {
            setItems((prev) => [meeting, ...prev]);
            setShowChat(false);
          }}
          onCancel={() => setShowChat(false)}
        />
      )}

      {editingId && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
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
              <span>회의 내용(주요 논의사항 - 두서없이 메모하듯 써도 됩니다)</span>
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

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              취소
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {items.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
            등록된 회의가 없습니다.
          </div>
        )}
        {items.map((it) => {
          const expanded = expandedId === it.id;
          return (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => {
                  setExpandedId(expanded ? null : it.id);
                  if (!expanded) loadAudioUrl(it);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {oneLine(it.content)}
                </span>
                {it.audio_path && <span className="shrink-0 text-xs">🎙️</span>}
                <span className="shrink-0 text-xs text-slate-400">{it.date}</span>
                {it.status && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {it.status}
                  </span>
                )}
                <span className="shrink-0 text-xs font-bold text-blue-600">
                  {expanded ? "접기 ‹" : "더보기 ›"}
                </span>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 px-4 py-3 text-sm">
                  <dl className="flex flex-col gap-2">
                    {[
                      ["참석자", it.attendees],
                      ["회의 내용", it.content],
                      ["확정된 안건 기록", it.final_record],
                      ["다음 회의 안건", it.next_agenda],
                    ]
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label as string}>
                          <dt className="text-xs text-slate-400">{label}</dt>
                          <dd className="whitespace-pre-wrap">{value}</dd>
                        </div>
                      ))}
                  </dl>
                  {it.audio_path && (
                    <div className="mt-3">
                      {audioUrls[it.id] ? (
                        <audio controls src={audioUrls[it.id]} className="h-9 w-full max-w-sm" />
                      ) : (
                        <p className="text-xs text-slate-400">🎙️ 녹음 파일 불러오는 중...</p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => startEdit(it)}
                    className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    수정
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
