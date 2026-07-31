"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import type { EventRecord } from "@/lib/types";
import type { EventCompareResult } from "@/lib/ai/types";
import PhotoUploader from "@/components/common/PhotoUploader";

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

export default function EventsClient({ initialItems }: { initialItems: EventRecord[] }) {
  const [items, setItems] = useRealtimeTable<EventRecord>("events", initialItems);
  const [topTab, setTopTab] = useState<"regular" | "adhoc">("regular");

  const regularItems = items.filter((it) => it.kind === "regular");
  const adhocItems = items.filter((it) => it.kind === "adhoc");

  async function updatePhotos(id: string, photo_paths: string[]) {
    const supabase = createClient();
    await supabase.from("events").update({ photo_paths }).eq("id", id);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-bold">행사기록</h1>
      <p className="mb-4 text-xs text-slate-500">
        매년/주기적으로 반복되는 행사(정규행사)는 이름별로 묶어서 이력을 쌓고 AI로 지난 회차와
        비교해 다음 행사를 더 잘 준비할 수 있습니다. 한 번만 진행하는 행사(일시적행사)는 &quot;이런
        행사가 있었다&quot; 정도로만 가볍게 기록해두면, 몇 년 뒤 비슷한 행사를 할 때 참고할 수
        있습니다.
      </p>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTopTab("regular")}
          className={
            "border-b-2 px-3 py-2 text-sm font-semibold transition " +
            (topTab === "regular"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-400 hover:text-slate-600")
          }
        >
          🎯 정규행사 ({regularItems.length})
        </button>
        <button
          onClick={() => setTopTab("adhoc")}
          className={
            "border-b-2 px-3 py-2 text-sm font-semibold transition " +
            (topTab === "adhoc"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-400 hover:text-slate-600")
          }
        >
          📌 일시적행사 ({adhocItems.length})
        </button>
      </div>

      {topTab === "regular" ? (
        <RegularEventsSection items={regularItems} setItems={setItems} updatePhotos={updatePhotos} />
      ) : (
        <AdhocEventsSection items={adhocItems} setItems={setItems} updatePhotos={updatePhotos} />
      )}
    </div>
  );
}

function RegularEventsSection({
  items,
  setItems,
  updatePhotos,
}: {
  items: EventRecord[];
  setItems: React.Dispatch<React.SetStateAction<EventRecord[]>>;
  updatePhotos: (id: string, paths: string[]) => Promise<void>;
}) {
  const names = useMemo(
    () => [...new Set(items.map((it) => it.name.trim()))].sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const [selectedName, setSelectedName] = useState<string | null>(names[0] ?? null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<(EventCompareResult & { recordCount: number }) | null>(null);
  const [compareError, setCompareError] = useState("");

  const effectiveSelected = selectedName ?? names[0] ?? null;
  const occurrences = items
    .filter((it) => it.name.trim() === effectiveSelected)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  function startAdd() {
    setForm({ ...EMPTY_FORM, name: effectiveSelected || "" });
    setEditingId(null);
    setShowForm(true);
  }

  function startNewSeries() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setSelectedName(null);
  }

  function startEdit(it: EventRecord) {
    setEditingId(it.id);
    setForm({
      date: it.date,
      name: it.name,
      owner: it.owner ?? "",
      good: it.good ?? "",
      lack: it.lack ?? "",
      suggest: it.suggest ?? "",
      status: it.status ?? "",
    });
    setShowForm(true);
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
        .insert({ ...form, kind: "regular", case_id: genCaseId("EVT") })
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => [data as EventRecord, ...prev]);
        setSelectedName(form.name.trim());
        resetForm();
      }
    }
    setSaving(false);
  }

  async function compareWithPastYears() {
    if (!effectiveSelected) return;
    setComparing(true);
    setCompareError("");
    const res = await fetch("/api/ai/compare-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: effectiveSelected }),
    });
    const data = await res.json();
    setComparing(false);
    if (!res.ok) {
      setCompareError(data.error || "비교 리포트를 만들지 못했습니다.");
      return;
    }
    setCompareResult({ ...data.result, recordCount: data.recordCount });
  }

  if (names.length === 0 && !showForm) {
    return (
      <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
        아직 등록된 정규행사가 없습니다.
        <button
          onClick={startNewSeries}
          className="ml-2 font-semibold text-blue-600 underline"
        >
          + 첫 정규행사 추가하기
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {names.map((n) => (
          <button
            key={n}
            onClick={() => {
              setSelectedName(n);
              setCompareResult(null);
              setCompareError("");
            }}
            className={
              "rounded-full border px-3 py-1 text-xs font-semibold transition " +
              (n === effectiveSelected
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 text-slate-600 hover:bg-slate-50")
            }
          >
            {n}
          </button>
        ))}
        <button
          onClick={startNewSeries}
          className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
        >
          + 새 정규행사
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{effectiveSelected}</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={startAdd}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            + 이번 회차 기록 추가
          </button>
          {occurrences.length >= 2 && (
            <button
              onClick={compareWithPastYears}
              disabled={comparing}
              className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            >
              {comparing ? "AI가 비교하는 중..." : "📊 연도별 비교 리포트"}
            </button>
          )}
        </div>
      </div>

      {compareError && <p className="mb-2 text-xs text-red-600">{compareError}</p>}
      {compareResult && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
          <div className="mb-2 font-semibold text-blue-800">
            &quot;{effectiveSelected}&quot; 과거 기록 {compareResult.recordCount}건 비교
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

      {showForm && (
        <EventForm
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onCancel={resetForm}
          saving={saving}
          error={error}
        />
      )}

      <div className="flex flex-col gap-2">
        {occurrences.map((it) => (
          <EventOccurrenceCard key={it.id} item={it} onEdit={() => startEdit(it)} onPhotosChange={(p) => updatePhotos(it.id, p)} />
        ))}
      </div>
    </div>
  );
}

function AdhocEventsSection({
  items,
  setItems,
  updatePhotos,
}: {
  items: EventRecord[];
  setItems: React.Dispatch<React.SetStateAction<EventRecord[]>>;
  updatePhotos: (id: string, paths: string[]) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sorted = [...items].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  function startEdit(it: EventRecord) {
    setEditingId(it.id);
    setExpandedId(it.id);
    setForm({
      date: it.date,
      name: it.name,
      owner: it.owner ?? "",
      good: it.good ?? "",
      lack: "",
      suggest: "",
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
    const payload = { date: form.date, name: form.name, owner: form.owner, good: form.good, status: form.status };

    if (editingId) {
      const { data, error: err } = await supabase
        .from("events")
        .update(payload)
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
        .insert({ ...payload, kind: "adhoc", case_id: genCaseId("EVT") })
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          {showForm ? "닫기" : "+ 새로 기록"}
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
            행사명
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            어떤 행사였는지 간단히 기록(형식 없이 자유롭게)
            <textarea
              value={form.good}
              onChange={(e) => setForm({ ...form, good: e.target.value })}
              rows={3}
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
        {sorted.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
            등록된 일시적행사가 없습니다.
          </div>
        )}
        {sorted.map((it) => {
          const expanded = expandedId === it.id;
          return (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => setExpandedId(expanded ? null : it.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{oneLine(it.name)}</span>
                <span className="shrink-0 text-xs text-slate-400">{it.date}</span>
                <span className="shrink-0 text-xs font-bold text-blue-600">
                  {expanded ? "접기 ‹" : "더보기 ›"}
                </span>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 px-4 py-3 text-sm">
                  {it.owner && <p className="mb-1 text-xs text-slate-400">담당자: {it.owner}</p>}
                  {it.good && <p className="mb-3 whitespace-pre-wrap">{it.good}</p>}
                  <PhotoUploader
                    paths={it.photo_paths ?? []}
                    onChange={(p) => updatePhotos(it.id, p)}
                    folder={`adhoc/${it.id}`}
                  />
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

function EventForm({
  form,
  setForm,
  onSubmit,
  onCancel,
  saving,
  error,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  return (
    <form onSubmit={onSubmit} className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
        행사명(매번 같은 이름을 써야 같은 정규행사로 묶입니다)
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
        ["suggest", "개선 제안(다음 회차를 위한 제안)"],
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
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          취소
        </button>
      </div>
    </form>
  );
}

function EventOccurrenceCard({
  item,
  onEdit,
  onPhotosChange,
}: {
  item: EventRecord;
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
        <span className="shrink-0 text-xs font-semibold text-slate-500">{item.date}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{oneLine(item.suggest || item.good || "", 50)}</span>
        {item.status && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{item.status}</span>
        )}
        <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm">
          <dl className="mb-3 flex flex-col gap-2">
            {[
              ["담당자", item.owner],
              ["좋았던 점", item.good],
              ["아쉬웠던 점", item.lack],
              ["개선 제안", item.suggest],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-slate-400">{label}</dt>
                  <dd className="whitespace-pre-wrap">{value}</dd>
                </div>
              ))}
          </dl>
          <PhotoUploader paths={item.photo_paths ?? []} onChange={onPhotosChange} folder={`regular/${item.id}`} />
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
