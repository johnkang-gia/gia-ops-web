"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import { getMeetingAudioUrl } from "@/lib/storage";
import type { Meeting, PolicyCategory, Term } from "@/lib/types";
import MeetingChatComposer from "./MeetingChatComposer";
import AiSourcePanel from "@/components/ai/AiSourcePanel";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";

// 회의가 쌓일수록 목록이 끝없이 길어지지 않도록, 게시판처럼 페이지 단위로 잘라 보여줍니다.
const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "💬 회의기록이란?",
    lines: [
      "회의 내용을 채팅형으로 대화하듯 입력하면 AI가 안건/결정사항을 자동 정리합니다. 음성 녹음 후 실시간 텍스트 변환(STT)도 지원합니다.",
      "왼쪽 목록에서 회의를 고르면 가운데에 정리된 회의록과 AI 제안이 나타납니다.",
    ],
  },
];

type FormState = {
  date: string;
  attendees: string;
  content: string;
  status: string;
  next_agenda: string;
  final_record: string;
  manual_cat: string;
  op_plan_cat: string;
};

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  attendees: "",
  content: "",
  status: "",
  next_agenda: "",
  final_record: "",
  manual_cat: "",
  op_plan_cat: "",
};

function oneLine(text: string, maxLen = 40) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

// 왼쪽(날짜별 목록) · 가운데(채팅 작성창, 항상 표시) · 오른쪽(AI 제안) 3단 레이아웃입니다.
export default function MeetingsClient({
  initialItems,
  currentTerm,
  policyCategories,
}: {
  initialItems: Meeting[];
  currentTerm: Term | null;
  // 매뉴얼(실무자용)/운영계획안(학부모용) 고정 항목 목록 - incidents와 동일하게 이 목록
  // 중에서만 골라 태그합니다.
  policyCategories: PolicyCategory[];
}) {
  const manualCatOptions = policyCategories.filter((c) => c.target_doc === "실무자용");
  const opPlanCatOptions = policyCategories.filter((c) => c.target_doc === "학부모용");
  const [items, setItems] = useRealtimeTable<Meeting>("meetings", initialItems);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [composerKey, setComposerKey] = useState(0);

  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page]
  );
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // 새 회의가 저장되는 등 전체 건수가 바뀌면 현재 보던 페이지가 유효하지 않을 수 있어
  // 1페이지로 되돌립니다.
  useEffect(() => {
    setPage(1);
  }, [items.length]);

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
      manual_cat: it.manual_cat ?? "",
      op_plan_cat: it.op_plan_cat ?? "",
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
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[300px_1fr_340px] lg:overflow-hidden">
      {/* 왼쪽: 날짜별 목록 - 계속 늘어지는 스크롤 대신 게시판처럼 페이지 번호로 넘겨봅니다 */}
      <div className="order-2 flex flex-col gap-2 lg:order-1 lg:h-full lg:min-h-0 lg:overflow-hidden">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-bold text-slate-700">회의 ({items.length}건)</h1>
          <div className="flex items-center gap-1.5">
          {editingId && (
            <button
              onClick={stopEditing}
              className="rounded-lg bg-gia-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-gia-navy-2"
            >
              + 새 회의
            </button>
          )}
          <GuideButton title="회의기록 사용 가이드" sections={GUIDE_SECTIONS} />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto lg:min-h-0">
          {items.length === 0 && (
            <div className="rounded-lg bg-white p-3 text-xs text-slate-400 shadow-sm">등록된 회의가 없습니다.</div>
          )}
          {pageItems.map((it) => (
            <button
              key={it.id}
              onClick={() => {
                startEdit(it);
                loadAudioUrl(it);
              }}
              className={
                "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left shadow-sm transition " +
                (editingId === it.id
                  ? "border-gia-navy bg-gia-gold-soft/20"
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
        <div className="shrink-0">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
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
            currentTerm={currentTerm}
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                매뉴얼 항목(실무자용)
                <select
                  value={form.manual_cat}
                  onChange={(e) => setForm({ ...form, manual_cat: e.target.value })}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">(선택 안 함 - AI가 나중에 분류)</option>
                  {manualCatOptions.map((c) => (
                    <option key={c.id} value={c.category}>
                      {c.domain ? `${c.domain} · ` : ""}
                      {c.category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                운영계획안 항목(학부모용)
                <select
                  value={form.op_plan_cat}
                  onChange={(e) => setForm({ ...form, op_plan_cat: e.target.value })}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">(선택 안 함 - AI가 나중에 분류)</option>
                  {opPlanCatOptions.map((c) => (
                    <option key={c.id} value={c.category}>
                      {c.domain ? `${c.domain} · ` : ""}
                      {c.category}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {editingId && audioUrls[editingId] && (
              <audio controls src={audioUrls[editingId]} className="h-9 w-full max-w-sm" />
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
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
