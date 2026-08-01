"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import type { Incident, Term } from "@/lib/types";
import AiSourcePanel from "@/components/ai/AiSourcePanel";

type FormState = {
  date: string;
  title: string;
  detail: string;
  good: string;
  lack: string;
  suggest: string;
  owner: string;
  students: string;
  manual_cat: string;
  status: string;
};

function emptyForm(ownerDefault: string): FormState {
  return {
    date: new Date().toISOString().slice(0, 10),
    title: "",
    detail: "",
    good: "",
    lack: "",
    suggest: "",
    owner: ownerDefault,
    students: "",
    manual_cat: "",
    status: "",
  };
}

function oneLine(text: string, maxLen = 40) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

// 왼쪽(목록) · 가운데(입력폼, 항상 표시) · 오른쪽(AI 제안) 3단 레이아웃입니다. 사건기록 →
// 제안함 → 채택예정을 오가지 않고, 새 사건을 적으면 바로 옆에서 AI 제안이 나타나 승인/발행까지
// 한 화면에서 끝낼 수 있습니다.
export default function IncidentsClient({
  initialItems,
  currentTerm,
  currentUserEmail,
}: {
  initialItems: Incident[];
  currentTerm: Term | null;
  currentUserEmail: string;
}) {
  const [items, setItems] = useRealtimeTable<Incident>("incidents", initialItems);
  const [form, setForm] = useState<FormState>(emptyForm(currentUserEmail));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSavedMsg, setJustSavedMsg] = useState("");
  const [filling, setFilling] = useState(false);

  function startNew() {
    setEditingId(null);
    setForm(emptyForm(currentUserEmail));
    setError("");
    setJustSavedMsg("");
  }

  async function fillFromDetail() {
    if (!form.detail.trim()) {
      setError("먼저 상세 내용(경위)을 입력해주세요.");
      return;
    }
    setFilling(true);
    setError("");
    const res = await fetch("/api/ai/fill-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ detail: form.detail, currentTitle: form.title }),
    });
    const data = await res.json();
    setFilling(false);
    if (!res.ok) {
      setError(data.error || "자동 채우기에 실패했습니다.");
      return;
    }
    const result = data.result as { date: string; title: string; good: string; lack: string; suggest: string };
    setForm((f) => ({
      ...f,
      date: result.date || f.date,
      title: result.title || f.title,
      good: result.good || f.good,
      lack: result.lack || f.lack,
      suggest: result.suggest || f.suggest,
    }));
  }

  function startEdit(it: Incident) {
    setEditingId(it.id);
    setForm({
      date: it.date,
      title: it.title,
      detail: it.detail ?? "",
      good: it.good ?? "",
      lack: it.lack ?? "",
      suggest: it.suggest ?? "",
      owner: it.owner ?? "",
      students: it.students ?? "",
      manual_cat: it.manual_cat ?? "",
      status: it.status ?? "",
    });
    setError("");
    setJustSavedMsg("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    setJustSavedMsg("");
    const supabase = createClient();

    if (editingId) {
      const { data, error: err } = await supabase
        .from("incidents")
        .update({ ...form })
        .eq("id", editingId)
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => prev.map((it) => (it.id === editingId ? (data as Incident) : it)));
        setJustSavedMsg("수정되었습니다.");
      }
    } else {
      const { data, error: err } = await supabase
        .from("incidents")
        .insert({ ...form, case_id: genCaseId("INC"), term_id: currentTerm?.id ?? null })
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        const saved = data as Incident;
        setItems((prev) => [saved, ...prev]);
        startNew();
        setJustSavedMsg("저장되었습니다. 오른쪽에 AI 제안이 곧 나타납니다.");
        // 저장 직후 바로 이 건에 대해서만 AI 분석을 실행해, 5건 단위 일괄 분석을 기다리지 않고
        // 오른쪽 패널에 즉시 제안이 뜨도록 합니다.
        fetch("/api/ai/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "incidents", id: saved.id }),
        }).catch(() => {});
      }
    }
    setSaving(false);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_340px] lg:items-start">
      {/* 왼쪽: 목록 */}
      <div className="order-2 flex flex-col gap-2 lg:order-1">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-bold text-slate-700">사건 ({items.length}건)</h1>
          <button
            onClick={startNew}
            className="rounded-lg bg-gia-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-gia-navy-2"
          >
            + 새 사건
          </button>
        </div>
        <div className="flex max-h-[75vh] flex-col gap-1.5 overflow-y-auto lg:max-h-[calc(100vh-8rem)]">
          {items.length === 0 && (
            <div className="rounded-lg bg-white p-3 text-xs text-slate-400 shadow-sm">등록된 사건이 없습니다.</div>
          )}
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => startEdit(it)}
              className={
                "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left shadow-sm transition " +
                (editingId === it.id
                  ? "border-gia-navy bg-gia-gold-soft/20"
                  : "border-slate-200 bg-white hover:border-slate-300")
              }
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{oneLine(it.title)}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{it.date}</span>
              </div>
              {it.status && (
                <span className="w-fit rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {it.status}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 가운데: 입력폼 (항상 표시) */}
      <div className="order-1 lg:order-2">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">{editingId ? "사건 수정" : "새 사건 입력"}</h2>
            {editingId && (
              <button
                type="button"
                onClick={startNew}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                새로 작성하기
              </button>
            )}
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
              담당자
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            제목
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="예: 현장학습 중 학생 경미한 부상"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            <div className="flex items-center justify-between">
              <span>상세 내용(경위) - 두서없이 메모하듯 써도 됩니다</span>
              <button
                type="button"
                onClick={fillFromDetail}
                disabled={filling || !form.detail.trim()}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {filling ? "채우는 중..." : "🧹 AI로 채우기"}
              </button>
            </div>
            <textarea
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              rows={3}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <p className="-mt-2 text-[11px] text-slate-400">
            위에 상황을 적고 &quot;AI로 채우기&quot;를 누르면 날짜·제목·잘된 점·부족했던 점·보완점을
            AI가 최대한 자동으로 채워줍니다(원문에 없는 내용은 비워둠 - 확인 후 수정하세요).
          </p>
          {[
            ["good", "잘된 점"],
            ["lack", "부족했던 점"],
            ["suggest", "보완점/제안"],
          ].map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-slate-500">
              {label}
              <textarea
                value={form[key as keyof FormState]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                rows={2}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          ))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              관련 학생 이름(쉼표 구분)
              <input
                type="text"
                value={form.students}
                onChange={(e) => setForm({ ...form, students: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              처리상태
              <input
                type="text"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                placeholder="예: 처리중, 완료"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {justSavedMsg && <p className="text-sm text-emerald-600">{justSavedMsg}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
            >
              {saving ? "저장 중..." : editingId ? "수정 저장" : "저장"}
            </button>
          </div>
        </form>

        {editingId && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            매뉴얼 항목: {items.find((it) => it.id === editingId)?.manual_cat || "(아직 분류 안 됨)"}
          </div>
        )}
      </div>

      {/* 오른쪽: AI 제안 */}
      <div className="order-3">
        <AiSourcePanel source="incidents" scanType="incidents" />
      </div>
    </div>
  );
}
