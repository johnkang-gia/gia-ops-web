"use client";

import { useMemo, useState } from "react";
import { humanDuration, labelOf } from "@/lib/usageTrack";

/**
 * 이용 기록을 **세 가지 물음**으로 나눠 보여줍니다.
 *
 *   ① 누가 쓰고 있나        — 사람마다 마지막 접속 · 접속 횟수 · 머문 시간
 *   ② 무엇이 쓰이고 있나    — 화면마다 열린 횟수 · 머문 시간 · 몇 명이 쓰나
 *   ③ 방금 무슨 일이 있었나 — 시간순 그대로
 *
 * 한 표에 몰아넣지 않는 이유: 세 물음은 **답을 보고 할 일이 다릅니다.** ①은 계정을
 * 정리하게 하고, ②는 화면을 지우거나 고치게 하고, ③은 「지금 뭔가 이상하다」를 확인하게
 * 합니다. 한 표로 만들면 어느 쪽도 못 합니다.
 */

export type UsageRow = {
  user_email: string;
  user_name: string | null;
  position: string | null;
  session_id: string;
  kind: string;
  path: string;
  label: string | null;
  action: string | null;
  duration_ms: number | null;
  created_at: string;
};

type Tab = "사람" | "화면" | "흐름";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function ago(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function UsageClient({
  rows,
  days,
  loadError,
}: {
  rows: UsageRow[];
  days: number;
  loadError: string | null;
}) {
  const [tab, setTab] = useState<Tab>("사람");
  const [who, setWho] = useState<string | null>(null);

  const scoped = useMemo(() => (who ? rows.filter((r) => r.user_email === who) : rows), [rows, who]);

  const byUser = useMemo(() => {
    const m = new Map<
      string,
      { email: string; name: string | null; position: string | null; views: number; ms: number; sessions: Set<string>; last: string; paths: Set<string> }
    >();
    for (const r of rows) {
      const cur = m.get(r.user_email) ?? {
        email: r.user_email,
        name: r.user_name,
        position: r.position,
        views: 0,
        ms: 0,
        sessions: new Set<string>(),
        last: r.created_at,
        paths: new Set<string>(),
      };
      cur.views += 1;
      cur.ms += r.duration_ms ?? 0;
      cur.sessions.add(r.session_id);
      cur.paths.add(r.path);
      if (r.created_at > cur.last) cur.last = r.created_at;
      if (!cur.name && r.user_name) cur.name = r.user_name;
      m.set(r.user_email, cur);
    }
    return [...m.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [rows]);

  const byPath = useMemo(() => {
    const m = new Map<string, { path: string; label: string; views: number; ms: number; users: Set<string>; last: string }>();
    for (const r of scoped) {
      const cur = m.get(r.path) ?? {
        path: r.path,
        label: r.label || labelOf(r.path),
        views: 0,
        ms: 0,
        users: new Set<string>(),
        last: r.created_at,
      };
      cur.views += 1;
      cur.ms += r.duration_ms ?? 0;
      cur.users.add(r.user_email);
      if (r.created_at > cur.last) cur.last = r.created_at;
      m.set(r.path, cur);
    }
    return [...m.values()].sort((a, b) => b.views - a.views);
  }, [scoped]);

  const recent = useMemo(() => scoped.slice(0, 300), [scoped]);

  /**
   * **안 쌓이고 있다는 사실이 보여야 합니다.** 기록 라우트는 조용히 실패해도 되는 유일한
   * 자리인데(사람이 하려던 일을 막으면 안 되므로), 그 대가로 «멈춘 것»과 «아무도 안 쓴 것»이
   * 똑같이 빈 화면으로 보입니다. 그래서 마지막 기록 시각을 맨 위에 적습니다.
   */
  const lastAt = rows[0]?.created_at ?? null;
  const stale = lastAt ? Date.now() - new Date(lastAt).getTime() > 6 * 60 * 60 * 1000 : true;

  return (
    <div className="p-4">
      <div className="mb-3">
        <h1 className="text-lg font-bold text-slate-800">📈 이용 기록</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
          최근 <b>{days}일</b> · 누가 언제 어느 화면을 얼마나 봤는지입니다. <b>화면에 무엇이 떠 있었는지는 담지 않습니다</b> —
          주소의 학생 번호는 지우고 자리(<code className="rounded bg-slate-100 px-1">/students/:id</code>)만 남깁니다.
        </p>
      </div>

      {loadError && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          읽지 못했습니다: {loadError} — 마이그레이션(<code>usage_events</code>)이 걸렸는지 확인해주세요.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="text-[12px] text-slate-500">
          마지막 기록 <b className="text-slate-800">{lastAt ? `${fmt(lastAt)} (${ago(lastAt)})` : "없음"}</b>
        </span>
        {stale && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
            {lastAt ? "여섯 시간 넘게 안 쌓였습니다 — 기록이 멈췄을 수 있습니다" : "아직 아무 기록도 없습니다"}
          </span>
        )}
        <span className="ml-auto text-[12px] text-slate-500">
          줄 {rows.length.toLocaleString("ko-KR")} · 사람 {byUser.length} · 화면 {byPath.length}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["사람", "화면", "흐름"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              "rounded-lg px-3 py-1.5 text-[12px] font-bold transition " +
              (tab === t ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")
            }
          >
            {t}
          </button>
        ))}
        {who && (
          <button
            type="button"
            onClick={() => setWho(null)}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700"
          >
            {who} 만 보는 중 ✕
          </button>
        )}
      </div>

      {tab === "사람" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2">사람</th>
                <th className="px-3 py-2">직위</th>
                <th className="px-3 py-2 text-right">마지막 접속</th>
                <th className="px-3 py-2 text-right">접속 횟수</th>
                <th className="px-3 py-2 text-right">화면 열람</th>
                <th className="px-3 py-2 text-right">머문 시간</th>
                <th className="px-3 py-2 text-right">쓴 화면 수</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byUser.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    아직 기록이 없습니다.
                  </td>
                </tr>
              )}
              {byUser.map((u) => (
                <tr key={u.email} className="hover:bg-indigo-50/40">
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setWho(u.email);
                        setTab("화면");
                      }}
                      className="text-left font-semibold text-indigo-700 hover:underline"
                      title="이 사람이 어느 화면을 썼는지 봅니다"
                    >
                      {u.name || u.email}
                    </button>
                    <div className="text-[10px] text-slate-400">{u.email}</div>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{u.position ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">
                    {fmt(u.last)}
                    <div className="text-[10px] text-slate-400">{ago(u.last)}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{u.sessions.size}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{u.views.toLocaleString("ko-KR")}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{humanDuration(u.ms)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{u.paths.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "화면" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2">화면</th>
                <th className="px-3 py-2 text-right">열린 횟수</th>
                <th className="px-3 py-2 text-right">머문 시간</th>
                <th className="px-3 py-2 text-right">한 번에 평균</th>
                <th className="px-3 py-2 text-right">쓰는 사람</th>
                <th className="px-3 py-2 text-right">마지막</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byPath.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    아직 기록이 없습니다.
                  </td>
                </tr>
              )}
              {byPath.map((p) => (
                <tr key={p.path} className="hover:bg-indigo-50/40">
                  <td className="px-3 py-1.5">
                    <span className="font-semibold text-slate-800">{p.label}</span>
                    <div className="text-[10px] text-slate-400">{p.path}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.views.toLocaleString("ko-KR")}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{humanDuration(p.ms)}</td>
                  {/* **한 번에 얼마나 보나.** 「많이 열리는데 매번 3초」는 잘못 들어왔다가
                      나오는 화면이라는 뜻입니다 - 총합만 보면 그게 안 보입니다. */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {humanDuration(p.views > 0 ? Math.round(p.ms / p.views) : null)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.users.size}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{ago(p.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "흐름" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2">시각</th>
                <th className="px-3 py-2">사람</th>
                <th className="px-3 py-2">화면</th>
                <th className="px-3 py-2">한 일</th>
                <th className="px-3 py-2 text-right">머문 시간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    아직 기록이 없습니다.
                  </td>
                </tr>
              )}
              {recent.map((r, i) => (
                <tr key={`${r.session_id}-${r.created_at}-${i}`} className="hover:bg-indigo-50/40">
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-500">{fmt(r.created_at)}</td>
                  <td className="px-3 py-1.5 text-slate-700">{r.user_name || r.user_email}</td>
                  <td className="px-3 py-1.5">
                    <span className="font-semibold text-slate-800">{r.label || labelOf(r.path)}</span>
                    <span className="ml-1 text-[10px] text-slate-400">{r.path}</span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{r.kind === "action" ? (r.action ?? "동작") : "열람"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{humanDuration(r.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {scoped.length > recent.length && (
            <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
              최근 {recent.length}줄만 보여줍니다 — 전체 {scoped.length.toLocaleString("ko-KR")}줄.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
