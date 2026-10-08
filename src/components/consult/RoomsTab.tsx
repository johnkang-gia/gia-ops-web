"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { APP_ORIGIN } from "@/lib/appUrl";
import type { ConsultState } from "@/lib/consult/server";
import type { StaffOption } from "./ConsultEventClient";
import { send } from "./shared";

type Row = { key: string; id: string | null; name: string; teacher_email: string; teacher_name: string; grade_label: string };

/**
 * 상담실 — 이름·면담 선생님·안내 글자.
 *
 * 선생님 계정을 고르면 그 선생님 면담 화면이 이 방을 먼저 엽니다. 다만 **누르는 사람을 방으로
 * 막지는 않습니다** - 그날 대신 들어간 선생님, 계정 없는 외부 상담사도 방마다 놓은 태블릿이나
 * 문에 붙인 QR(아래 「상담실 태블릿·QR」)로 호출·시작·종료를 누릅니다.
 */
export default function RoomsTab({
  state,
  staff,
  onChanged,
  onError,
}: {
  state: ConsultState;
  staff: StaffOption[];
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const toRows = () =>
    state.rooms.map((r) => ({
      key: r.id,
      id: r.id,
      name: r.name,
      teacher_email: r.teacher_email ?? "",
      teacher_name: r.teacher_name ?? "",
      grade_label: r.grade_label ?? "",
    }));
  const [rows, setRows] = useState<Row[]>(toRows);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 다른 화면에서 고친 것이 들어오면, 이쪽에서 고치는 중이 아닐 때만 받아들입니다.
  useEffect(() => {
    if (!dirty) setRows(toRows());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rooms]);

  const edit = (key: string, p: Partial<Row>) => {
    setDirty(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };
  const move = (i: number, d: -1 | 1) => {
    setDirty(true);
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  async function save() {
    setSaving(true);
    const r = await send(`/api/consult/events/${state.event.id}/rooms`, "PUT", {
      rooms: rows.map((x) => ({ id: x.id, name: x.name, teacher_email: x.teacher_email, teacher_name: x.teacher_name, grade_label: x.grade_label })),
    });
    setSaving(false);
    if (!r.ok) return onError(r.error ?? "저장하지 못했습니다.");
    onError(null);
    setDirty(false);
    await onChanged();
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-slate-800">상담실</h3>
        <span className="text-xs text-slate-500">순서는 현황판에 보이는 순서입니다. 방을 지우면 그 방에 정해진 예약은 «미정»이 됩니다.</span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[auto_1.2fr_1.2fr_0.8fr_auto] items-center gap-2">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} className="text-xs text-slate-400 hover:text-slate-700">
                ▲
              </button>
              <button onClick={() => move(i, 1)} className="text-xs text-slate-400 hover:text-slate-700">
                ▼
              </button>
            </div>
            <input value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} placeholder="방 이름(예: 1반 교실)" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            <select
              value={r.teacher_email}
              onChange={(e) => {
                const s = staff.find((x) => x.email === e.target.value);
                edit(r.key, { teacher_email: e.target.value, teacher_name: s?.name ?? r.teacher_name });
              }}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">선생님 계정 없음{r.teacher_name ? ` (${r.teacher_name})` : ""}</option>
              {staff.map((s) => (
                <option key={s.email} value={s.email}>
                  {s.name} {s.position ? `· ${s.position}` : ""}
                </option>
              ))}
            </select>
            <input value={r.grade_label} onChange={(e) => edit(r.key, { grade_label: e.target.value })} placeholder="안내(예: 1학년)" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            <button
              onClick={() => {
                setDirty(true);
                setRows((rs) => rs.filter((x) => x.key !== r.key));
              }}
              className="text-sm text-rose-500 hover:text-rose-700"
            >
              삭제
            </button>
            {!r.teacher_email && (
              <input
                value={r.teacher_name}
                onChange={(e) => edit(r.key, { teacher_name: e.target.value })}
                placeholder="면담하는 분 이름(계정 없을 때)"
                className="col-start-3 rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-xs"
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => {
            setDirty(true);
            setRows((rs) => [...rs, { key: crypto.randomUUID(), id: null, name: "", teacher_email: "", teacher_name: "", grade_label: "" }]);
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          + 상담실 추가
        </button>
        <button onClick={() => void save()} disabled={!dirty || saving} className="ml-auto rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      <RoomLinks state={state} onChanged={onChanged} onError={onError} />
    </section>
  );
}

/**
 * **상담실 태블릿·QR.** 방마다 로그인 없이 여는 주소가 하나씩 있습니다.
 *
 * 태블릿을 둘 수 있으면 그 주소를 태블릿에 띄워 두고, 어려우면 QR을 인쇄해 문에 붙입니다. 어느
 * 휴대폰이든 찍으면 그 방의 호출·시작·종료 화면이 열립니다. 주소가 밖으로 돌면 「새로 만들기」로
 * 한꺼번에 닫습니다(새 QR을 다시 붙여야 합니다).
 */
function RoomLinks({
  state,
  onChanged,
  onError,
}: {
  state: ConsultState;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const urlOf = (code: string) => `${APP_ORIGIN}/cr/${code}`;
  const open = state.event.room_links_enabled && state.event.status !== "종료";

  useEffect(() => {
    const room = state.rooms.find((r) => r.id === qrFor);
    if (!room) return setQr(null);
    QRCode.toDataURL(urlOf(room.room_short_code), { margin: 1, width: 280 })
      .then(setQr)
      .catch((e: unknown) => onError(`QR을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrFor, state.rooms]);

  async function rotate() {
    if (!confirm("상담실 주소를 모두 새로 만듭니다. 지금 붙어 있는 QR과 태블릿 화면은 바로 닫히고, 새 QR을 다시 붙여야 합니다. 계속할까요?")) return;
    const r = await send(`/api/consult/events/${state.event.id}`, "PATCH", { rotate_rooms: true });
    if (!r.ok) return onError(r.error ?? "새로 만들지 못했습니다.");
    onError(null);
    await onChanged();
  }

  if (state.rooms.length === 0) return null;
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-800">📱 상담실 태블릿·QR</h3>
        <span className="text-xs text-slate-500">
          로그인 없이 그 방의 호출·시작·종료만 할 수 있습니다. 태블릿에 띄워 두거나, QR을 인쇄해 문에 붙이세요.
        </span>
        <a
          href={`/school/consult/${state.event.id}/room-qr`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          🖨️ QR 인쇄
        </a>
        <button onClick={() => void rotate()} className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
          주소 새로 만들기
        </button>
      </div>
      {!open && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          지금은 상담실 링크가 닫혀 있습니다({state.event.status === "종료" ? "행사 종료" : "설정에서 꺼 둠"}).
        </p>
      )}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {state.rooms.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="w-32 shrink-0 font-semibold text-slate-800">{r.name}</span>
            <span className="break-all font-mono text-xs text-slate-600">{urlOf(r.room_short_code)}</span>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(urlOf(r.room_short_code));
                setCopied(r.id);
                setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 1500);
              }}
              className="ml-auto rounded px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50"
            >
              {copied === r.id ? "복사됨" : "주소 복사"}
            </button>
            <button onClick={() => setQrFor((x) => (x === r.id ? null : r.id))} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
              {qrFor === r.id ? "QR 닫기" : "QR 보기"}
            </button>
            {qrFor === r.id && (
              <div className="w-full pt-1">
                {qr ? <img src={qr} alt={`${r.name} QR`} className="h-40 w-40 rounded border border-slate-200" /> : <div className="h-40 w-40 animate-pulse rounded bg-slate-100" />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
