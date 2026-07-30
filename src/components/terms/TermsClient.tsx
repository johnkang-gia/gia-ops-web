"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import type { Term } from "@/lib/types";
import type { EventCompareResult } from "@/lib/ai/types";
import PhotoUploader from "@/components/common/PhotoUploader";

const TERM_TYPES = ["1학기", "2학기", "3학기", "여름캠프1", "여름캠프2", "겨울캠프1", "겨울캠프2"];

type FormState = {
  term_type: string;
  year: string;
  start_date: string;
  end_date: string;
  status: "진행중" | "종료";
  good: string;
  lack: string;
  suggest: string;
};

function emptyForm(termType: string): FormState {
  return {
    term_type: termType,
    year: String(new Date().getFullYear()),
    start_date: "",
    end_date: "",
    status: "진행중",
    good: "",
    lack: "",
    suggest: "",
  };
}

export default function TermsClient({ initialItems }: { initialItems: Term[] }) {
  const [items, setItems] = useRealtimeTable<Term>("terms", initialItems);

  const typesInUse = useMemo(
    () => [...new Set(items.map((it) => it.term_type))],
    [items]
  );
  const allTypes = useMemo(() => {
    const merged = [...TERM_TYPES];
    for (const t of typesInUse) if (!merged.includes(t)) merged.push(t);
    return merged;
  }, [typesInUse]);

  const [selectedType, setSelectedType] = useState<string>(
    typesInUse[0] ?? TERM_TYPES[0]
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(selectedType));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<(EventCompareResult & { recordCount: number }) | null>(null);
  const [compareError, setCompareError] = useState("");

  const occurrences = items
    .filter((it) => it.term_type === selectedType)
    .sort((a, b) => b.year.localeCompare(a.year));

  async function updatePhotos(id: string, photo_paths: string[]) {
    const supabase = createClient();
    await supabase.from("terms").update({ photo_paths }).eq("id", id);
  }

  function startAdd() {
    setForm(emptyForm(selectedType));
    setEditingId(null);
    setShowForm(true);
    setCompareResult(null);
    setCompareError("");
  }

  function startEdit(it: Term) {
    setEditingId(it.id);
    setForm({
      term_type: it.term_type,
      year: it.year,
      start_date: it.start_date ?? "",
      end_date: it.end_date ?? "",
      status: it.status,
      good: it.good ?? "",
      lack: it.lack ?? "",
      suggest: it.suggest ?? "",
    });
    setShowForm(true);
  }

  function resetForm() {
    setForm(emptyForm(selectedType));
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.term_type.trim() || !form.year.trim()) {
      setError("학기/캠프 종류와 연도를 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();
    const payload = {
      term_type: form.term_type,
      year: form.year,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      status: form.status,
      good: form.good,
      lack: form.lack,
      suggest: form.suggest,
    };

    if (editingId) {
      const { data, error: err } = await supabase
        .from("terms")
        .update(payload)
        .eq("id", editingId)
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => prev.map((it) => (it.id === editingId ? (data as Term) : it)));
        resetForm();
      }
    } else {
      const { data, error: err } = await supabase
        .from("terms")
        .insert({ ...payload, case_id: genCaseId("TRM") })
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => [data as Term, ...prev]);
        setSelectedType(form.term_type);
        resetForm();
      }
    }
    setSaving(false);
  }

  async function compareWithPastTerms() {
    setComparing(true);
    setCompareError("");
    const res = await fetch("/api/ai/compare-terms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ termType: selectedType }),
    });
    const data = await res.json();
    setComparing(false);
    if (!res.ok) {
      setCompareError(data.error || "비교 리포트를 만들지 못했습니다.");
      return;
    }
    setCompareResult({ ...data.result, recordCount: data.recordCount });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">학기 · 캠프</h1>
      <p className="mb-4 text-xs text-slate-500">
        학기(1~3학기)와 방학 캠프(여름캠프1·2, 겨울캠프1·2)는 매년 반복됩니다. 학기가 진행되는
        동안 나온 회의록 내용은 회의록 AI 분류를 통해 해당 학기의 개선 제안란에 자동으로
        누적되고, 다음 같은 학기나 다음 연도가 되었을 때 참고할 수 있습니다.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {allTypes.map((t) => (
          <button
            key={t}
            onClick={() => {
              setSelectedType(t);
              setCompareResult(null);
              setCompareError("");
              setShowForm(false);
            }}
            className={
              "rounded-full border px-3 py-1 text-xs font-semibold transition " +
              (t === selectedType
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 text-slate-600 hover:bg-slate-50")
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{selectedType}</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={startAdd}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            + 새 회차 기록 추가
          </button>
          {occurrences.length >= 2 && (
            <button
              onClick={compareWithPastTerms}
              disabled={comparing}
              className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            >
              {comparing ? "AI가 비교하는 중..." : "📊 회차별 비교 리포트"}
            </button>
          )}
        </div>
      </div>

      {compareError && <p className="mb-2 text-xs text-red-600">{compareError}</p>}
      {compareResult && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
          <div className="mb-2 font-semibold text-blue-800">
            &quot;{selectedType}&quot; 과거 회차 {compareResult.recordCount}건 비교
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
              <div className="font-semibold text-blue-700">💡 다음 회차 제안</div>
              <p className="whitespace-pre-wrap text-slate-600">{compareResult.recommendation}</p>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              학기/캠프 종류
              <select
                value={form.term_type}
                onChange={(e) => setForm({ ...form, term_type: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                {allTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              연도
              <input
                type="text"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                placeholder="예: 2026"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              시작일
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              종료일
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              상태
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as "진행중" | "종료" })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="진행중">진행중</option>
                <option value="종료">종료</option>
              </select>
            </label>
          </div>
          {[
            ["good", "좋았던 점"],
            ["lack", "아쉬웠던 점"],
            ["suggest", "개선 제안 / 회의록 메모(진행 중 회의에서 나온 내용이 여기 자동으로 쌓입니다)"],
          ].map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-slate-500">
              {label}
              <textarea
                value={form[key as keyof FormState] as string}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                rows={key === "suggest" ? 4 : 2}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          ))}

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
        {occurrences.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
            &quot;{selectedType}&quot; 기록이 아직 없습니다.
          </div>
        )}
        {occurrences.map((it) => (
          <TermOccurrenceCard
            key={it.id}
            item={it}
            onEdit={() => startEdit(it)}
            onPhotosChange={(p) => updatePhotos(it.id, p)}
          />
        ))}
      </div>
    </div>
  );
}

function TermOccurrenceCard({
  item,
  onEdit,
  onPhotosChange,
}: {
  item: Term;
  onEdit: () => void;
  onPhotosChange: (paths: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="shrink-0 text-xs font-semibold text-slate-500">{item.year}</span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {item.start_date ? `${item.start_date} ~ ${item.end_date ?? ""}` : "기간 미입력"}
        </span>
        <span
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-xs " +
            (item.status === "진행중" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")
          }
        >
          {item.status}
        </span>
        <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm">
          <dl className="mb-3 flex flex-col gap-2">
            {[
              ["좋았던 점", item.good],
              ["아쉬웠던 점", item.lack],
              ["개선 제안 / 회의록 메모", item.suggest],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-slate-400">{label}</dt>
                  <dd className="whitespace-pre-wrap">{value}</dd>
                </div>
              ))}
          </dl>
          <PhotoUploader paths={item.photo_paths ?? []} onChange={onPhotosChange} folder={`terms/${item.id}`} />
          <button
            onClick={onEdit}
            className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            수정
          </button>
        </div>
      )}
    </div>
  );
}
