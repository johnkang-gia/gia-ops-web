"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SchoolDocument } from "@/lib/types";
import { genCaseId } from "@/lib/caseId";

const STATUS_OPTIONS: SchoolDocument["status"][] = ["필요", "준비중", "보유", "만료임박", "해당없음"];

const STATUS_STYLE: Record<SchoolDocument["status"], string> = {
  필요: "bg-red-50 text-red-600 border-red-200",
  준비중: "bg-amber-50 text-amber-700 border-amber-200",
  보유: "bg-emerald-50 text-emerald-700 border-emerald-200",
  만료임박: "bg-red-50 text-red-600 border-red-200",
  해당없음: "bg-slate-50 text-slate-400 border-slate-200",
};

const EMPTY_FORM = { name: "", category: "", notes: "" };

export default function DocumentsClient({ initialItems }: { initialItems: SchoolDocument[] }) {
  const [items, setItems] = useState<SchoolDocument[]>(initialItems);
  const [recommending, setRecommending] = useState(false);
  const [recommendMsg, setRecommendMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("documents-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "documents" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((it) => it.id !== oldId);
            }
            const next = payload.new as SchoolDocument;
            const exists = prev.some((it) => it.id === next.id);
            const merged = exists
              ? prev.map((it) => (it.id === next.id ? next : it))
              : [...prev, next];
            return [...merged].sort((a, b) => a.name.localeCompare(b.name));
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function requestRecommend() {
    setRecommending(true);
    setRecommendMsg("");
    const res = await fetch("/api/ai/document-recommend", { method: "POST" });
    const data = await res.json();
    setRecommending(false);
    if (!res.ok) {
      setRecommendMsg(`오류: ${data.error || "추천을 받지 못했습니다."}`);
      return;
    }
    setRecommendMsg(
      data.created > 0
        ? `${data.created}개 서류를 새로 추천받았습니다.`
        : "이미 등록된 서류와 겹치지 않는 새 추천이 없습니다."
    );
  }

  async function addDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("서류명을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.from("documents").insert({
      case_id: genCaseId("DOC"),
      name: form.name,
      category: form.category,
      notes: form.notes,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  async function updateStatus(id: string, status: SchoolDocument["status"]) {
    const supabase = createClient();
    await supabase.from("documents").update({ status }).eq("id", id);
  }

  async function deleteDocument(id: string) {
    if (!confirm("이 서류 항목을 삭제할까요?")) return;
    const supabase = createClient();
    await supabase.from("documents").delete().eq("id", id);
  }

  async function requestDraft(id: string) {
    setDraftingId(id);
    const res = await fetch("/api/ai/document-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    setDraftingId(null);
    if (!res.ok) {
      alert(data.error || "초안을 만들지 못했습니다.");
      return;
    }
    setExpandedId(id);
  }

  const needAttention = items.filter((d) => d.status === "필요" || d.status === "만료임박");
  const others = items.filter((d) => d.status !== "필요" && d.status !== "만료임박");

  function renderRow(d: SchoolDocument) {
    const expanded = expandedId === d.id;
    return (
      <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{d.name}</span>
              {d.category && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {d.category}
                </span>
              )}
            </div>
            {d.notes && <p className="mt-1 text-xs text-slate-500">{d.notes}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={d.status}
              onChange={(e) => updateStatus(d.id, e.target.value as SchoolDocument["status"])}
              className={`rounded-lg border px-2 py-1 text-xs font-semibold ${STATUS_STYLE[d.status]}`}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={() => deleteDocument(d.id)}
              className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              삭제
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => requestDraft(d.id)}
            disabled={draftingId === d.id}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {draftingId === d.id ? "AI가 작성 중..." : d.ai_draft ? "AI 초안 다시 만들기" : "AI 초안 만들기"}
          </button>
          {d.ai_draft && (
            <button
              onClick={() => setExpandedId(expanded ? null : d.id)}
              className="text-xs font-semibold text-blue-600"
            >
              {expanded ? "초안 접기 ‹" : "초안 보기 ›"}
            </button>
          )}
        </div>

        {expanded && d.ai_draft && (
          <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            {d.ai_draft}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">서류함</h1>
      <p className="mb-4 text-xs text-slate-500">
        학교 운영에 필요한 서류를 정리하고 상태를 관리합니다. &quot;AI 서류 추천받기&quot;를
        누르면 GIA 같은 대안교육기관이 갖추면 좋은 서류를 AI가 찾아서 목록에 추가하고,
        각 서류의 &quot;AI 초안 만들기&quot;를 누르면 바로 다듬어 쓸 수 있는 초안을 만들어줍니다
        (실제 수치·인명 등은 [ ] 표시된 자리에 직접 채워주세요).
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          onClick={requestRecommend}
          disabled={recommending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {recommending ? "AI가 찾는 중..." : "✨ AI 서류 추천받기"}
        </button>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {showForm ? "닫기" : "+ 직접 추가"}
        </button>
        {recommendMsg && <span className="text-xs text-slate-500">{recommendMsg}</span>}
      </div>

      {showForm && (
        <form
          onSubmit={addDocument}
          className="mb-6 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="서류명 - 예: 개인정보처리방침"
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            type="text"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="분류 - 예: 개인정보"
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="메모(선택)"
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "추가"}
          </button>
        </form>
      )}

      <div className="mb-2 text-xs font-semibold text-slate-400">
        신경 써야 할 서류 ({needAttention.length})
      </div>
      <div className="mb-6 flex flex-col gap-2">
        {needAttention.length === 0 ? (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">없습니다.</div>
        ) : (
          needAttention.map(renderRow)
        )}
      </div>

      {others.length > 0 && (
        <>
          <div className="mb-2 text-xs font-semibold text-slate-400">그 외 ({others.length})</div>
          <div className="flex flex-col gap-2">{others.map(renderRow)}</div>
        </>
      )}

      {items.length === 0 && (
        <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
          아직 등록된 서류가 없습니다. &quot;AI 서류 추천받기&quot;로 시작해보세요.
        </div>
      )}
    </div>
  );
}
