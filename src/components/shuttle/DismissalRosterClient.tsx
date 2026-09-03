"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/common/ConfirmProvider";

// 하원 셔틀명단 설정(요청: 하원체크표 탭 분리). 노선(호차)별로 누가 무슨 요일에 타는지 한
// 화면에서 보고 바로 고칩니다. 요일 버튼(월~금)을 눌러 켜고 끄면 즉시 저장되고, 체크표·안내
// 보드·실시간 셔틀에 그대로 반영됩니다. (요일)이름 = 그 요일만 탑승 표기와 같은 데이터입니다.
export type RosterAssignment = {
  id: string;
  stop_id: string;
  student_name_raw: string;
  weekdays: number[];
  note: string | null;
};
export type RosterRoute = {
  id: string;
  route_no: string;
  name: string | null;
  driver_name: string | null;
  firstStopId: string | null;
  assignments: RosterAssignment[];
};

const WD_LABEL = ["", "월", "화", "수", "목", "금"];

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

export default function DismissalRosterClient({ initialRoutes }: { initialRoutes: RosterRoute[] }) {
  const confirmAction = useConfirm();
  const [routes, setRoutes] = useState<RosterRoute[]>(initialRoutes);
  const [query, setQuery] = useState("");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const sorted = useMemo(() => [...routes].sort((a, b) => natCompare(a.route_no, b.route_no)), [routes]);
  const q = query.trim();
  const visible = q
    ? sorted.filter((r) => r.route_no.includes(q) || r.assignments.some((a) => a.student_name_raw.includes(q)))
    : sorted;
  const totalStudents = routes.reduce((s, r) => s + r.assignments.length, 0);

  async function toggleDay(routeId: string, asg: RosterAssignment, day: number) {
    const has = asg.weekdays.includes(day);
    const next = has ? asg.weekdays.filter((d) => d !== day) : [...asg.weekdays, day].sort();
    setRoutes((prev) =>
      prev.map((r) =>
        r.id === routeId
          ? { ...r, assignments: r.assignments.map((a) => (a.id === asg.id ? { ...a, weekdays: next } : a)) }
          : r
      )
    );
    const supabase = createClient();
    await supabase.from("shuttle_assignments").update({ weekdays: next }).eq("id", asg.id);
  }

  async function removeStudent(routeId: string, asg: RosterAssignment) {
    if (!(await confirmAction(`${asg.student_name_raw} 학생을 이 노선 명단에서 뺄까요?`, { danger: true }))) return;
    setRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, assignments: r.assignments.filter((a) => a.id !== asg.id) } : r)));
    const supabase = createClient();
    await supabase.from("shuttle_assignments").delete().eq("id", asg.id);
  }

  async function addStudent(route: RosterRoute) {
    const name = newName.trim();
    if (!name || !route.firstStopId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("shuttle_assignments")
      .insert({ stop_id: route.firstStopId, student_name_raw: name, weekdays: [1, 2, 3, 4, 5] })
      .select("id, stop_id, student_name_raw, weekdays, note")
      .single();
    if (data) {
      setRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, assignments: [...r.assignments, data as RosterAssignment] } : r)));
      setNewName("");
      setAddingFor(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">🚌 하원 셔틀명단 (정규학기)</h1>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
          {routes.length}개 노선 · {totalStudents}명
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·호차 검색"
          className="ml-auto w-48 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        요일 버튼을 누르면 그 요일 탑승 여부가 바로 저장됩니다. 파란색 = 타는 요일. 이준서·이준우(중등) 형제는 4-2호(학원)·9호(집·기업은행)
        양쪽에 있고, 당일 하원 때 물어본 뒤 체크표에서 [오늘만] 노선 이동으로 확정하면 됩니다.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => (
          <div key={r.id} className="g-panel-solid p-3">
            <div className="mb-2 flex items-center justify-between">
              <b className="text-sm text-slate-800">{r.route_no}호{r.name && r.name !== `${r.route_no}호` ? ` · ${r.name}` : ""}</b>
              <span className="text-[11px] text-slate-400">
                {r.driver_name ? `${r.driver_name} · ` : ""}{r.assignments.length}명
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {r.assignments.map((a) => {
                const partTime = a.weekdays.length < 5;
                return (
                  <div key={a.id} className={"rounded-lg px-2 py-1.5 " + (partTime ? "bg-amber-50/70" : "bg-slate-50")}>
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700">
                        {a.student_name_raw}
                        {partTime && (
                          <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700">
                            {a.weekdays.map((d) => WD_LABEL[d]).join("")}만
                          </span>
                        )}
                      </span>
                      <div className="flex shrink-0 gap-0.5">
                        {[1, 2, 3, 4, 5].map((d) => {
                          const on = a.weekdays.includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => toggleDay(r.id, a, d)}
                              className={
                                "h-5 w-5 rounded text-[10px] font-bold transition " +
                                (on ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-400 hover:bg-slate-300")
                              }
                            >
                              {WD_LABEL[d]}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStudent(r.id, a)}
                        className="shrink-0 rounded px-1 text-xs text-red-300 hover:text-red-500"
                        title="명단에서 빼기"
                      >
                        ✕
                      </button>
                    </div>
                    {a.note && <p className="mt-0.5 text-[10px] text-slate-400">💡 {a.note}</p>}
                  </div>
                );
              })}
              {r.assignments.length === 0 && <p className="py-2 text-center text-[11px] text-slate-300">배정된 학생 없음</p>}
            </div>
            {addingFor === r.id ? (
              <div className="mt-2 flex gap-1.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addStudent(r)}
                  autoFocus
                  placeholder="학생 이름"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                />
                <button onClick={() => addStudent(r)} className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-bold text-white">추가</button>
                <button onClick={() => { setAddingFor(null); setNewName(""); }} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">취소</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAddingFor(r.id); setNewName(""); }}
                className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-1 text-[11px] text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              >
                + 학생 추가
              </button>
            )}
          </div>
        ))}
      </div>
      {visible.length === 0 && <p className="py-10 text-center text-sm text-slate-400">검색 결과가 없습니다.</p>}
    </div>
  );
}
