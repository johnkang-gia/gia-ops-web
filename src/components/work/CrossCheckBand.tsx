"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Who } from "@/components/common/HomonymProvider";
import { kstDateOffset } from "@/lib/kst";
import {
  buildCrossCheck,
  verdictNote,
  type CrossEntry,
  type CrossPickup,
  type CrossRow,
  type CrossSummary,
  type Verdict,
} from "@/lib/attendanceCrossCheck";

/**
 * **보험이 맞았는지 보여주는 띠.**
 *
 * 구글챗 직원방은 토들 수집이 놓칠 때를 대비해 둔 이중 확인입니다. 그런데 두 자료가 서로를
 * 못 찾아서 **보험이 건진 건이 화면에 한 번도 안 나타났습니다.** 실측으로는 구글챗 결석
 * 45건 중 35건이 토들 쪽에 짝이 없었는데, 그 사실을 볼 자리가 없었습니다.
 *
 * **탭을 새로 만들지 않았습니다.** 출결을 보러 온 사람이 이미 열어 둔 [출결내역] 위에
 * 한 줄로 얹습니다 - 화면을 옮겨야 하는 일은 대개 안 하게 되고, 그게 지금 확인대기가
 * 292건까지 쌓인 이유입니다.
 */
const VERDICT_STYLE: Record<Verdict, { chip: string; dot: string; label: string }> = {
  "구글챗에만": { chip: "bg-rose-100 text-rose-700", dot: "bg-rose-500", label: "구글챗에만" },
  "토들은 못 읽음": { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500", label: "토들은 못 읽음" },
  "토들에만": { chip: "bg-sky-100 text-sky-700", dot: "bg-sky-500", label: "토들에만" },
  "양쪽 확인": { chip: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", label: "양쪽 확인" },
};

/**
 * 며칠 전까지 볼 것인가. 학기 전체를 훑으면 오늘 볼 것이 지난 것에 묻힙니다.
 *
 * **앞날은 자릅니다.** 「21~23일 결석합니다」처럼 미리 온 연락도 대조 대상입니다 - 오히려
 * 그런 건이 처리에서 빠지기 쉬우므로 지금 보여주는 것이 맞습니다.
 */
const DAYS = 14;

export default function CrossCheckBand() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CrossRow[]>([]);
  const [summary, setSummary] = useState<CrossSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<Verdict | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const since = kstDateOffset(-DAYS);
    const [eRes, pRes] = await Promise.all([
      supabase
        .from("attendance_entries")
        .select("id, source, student_id, student_name, status, date_from, date_to, state, raw_text, registered_at, created_at")
        .eq("status", "결석")
        .gte("date_to", since),
      supabase
        .from("pickup_requests")
        .select("id, student_id, matched_name, ai_student_name, service_date, received_at, raw_text, summary, status, source_url, is_demo")
        .gte("service_date", since),
    ]);
    // 조용히 넘기면 「대조할 것이 없다」와 「못 읽었다」가 구별되지 않습니다(CLAUDE.md 5).
    if (eRes.error || pRes.error) {
      setError(eRes.error?.message ?? pRes.error?.message ?? "읽지 못했습니다.");
      return;
    }
    setError(null);
    const pickups = ((pRes.data ?? []) as (CrossPickup & { is_demo?: boolean })[]).filter((p) => !p.is_demo);
    const built = buildCrossCheck({ entries: (eRes.data ?? []) as CrossEntry[], pickups, since });
    setRows(built.rows);
    setSummary(built.summary);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 한쪽에서 처리하면 이 띠의 숫자도 따라 움직여야 합니다. 두 표 어느 쪽이 바뀌어도 다시
  // 셉니다 - 필터를 걸면 새로 생기거나 지워지는 줄을 통째로 놓칩니다.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("attendance-cross-check")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_entries" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  if (error) {
    return (
      <div className="mx-2 mb-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700">
        두 창구 대조를 못 읽었습니다: {error}
      </div>
    );
  }
  if (!summary || summary.total === 0) return null;

  const needLook = summary.chatOnly + summary.unreadByToddle + summary.toddleOnly;
  const shown = only ? rows.filter((r) => r.verdict === only) : rows;

  return (
    <div className="mx-2 mb-1 shrink-0 rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        title="토들(학부모)과 구글챗(직원방)이 같은 말을 했는지 맞대어 봅니다"
      >
        <span className="text-[11px] font-bold text-slate-700">🔀 두 창구 대조</span>
        <span className="text-[10px] text-slate-400">최근 {DAYS}일 · 앞날 결석</span>
        <span className="ml-auto flex items-center gap-1">
          <Pill n={summary.both} kind="양쪽 확인" />
          <Pill n={summary.chatOnly} kind="구글챗에만" />
          <Pill n={summary.unreadByToddle} kind="토들은 못 읽음" />
          <Pill n={summary.toddleOnly} kind="토들에만" />
        </span>
        <span className="text-[10px] text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1 px-2.5 py-1.5">
            <Chip active={only === null} onClick={() => setOnly(null)} label={`전체 ${summary.total}`} />
            {(["구글챗에만", "토들은 못 읽음", "토들에만", "양쪽 확인"] as Verdict[]).map((v) => (
              <Chip
                key={v}
                active={only === v}
                onClick={() => setOnly(only === v ? null : v)}
                label={`${VERDICT_STYLE[v].label} ${rows.filter((r) => r.verdict === v).length}`}
              />
            ))}
            {/* **번호 없는 줄은 「한쪽에만」이 아닙니다.** 섞으면 수집기가 멀쩡한데도
                놓치는 것처럼 보입니다. 그래서 따로 적습니다. */}
            {summary.unmatchable > 0 && (
              <span
                className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                title="학생이 정해지지 않아 대조에 넣지 못한 줄입니다. 한쪽에만 있는 것과는 다릅니다."
              >
                못 맞춘 줄 {summary.unmatchable}
              </span>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto border-t border-slate-100">
            {shown.map((r) => {
              const s = VERDICT_STYLE[r.verdict];
              return (
                <div key={r.key + r.verdict} className="border-b border-slate-50 px-2.5 py-1.5 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + s.dot} />
                    <span className="text-[12px] font-semibold text-slate-800">
                      <Who id={r.studentId} name={r.studentName} />
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {r.from}
                      {r.to !== r.from && ` ~ ${r.to}`} · {r.kind}
                    </span>
                    <span className={"rounded px-1 text-[10px] font-bold " + s.chip}>{s.label}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{verdictNote(r.verdict)}</p>
                  <div className="mt-1 grid gap-0.5 text-[10px]">
                    <Line who="토들" hit={r.toddle ?? r.toddleRaw} weak={!r.toddle && !!r.toddleRaw} />
                    <Line who="구글챗" hit={r.chat} weak={false} />
                  </div>
                </div>
              );
            })}
            {shown.length === 0 && <p className="py-6 text-center text-[11px] text-slate-400">해당하는 줄이 없습니다.</p>}
          </div>

          {needLook === 0 && (
            <p className="border-t border-slate-100 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-700">
              최근 {DAYS}일과 앞날 결석은 두 창구가 모두 같은 말을 했습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({ n, kind }: { n: number; kind: Verdict }) {
  if (n === 0) return null;
  return <span className={"rounded px-1 text-[10px] font-bold " + VERDICT_STYLE[kind].chip}>{n}</span>;
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-2 py-0.5 text-[10px] font-bold transition " +
        (active ? "bg-slate-800 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
      }
    >
      {label}
    </button>
  );
}

/**
 * 한 창구의 줄.
 *
 * `weak` 는 **판정이 아니라 원문만 있다**는 뜻입니다. 그냥 붙여 두면 「토들도 결석으로
 * 읽었다」로 오해되므로, 읽지 못했다는 것을 글자로 적습니다.
 */
function Line({ who, hit, weak }: { who: string; hit: { at: string; text: string; state: string; url?: string | null } | null; weak: boolean }) {
  if (!hit) {
    return (
      <div className="flex gap-1.5">
        <span className="w-11 shrink-0 font-semibold text-slate-400">{who}</span>
        <span className="text-slate-400">—</span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 gap-1.5">
      <span className="w-11 shrink-0 font-semibold text-slate-500">{who}</span>
      <span className="w-10 shrink-0 text-slate-400">{hit.at ? hit.at.slice(11, 16) : ""}</span>
      <span className="min-w-0 flex-1 truncate text-slate-600">
        {weak && <span className="mr-1 rounded bg-amber-100 px-1 font-bold text-amber-700">결석으로 못 읽음</span>}
        {hit.text || "(원문이 없습니다)"}
      </span>
      {hit.url && (
        <a
          href={hit.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-bold text-slate-400 hover:text-slate-800"
          title="토들에서 이 대화 열기"
        >
          ↗
        </a>
      )}
    </div>
  );
}
