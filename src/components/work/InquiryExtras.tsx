"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { kstDateOffset } from "@/lib/kst";
import { BADGE_STYLE, INQUIRY_BADGES, type InquiryBadge, minutesBetween } from "@/lib/inquiryBadges";

/**
 * 오늘의 문의사항 줄에 붙는 도구들 — 최근 이력 · 답장 문구 · 하루 처리 보고.
 *
 * 줄 하나를 펼쳤을 때만 읽습니다. 줄마다 미리 읽어 두면 문의 40건에 조회가 40번 나갑니다.
 */

const timeKst = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const dayKst = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });

type HistRow = {
  id: string;
  received_at: string;
  summary: string | null;
  raw_text: string | null;
  badges: string[] | null;
  kind: string | null;
  status: string | null;
  answered_at: string | null;
  skipped_at?: string | null;
  is_demo?: boolean | null;
};

/**
 * 최근 30일 이력. 학생 번호가 있으면 그 아이, 없으면 같은 방(집)으로 찾습니다 - 이름 글자로 찾지 않습니다.
 * 김재이가 셋이라 이름으로 찾으면 남의 아이 이력이 섞입니다(CLAUDE.md §2-4-1).
 */
export function StudentHistory({ rowId, studentId, channelId }: { rowId: string; studentId: string | null; channelId: string | null }) {
  const [rows, setRows] = useState<HistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId && !channelId) return;
    let stop = false;
    const since = `${kstDateOffset(-30)}T00:00:00+09:00`;
    let q = createClient().from("pickup_requests").select("*").gte("received_at", since).neq("id", rowId);
    q = studentId ? q.eq("student_id", studentId) : q.eq("channel_id", channelId as string);
    void q
      .order("received_at", { ascending: false })
      .limit(30)
      .then(({ data, error: err }) => {
        if (stop) return;
        if (err) setError(err.message);
        setRows(((data as HistRow[] | null) ?? []).filter((r) => !r.is_demo));
      });
    return () => {
      stop = true;
    };
  }, [rowId, studentId, channelId]);

  if (!studentId && !channelId) return <p className="text-[10px] text-slate-400">학생·방이 정해지지 않아 이력을 볼 수 없습니다.</p>;
  if (error) return <p className="text-[10px] font-bold text-rose-600">이력을 읽지 못했습니다: {error}</p>;
  if (!rows) return <p className="text-[10px] text-slate-400">이력 불러오는 중…</p>;
  if (rows.length === 0) return <p className="text-[10px] text-slate-400">최근 30일 다른 연락이 없습니다.</p>;
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-bold text-slate-400">
        최근 30일 {studentId ? "이 학생" : "이 방"} 연락 {rows.length}건
      </p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded bg-slate-50 p-1">
        {rows.map((h) => (
          <li key={h.id} className="flex items-start gap-1 text-[10.5px]">
            <span className="w-16 shrink-0 tabular-nums text-slate-400">
              {dayKst(h.received_at)} {timeKst(h.received_at)}
            </span>
            <span className="flex shrink-0 gap-0.5">
              {(h.badges ?? []).slice(0, 2).map((b) => (
                <span key={b} className={"rounded-full border px-1 text-[9px] font-bold " + (BADGE_STYLE[b as InquiryBadge] ?? "")}>
                  {b}
                </span>
              ))}
            </span>
            <span className={"min-w-0 flex-1 truncate " + (h.answered_at || h.skipped_at ? "text-slate-400" : "text-slate-700")}>
              {h.summary || h.raw_text || "(내용 없음)"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Tpl = { id: string; badge: string | null; title: string; body: string; sort_order: number; created_by: string | null };

/**
 * 답장 문구. 누르면 「{이름}」을 학생 이름으로 바꿔 클립보드에 넣습니다 - 토들에 붙여 넣기만 하면 됩니다.
 * 이 문의의 뱃지에 맞는 문구가 앞에 섭니다.
 */
export function ReplyTemplates({ badges, studentName, me }: { badges: string[]; studentName: string | null; me: string }) {
  const notify = useToast();
  const [list, setList] = useState<Tpl[] | null>(null);
  const [editing, setEditing] = useState<Partial<Tpl> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("inquiry_reply_templates").select("*").order("sort_order").limit(200);
    if (error) {
      notify("답장 문구를 읽지 못했습니다: " + error.message, "error");
      setList([]);
      return;
    }
    setList((data as Tpl[] | null) ?? []);
  }, [notify]);
  useEffect(() => void load(), [load]);

  const ordered = useMemo(() => {
    const all = list ?? [];
    const hit = all.filter((t) => t.badge && badges.includes(t.badge));
    const common = all.filter((t) => !t.badge);
    const rest = all.filter((t) => t.badge && !badges.includes(t.badge));
    return { hit, common, rest };
  }, [list, badges]);

  async function copy(t: Tpl) {
    const text = t.body.replace(/\{이름\}/g, studentName ?? "학생");
    try {
      await navigator.clipboard.writeText(text);
      notify(`「${t.title}」 문구를 복사했습니다. 토들에 붙여 넣으세요.`, "success");
    } catch {
      notify("클립보드에 넣지 못했습니다. 문구를 길게 눌러 직접 복사해 주세요.", "error");
    }
  }

  async function save() {
    if (!editing?.title?.trim() || !editing.body?.trim()) return notify("제목과 문구를 적어 주세요.", "error");
    const row = {
      badge: editing.badge || null,
      title: editing.title.trim(),
      body: editing.body.trim(),
      sort_order: editing.sort_order ?? 100,
      updated_at: new Date().toISOString(),
    };
    const sb = createClient().from("inquiry_reply_templates");
    const { error } = editing.id ? await sb.update(row).eq("id", editing.id) : await sb.insert({ ...row, created_by: me });
    if (error) return notify("문구를 저장하지 못했습니다: " + error.message, "error");
    setEditing(null);
    void load();
  }

  async function remove(t: Tpl) {
    if (!window.confirm(`「${t.title}」 문구를 지울까요? 모든 직원 화면에서 사라집니다.`)) return;
    const { error } = await createClient().from("inquiry_reply_templates").delete().eq("id", t.id);
    if (error) return notify("지우지 못했습니다: " + error.message, "error");
    setEditing(null);
    void load();
  }

  const chip = (t: Tpl, strong: boolean) => (
    <button
      key={t.id}
      type="button"
      onClick={() => void copy(t)}
      onContextMenu={(e) => {
        e.preventDefault();
        setEditing(t);
      }}
      title={`${t.body}\n\n(누르면 복사 · 오른쪽 클릭으로 고치기)`}
      className={
        "rounded-full border px-2 py-0.5 text-[10px] font-bold " +
        (strong ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")
      }
    >
      📋 {t.title}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-bold text-slate-400">답장 문구</span>
      {list === null ? (
        <span className="text-[10px] text-slate-400">…</span>
      ) : (
        <>
          {ordered.hit.map((t) => chip(t, true))}
          {ordered.common.map((t) => chip(t, false))}
          {ordered.rest.length > 0 && (
            <details className="inline">
              <summary className="cursor-pointer text-[10px] text-slate-400">다른 문구 {ordered.rest.length}</summary>
              <span className="flex flex-wrap gap-1 pt-1">{ordered.rest.map((t) => chip(t, false))}</span>
            </details>
          )}
          <button
            type="button"
            onClick={() => setEditing({ badge: badges.find((b) => b !== "인사·감사" && b !== "기타") ?? null, title: "", body: "" })}
            className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
          >
            + 문구
          </button>
        </>
      )}
      {editing &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[950] flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
            <div className="w-full max-w-md space-y-2 rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-slate-800">{editing.id ? "답장 문구 고치기" : "답장 문구 더하기"}</h3>
              <input
                value={editing.title ?? ""}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="제목 (예: 결석 확인)"
                className="w-full rounded border px-2 py-1 text-[12px]"
              />
              <select
                value={editing.badge ?? ""}
                onChange={(e) => setEditing({ ...editing, badge: e.target.value || null })}
                className="w-full rounded border px-2 py-1 text-[12px]"
              >
                <option value="">모든 문의에서 보이기</option>
                {INQUIRY_BADGES.map((b) => (
                  <option key={b} value={b}>
                    {b} 문의에서 먼저 보이기
                  </option>
                ))}
              </select>
              <textarea
                value={editing.body ?? ""}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                rows={5}
                placeholder="문구. {이름} 은 학생 이름으로 바뀝니다."
                className="w-full rounded border px-2 py-1 text-[12px]"
              />
              <div className="flex items-center gap-2">
                {editing.id && (
                  <button type="button" onClick={() => void remove(editing as Tpl)} className="text-[11px] font-bold text-rose-600">
                    지우기
                  </button>
                )}
                <button type="button" onClick={() => setEditing(null)} className="ml-auto rounded-lg border px-3 py-1 text-[12px] font-bold text-slate-600">
                  닫기
                </button>
                <button type="button" onClick={() => void save()} className="rounded-lg bg-blue-600 px-3 py-1 text-[12px] font-bold text-white">
                  저장
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

type RepRow = {
  id: string;
  received_at: string;
  badges: string[] | null;
  kind: string | null;
  replied_at: string | null;
  replied_by: string | null;
  replied_via: string | null;
  answered_at: string | null;
  answered_by: string | null;
  skipped_at?: string | null;
  skipped_by?: string | null;
  is_demo?: boolean | null;
};

/**
 * 하루 처리 보고 — 관리자·개발자만 봅니다. 단추 자체가 다른 직원 화면에는 없습니다.
 *
 * 따로 모으는 자료는 없습니다. 답함·처리 완료·넘김을 누를 때 이미 남는 «누가·언제»를 그날 것만 세어
 * 보여줍니다. 넘김은 처리로 세지 않습니다.
 */
export function ProcessingReportButton({ staffName }: { staffName: (email: string | null) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
        title="관리자·개발자만 보입니다"
      >
        📊 처리 보고
      </button>
      {open && typeof document !== "undefined" && createPortal(<ReportModal staffName={staffName} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const shiftDay = (iso: string, d: number) => {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

function ReportModal({ staffName, onClose }: { staffName: (email: string | null) => string; onClose: () => void }) {
  const today = kstDateOffset(0);
  const [day, setDay] = useState(today);
  const [rows, setRows] = useState<RepRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    setRows(null);
    void createClient()
      .from("pickup_requests")
      .select("*")
      .gte("received_at", `${day}T00:00:00+09:00`)
      .lt("received_at", `${shiftDay(day, 1)}T00:00:00+09:00`)
      .limit(1000)
      .then(({ data, error: err }) => {
        if (stop) return;
        setError(err ? err.message : null);
        setRows(((data as RepRow[] | null) ?? []).filter((r) => !r.is_demo));
      });
    return () => {
      stop = true;
    };
  }, [day]);

  const stat = useMemo(() => {
    const all = rows ?? [];
    const act = all.filter((r) => !(r.badges ?? []).every((b) => b === "인사·감사") || (r.badges ?? []).length === 0);
    type P = { replied: number; done: number; skipped: number; mins: number[] };
    const people = new Map<string, P>();
    const get = (k: string) => {
      const p = people.get(k) ?? { replied: 0, done: 0, skipped: 0, mins: [] };
      people.set(k, p);
      return p;
    };
    for (const r of all) {
      if (r.replied_at && r.replied_by) {
        const k = r.replied_via === "토들 답글" ? `${r.replied_by} (토들)` : staffName(r.replied_by);
        const p = get(k);
        p.replied += 1;
        p.mins.push(minutesBetween(r.received_at, r.replied_at));
      }
      if (r.answered_at && r.answered_by) get(staffName(r.answered_by)).done += 1;
      if (r.skipped_at && r.skipped_by) get(staffName(r.skipped_by)).skipped += 1;
    }
    const replyMins = all.filter((r) => r.replied_at).map((r) => minutesBetween(r.received_at, r.replied_at as string));
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    return {
      total: all.length,
      actionable: act.length,
      replied: act.filter((r) => r.replied_at).length,
      done: act.filter((r) => r.answered_at).length,
      skipped: all.filter((r) => r.skipped_at).length,
      late: act.filter((r) => r.replied_at && minutesBetween(r.received_at, r.replied_at) >= 60).length,
      unanswered: act.filter((r) => !r.replied_at && !r.answered_at && !r.skipped_at).length,
      avgReply: avg(replyMins),
      people: [...people.entries()]
        .map(([name, p]) => ({ name, ...p, avg: avg(p.mins) }))
        .sort((a, b) => b.replied + b.done - (a.replied + a.done)),
    };
  }, [rows, staffName]);

  return (
    <div className="fixed inset-0 z-[900] flex items-start justify-center bg-black/40 p-3 sm:p-8" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2.5">
          <h2 className="text-sm font-bold text-slate-800">📊 문의 처리 보고</h2>
          <button type="button" onClick={() => setDay(shiftDay(day, -1))} className="rounded border px-1.5 text-xs">
            ◀
          </button>
          <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="rounded border px-1.5 py-0.5 text-xs" />
          <button type="button" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))} className="rounded border px-1.5 text-xs disabled:opacity-30">
            ▶
          </button>
          <span className="text-[10px] text-slate-400">관리자·개발자만 보입니다</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-slate-800 px-3 py-1 text-[12px] font-bold text-white">
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="text-xs font-bold text-rose-600">읽지 못했습니다: {error}</p>
          ) : rows === null ? (
            <p className="text-xs text-slate-400">불러오는 중…</p>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-4 gap-2 text-center">
                {[
                  ["들어온 연락", stat.total],
                  ["답할 것", stat.actionable],
                  ["답함", stat.replied],
                  ["처리 완료", stat.done],
                  ["넘김", stat.skipped],
                  ["아직 답 없음", stat.unanswered],
                  ["1시간 넘겨 답함", stat.late],
                  ["평균 답변", stat.avgReply == null ? "-" : `${stat.avgReply}분`],
                ].map(([k, v]) => (
                  <div key={String(k)} className="rounded-lg bg-slate-50 p-2">
                    <p className="text-[10px] text-slate-400">{k}</p>
                    <p className="text-base font-bold tabular-nums text-slate-800">{v}</p>
                  </div>
                ))}
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b text-[10px] text-slate-400">
                    <th className="py-1 text-left">사람</th>
                    <th className="text-right">답함</th>
                    <th className="text-right">처리 완료</th>
                    <th className="text-right">넘김</th>
                    <th className="text-right">평균 답변</th>
                  </tr>
                </thead>
                <tbody>
                  {stat.people.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-slate-400">
                        이날 처리 기록이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    stat.people.map((p) => (
                      <tr key={p.name} className="border-b border-black/5">
                        <td className="py-1 font-bold text-slate-700">{p.name}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{p.replied}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{p.done}</td>
                        <td className="whitespace-nowrap text-right tabular-nums text-slate-400">{p.skipped}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{p.avg == null ? "-" : `${p.avg}분`}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-slate-400">
                평균 답변 = 학부모가 쓴 시각부터 「답함」까지. 토들에 직접 단 답글은 토들 이름으로 셉니다. 넘김은 처리로 세지 않습니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
