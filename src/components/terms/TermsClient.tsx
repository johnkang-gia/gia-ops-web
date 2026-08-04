"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import type { Term } from "@/lib/types";
import type { EventCompareResult } from "@/lib/ai/types";
import PhotoUploader from "@/components/common/PhotoUploader";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📅 학기 · 캠프란?",
    lines: [
      "연도/학기(또는 캠프) 단위로 기간을 등록·관리합니다. 진행중으로 설정된 학기는 위클리 리포트, 사건/회의 기록 등 앱 전체의 \"현재 학기\" 기준이 됩니다.",
      "학기별로 그동안 쌓인 사건/회의 기록을 모아볼 수 있고, AI로 지난 학기와 비교할 수 있습니다.",
    ],
  },
];

const TERM_TYPES = ["1학기", "2학기", "3학기", "여름캠프1", "여름캠프2", "겨울캠프1", "겨울캠프2"];
const PAGE_SIZE = 10;

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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherChoice, setSwitcherChoice] = useState("");
  const [switcherYear, setSwitcherYear] = useState(String(new Date().getFullYear()));
  const [switching, setSwitching] = useState(false);

  const occurrences = items
    .filter((it) => it.term_type === selectedType)
    .sort((a, b) => b.year.localeCompare(a.year));

  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => occurrences.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [occurrences, page]
  );
  const totalPages = Math.max(1, Math.ceil(occurrences.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [selectedType]);

  // 홈/사이드바에서 쓰는 getCurrentTerm()과 같은 기준(진행중 중 시작일이 가장 최근인 것, 없으면
  // 등록일 최신)으로 "현재 학기"를 골라 화면 맨 위에 보여줍니다.
  const currentActive = useMemo(() => {
    const active = items.filter((it) => it.status === "진행중");
    if (!active.length) return null;
    return [...active].sort((a, b) => {
      if (a.start_date && b.start_date && a.start_date !== b.start_date) {
        return b.start_date.localeCompare(a.start_date);
      }
      if (a.start_date && !b.start_date) return -1;
      if (!a.start_date && b.start_date) return 1;
      return b.created_at.localeCompare(a.created_at);
    })[0];
  }, [items]);

  const CURRENT_YEAR = String(new Date().getFullYear());
  // 연도 선택지: 작년~내년을 기본으로 주고, 이미 기록이 있는 연도가 그 범위 밖이면 추가합니다.
  const yearChoices = useMemo(() => {
    const base = [String(Number(CURRENT_YEAR) - 1), CURRENT_YEAR, String(Number(CURRENT_YEAR) + 1)];
    const used = [...new Set(items.map((it) => it.year))];
    const merged = [...new Set([...base, ...used])];
    return merged.sort((a, b) => a.localeCompare(b));
  }, [items, CURRENT_YEAR]);

  // 선택지는 실제로 저장된 회차가 아니라 항상 존재하는 7개 학기/캠프 종류(+커스텀으로 추가된
  // 종류)를 그대로 보여줍니다. 선택한 연도에 아직 회차 기록이 없어도 선택할 수 있어야 하기 때문에,
  // 저장된 occurrence 목록(items)이 아니라 allTypes를 기준으로 만듭니다.
  const switcherOptions = useMemo(
    () =>
      allTypes.map((t) => ({
        type: t,
        existing: items.find((it) => it.term_type === t && it.year === switcherYear) ?? null,
      })),
    [allTypes, items, switcherYear]
  );

  // 선택한 연도·학기/캠프 종류를 "진행중"으로 설정합니다. 이미 그 종류/연도의 기록이 있으면
  // 상태만 바꾸고, 없으면 새로 만듭니다(비어있던 선택창에서 바로 시작할 수 있게).
  async function setCurrentTermType(termType: string, year: string) {
    setSwitching(true);
    const supabase = createClient();
    const existing = items.find((it) => it.term_type === termType && it.year === year);
    const others = items.filter(
      (it) => it.status === "진행중" && (!existing || it.id !== existing.id)
    );
    await Promise.all(others.map((it) => supabase.from("terms").update({ status: "종료" }).eq("id", it.id)));

    if (existing) {
      await supabase.from("terms").update({ status: "진행중" }).eq("id", existing.id);
      setItems((prev) =>
        prev.map((it) => {
          if (it.id === existing.id) return { ...it, status: "진행중" };
          if (others.some((o) => o.id === it.id)) return { ...it, status: "종료" };
          return it;
        })
      );
    } else {
      const { data } = await supabase
        .from("terms")
        .insert({
          case_id: genCaseId("TRM"),
          term_type: termType,
          year,
          status: "진행중",
          good: "",
          lack: "",
          suggest: "",
        })
        .select()
        .single();
      setItems((prev) => {
        const withOthersEnded = prev.map((it) =>
          others.some((o) => o.id === it.id) ? { ...it, status: "종료" as const } : it
        );
        return data ? [data as Term, ...withOthersEnded] : withOthersEnded;
      });
      setSelectedType(termType);
    }
    setSwitching(false);
    setSwitcherOpen(false);
  }

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
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
    <div className="shrink-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">학기 · 캠프</h1>
        <GuideButton title="학기 · 캠프 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        학기(1~3학기)와 방학 캠프(여름캠프1·2, 겨울캠프1·2)는 매년 반복됩니다. 학기가 진행되는
        동안 나온 회의록 내용은 회의록 AI 분류를 통해 해당 학기의 개선 제안란에 자동으로
        누적되고, 다음 같은 학기나 다음 연도가 되었을 때 참고할 수 있습니다.
      </p>

      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-blue-700">현재 학기</div>
          <button
            onClick={() => {
              setSwitcherOpen((v) => !v);
              setSwitcherChoice(currentActive?.term_type ?? "");
              setSwitcherYear(currentActive?.year ?? CURRENT_YEAR);
            }}
            className="rounded-lg border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            {switcherOpen ? "닫기" : currentActive ? "변경" : "설정하기"}
          </button>
        </div>
        {currentActive ? (
          <div className="text-sm font-bold text-blue-900">
            {currentActive.year} {currentActive.term_type}
          </div>
        ) : (
          <div className="text-sm text-blue-700">설정된 진행중 학기가 없습니다.</div>
        )}
        {switcherOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-blue-200 pt-3">
            <select
              value={switcherYear}
              onChange={(e) => setSwitcherYear(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {yearChoices.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select
              value={switcherChoice}
              onChange={(e) => setSwitcherChoice(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">학기/캠프 종류 선택</option>
              {switcherOptions.map(({ type, existing }) => (
                <option key={type} value={type}>
                  {type}
                  {existing?.status === "진행중" ? " · 현재 진행중" : existing ? " · 기존 기록 있음" : " · 새로 시작"}
                </option>
              ))}
            </select>
            <button
              onClick={() => switcherChoice && setCurrentTermType(switcherChoice, switcherYear)}
              disabled={!switcherChoice || switching}
              className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
            >
              {switching ? "전환 중..." : `${switcherYear} ${switcherChoice || ""} 로 전환`}
            </button>
            <p className="w-full text-[11px] text-blue-600">
              연도와 학기/캠프 종류를 선택하세요. 선택한 연도에 해당 종류의 기록이 없으면 새로
              만들어서 바로 진행중으로 설정합니다. 전환하면 기존에 진행중이던 학기는 자동으로
              종료 처리되고, 그 이후 새로 작성되는 사건·회의 기록이 새 학기로 연결됩니다.
            </p>
          </div>
        )}
      </div>

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
                ? "border-gia-navy bg-gia-navy text-white"
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
              className="rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
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
    </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2">
          {occurrences.length === 0 && (
            <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
              &quot;{selectedType}&quot; 기록이 아직 없습니다.
            </div>
          )}
          {pageItems.map((it) => (
            <TermOccurrenceCard
              key={it.id}
              item={it}
              onEdit={() => startEdit(it)}
              onPhotosChange={(p) => updatePhotos(it.id, p)}
            />
          ))}
        </div>
      </div>
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}

function oneLineRecord(text: string, maxLen = 50) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
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
  const [linkedIncidents, setLinkedIncidents] = useState<{ id: string; date: string; title: string }[] | null>(null);
  const [linkedMeetings, setLinkedMeetings] = useState<{ id: string; date: string; content: string }[] | null>(null);
  const [loadingLinked, setLoadingLinked] = useState(false);

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && linkedIncidents === null) {
      setLoadingLinked(true);
      const supabase = createClient();
      const [inc, mtg] = await Promise.all([
        supabase.from("incidents").select("id, date, title").eq("term_id", item.id).order("date", { ascending: false }),
        supabase.from("meetings").select("id, date, content").eq("term_id", item.id).order("date", { ascending: false }),
      ]);
      setLinkedIncidents(inc.data ?? []);
      setLinkedMeetings(mtg.data ?? []);
      setLoadingLinked(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button onClick={toggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
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

          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-xs font-semibold text-slate-500">
              이 기간에 쌓인 기록 {loadingLinked ? "" : `(사건 ${linkedIncidents?.length ?? 0}건 · 회의 ${linkedMeetings?.length ?? 0}건)`}
            </div>
            {loadingLinked && <p className="text-xs text-slate-400">불러오는 중...</p>}
            {!loadingLinked && (linkedIncidents?.length ?? 0) === 0 && (linkedMeetings?.length ?? 0) === 0 && (
              <p className="text-xs text-slate-400">
                아직 이 학기로 분류된 사건·회의 기록이 없습니다(진행중 상태일 때 새로 작성하는 기록부터 자동으로 연결됩니다).
              </p>
            )}
            <div className="flex flex-col gap-1">
              {linkedIncidents?.map((it) => (
                <Link
                  key={`inc-${it.id}`}
                  href="/records"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50"
                >
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">📋 사건</span>
                  <span className="min-w-0 flex-1 truncate">{oneLineRecord(it.title)}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{it.date}</span>
                </Link>
              ))}
              {linkedMeetings?.map((it) => (
                <Link
                  key={`mtg-${it.id}`}
                  href="/meetings"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50"
                >
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">💬 회의</span>
                  <span className="min-w-0 flex-1 truncate">{oneLineRecord(it.content)}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{it.date}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
