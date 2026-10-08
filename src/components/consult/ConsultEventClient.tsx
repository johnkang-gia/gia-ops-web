"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { APP_ORIGIN } from "@/lib/appUrl";
import type { ConsultState } from "@/lib/consult/server";
import type { Student } from "@/lib/students";
import { useConsultEvent } from "./useConsultEvent";
import { send } from "./shared";
import DeskTab from "./DeskTab";
import RosterTab from "./RosterTab";
import RoomsTab from "./RoomsTab";
import SettingsTab from "./SettingsTab";
import StatsTab from "./StatsTab";

export type ClassOption = { id: string; grade: string | null; class_name: string | null; teacher_email: string | null };
export type StaffOption = { email: string; name: string | null; position: string | null };

type TabKey = "desk" | "roster" | "rooms" | "settings" | "stats";
const TABS: { key: TabKey; label: string }[] = [
  { key: "desk", label: "🛎️ 당일 운영" },
  { key: "roster", label: "📋 명단" },
  { key: "rooms", label: "🚪 상담실" },
  { key: "settings", label: "⚙️ 설정" },
  { key: "stats", label: "📊 기록·통계" },
];

/**
 * 상담 행사 하나의 행정실 화면. 다섯 탭이 **같은 상태 하나**(useConsultEvent)를 봅니다 -
 * 명단 탭에서 넣은 아이가 운영 탭에 바로 뜨고, 면담 선생님이 누른 «시작»이 그 순간 보입니다.
 */
export default function ConsultEventClient({
  initial,
  allStudents,
  classes,
  staff,
  isAdmin,
}: {
  initial: ConsultState;
  allStudents: Student[];
  classes: ClassOption[];
  staff: StaffOption[];
  isAdmin: boolean;
}) {
  const live = useConsultEvent(initial.event.id, initial);
  const state = live.state ?? initial;
  const [tab, setTab] = useState<TabKey>(state.appts.length === 0 ? (state.rooms.length === 0 ? "rooms" : "roster") : "desk");
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  // 현황판 주소는 전자칠판에 붙여 두는 주소라 언제나 운영 주소로 만듭니다(미리보기 주소가 박히면 배포마다 바뀝니다).
  const origin = APP_ORIGIN;

  const shortUrl = state.event.board_short_code ? `${origin}/cs/${state.event.board_short_code}` : `${origin}/consult-board/${state.event.board_token}`;
  useEffect(() => {
    if (!showQr || !origin) return;
    QRCode.toDataURL(shortUrl, { margin: 1, width: 320 })
      .then(setQr)
      .catch((e: unknown) => live.setError(`QR을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQr, shortUrl, origin]);

  async function setStatus(status: "준비" | "진행" | "종료") {
    if (status === "종료" && !confirm("행사를 종료하면 현황판과 학부모 링크가 닫힙니다. 종료할까요?")) return;
    const r = await send(`/api/consult/events/${state.event.id}`, "PATCH", { status });
    if (!r.ok) live.setError(r.error ?? "바꾸지 못했습니다.");
    await live.reload();
  }

  // 퇴소 등으로 명부(재학생)에 없는 아이는 행사 상태에 실려 온 이름으로 채웁니다.
  const studentById = useMemo(() => {
    const m = new Map<string, Student>(allStudents.map((s) => [s.id, s]));
    for (const s of state.students) if (!m.has(s.id)) m.set(s.id, s);
    return m;
  }, [allStudents, state.students]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/school/consult" className="text-sm text-slate-500 hover:text-slate-800">
          ← 행사 목록
        </Link>
        <h1 className="text-xl font-bold text-slate-900">{state.event.name}</h1>
        <span className="text-sm text-slate-500">
          {state.event.event_date ?? "날짜 미정"}
          {state.event.end_date ? ` ~ ${state.event.end_date}` : ""}
        </span>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
          {(["준비", "진행", "종료"] as const).map((s) => (
            <button
              key={s}
              onClick={() => void setStatus(s)}
              className={`px-3 py-1.5 font-semibold ${state.event.status === s ? (s === "진행" ? "bg-emerald-600 text-white" : "bg-slate-700 text-white") : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href={`/consult?event=${state.event.id}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            🧑‍🏫 면담 화면
          </Link>
          <button onClick={() => setShowQr((v) => !v)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            📺 현황판 주소
          </button>
          <a
            href={`/school/consult/${state.event.id}/slips`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            🖨️ 학부모 안내지(QR)
          </a>
        </div>
      </header>

      {showQr && (
        <section className="flex flex-wrap items-center gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          {qr ? <img src={qr} alt="현황판 QR" className="h-40 w-40 rounded bg-white p-1" /> : <div className="h-40 w-40 animate-pulse rounded bg-white" />}
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-indigo-900">태블릿·전자칠판 주소창에 이 주소를 치거나 QR을 찍으세요. 로그인이 필요 없습니다.</p>
            <p className="break-all rounded bg-white px-2 py-1 font-mono text-base text-slate-900">{shortUrl}</p>
            <p className="text-xs text-indigo-700">
              {state.event.mask_names ? "이름 가운데를 가려서 보여줍니다(설정에서 바꿀 수 있습니다)." : "이름을 그대로 보여줍니다."} 전화번호·메모는 현황판으로 나가지 않습니다.
              {!state.event.board_enabled && " · 지금은 현황판이 꺼져 있습니다(설정)."}
            </p>
            <button
              onClick={() => void navigator.clipboard.writeText(shortUrl)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              주소 복사
            </button>
          </div>
        </section>
      )}

      {live.error && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="flex-1">{live.error}</span>
          <button onClick={() => live.setError(null)} className="text-rose-400 hover:text-rose-700">
            ✕
          </button>
        </div>
      )}

      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-lg border px-4 py-2 text-sm font-semibold ${tab === t.key ? "border-slate-200 border-b-white bg-white text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "desk" && <DeskTab state={state} studentById={studentById} live={live} />}
      {tab === "roster" && (
        <RosterTab state={state} studentById={studentById} allStudents={allStudents} classes={classes} onChanged={live.reload} onError={live.setError} />
      )}
      {tab === "rooms" && <RoomsTab state={state} staff={staff} onChanged={live.reload} onError={live.setError} />}
      {tab === "settings" && <SettingsTab state={state} onChanged={live.reload} onError={live.setError} />}
      {tab === "stats" && <StatsTab state={state} studentById={studentById} staff={staff} isAdmin={isAdmin} />}
    </div>
  );
}
