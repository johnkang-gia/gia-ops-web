"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import type { Incident } from "@/lib/types";

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

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  title: "",
  detail: "",
  good: "",
  lack: "",
  suggest: "",
  owner: "",
  students: "",
  manual_cat: "",
  status: "",
};

function oneLine(text: string, maxLen = 60) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default function IncidentsClient({
  initialItems,
}: {
  initialItems: Incident[];
}) {
  const [items, setItems] = useRealtimeTable<Incident>("incidents", initialItems);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function startEdit(it: Incident) {
    setEditingId(it.id);
    setExpandedId(it.id);
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
    if (!form.title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
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
        resetForm();
      }
    } else {
      const { data, error: err } = await supabase
        .from("incidents")
        .insert({ ...form, case_id: genCaseId("INC") })
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => [data as Incident, ...prev]);
        resetForm();
      }
    }
    setSaving(false);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">사건 ({items.length}건)</h1>
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
          {[
            ["detail", "상세 내용(경위)"],
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
            등록된 사건이 없습니다.
          </div>
        )}
        {items.map((it) => {
          const expanded = expandedId === it.id;
          return (
            <div
              key={it.id}
              className="rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <button
                onClick={() => setExpandedId(expanded ? null : it.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {oneLine(it.title)}
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
                      ["담당자", it.owner],
                      ["매뉴얼 항목", it.manual_cat],
                      ["상세 내용", it.detail],
                      ["잘된 점", it.good],
                      ["부족했던 점", it.lack],
                      ["보완점/제안", it.suggest],
                      ["관련 학생", it.students],
                    ]
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label as string}>
                          <dt className="text-xs text-slate-400">{label}</dt>
                          <dd className="whitespace-pre-wrap">{value}</dd>
                        </div>
                      ))}
                  </dl>
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
