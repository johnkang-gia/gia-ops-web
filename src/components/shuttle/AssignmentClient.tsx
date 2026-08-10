"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShuttleAssignment, ShuttleDirection, ShuttleRoute, ShuttleStop, WrStudent } from "@/lib/types";
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

// 노선 번호("1", "2A", "10")에서 앞의 숫자만 뽑아 정렬 기준으로 씁니다 - 문자열로만 정렬하면
// "10호차"가 "2호차"보다 앞에 와버립니다.
function routeNoSortKey(no: string): number {
  const m = no.match(/\d+/);
  return m ? Number(m[0]) : 999;
}

// 학년 문자열("1", "2학년" 등)에서 숫자만 뽑아 정렬 기준으로 씁니다. 유치부·중고등부처럼 학년
// 정보가 없는 학생은 맨 뒤로 보냅니다.
function gradeSortKey(grade: string | null | undefined): number {
  if (!grade) return 999;
  const m = grade.match(/\d+/);
  return m ? Number(m[0]) : 999;
}

type Row = {
  assignment: ShuttleAssignment;
  route: ShuttleRoute;
  stop: ShuttleStop;
  grade: string | null;
};

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
  const [direction, setDirection] = useState<ShuttleDirection>("등원");
  const [query, setQuery] = useState("");
  const [addingForRoute, setAddingForRoute] = useState<string | null>(null);
  const [newStudentName, setNewStudentName] = useState("");
  const [newStopId, setNewStopId] = useState("");

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const stopById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);

  // 학생별 학년 조회용 - 배정에는 학년이 없어서, 명부(students)에서 student_id 또는 이름으로
  // 찾아옵니다. 명부에 없는 유치부·중고등부 학생은 학년을 알 수 없어 정렬에서 맨 뒤로 갑니다.
  const gradeByStudentId = useMemo(() => new Map(students.map((s) => [s.id, s.grade])), [students]);
  const gradeByName = useMemo(() => new Map(students.map((s) => [s.name.split("(")[0].trim(), s.grade])), [students]);

  function gradeFor(a: ShuttleAssignment): string | null {
    if (a.student_id && gradeByStudentId.has(a.student_id)) return gradeByStudentId.get(a.student_id) ?? null;
    return gradeByName.get(a.student_name_raw) ?? null;
  }

  // 요청 2: "탑승배정의 경우, 학생학년별, 셔틀호수별로 정렬해서 볼 수 있게... 우선적으로 셔틀
  // 호수 별로 정렬... 1호차에서 아이들 목록이 뜨고 거기에서 요일을 관리... 등원/하원으로 나눠서".
  // 선택한 방향(등원/하원)의 배정만 노선(호차) 단위로 묶고, 노선은 호수 순, 노선 안에서는
  // 학년 순으로 정렬합니다.
  const busGroups = useMemo(() => {
    const groups = new Map<string, { route: ShuttleRoute; rows: Row[] }>();
    for (const a of assignments) {
      const stop = stopById.get(a.stop_id);
      const route = stop ? routeById.get(stop.route_id) : undefined;
      if (!stop || !route || route.direction !== direction) continue;
      const g = groups.get(route.id) ?? { route, rows: [] };
      g.rows.push({ assignment: a, route, stop, grade: gradeFor(a) });
      groups.set(route.id, g);
    }
    for (const g of groups.values()) {
      g.rows.sort((x, y) => {
        const gd = gradeSortKey(x.grade) - gradeSortKey(y.grade);
        if (gd !== 0) return gd;
        return x.assignment.student_name_raw.localeCompare(y.assignment.student_name_raw, "ko");
      });
    }
    return [...groups.values()].sort((x, y) => {
      const rd = routeNoSortKey(x.route.route_no) - routeNoSortKey(y.route.route_no);
      if (rd !== 0) return rd;
      return x.route.route_no.localeCompare(y.route.route_no, "ko");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, direction, stopById, routeById]);

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return busGroups;
    return busGroups
      .map((g) => {
        const routeMatches = `${g.route.route_no} ${g.route.name ?? ""}`.toLowerCase().includes(q);
        const rows = routeMatches ? g.rows : g.rows.filter((r) => r.assignment.student_name_raw.toLowerCase().includes(q));
        return { ...g, rows };
      })
      .filter((g) => g.rows.length > 0);
  }, [busGroups, query]);

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

  // 학생을 새로 추가합니다 - 어느 호차인지는 newStopId(그 호차 소속 정류장)로 결정됩니다.
  async function addAssignment() {
    const name = newStudentName.trim();
    if (!name) {
      notify("학생 이름을 입력해주세요.", "error");
      return;
    }
    if (!newStopId) {
      notify("정류장을 선택해주세요.", "error");
      return;
    }
    const matched = students.find((s) => s.name.split("(")[0].trim() === name);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("shuttle_assignments")
      .insert({
        stop_id: newStopId,
        student_id: matched?.id ?? null,
        student_name_raw: name,
        class_raw: matched?.class_name ?? null,
        weekdays: [1, 2, 3, 4, 5],
        guardian_phone: null,
      })
      .select()
      .single();
    if (error || !data) {
      notify("추가하지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setAssignments((prev) => [...prev, data as ShuttleAssignment]);
    setAddingForRoute(null);
    setNewStudentName("");
    setNewStopId("");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 요청: "탑승배정은 등원/하원으로 나눠서 관리 되로록". */}
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <div className="flex shrink-0 gap-1 rounded-full bg-slate-100 p-0.5">
          {(["등원", "하원"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={
                "rounded-full px-3 py-1.5 text-xs font-bold transition " +
                (direction === d ? "bg-white text-gia-navy shadow-sm" : "text-slate-500 hover:text-slate-700")
              }
            >
              {d === "등원" ? "🌅 등원" : "🌆 하원"}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="학생 이름 또는 노선(예: 잠원, 3호)으로 검색"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="shrink-0 text-[11px] text-slate-400">
          {direction} {visibleGroups.reduce((n, g) => n + g.rows.length, 0)}명 · {visibleGroups.length}개 호차
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {visibleGroups.map((g) => {
          const over = g.route.usable_capacity != null && g.rows.length > g.route.usable_capacity;
          const stopsOfRoute = stops.filter((s) => s.route_id === g.route.id).sort((a, b) => a.seq - b.seq);
          return (
            <div key={g.route.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                    (direction === "등원" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700")
                  }
                >
                  {direction}
                </span>
                <span className="text-sm font-bold text-slate-800">{g.route.route_no}호차</span>
                {g.route.name && <span className="text-[11px] text-slate-400">{g.route.name}</span>}
                <span className="text-[11px] text-slate-400">{g.route.depart_time}</span>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                  {g.rows.length}명{g.route.usable_capacity != null && ` / ${g.route.usable_capacity}`}
                </span>
                {over && <span className="text-[10px] font-bold text-red-500">⚠️ 정원 초과</span>}
                <button
                  onClick={() => {
                    setAddingForRoute(addingForRoute === g.route.id ? null : g.route.id);
                    setNewStudentName("");
                    setNewStopId("");
                  }}
                  className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  {addingForRoute === g.route.id ? "닫기" : "+ 학생 추가"}
                </button>
              </div>

              {addingForRoute === g.route.id && (
                <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400">학생 이름</label>
                    <input
                      list="assignment-student-names"
                      value={newStudentName}
                      onChange={(e) => setNewStudentName(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px]"
                      placeholder="이름"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400">정류장</label>
                    <select
                      value={newStopId}
                      onChange={(e) => setNewStopId(e.target.value)}
                      className="max-w-xs rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px]"
                    >
                      <option value="">선택</option>
                      {stopsOfRoute.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.stop_time} {s.address}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => addAssignment()}
                    className="rounded-lg bg-gia-navy px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    추가
                  </button>
                </div>
              )}

              <div className="space-y-1">
                {g.rows.map(({ assignment: a, grade }) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <span className="w-24 shrink-0 truncate text-[11px] font-semibold text-slate-700" title={a.student_name_raw}>
                      {a.student_name_raw}
                    </span>
                    {grade && <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[9px] text-slate-400">{grade}학년</span>}
                    {a.class_raw && !grade && (
                      <span className={"shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold " + DIVISION_BADGE[divisionFromClassRaw(a.class_raw)]}>
                        {divisionFromClassRaw(a.class_raw)}
                      </span>
                    )}
                    <select
                      value={a.stop_id}
                      onChange={(e) => moveAssignment(a, e.target.value)}
                      title="정류장 바꾸기"
                      className="min-w-0 max-w-[240px] flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-slate-500 hover:border-slate-200"
                    >
                      {stopsOfRoute.map((s) => (
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
                ))}
              </div>
            </div>
          );
        })}
        {visibleGroups.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{direction} 배정이 없습니다.</p>}
      </div>

      <datalist id="assignment-student-names">
        {students.map((s) => (
          <option key={s.id} value={s.name.split("(")[0].trim()} />
        ))}
      </datalist>
    </div>
  );
}
