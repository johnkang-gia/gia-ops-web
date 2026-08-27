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

// 배정 한 줄의 학생 칸.
//
// 연결된 아이는 **명부의 이름**을, 연결 안 된 아이는 적힌 원문을 흐리게 보여주고 왜 안 됐는지를
// 답니다. 예전처럼 원문만 그리면 "이 이름이 명부의 그 아이인지" 알 방법이 없었습니다.
const REASON_CHIP: Record<string, { label: string; cls: string; help: string }> = {
  유치부: { label: "유치", cls: "bg-amber-50 text-amber-600", help: "유치부 - 기사님이 이 정류장에 들르는 이유입니다. 명부와 연결하지 않습니다." },
  퇴소: { label: "퇴소", cls: "bg-slate-100 text-slate-400", help: "유치부도 아닌데 명부에 없는 아이입니다. 배정을 정리할 대상입니다." },
  확인필요: { label: "확인", cls: "bg-red-50 text-red-500", help: "동명이인 등으로 자동 연결이 안 됐습니다. 사람이 지정해야 합니다." },
};

function StudentCell({
  d,
  raw,
  students,
  onLink,
}: {
  d: { name: string; grade: string | null; linked: boolean; reason: string | null };
  raw: string;
  students: StudentLite[];
  onLink: (studentId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  // 고칠 수 없는 화면은 보여주기만 하는 화면입니다. 여기서 바로 붙일 수 있어야
  // "확인필요"가 실제로 줄어듭니다 - 다른 화면으로 넘어가야 하면 아무도 안 합니다.
  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={d.linked ? "" : ""}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          onLink(e.target.value || null);
          setEditing(false);
        }}
        className="w-24 shrink-0 rounded border border-blue-300 bg-white px-1 py-0.5 text-[10px] outline-none"
      >
        <option value="">{d.linked ? "(연결 해제)" : "학생 선택…"}</option>
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.grade ? ` (${s.grade})` : ""}
          </option>
        ))}
      </select>
    );
  }

  if (d.linked) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex w-24 shrink-0 items-center gap-1 truncate text-left"
        title={raw !== d.name ? `명단 표기: ${raw} · 눌러서 바꾸기` : `${d.name} · 눌러서 바꾸기`}
      >
        <span className="truncate text-[11px] font-semibold text-slate-700">{d.name}</span>
      </button>
    );
  }
  return <UnlinkedCell d={d} onEdit={() => setEditing(true)} />;
}

function UnlinkedCell({
  d,
  onEdit,
}: {
  d: { name: string; reason: string | null };
  onEdit: () => void;
}) {
  {
    const chip = REASON_CHIP[d.reason ?? "확인필요"] ?? REASON_CHIP.확인필요;
    return (
      <button
        type="button"
        onClick={onEdit}
        className="flex w-24 shrink-0 items-center gap-1 truncate text-left"
        title={chip.help + " · 눌러서 학생을 지정할 수 있습니다"}
      >
        <span className="truncate text-[11px] font-medium text-slate-400">{d.name}</span>
        <span className={"shrink-0 rounded px-1 text-[9px] font-bold " + chip.cls}>{chip.label}</span>
      </button>
    );
  }
}

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

  // ── 명부와의 연결 ────────────────────────────────────────────────────────
  //
  // 담당자: "노선·배정 탭에 아이들이 제대로 우리 명부와 매칭되지 않아."
  //
  // 원인: 이 화면이 **student_name_raw(적힌 그대로의 문자열)만 보고 있었습니다.** 배정에
  // student_id를 채워 넣어도 화면은 여전히 원문을 그리니, 연결이 됐는지 안 됐는지 알 수가
  // 없었습니다. 이름이 조금만 달라도(공백·꼬리표) 명부와 따로 놀고요.
  //
  // 이제 student_id로 명부에서 찾아 **명부의 이름·학년**을 보여주고, 연결이 안 된 줄은
  // 왜 안 됐는지(유치부/퇴소/확인필요)를 눈에 보이게 답니다. 화면이 데이터의 실제 상태를
  // 그대로 비추게 하는 것이 요점입니다 - 그래야 뭘 고쳐야 하는지 보입니다.
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  type Display = { name: string; grade: string | null; linked: boolean; reason: string | null };
  function displayFor(a: ShuttleAssignment): Display {
    const s = a.student_id ? studentById.get(a.student_id) : undefined;
    if (s) return { name: s.name, grade: s.grade ?? null, linked: true, reason: null };
    return {
      name: a.student_name_raw,
      grade: null,
      linked: false,
      reason: a.unlinked_reason ?? "확인필요",
    };
  }

  function gradeFor(a: ShuttleAssignment): string | null {
    return displayFor(a).grade;
  }

  /** 배정 한 줄을 학생에게 붙이거나(또는 떼거나) 합니다. */
  async function linkStudent(a: ShuttleAssignment, studentId: string | null) {
    const supabase = createClient();
    // CHECK 제약: student_id가 있으면 unlinked_reason은 비어 있어야 하고, 없으면 반드시 있어야
    // 합니다. 둘을 항상 함께 바꿔야 저장이 됩니다.
    const patch = studentId
      ? { student_id: studentId, unlinked_reason: null }
      : { student_id: null, unlinked_reason: "확인필요" };
    setAssignments((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("shuttle_assignments").update(patch).eq("id", a.id);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      setAssignments((prev) => prev.map((x) => (x.id === a.id ? a : x)));
      return;
    }
    const s = studentId ? studentById.get(studentId) : null;
    notify(s ? `${a.student_name_raw} → ${s.name} 으로 연결했습니다` : "연결을 해제했습니다", "success");
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
        return displayFor(x.assignment).name.localeCompare(displayFor(y.assignment).name, "ko");
      });
    }
    return [...groups.values()].sort((x, y) => {
      const rd = routeNoSortKey(x.route.route_no) - routeNoSortKey(y.route.route_no);
      if (rd !== 0) return rd;
      return x.route.route_no.localeCompare(y.route.route_no, "ko");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, direction, stopById, routeById]);

  // 연결 상태 요약. 화면 위에 숫자로 떠 있어야 "지금 몇 개가 안 붙어 있는지"가 보입니다.
  const linkSummary = useMemo(() => {
    let linked = 0;
    const byReason = new Map<string, number>();
    for (const g of busGroups) {
      for (const r of g.rows) {
        const d = displayFor(r.assignment);
        if (d.linked) linked += 1;
        else byReason.set(d.reason ?? "확인필요", (byReason.get(d.reason ?? "확인필요") ?? 0) + 1);
      }
    }
    return { linked, byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busGroups, studentById]);

  // 정류장이 아직 안 정해진 아이들.
  //
  // 하원 명단을 PDF 기준으로 다시 넣을 때 생긴 상태입니다. PDF는 배차표라 정류장이 없어서,
  // 예전 배정에서 정류장을 물려받지 못한 아이는 각 노선의 '정류장 미지정' 자리(seq 999)에
  // 모아뒀습니다. 탑승 명단과 요일은 정상이지만 정류장은 사람이 채워야 합니다.
  //
  // 이 숫자가 없으면 노선을 하나씩 열어봐야 몇 명이 남았는지 알 수 없습니다. 다 채우면
  // 배지가 사라집니다 - 끝이 보이는 일은 끝이 보여야 합니다.
  const unassignedStopCount = useMemo(() => {
    let n = 0;
    for (const g of busGroups) {
      for (const r of g.rows) {
        if ((stopById.get(r.assignment.stop_id)?.seq ?? 0) >= 999) n += 1;
      }
    }
    return n;
  }, [busGroups, stopById]);
  const [onlyUnassignedStop, setOnlyUnassignedStop] = useState(false);

  const visibleGroups = useMemo(() => {
    if (onlyUnassignedStop) {
      return busGroups
        .map((g) => ({ ...g, rows: g.rows.filter((r) => (stopById.get(r.assignment.stop_id)?.seq ?? 0) >= 999) }))
        .filter((g) => g.rows.length > 0);
    }
    const q = query.trim().toLowerCase();
    if (!q) return busGroups;
    return busGroups
      .map((g) => {
        const routeMatches = `${g.route.route_no} ${g.route.name ?? ""}`.toLowerCase().includes(q);
        // 원문과 명부 이름 둘 다로 찾습니다 - 선생님은 어느 쪽으로 기억하고 계실지 모릅니다.
        const rows = routeMatches
          ? g.rows
          : g.rows.filter((r) => {
              const d = displayFor(r.assignment);
              return d.name.toLowerCase().includes(q) || r.assignment.student_name_raw.toLowerCase().includes(q);
            });
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
        {/* 명부 연결 상태 - 이름 옆 회색 꼬리표가 몇 개인지 위에서 바로 보이게. */}
        <span className="flex shrink-0 items-center gap-1 text-[10px]">
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700" title="명부와 연결된 배정">
            명부연결 {linkSummary.linked}
          </span>
          {linkSummary.byReason.map(([reason, n]) => {
            const chip = REASON_CHIP[reason] ?? REASON_CHIP.확인필요;
            return (
              <span key={reason} className={"rounded px-1.5 py-0.5 font-bold " + chip.cls} title={chip.help}>
                {reason} {n}
              </span>
            );
          })}
          {/* 정류장이 비어 있는 아이들. 누르면 그 아이들만 모아 보여줘 한 자리에서 채웁니다. */}
          {unassignedStopCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyUnassignedStop((v) => !v)}
              className={
                "rounded px-1.5 py-0.5 font-bold transition " +
                (onlyUnassignedStop ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100")
              }
              title="정류장이 아직 안 정해진 아이들만 봅니다. 각 줄의 정류장 칸에서 골라주세요."
            >
              정류장 미지정 {unassignedStopCount}
            </button>
          )}
        </span>
      </div>

      {onlyUnassignedStop && (
        <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-800">
          정류장이 아직 안 정해진 아이들만 보고 있습니다. 각 줄의 <b>정류장</b> 칸에서 고르면 목록에서 사라집니다.
          탑승 명단과 요일은 이미 정상이라, 정류장을 안 채워도 체크표·안내보드는 그대로 동작합니다.
        </div>
      )}

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
                    <StudentCell d={displayFor(a)} raw={a.student_name_raw} students={students} onLink={(sid) => linkStudent(a, sid)} />
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
