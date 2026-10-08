"use client";

import { useEffect, useState } from "react";
import type { ConsultState } from "@/lib/consult/server";
import type { StaffOption } from "./ConsultEventClient";
import { send } from "./shared";

type Row = { key: string; id: string | null; name: string; teacher_email: string; teacher_name: string; grade_label: string };

/**
 * 상담실 — 이름·면담 선생님·안내 글자.
 *
 * 선생님은 **계정으로** 고릅니다. 선생님 화면이 «내 상담실»을 그 계정으로 찾고, 선생님은 자기
 * 방에 온 예약만 호출·시작·종료할 수 있습니다. 계정이 없는 분(외부 상담사 등)은 이름만 적으면
 * 되고, 그 방은 안내데스크가 대신 눌러 줍니다.
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
    </section>
  );
}
