"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TERM_TYPES } from "@/lib/termTypes";
import type { Term, Task, Meeting, FormSubmission } from "@/lib/types";

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// 신청서 기록은 개별 응답자(행) 단위라 그대로 나열하면 너무 많아지므로, 연도별 → 목적별로
// 묶어서 "몇 건 들어왔는지"와 "언제 마지막으로 가져왔는지"만 요약해서 보여줍니다.
type SubmissionSummary = { year: string; purpose: string; count: number; lastImportedAt: string };

type AiResult = {
  summary?: string;
  strengths?: string[];
  improvements?: string[];
  checklist?: string[];
  otherSchools?: { idea?: string; detail?: string; source?: string }[];
};

function summarizeByYear(subs: FormSubmission[]): [string, SubmissionSummary[]][] {
  const byKey = new Map<string, SubmissionSummary>();
  for (const s of subs) {
    const key = `${s.year || "연도 미상"}__${s.purpose || "(목적 미기재)"}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (s.imported_at > existing.lastImportedAt) existing.lastImportedAt = s.imported_at;
    } else {
      byKey.set(key, { year: s.year || "연도 미상", purpose: s.purpose || "(목적 미기재)", count: 1, lastImportedAt: s.imported_at });
    }
  }
  const byYear = new Map<string, SubmissionSummary[]>();
  for (const summary of byKey.values()) {
    if (!byYear.has(summary.year)) byYear.set(summary.year, []);
    byYear.get(summary.year)!.push(summary);
  }
  return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export default function TermPrepClient({ defaultYear, defaultTermType }: { defaultYear: string; defaultTermType: string }) {
  const [year, setYear] = useState(defaultYear);
  const [termType, setTermType] = useState(defaultTermType);
  const [customTermType, setCustomTermType] = useState(!TERM_TYPES.includes(defaultTermType));

  const [loading, setLoading] = useState(false);
  const [terms, setTerms] = useState<Term[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  // 돌아보기 편집(요청 ⑧: 잘된점/개선점/제안을 화면에서 직접 작성·수정→terms 저장)
  const [editing, setEditing] = useState(false);
  const [editGood, setEditGood] = useState("");
  const [editLack, setEditLack] = useState("");
  const [editSuggest, setEditSuggest] = useState("");
  const [savingRef, setSavingRef] = useState(false);

  // 회의록 펼치기
  const [expandedMeetings, setExpandedMeetings] = useState<Set<string>>(new Set());

  // AI 분석·타 학교 참고 제안
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiResult | null>(null);

  useEffect(() => {
    if (!termType.trim()) return;
    let cancelled = false;
    setLoading(true);

    async function load() {
      const supabase = createClient();

      // ① 같은 term_type의 학기 기록 전체(연도 무관) - 지난 회차의 good/lack/suggest를
      // 보여주기 위함입니다. 진행중인 화면 기준 학기와 달리, 여기서는 "선택한 연도 이전"에
      // 가장 가까운 회차를 지난 학기로 봅니다.
      const { data: termsData } = await supabase
        .from("terms")
        .select("*")
        .eq("term_type", termType.trim())
        .order("year", { ascending: false });

      // ② 같은 term_type의 신청서(구글폼) 가져오기 기록 - 연도 무관, 최근순.
      const { data: subsData } = await supabase
        .from("form_submissions")
        .select("*")
        .eq("term_type", termType.trim())
        .order("imported_at", { ascending: false })
        .limit(200);

      if (cancelled) return;
      const allTerms = (termsData as Term[] | null) ?? [];
      const allSubs = (subsData as FormSubmission[] | null) ?? [];
      setTerms(allTerms);
      setSubmissions(allSubs);

      // ③ 지난 회차(선택한 연도보다 이전 연도 중 가장 최근)의 term_id로 업무/회의 타임라인을
      // 가져옵니다(요청 답변: "신청서 + 업무/회의록 타임라인 (추천)") - "몇일전에 어떤 준비를
      // 했는지"를 그 학기 기간에 등록된 업무/회의로 보여줍니다.
      const prevTerm = allTerms.find((t) => t.year < year.trim()) ?? allTerms.find((t) => t.year !== year.trim()) ?? null;
      if (prevTerm) {
        const [{ data: tasksData }, { data: meetingsData }] = await Promise.all([
          supabase.from("tasks").select("*").eq("term_id", prevTerm.id).is("deleted_at", null).order("created_at", { ascending: true }),
          supabase.from("meetings").select("*").eq("term_id", prevTerm.id).order("date", { ascending: true }),
        ]);
        if (cancelled) return;
        setTasks((tasksData as Task[] | null) ?? []);
        setMeetings((meetingsData as Meeting[] | null) ?? []);
      } else {
        setTasks([]);
        setMeetings([]);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [year, termType]);

  const prevTerm = terms.find((t) => t.year < year.trim()) ?? terms.find((t) => t.year !== year.trim()) ?? null;
  const submissionsByYear = summarizeByYear(submissions);
  const timeline = [
    ...tasks.map((t) => ({ kind: "task" as const, at: t.created_at, task: t })),
    ...meetings.map((m) => ({ kind: "meeting" as const, at: m.date, meeting: m })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  function startEdit() {
    if (!prevTerm) return;
    setEditGood(prevTerm.good ?? "");
    setEditLack(prevTerm.lack ?? "");
    setEditSuggest(prevTerm.suggest ?? "");
    setEditing(true);
  }
  async function saveEdit() {
    if (!prevTerm) return;
    setSavingRef(true);
    const supabase = createClient();
    const patch = { good: editGood.trim() || null, lack: editLack.trim() || null, suggest: editSuggest.trim() || null };
    const { error } = await supabase.from("terms").update(patch).eq("id", prevTerm.id);
    setSavingRef(false);
    if (!error) {
      setTerms((prev) => prev.map((t) => (t.id === prevTerm.id ? { ...t, ...patch } : t)));
      setEditing(false);
    }
  }

  function toggleMeeting(id: string) {
    setExpandedMeetings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runAi() {
    setAiLoading(true);
    setAiError(null);
    try {
      const reflections = terms
        .map((t) => ({ year: t.year ?? "", good: t.good ?? "", lack: t.lack ?? "", suggest: t.suggest ?? "" }))
        .filter((r) => r.good || r.lack || r.suggest);
      const res = await fetch("/api/term-prep/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termType: termType.trim(),
          year: year.trim(),
          reflections,
          meetings: meetings.map((m) => ({ date: m.date, content: m.content })),
        }),
      });
      const json = (await res.json()) as { result?: AiResult; error?: string };
      if (!res.ok || json.error) throw new Error(json.error || "분석에 실패했습니다.");
      setAi(json.result ?? null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-bold text-slate-600">어떤 학기를 준비하나요? (예: 27년 1학기)</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="연도 (예: 2027)"
            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
          />
          {customTermType ? (
            <input
              value={termType}
              onChange={(e) => setTermType(e.target.value)}
              placeholder="학기/캠프 직접 입력"
              className="w-36 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            />
          ) : (
            <select
              value={termType}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setCustomTermType(true);
                  setTermType("");
                } else {
                  setTermType(e.target.value);
                }
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              {TERM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="__custom__">직접 입력...</option>
            </select>
          )}
          {loading && <span className="text-[11px] text-slate-400">불러오는 중...</span>}
        </div>
        {prevTerm ? (
          <p className="mt-2 text-[11px] text-emerald-600">
            ✓ 참고할 지난 회차를 찾았습니다: {prevTerm.year}년 {prevTerm.term_type} ({formatDate(prevTerm.start_date)} ~ {formatDate(prevTerm.end_date)})
          </p>
        ) : (
          !loading && (
            <p className="mt-2 text-[11px] text-amber-600">
              같은 학기 유형의 지난 기록이 아직 없습니다. 처음 준비하는 학기이거나, 학기 메뉴에 이전 회차가 등록되지 않았을 수 있습니다.
            </p>
          )
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">📝 지난 학기 돌아보기{prevTerm ? ` · ${prevTerm.year}년 ${prevTerm.term_type}` : ""}</h3>
          {prevTerm && !editing && (
            <button onClick={startEdit} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">✏️ 편집</button>
          )}
        </div>
        {!prevTerm ? (
          <p className="text-xs text-slate-400">지난 회차 기록이 없습니다.</p>
        ) : editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-emerald-700">잘한 점</p>
              <textarea value={editGood} onChange={(e) => setEditGood(e.target.value)} rows={5} className="w-full rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs" />
            </div>
            <div className="rounded-lg bg-red-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-red-700">아쉬운 점 · 개선점</p>
              <textarea value={editLack} onChange={(e) => setEditLack(e.target.value)} rows={5} className="w-full rounded-md border border-red-200 bg-white px-2 py-1 text-xs" />
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-blue-700">다음 학기 제안</p>
              <textarea value={editSuggest} onChange={(e) => setEditSuggest(e.target.value)} rows={5} className="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-xs" />
            </div>
            <div className="sm:col-span-3 flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">취소</button>
              <button onClick={saveEdit} disabled={savingRef} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{savingRef ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-emerald-700">잘한 점</p>
              <p className="whitespace-pre-wrap text-xs text-slate-600">{prevTerm.good || "-"}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-red-700">아쉬운 점 · 개선점</p>
              <p className="whitespace-pre-wrap text-xs text-slate-600">{prevTerm.lack || "-"}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-blue-700">다음 학기 제안</p>
              <p className="whitespace-pre-wrap text-xs text-slate-600">{prevTerm.suggest || "-"}</p>
            </div>
          </div>
        )}
      </div>

      {/* AI 분석 · 타 학교 참고 제안(요청 ⑧). 지난 회차 돌아보기·회의록을 근거로 종합 분석과
          타 학교(국제학교·마이크로스쿨 등) 참고 제안을 웹 검색을 곁들여 만들어 줍니다. */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-indigo-800">🤖 AI 분석 · 타 학교 참고 제안</h3>
          <button onClick={runAi} disabled={aiLoading} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            {aiLoading ? "분석 중… (최대 1분)" : ai ? "다시 생성" : "AI 분석·제안 생성"}
          </button>
        </div>
        {aiError && <p className="text-xs text-red-500">{aiError}</p>}
        {!ai && !aiLoading && !aiError && (
          <p className="text-xs text-slate-500">지난 회차 돌아보기와 회의록을 바탕으로 이번 학기 준비 포인트와 타 학교 참고 아이디어를 만들어 드립니다. 위 버튼을 눌러주세요.</p>
        )}
        {aiLoading && <p className="text-xs text-indigo-500">웹에서 타 학교 사례를 찾아보는 중입니다…</p>}
        {ai && (
          <div className="flex flex-col gap-3">
            {ai.summary && <p className="rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-700">{ai.summary}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {ai.strengths && ai.strengths.length > 0 && (
                <div className="rounded-lg bg-emerald-50 p-3">
                  <p className="mb-1 text-[11px] font-bold text-emerald-700">이어갈 강점</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{ai.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {ai.improvements && ai.improvements.length > 0 && (
                <div className="rounded-lg bg-red-50 p-3">
                  <p className="mb-1 text-[11px] font-bold text-red-700">개선·대비할 점</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{ai.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {ai.checklist && ai.checklist.length > 0 && (
                <div className="rounded-lg bg-amber-50 p-3">
                  <p className="mb-1 text-[11px] font-bold text-amber-700">준비 체크리스트</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{ai.checklist.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
            </div>
            {ai.otherSchools && ai.otherSchools.length > 0 && (
              <div className="rounded-lg bg-white p-3">
                <p className="mb-1.5 text-[11px] font-bold text-indigo-700">🏫 타 학교 참고 제안</p>
                <div className="flex flex-col gap-2">
                  {ai.otherSchools.map((o, i) => (
                    <div key={i} className="rounded-md border border-indigo-100 bg-indigo-50/40 p-2 text-xs">
                      <p className="font-semibold text-slate-700">{o.idea}</p>
                      {o.detail && <p className="mt-0.5 text-slate-600">{o.detail}</p>}
                      {o.source && <p className="mt-0.5 text-[10px] text-slate-400">출처: {o.source}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[10px] text-slate-400">AI가 웹 검색을 곁들여 만든 제안입니다. 실제 적용 전에 사실관계와 학교 상황을 확인해주세요.</p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-bold text-slate-800">📋 신청서(구글폼) 기록</h3>
        {submissionsByYear.length === 0 ? (
          <p className="text-xs text-slate-400">
            &quot;{termType}&quot; 학기의 신청서 가져오기 기록이 아직 없습니다. 학교 관리 &gt; 구글시트로 가져오기 &gt; 신청서(학기/행사)
            탭에서 이 학기로 붙여넣으면 여기에 쌓입니다.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {submissionsByYear.map(([y, summaries]) => (
              <div key={y} className="rounded-lg border border-slate-100 p-2.5">
                <p className="mb-1 text-xs font-bold text-slate-600">{y}년</p>
                <div className="flex flex-col gap-1">
                  {summaries.map((s) => (
                    <div key={s.purpose} className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{s.purpose} · {s.count}건</span>
                      <span className="text-slate-400">최근 가져옴 {formatDateTime(s.lastImportedAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-bold text-slate-800">🗂️ 준비 과정 업무·회의 타임라인</h3>
        {!prevTerm ? (
          <p className="text-xs text-slate-400">지난 회차가 없어 타임라인을 만들 수 없습니다.</p>
        ) : timeline.length === 0 ? (
          <p className="text-xs text-slate-400">그 학기 기간에 등록된 업무/회의 기록이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {timeline.map((row, i) =>
              row.kind === "task" ? (
                <div key={`t-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">업무</span>
                  <span className="flex-1 truncate text-slate-700">{row.task.title}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{row.task.status}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{formatDate(row.task.created_at)}</span>
                </div>
              ) : (
                <div key={`m-${i}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <button onClick={() => toggleMeeting(row.meeting.id)} className="flex w-full items-center gap-2 text-left">
                    <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">회의</span>
                    <span className={"flex-1 text-slate-700 " + (expandedMeetings.has(row.meeting.id) ? "" : "truncate")}>
                      {row.meeting.content.slice(0, expandedMeetings.has(row.meeting.id) ? 100000 : 60) || "(내용 없음)"}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{formatDate(row.meeting.date)}</span>
                    <span className="shrink-0 text-[10px] text-purple-300">{expandedMeetings.has(row.meeting.id) ? "▾" : "▸"}</span>
                  </button>
                  {expandedMeetings.has(row.meeting.id) && (
                    <p className="mt-1.5 whitespace-pre-wrap border-t border-slate-200 pt-1.5 text-[11px] leading-relaxed text-slate-600">{row.meeting.content || "(내용 없음)"}</p>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
