"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import { INTEGRATIONS } from "@/lib/heartbeat";
import {
  attendanceSpaceProblem,
  buildReport,
  CRITICAL_KEYS,
  DEFAULT_GUIDE,
  FIX_GUIDE,
  consoleLinksOf,
  judge,
  type SpaceLite,
} from "@/lib/integrationHealth";

export type Row = {
  key: string;
  label: string;
  what: string;
  everyMinutes: number;
  officeHoursOnly: boolean;
  lastSeenAt: string | null;
  status: string | null;
  detail: string | null;
};

export type DataStat = { label: string; value: string; sub: string; warn: boolean };

function ago(iso: string | null): string {
  if (!iso) return "신호 없음";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

function everyLabel(m: number): string {
  if (m < 60) return `${m}분마다`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간마다`;
  if (m < 60 * 24 * 7) return "하루 한 번";
  return "주 한 번";
}

const TONE: Record<string, string> = {
  "🟢": "text-emerald-600",
  "🟡": "text-amber-600 font-semibold",
  "🔴": "text-red-600 font-bold",
  "⚪": "text-slate-400",
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 연동 상태 — 보는 것에서 **고치는 것**으로.
 *
 * 빨간불이 켜지면 그 줄 아래에 「어디를 보라」가 바로 펼쳐지고, 「이 줄 복사」·「전체 상태 복사」로
 * 개발자에게 붙여넣을 글이 나옵니다. 구글챗 방은 여기서 켜고 끕니다 - 켜고 끄는 자리가 화면에
 * 없어서 출결알림 방이 꺼진 채 2주를 보냈습니다.
 */
export default function IntegrationsClient({ rows, stats, spaces }: { rows: Row[]; stats: DataStat[]; spaces: SpaceLite[] }) {
  const router = useRouter();
  const notify = useToast();
  // 1분마다 다시 그립니다 - "3분 전"이 화면에 박혀 있으면 보는 사람이 언제 기준인지 모릅니다.
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const specOf = (key: string) => INTEGRATIONS.find((s) => s.key === key)!;
  const verdict = (r: Row) => judge(specOf(r.key), { key: r.key, last_seen_at: r.lastSeenAt, status: r.status, detail: r.detail });
  const broken = rows.filter((r) => verdict(r).dot === "🔴");
  const attProblem = attendanceSpaceProblem(spaces);
  const critical = new Set<string>(CRITICAL_KEYS);

  const beats = rows.map((r) => ({ key: r.key, last_seen_at: r.lastSeenAt, status: r.status, detail: r.detail }));

  async function copyAll() {
    const ok = await copyText(buildReport(beats, spaces));
    notify(ok ? "전체 상태를 복사했습니다. 개발자에게 붙여넣어 주세요." : "복사하지 못했습니다. 브라우저가 막았습니다.", ok ? "success" : "error");
  }

  async function copyRow(r: Row) {
    const v = verdict(r);
    const guide = FIX_GUIDE[r.key] ?? DEFAULT_GUIDE;
    const text = [
      `[연동 오류] ${r.label} (${r.key})`,
      `상태: ${v.dot} ${v.text} · 주기 ${everyLabel(r.everyMinutes)} · 마지막 신호 ${r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString("ko-KR") : "없음"}`,
      r.status ? `신호 상태: ${r.status}` : null,
      r.detail ? `오류 내용: ${r.detail}` : null,
      `확인한 것: ${guide.map((g, i) => `${i + 1}) ${g}`).join(" ")}`,
      `복사 시각: ${new Date().toLocaleString("ko-KR")}`,
    ]
      .filter(Boolean)
      .join("\n");
    const ok = await copyText(text);
    notify(ok ? "이 줄을 복사했습니다." : "복사하지 못했습니다.", ok ? "success" : "error");
  }

  async function toggleSpace(s: SpaceLite) {
    setBusy(s.google_space_id);
    const res = await fetch("/api/google-chat/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", spaceId: s.google_space_id, enabled: !s.enabled }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      notify(json.error ?? "방을 바꾸지 못했습니다.", "error");
      return;
    }
    notify(!s.enabled ? "방을 켰습니다. 1분 안에 그 방 글이 들어옵니다." : "방을 껐습니다.", "success");
    router.refresh();
  }

  async function syncSpaces() {
    setBusy("sync");
    const res = await fetch("/api/google-chat/spaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      notify(json.error ?? "방 목록을 받지 못했습니다.", "error");
      return;
    }
    notify("방 목록을 다시 받았습니다.", "success");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">🔌 연동 상태</h1>
        <button
          type="button"
          onClick={() => void copyAll()}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          title="모든 연동의 상태와 구글챗 방 상태를 글로 복사합니다. 개발자에게 그대로 붙여넣으면 됩니다."
        >
          📋 전체 상태 복사
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        이 앱은 크론·수집기·GPS에 기대어 굴러갑니다. 이것들이 멈춰도 화면은 멀쩡해 보이고 데이터만 안 들어옵니다. 빨간 줄은
        그 아래 「고치는 길」을 따라가고, 안 되면 「복사」를 눌러 개발자에게 보내주세요.
      </p>

      {broken.length > 0 || attProblem ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-bold text-red-700">🔴 멈춘 것이 {broken.length + (attProblem ? 1 : 0)}개 있습니다</p>
          <p className="mt-1 text-xs text-red-600">{[...broken.map((b) => b.label), attProblem ? "구글챗 출결알림 방" : null].filter(Boolean).join(" · ")}</p>
          {attProblem && <p className="mt-1 text-[11px] text-red-600">{attProblem} 아래 「구글챗 방」에서 켜주세요.</p>}
          <p className="mt-1.5 text-[11px] text-red-500">
            셔틀·구글챗·토들·픽업 예약은 끊기면 업무보드 맨 위에 전체공지로도 뜹니다. 돌아오면 공지는 저절로 내려갑니다.
          </p>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-bold text-emerald-700">🟢 모두 정상입니다</p>
        </div>
      )}

      {/* 실제로 쌓인 데이터 - 신호만으로는 "돌긴 도는데 아무것도 안 들어오는" 상태를 못 잡습니다. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className={"rounded-xl border p-3 " + (s.warn ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white")}>
            <p className="text-[11px] text-slate-400">{s.label}</p>
            <p className={"text-sm font-bold " + (s.warn ? "text-amber-700" : "text-slate-800")}>{s.value}</p>
            {s.sub && <p className="mt-0.5 text-[11px] text-slate-500">{s.sub}</p>}
          </div>
        ))}
      </div>

      <div className="overflow-hidden g-panel-solid">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] text-slate-400">
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 font-semibold">연동</th>
              <th className="w-24 px-3 py-2 font-semibold">주기</th>
              <th className="w-28 px-3 py-2 font-semibold">마지막 신호</th>
              <th className="w-24 px-3 py-2 font-semibold">상태</th>
              <th className="w-20 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = verdict(r);
              const bad = v.dot === "🔴" || v.dot === "🟡";
              const guide = FIX_GUIDE[r.key] ?? DEFAULT_GUIDE;
              return (
                <tr key={r.key} className={"border-b border-slate-50 last:border-0 " + (v.dot === "🔴" ? "bg-red-50/40" : "")}>
                  <td className="px-3 py-2 text-center align-top">{v.dot}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-slate-800">{r.label}</span>
                    {critical.has(r.key) && (
                      <span className="ml-1 rounded bg-slate-800 px-1 text-[10px] font-bold text-white" title="끊기면 전체공지가 올라갑니다">
                        경보
                      </span>
                    )}
                    {r.what && <p className="text-[11px] text-slate-400">{r.what}</p>}
                    {r.detail && <p className="text-[11px] text-amber-600">{r.detail}</p>}
                    {consoleLinksOf(r.key).length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {consoleLinksOf(r.key).map((l) => (
                          <a
                            key={l.url}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className={
                              "rounded border px-1.5 py-0.5 text-[11px] " +
                              (bad ? "border-red-300 bg-red-50 font-semibold text-red-700 hover:bg-red-100" : "border-slate-200 text-slate-500 hover:bg-slate-50")
                            }
                          >
                            {l.label} ↗
                          </a>
                        ))}
                      </p>
                    )}
                    {bad && (
                      <div className="mt-1.5 rounded-lg border border-red-100 bg-white px-2 py-1.5">
                        <p className="text-[11px] font-bold text-red-600">고치는 길</p>
                        <ol className="mt-0.5 list-decimal pl-4 text-[11px] text-slate-600">
                          {guide.map((g) => (
                            <li key={g}>{g}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500">{everyLabel(r.everyMinutes)}</td>
                  <td className="px-3 py-2 align-top text-xs text-slate-600" title={r.lastSeenAt ?? undefined}>
                    {ago(r.lastSeenAt)}
                  </td>
                  <td className={"px-3 py-2 align-top text-xs " + TONE[v.dot]}>{v.text}</td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => void copyRow(r)}
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
                      title="이 연동의 상태·오류를 글로 복사합니다"
                    >
                      복사
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 구글챗 방. 꺼진 방은 크론이 돌아도 글이 안 옵니다 - 출결알림 방이 2주 꺼져 있었습니다. */}
      <div className="mt-4 g-panel-solid overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <b className="text-[13px] text-slate-800">💬 구글챗 방</b>
          <span className="text-[11px] text-slate-400">켜진 방만 수집합니다. 출결알림 방은 꺼지면 안 됩니다.</span>
          <button
            type="button"
            onClick={() => void syncSpaces()}
            disabled={busy === "sync"}
            className="ml-auto rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            방 목록 다시 받기
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {spaces.map((s) => {
              const isAtt = s.source_key === "attendance";
              return (
                <tr key={s.google_space_id} className={"border-b border-slate-50 last:border-0 " + (isAtt && !s.enabled ? "bg-red-50/40" : "")}>
                  <td className="w-8 px-3 py-2 text-center">{s.enabled ? "🟢" : isAtt ? "🔴" : "⚪"}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-slate-800">{s.display_name ?? "(이름 없음)"}</span>
                    {s.source_key && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{s.source_key}</span>}
                    {isAtt && <span className="ml-1 text-[10px] font-bold text-red-500">출결알림 · 꺼지면 픽업·결석 연락이 안 옵니다</span>}
                    {s.last_error && <p className="text-[11px] text-amber-600">{s.last_error}</p>}
                  </td>
                  <td className="w-28 px-3 py-2 text-xs text-slate-500" title={s.last_polled_at ?? undefined}>
                    {s.last_polled_at ? ago(s.last_polled_at) : "아직 안 읽음"}
                  </td>
                  <td className="w-20 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void toggleSpace(s)}
                      disabled={busy === s.google_space_id}
                      className={
                        "rounded px-2 py-0.5 text-[11px] font-bold disabled:opacity-40 " +
                        (s.enabled ? "border border-slate-300 text-slate-600" : "bg-emerald-600 text-white")
                      }
                    >
                      {s.enabled ? "끄기" : "켜기"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {spaces.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-center text-xs text-slate-400">
                  방이 없습니다. 「방 목록 다시 받기」를 눌러주세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        · 신호는 각 크론이 실제로 실행될 때 남깁니다. 등록만 하고 안 불리면 여기 안 뜹니다.
        <br />· 정해진 주기의 3배가 지나면 끊긴 것으로 봅니다. 경보가 자주 울리면 아무도 안 보게 되므로 여유를 뒀습니다.
        <br />· 방금 배포했다면 각 크론이 한 번씩 돌 때까지는 🔴로 보입니다.
      </p>
    </div>
  );
}
