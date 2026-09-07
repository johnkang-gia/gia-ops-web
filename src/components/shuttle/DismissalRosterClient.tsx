"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";

// 하원 셔틀명단 설정(요청: 하원체크표 탭 분리). 노선(호차)별로 누가 무슨 요일에 타는지 한
// 화면에서 보고 바로 고칩니다. 요일 버튼(월~금)을 눌러 켜고 끄면 즉시 저장되고, 체크표·안내
// 보드·실시간 셔틀에 그대로 반영됩니다. (요일)이름 = 그 요일만 탑승 표기와 같은 데이터입니다.
export type RosterAssignment = {
  id: string;
  stop_id: string;
  student_name_raw: string;
  /** 명부의 학생. 이름만 적힌 옛 줄은 비어 있을 수 있습니다. */
  student_id?: string | null;
  weekdays: number[];
  note: string | null;
};

/** 명부에서 고를 학생. 이름만 손으로 치면 오타 한 글자로 다른 아이가 됩니다. */
export type RosterStudent = {
  id: string;
  name: string;
  grade: string | null;
  class_name: string | null;
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

export default function DismissalRosterClient({
  initialRoutes,
  students,
}: {
  initialRoutes: RosterRoute[];
  students: RosterStudent[];
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [routes, setRoutes] = useState<RosterRoute[]>(initialRoutes);
  const [query, setQuery] = useState("");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  // 이미 어느 노선에든 배정된 학생. 두 번 넣으면 체크표에 같은 아이가 두 줄로 뜹니다.
  const assignedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of routes) for (const a of r.assignments) if (a.student_id) s.add(a.student_id);
    return s;
  }, [routes]);

  /** 이름을 치면 명부에서 찾습니다. 이름·학년·반 어느 쪽으로도 걸립니다. */
  const candidates = useMemo(() => {
    const needle = newName.trim().toLowerCase();
    if (!needle) return [];
    return students
      .filter((s) => `${s.name} ${s.grade ?? ""} ${s.class_name ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [newName, students]);

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

  /**
   * 명부에서 고른 학생을 이 노선에 넣습니다.
   *
   * 앞 판은 이름을 손으로 치게 하고, 그 노선에 정류장이 하나도 없으면 **아무 말 없이
   * 아무 일도 안 했습니다.** 눌러도 반응이 없으니 「추가가 안 된다」가 됩니다.
   * 이제 왜 안 되는지 말합니다.
   *
   * 그리고 명부의 학생 번호를 함께 남깁니다 - 이름만 적힌 줄은 오타 한 글자로 다른 아이가
   * 되고, 대시보드·체크표가 그 아이를 못 찾습니다.
   */
  async function addStudent(route: RosterRoute, s: RosterStudent) {
    if (!route.firstStopId) {
      notify(`${route.route_no}호에 정류장이 없어 학생을 넣을 수 없습니다. [노선 관리]에서 정류장을 먼저 만들어주세요.`, "error");
      return;
    }
    if (assignedIds.has(s.id)) {
      notify(`${s.name} 학생은 이미 다른 노선에 있습니다. 옮기려면 그쪽에서 먼저 빼주세요.`, "error");
      return;
    }
    setBusy(true);
    const { data, error } = await createClient()
      .from("shuttle_assignments")
      // 기본은 월~금 전부입니다. 넣자마자 요일 버튼이 보이므로, 안 타는 요일만 눌러서 끕니다 -
      // 아무 요일도 없이 넣으면 「넣었는데 어디에도 안 뜬다」가 됩니다.
      .insert({ stop_id: route.firstStopId, student_id: s.id, student_name_raw: s.name, weekdays: [1, 2, 3, 4, 5] })
      .select("id, stop_id, student_id, student_name_raw, weekdays, note")
      .single();
    setBusy(false);
    if (error || !data) {
      // 조용히 넘기면 화면에는 아무 일도 없었던 것처럼 보입니다.
      notify("넣지 못했습니다: " + (error?.message ?? "알 수 없는 이유"), "error");
      return;
    }
    setRoutes((prev) =>
      prev.map((r) => (r.id === route.id ? { ...r, assignments: [...r.assignments, data as RosterAssignment] } : r)),
    );
    setNewName("");
    setAddingFor(null);
    notify(`${s.name} 학생을 ${route.route_no}호에 넣었습니다. 안 타는 요일은 눌러서 끄세요.`, "success");
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
              // 이름을 손으로 치지 않고 **명부에서 고릅니다.** 오타 한 글자면 다른 아이가 되고,
              // 그 줄은 대시보드·체크표에서 학생을 못 찾습니다.
              <div className="mt-2">
                <div className="flex gap-1.5">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && candidates.length === 1) void addStudent(r, candidates[0]);
                      if (e.key === "Escape") { setAddingFor(null); setNewName(""); }
                    }}
                    autoFocus
                    placeholder="명부에서 찾기 (이름·학년·반)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  />
                  <button onClick={() => { setAddingFor(null); setNewName(""); }} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">취소</button>
                </div>

                {/* 없으면 「없다」고 말합니다. 빈 목록만 두면 다 쳤는데 아무 일도 안 일어난 것처럼 보입니다. */}
                <div className="mt-1 flex flex-col gap-0.5">
                  {newName.trim() === "" ? (
                    <p className="px-1 py-1 text-[11px] text-slate-400">이름을 치면 명부에서 찾습니다.</p>
                  ) : candidates.length === 0 ? (
                    <p className="px-1 py-1 text-[11px] text-rose-500">명부에 「{newName.trim()}」이(가) 없습니다.</p>
                  ) : (
                    candidates.map((s) => {
                      const already = assignedIds.has(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={busy || already}
                          onClick={() => void addStudent(r, s)}
                          className={
                            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12px] " +
                            (already ? "bg-slate-50 text-slate-300" : "bg-blue-50 text-blue-900 hover:bg-blue-100")
                          }
                        >
                          <b>{s.name}</b>
                          <span className="text-[10px] text-slate-400">
                            {[s.grade, s.class_name].filter(Boolean).join(" ")}
                          </span>
                          {already && <span className="ml-auto text-[10px] font-bold">이미 배정됨</span>}
                        </button>
                      );
                    })
                  )}
                </div>
                <p className="mt-1 px-1 text-[10px] text-slate-400">
                  넣으면 월~금 전부 켜집니다. 안 타는 요일은 아래 요일 버튼으로 끄세요.
                </p>
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
