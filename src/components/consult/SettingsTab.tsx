"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsultState } from "@/lib/consult/server";
import type { SiblingMode } from "@/lib/consult/model";
import { send } from "./shared";

/** 행사 설정 — 바꾸는 즉시 저장합니다. 현황판·학부모 링크에도 바로 반영됩니다. */
export default function SettingsTab({
  state,
  onChanged,
  onError,
}: {
  state: ConsultState;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const ev = state.event;
  const [name, setName] = useState(ev.name);

  async function save(body: Record<string, unknown>) {
    const r = await send(`/api/consult/events/${ev.id}`, "PATCH", body);
    if (!r.ok) onError(r.error ?? "저장하지 못했습니다.");
    else onError(null);
    await onChanged();
  }

  async function remove() {
    if (!confirm("이 행사를 지울까요? 상담실과 명단도 함께 지워집니다.")) return;
    const r = await send(`/api/consult/events/${ev.id}`, "DELETE");
    if (!r.ok) return onError(r.error ?? "지우지 못했습니다.");
    router.push("/school/consult");
  }

  const sibling: { v: SiblingMode; label: string }[] = [
    { v: "ask", label: "넣을 때마다 묻기" },
    { v: "together", label: "기본은 함께" },
    { v: "separate", label: "기본은 따로" },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">행사</h3>
        <label className="block text-xs text-slate-500">
          이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== ev.name && void save({ name })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">
            날짜
            <input type="date" defaultValue={ev.event_date ?? ""} onBlur={(e) => void save({ event_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            끝 날짜
            <input type="date" defaultValue={ev.end_date ?? ""} onBlur={(e) => void save({ end_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
        </div>
        <label className="block text-xs text-slate-500">
          기본 상담 시간(분) — 기록이 쌓이기 전 «예상 대기 시간»의 출발값
          <input
            type="number"
            min={3}
            max={120}
            defaultValue={ev.default_minutes}
            onBlur={(e) => void save({ default_minutes: Math.max(3, Math.min(120, Number(e.target.value) || 15)) })}
            className="mt-1 w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="text-xs text-slate-500">
          형제를 넣을 때
          <div className="mt-1 flex flex-wrap gap-1.5">
            {sibling.map((s) => (
              <button
                key={s.v}
                onClick={() => void save({ sibling_default: s.v })}
                className={`rounded-full px-3 py-1 text-xs ring-1 ${ev.sibling_default === s.v ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-200"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">현황판 · 학부모 링크</h3>
        <Toggle
          label="현황판에서 이름 가리기"
          hint="켜면 「김*하」처럼 가운데를 가립니다. 로비처럼 여럿이 보는 화면이면 켜 두세요."
          on={ev.mask_names}
          onChange={(v) => void save({ mask_names: v })}
        />
        <Toggle label="현황판 켜기" hint="끄면 주소를 알아도 열리지 않습니다." on={ev.board_enabled} onChange={(v) => void save({ board_enabled: v })} />
        <Toggle
          label="학부모 개인 확인 링크(QR)"
          hint="학부모가 휴대폰으로 «내 순서까지 몇 명»을 봅니다. 다른 가정 정보는 보이지 않습니다."
          on={ev.personal_links_enabled}
          onChange={(v) => void save({ personal_links_enabled: v })}
        />
        <Toggle
          label="상담실 태블릿·QR 링크"
          hint="상담실마다 로그인 없이 호출·시작·종료를 누르는 주소입니다(상담실 탭). 끄면 태블릿과 QR이 모두 닫힙니다."
          on={ev.room_links_enabled}
          onChange={(v) => void save({ room_links_enabled: v })}
        />
        <label className="block text-xs text-slate-500">
          현황판 닫는 시각(비우면 행사를 «종료»할 때 닫힘)
          <input
            type="datetime-local"
            // 저장은 UTC 이고 칸은 한국 시각으로 보여줍니다(+9시간 - 기계 시간대에 기대지 않습니다).
            defaultValue={ev.board_expires_at ? new Date(Date.parse(ev.board_expires_at) + 9 * 3600_000).toISOString().slice(0, 16) : ""}
            onBlur={(e) => void save({ board_expires_at: e.target.value ? new Date(`${e.target.value}:00+09:00`).toISOString() : null })}
            className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => confirm("현황판 주소를 새로 만들까요? 지금 켜 둔 태블릿·전자칠판은 새 주소로 다시 열어야 합니다.") && void save({ rotate_board: true })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
        >
          🔑 현황판 주소 새로 만들기(옛 주소 닫기)
        </button>
      </section>

      <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 lg:col-span-2">
        <p className="text-sm text-rose-800">상담 기록이 한 건도 없을 때만 지울 수 있습니다. 기록이 있으면 상단에서 «종료»로 바꿔 주세요.</p>
        <button onClick={() => void remove()} className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">
          행사 지우기
        </button>
      </section>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-start gap-3 text-left">
      <span className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${on ? "translate-x-4" : ""}`} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  );
}
