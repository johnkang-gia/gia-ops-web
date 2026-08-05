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
        <h3 className="mb-2 text-sm font-bold text-slate-800">📝 지난 학기 돌아보기</h3>
        {!prevTerm ? (
          <p className="text-xs text-slate-400">지난 회차 기록이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-emerald-700">잘한 점</p>
              <p className="whitespace-pre-wrap text-xs text-slate-600">{prevTerm.good || "-"}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-red-700">아쉬운 점</p>
              <p className="whitespace-pre-wrap text-xs text-slate-600">{prevTerm.lack || "-"}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="mb-1 text-[11px] font-bold text-blue-700">다음 학기 제안</p>
              <p className="whitespace-pre-wrap text-xs text-slate-600">{prevTerm.suggest || "-"}</p>
            </div>
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
                <div key={`m-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">회의</span>
                  <span className="flex-1 truncate text-slate-700">{row.meeting.content.slice(0, 60) || "(내용 없음)"}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{formatDate(row.meeting.date)}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
