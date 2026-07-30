"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import type { EventRecord } from "@/lib/types";
import type { EventCompareResult } from "@/lib/ai/types";

type FormState = {
  date: string;
  name: string;
  owner: string;
  good: string;
  lack: string;
  suggest: string;
  status: string;
};

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  name: "",
  owner: "",
  good: "",
  lack: "",
  suggest: "",
  status: "",
};

function oneLine(text: string, maxLen = 60) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default function EventsClient({
  initialItems,
}: {
  initialItems: EventRecord[];
}) {
  const [items, setItems] = useRealtimeTable<EventRecord>("events", initialItems);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comparing, setComparing] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<Record<string, EventCompareResult & { recordCount: number }>>({});
  const [compareError, setCompareError] = useState<Record<string, string>>({});

  function startEdit(it: EventRecord) {
    setEditingId(it.id);
    setExpandedId(it.id);
    setForm({
      date: it.date,
      name: it.name,
      owner: it.owner ?? "",
      good: it.good ?? "",
      lack: it.lack ?? "",
      suggest: it.suggest ?? "",
      status: it.status ?? "",
    });
    setShowForm(false);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("행사명을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();

    if (editingId) {
      const { data, error: err } = await supabase
        .from("events")
        .update({ ...form })
        .eq("id", editingId)
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => prev.map((it) => (it.id === editingId ? (data as EventRecord) : it)));
        resetForm();
      }
    } else {
      const { data, error: err } = await supabase
        .from("events")
        .insert({ ...form, case_id: genCaseId("EVT") })
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => [data as EventRecord, ...prev]);
        resetForm();
      }
    }
    setSaving(false);
  }

  async function compareWithPastYears(name: string) {
    setComparing(name);
    setCompareError((prev) => ({ ...prev, [name]: "" }));
    const res = await fetch("/api/ai/compare-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setComparing(null);
    if (!res.ok) {
      setCompareError((prev) => ({ ...prev, [name]: data.error || "비교 리포트를 만들지 못했습니다." }));
      return;
    }
    setCompareResults((prev) => ({ ...prev, [name]: { ...data.result, recordCount: data.recordCount } }));
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">행사 ({items.length}건)</h1>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          {showForm ? "닫기" : "+ 새로 입력"}
        </button>
      </div>

      {(showForm || editingId) && (
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
              작성자
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            행사명
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          {[
            ["good", "좋았던 점"],
            ["lack", "아쉬웠던 점"],
            ["suggest", "개선 제안"],
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
            등록된 행사가 없습니다.
          </div>
        )}
        {items.map((it) => {
          const expanded = expandedId === it.id;
          const sameNameCount = items.filter(
            (o) => o.name.trim().toLowerCase() === it.name.trim().toLowerCase()
          ).length;
          const compareResult = compareResults[it.name];
          const compareErr = compareError[it.name];
          return (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => setExpandedId(expanded ? null : it.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {oneLine(it.name)}
                </span>
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
                      ["작성자", it.owner],
                      ["좋았던 점", it.good],
                      ["아쉬웠던 점", it.lack],
                      ["개선 제안", it.suggest],
                    ]
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label as string}>
                          <dt className="text-xs text-slate-400">{label}</dt>
                          <dd className="whitespace-pre-wrap">{value}</dd>
                        </div>
                      ))}
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => startEdit(it)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      수정
                    </button>
                    {sameNameCount >= 2 && (
                      <button
                        onClick={() => compareWithPastYears(it.name)}
                        disabled={comparing === it.name}
                        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {comparing === it.name ? "AI가 비교하는 중..." : "📊 연도별 비교 리포트"}
                      </button>
                    )}
                  </div>

                  {compareErr && <p className="mt-2 text-xs text-red-600">{compareErr}</p>}

                  {compareResult && (
                    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
                      <div className="mb-2 font-semibold text-blue-800">
                        &quot;{it.name}&quot; 과거 기록 {compareResult.recordCount}건 비교
                      </div>
                      {compareResult.improvements?.length > 0 && (
                        <div className="mb-2">
                          <div className="font-semibold text-blue-700">✅ 개선된 점</div>
                          {compareResult.improvements.map((line, i) => (
                            <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                          ))}
                        </div>
                      )}
                      {compareResult.recurringIssues?.length > 0 && (
                        <div className="mb-2">
                          <div className="font-semibold text-amber-700">⚠️ 반복되는 문제</div>
                          {compareResult.recurringIssues.map((line, i) => (
                            <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                          ))}
                        </div>
                      )}
                      {compareResult.recommendation && (
                        <div>
                          <div className="font-semibold text-blue-700">💡 다음 행사 제안</div>
                          <p className="whitespace-pre-wrap text-slate-600">{compareResult.recommendation}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
