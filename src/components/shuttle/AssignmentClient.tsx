"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShuttleAssignment, ShuttleRoute, ShuttleStop, WrStudent } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { DIVISION_BADGE, divisionFromClassRaw } from "@/lib/shuttleDivision";

const WEEKDAYS = [
  { n: 1, label: "월" },
  { n: 2, label: "화" },
  { n: 3, label: "수" },
  { n: 4, label: "목" },
  { n: 5, label: "금" },
];

type StudentLite = Pick<WrStudent, "id" | "name" | "grade" | "class_name">;

export default function AssignmentClient({
  routes,
  stops,
  initialAssignments,
  students,
}: {
  routes: ShuttleRoute[];
  stops: ShuttleStop[];
  initialAssignments: ShuttleAssignment[];
  students: StudentLite[];
}) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const [assignments, setAssignments] = useState(initialAssignments);
  const [query, setQuery] = useState("");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newRouteId, setNewRouteId] = useState("");
  const [newStopId, setNewStopId] = useState("");

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const stopById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);

  // 배정을 "학생 표기 이름" 기준으로 묶습니다. 명부에 없는 유치부·중고등부 학생도 셔틀에는
  // 있으므로, 명부(students)가 아니라 배정에 적힌 이름을 기준으로 삼아야 전부 보입니다.
  const groups = useMemo(() => {
    const m = new Map<string, ShuttleAssignment[]>();
    for (const a of assignments) {
      const key = a.student_name_raw;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return [...m.entries()]
      .map(([name, list]) => ({ name, list }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [assignments]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups.slice(0, 60);
    return groups.filter((g) => {
      if (g.name.toLowerCase().includes(q)) return true;
      // 노선 번호/권역명으로도 찾을 수 있게 합니다.
      return g.list.some((a) => {
        const st = stopById.get(a.stop_id);
        const r = st ? routeById.get(st.route_id) : null;
        return r && `${r.direction} ${r.route_no} ${r.name ?? ""}`.toLowerCase().includes(q);
      });
    });
  }, [groups, query, stopById, routeById]);

  const stopsOfNewRoute = useMemo(
    () => stops.filter((s) => s.route_id === newRouteId).sort((a, b) => a.seq - b.seq),
    [stops, newRouteId]
  );

  async function toggleWeekday(a: ShuttleAssignment, n: number) {
    const next = a.weekdays.includes(n) ? a.weekdays.filter((d) => d !== n) : [...a.weekdays, n].sort();
    if (next.length === 0) {
      notify("최소 한 요일은 남겨주세요. 아예 안 타면 배정을 삭제하시면 됩니다.", "error");
      return;
    }
    setAssignments((prev) => prev.map((x) => (x.id === a.id ? { ...x, weekdays: next } : x)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_assignments").update({ weekdays: next }).eq("id", a.id);
    if (error) notify("저장하지 못했습니다: " + error.message, "error");
  }

  async function moveAssignment(a: ShuttleAssignment, stopId: string) {
    setAssignments((prev) => prev.map((x) => (x.id === a.id ? { ...x, stop_id: stopId } : x)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_assignments").update({ stop_id: stopId }).eq("id", a.id);
    if (error) notify("옮기지 못했습니다: " + error.message, "error");
  }

  async function removeAssignment(a: ShuttleAssignment) {
    if (!(await confirmAction(`${a.student_name_raw} 학생의 이 배정을 삭제할까요?`, { danger: true }))) return;
    setAssignments((prev) => prev.filter((x) => x.id !== a.id));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_assignments").delete().eq("id", a.id);
    if (error) notify("삭제하지 못했습니다: " + error.message, "error");
  }

  // 같은 학생에게 배정을 하나 더 추가합니다(요일별로 다른 노선을 타는 경우).
  async function addAssignment(studentName: string, sample: ShuttleAssignment | undefined) {
    if (!newStopId) {
      notify("정류장을 선택해주세요.", "error");
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("shuttle_assignments")
      .insert({
        stop_id: newStopId,
        student_id: sample?.student_id ?? students.find((s) => s.name.split("(")[0].trim() === studentName)?.id ?? null,
        student_name_raw: studentName,
        class_raw: sample?.class_raw ?? null,
        weekdays: [1, 2, 3, 4, 5],
        guardian_phone: sample?.guardian_phone ?? null,
      })
      .select()
      .single();
    if (error || !data) {
      notify("추가하지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setAssignments((prev) => [...prev, data as ShuttleAssignment]);
    setAddingFor(null);
    setNewRouteId("");
    setNewStopId("");
  }

  function routeLabel(a: ShuttleAssignment) {
    const st = stopById.get(a.stop_id);
    const r = st ? routeById.get(st.route_id) : null;
    if (!r || !st) return { dir: "?", head: "(정류장 없음)", addr: "" };
    return {
      dir: r.direction,
      head: `${r.route_no}호 ${r.name ?? ""}`,
      addr: `${st.stop_time ?? ""} ${st.address ?? ""}${st.gate ? ` (${st.gate})` : ""}`.trim(),
    };
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="학생 이름 또는 노선(예: 잠원, 3호)으로 검색"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="shrink-0 text-[11px] text-slate-400">
          {query.trim() ? `${visible.length}명` : `전체 ${groups.length}명 중 60명 표시`}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {visible.map((g) => {
          const sample = g.list[0];
          return (
            <div key={g.name} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-800">{g.name}</span>
                {sample?.class_raw && (
                  <>
                    <span className="text-[11px] text-slate-400">{sample.class_raw}</span>
                    <span className={"rounded-full px-1.5 py-0.5 text-[9px] font-semibold " + DIVISION_BADGE[divisionFromClassRaw(sample.class_raw)]}>
                      {divisionFromClassRaw(sample.class_raw)}
                    </span>
                  </>
                )}
                {sample?.guardian_phone && <span className="text-[10px] text-slate-400">📞 {sample.guardian_phone}</span>}
                <button
                  onClick={() => {
                    setAddingFor(addingFor === g.name ? null : g.name);
                    setNewRouteId("");
                    setNewStopId("");
                  }}
                  className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  {addingFor === g.name ? "닫기" : "+ 배정 추가"}
                </button>
              </div>

              {addingFor === g.name && (
                <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400">노선</label>
                    <select
                      value={newRouteId}
                      onChange={(e) => {
                        setNewRouteId(e.target.value);
                        setNewStopId("");
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px]"
                    >
                      <option value="">선택</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.direction} {r.route_no}호 {r.name ?? ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400">정류장</label>
                    <select
                      value={newStopId}
                      onChange={(e) => setNewStopId(e.target.value)}
                      disabled={!newRouteId}
                      className="max-w-xs rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      <option value="">선택</option>
                      {stopsOfNewRoute.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.stop_time} {s.address}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => addAssignment(g.name, sample)}
                    className="rounded-lg bg-gia-navy px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    추가
                  </button>
                </div>
              )}

              <div className="space-y-1.5">
                {g.list.map((a) => {
                  const info = routeLabel(a);
                  const routeId = stopById.get(a.stop_id)?.route_id;
                  const siblingStops = stops.filter((s) => s.route_id === routeId).sort((x, y) => x.seq - y.seq);
                  return (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <span
                        className={
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                          (info.dir === "등원" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700")
                        }
                      >
                        {info.dir}
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold text-slate-700">{info.head}</span>
                      <select
                        value={a.stop_id}
                        onChange={(e) => moveAssignment(a, e.target.value)}
                        title="정류장 바꾸기"
                        className="min-w-0 max-w-[280px] flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-slate-500 hover:border-slate-200"
                      >
                        {siblingStops.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.stop_time} {s.address}
                          </option>
                        ))}
                      </select>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {WEEKDAYS.map((w) => {
                          const on = a.weekdays.includes(w.n);
                          return (
                            <button
                              key={w.n}
                              onClick={() => toggleWeekday(a, w.n)}
                              title={on ? `${w.label}요일 탑승 - 누르면 해제` : `${w.label}요일 안 탐 - 누르면 설정`}
                              className={
                                "h-5 w-5 rounded text-[10px] font-bold transition " +
                                (on ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400 hover:bg-slate-300")
                              }
                            >
                              {w.label}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => removeAssignment(a)}
                        className="shrink-0 text-slate-300 hover:text-red-500"
                        title="이 배정 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <p className="py-10 text-center text-sm text-slate-400">검색 결과가 없습니다.</p>}
      </div>
    </div>
  );
}
