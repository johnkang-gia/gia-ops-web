"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";
import { buildWhereMaps, nameWithoutMark, needsCheck, normName, whereOf } from "@/lib/studentLabel";
import { DAY_LABEL, describeTaken, freeDays, takenDays, type RosterSlot } from "@/lib/rosterDays";
import { isMovedPermanently } from "@/lib/shuttleRoute";

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
  /**
   * **계속 이동**(`shuttle_assignments.override_route_id`). 체크표에서 「계속」으로 옮기면
   * 여기 남습니다. 이 칸을 안 읽으면 명단과 체크표가 서로 다른 호차를 말합니다.
   */
  override_route_id?: string | null;
  /** 정류장이 속한 원래 노선. 옮겨진 아이에게 「원래 N호」를 적어주기 위해 필요합니다. */
  homeRouteId?: string | null;
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
  const router = useRouter();
  const [routes, setRoutes] = useState<RosterRoute[]>(initialRoutes);
  const [query, setQuery] = useState("");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  // 서버가 새 명단을 내려주면 화면을 그것으로 맞춥니다. 이게 없으면 새로고침해도 처음 받은
  // 명단이 화면에 그대로 남습니다 - 고쳤는데 안 바뀌는 것처럼 보입니다.
  useEffect(() => setRoutes(initialRoutes), [initialRoutes]);

  /**
   * **체크표에서 고친 것이 이 화면에도 바로 와야 합니다.**
   *
   * 지금까지 구독은 체크표 쪽에만 있었습니다. 그래서 체크표에서 노선을 옮기면 체크표는
   * 바뀌는데 열어 둔 명단은 옛 자리를 계속 보여줬습니다. 두 사람이 각자 자기 화면을 믿고
   * 일하면, 어느 쪽이 맞는지는 아이가 차에 탄 뒤에야 드러납니다.
   *
   * **걸러내지 않고 전부 받습니다.** 예전에 체크표에서 `id=in.(지금 화면에 있는 것)` 으로
   * 걸렀다가 새로 들어온 줄과 지워진 줄을 통째로 놓쳤습니다 - 화면에 없는 것은 필터에도
   * 안 걸리니까요.
   */
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 한 번 고치면 여러 줄이 잇따라 오므로 조금 모았다 한 번만 다시 읽습니다.
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    const ch = supabase
      .channel("roster-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_assignments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_stops" }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [router]);

  /** 노선 번호를 찾는 표. 「원래 28호」를 적으려면 번호가 필요합니다. */
  const routeNoById = useMemo(() => new Map(routes.map((r) => [r.id, r.route_no])), [routes]);

  /** 지금 어느 줄에서 학생을 고르는 중인가. */
  const [linkingId, setLinkingId] = useState<string | null>(null);

  // 학년·반을 찾는 표. 만드는 일은 @/lib/studentLabel 한 곳에서 합니다 - 화면마다 손으로
  // 만들면 이름을 열쇠로 쓰게 되고, 그러면 김재이 셋이 같은 반으로 보입니다.
  const whereMaps = useMemo(() => buildWhereMaps(students), [students]);

  /**
   * 지금 누가 어느 요일에 어느 노선을 타는가.
   *
   * 예전에는 **「이미 어느 노선엔가 있으면 못 넣는다」**로 막았습니다. 그런데 황이안은
   * 월·화·수는 지금 타는 차, 목요일에는 다른 곳으로 가는 차를 탑니다. 목요일 노선이 새로
   * 생겨 넣으려는데 「이미 배정됨」으로 거절당했습니다.
   *
   * 막아야 하는 것은 「한 아이가 두 줄」이 아니라 **「같은 요일에 두 차」**입니다. 그건 있을
   * 수 없는 일이고, 그대로 두면 그 요일에 두 기사님이 같은 아이를 기다립니다. 요일이 안
   * 겹치면 줄이 둘이어도 괜찮습니다 - 체크표는 그날 타는 아이만 그립니다.
   */
  const slots = useMemo<RosterSlot[]>(
    () =>
      routes.flatMap((r) =>
        r.assignments.map((a) => ({
          routeNo: r.route_no,
          assignmentId: a.id,
          studentId: a.student_id ?? null,
          weekdays: a.weekdays ?? [],
        })),
      ),
    [routes],
  );

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
    // **켜는 쪽만 막습니다.** 끄는 것은 언제나 됩니다 - 잘못 켠 것을 못 끄면 더 답답합니다.
    if (!has && asg.student_id) {
      const other = takenDays(slots, asg.student_id, asg.id).get(day);
      if (other) {
        notify(
          `${asg.student_name_raw} 학생은 ${DAY_LABEL[day]}요일에 이미 ${other}호를 탑니다. 그쪽에서 먼저 끄고 켜주세요.`,
          "error",
        );
        return;
      }
    }
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

  /**
   * 고르기 목록에서 **같은 이름을 맨 위로** 올립니다.
   *
   * 명단에 「김재이」라고 적혀 있으면 고를 것은 김재이 셋 중 하나입니다. 137명을 훑게 하면
   * 아무도 안 고칩니다.
   */
  function sameNameFirst(raw: string): RosterStudent[] {
    const k = normName(nameWithoutMark(raw));
    const same = students.filter((s) => normName(s.name) === k);
    const rest = students.filter((s) => normName(s.name) !== k);
    return [...same, ...rest];
  }

  /** 배정 줄을 명부의 아이에게 잇습니다. 이어야 학년·반이 뜨고, 출결·픽업도 따라옵니다. */
  async function linkStudent(routeId: string, asg: RosterAssignment, studentId: string | null) {
    setLinkingId(null);
    if (!studentId) return;
    const s = students.find((x) => x.id === studentId);
    if (!s) return;
    setRoutes((prev) =>
      prev.map((r) =>
        r.id === routeId
          ? { ...r, assignments: r.assignments.map((a) => (a.id === asg.id ? { ...a, student_id: studentId, student_name_raw: s.name } : a)) }
          : r,
      ),
    );
    const { error } = await createClient()
      .from("shuttle_assignments")
      .update({ student_id: studentId, student_name_raw: s.name })
      .eq("id", asg.id);
    // 조용히 넘기면 화면에는 이어진 것처럼 보이는데 실제로는 안 이어져 있습니다.
    if (error) {
      notify("연결하지 못했습니다: " + error.message, "error");
      setRoutes((prev) =>
        prev.map((r) => (r.id === routeId ? { ...r, assignments: r.assignments.map((a) => (a.id === asg.id ? asg : a)) } : r)),
      );
      return;
    }
    notify(`${s.name} ${[s.grade, s.class_name].filter(Boolean).join(" ")} 으로 연결했습니다.`, "success");
  }

  /**
   * 계속 이동을 풀어 **원래 호차로 돌려보냅니다.**
   *
   * 이동이 걸려 있다는 것을 화면에 적기만 하면 아무도 안 풉니다 - 어디 가서 푸는지 모르니까요.
   * 보이는 그 자리에 단추를 둡니다.
   */
  async function unmove(asg: RosterAssignment) {
    const homeNo = asg.homeRouteId ? routeNoById.get(asg.homeRouteId) : null;
    if (!(await confirmAction(`${nameWithoutMark(asg.student_name_raw)} 학생을 원래 ${homeNo ?? "?"}호로 되돌릴까요?`))) return;
    const { error } = await createClient().from("shuttle_assignments").update({ override_route_id: null }).eq("id", asg.id);
    if (error) {
      notify("되돌리지 못했습니다: " + error.message, "error");
      return;
    }
    notify(`${nameWithoutMark(asg.student_name_raw)} 학생을 ${homeNo ?? "원래"}호로 되돌렸습니다.`, "success");
    router.refresh();
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
    // **이미 잡힌 요일만 빼고 넣습니다.**
    //
    // 다른 노선에 있다는 이유만으로 막지 않습니다 - 요일마다 다른 차를 타는 아이가 있습니다.
    // 다만 이미 잡힌 요일은 켜지 않습니다. 그 요일에 두 차가 같은 아이를 기다리게 됩니다.
    const taken = takenDays(slots, s.id);
    const free = freeDays(slots, s.id);
    if (free.length === 0) {
      notify(
        `${s.name} 학생은 월~금이 이미 다 차 있습니다 — ${describeTaken(taken)}. 옮기려면 그쪽에서 요일을 먼저 꺼주세요.`,
        "error",
      );
      return;
    }
    setBusy(true);
    const { data, error } = await createClient()
      .from("shuttle_assignments")
      // 남은 요일만 켭니다. 아무 요일도 없이 넣으면 「넣었는데 어디에도 안 뜬다」가 됩니다.
      // **이동은 비워서 넣습니다.** 값이 기본값에 기대면 언젠가 기본값이 바뀌고, 그때
      // 새로 넣은 아이가 엉뚱한 호차에 나타납니다. 여기서 넣는 아이는 이 노선을 탑니다.
      .insert({ stop_id: route.firstStopId, student_id: s.id, student_name_raw: s.name, weekdays: free, override_route_id: null })
      .select("id, stop_id, student_id, student_name_raw, weekdays, note, override_route_id")
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
    notify(
      taken.size > 0
        ? `${s.name} 학생을 ${route.route_no}호에 ${free.map((d) => DAY_LABEL[d]).join("·")}요일로 넣었습니다. ${describeTaken(taken)}는 이미 잡혀 있어 켜지 않았습니다.`
        : `${s.name} 학생을 ${route.route_no}호에 넣었습니다. 안 타는 요일은 눌러서 끄세요.`,
      "success",
    );
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
      {/* **학생을 넣는 자리가 여기라는 것을 먼저 말합니다.**
          노선 카드마다 아래쪽에 [+ 학생 추가]가 있는데, 카드가 마흔여덟 개라 처음 오는
          사람은 그 단추를 못 찾습니다. 화면 맨 위에서 한 줄로 알려주면 찾을 일이 없습니다. */}
      <p className="mb-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-900">
        <b>학생을 넣으려면</b> 넣을 호차 카드 아래의 <b className="rounded bg-white px-1 py-0.5">+ 학생 추가</b>를 누르고 이름을 치세요.
        여기서 넣고 뺀 것은 <b>하원 체크표·안내보드·도착체크에 바로</b> 반영됩니다.
        <br />
        <b>이미 다른 호차에 있는 아이도 넣을 수 있습니다</b> — 요일마다 다른 차를 타는 아이가 있어서,
        그쪽에 잡힌 요일만 빼고 켭니다(월·화·수가 20호면 목·금만 켜집니다).
      </p>
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
                // 이 카드는 **실제로 타는 노선**입니다. 원래 자리가 다르면 그 사실을 적습니다 -
                // 적지 않으면 명단에서 아무리 봐도 왜 여기 있는지 알 수가 없습니다. 옮겨졌는지는
                // @/lib/shuttleRoute 가 판정합니다(CLAUDE.md 2-11).
                const moved =
                  !!a.homeRouteId &&
                  isMovedPermanently({ homeRouteId: a.homeRouteId, permanentRouteId: a.override_route_id ?? null });
                const movedFrom = moved ? routeNoById.get(a.homeRouteId!) ?? "?" : null;
                return (
                  <div
                    key={a.id}
                    className={
                      "rounded-lg px-2 py-1.5 " +
                      (movedFrom ? "bg-violet-50 ring-1 ring-violet-200" : partTime ? "bg-amber-50/70" : "bg-slate-50")
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700">
                        {nameWithoutMark(a.student_name_raw)}
                        {/* 학년·반은 **학생 번호로** 찾습니다. 이름으로 찾으면 김재이 셋이
                            한 칸을 나눠 쓰게 되어 마지막 한 명의 반이 셋 모두에게 붙습니다.
                            번호가 없는 옛 줄은 아무것도 안 붙이고 「연결없음」으로 알립니다 -
                            엉뚱한 반을 적는 것보다 빈 것이 낫습니다. */}
                        {(() => {
                          const where = whereOf(whereMaps, a.student_id, a.student_name_raw);
                          if (where) {
                            return (
                              <span
                                className={
                                  "ml-1 align-baseline text-[9px] font-semibold " +
                                  (needsCheck(whereMaps, a.student_name_raw)
                                    ? "rounded bg-amber-100 px-1 text-amber-700"
                                    : "text-slate-400")
                                }
                                title={
                                  needsCheck(whereMaps, a.student_name_raw)
                                    ? "같은 이름이 여러 명입니다 - 학년·반을 꼭 확인하세요"
                                    : "학년·반"
                                }
                              >
                                {where}
                              </span>
                            );
                          }
                          // 못 찾았으면 **고칠 수 있게 합니다.** 「연결없음」이라고 적어만
                          // 두면 아무도 안 고치고, 그 줄은 내일도 누군지 모르는 채 남습니다.
                          // 누르면 그 자리에서 명부의 아이를 고릅니다.
                          return linkingId === a.id ? (
                            <select
                              autoFocus
                              defaultValue=""
                              onBlur={() => setLinkingId(null)}
                              onChange={(e) => void linkStudent(r.id, a, e.target.value || null)}
                              className="ml-1 w-40 rounded border border-blue-300 bg-white px-1 py-0.5 text-[10px] font-normal outline-none"
                            >
                              <option value="">명부에서 고르기…</option>
                              {sameNameFirst(a.student_name_raw).map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} {[s.grade, s.class_name].filter(Boolean).join(" ")}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setLinkingId(a.id)}
                              className="ml-1 rounded bg-orange-100 px-1 align-baseline text-[9px] font-semibold text-orange-700 hover:bg-orange-200"
                              title="명부와 이어져 있지 않아 학년·반을 알 수 없습니다 - 눌러서 어느 아이인지 골라주세요"
                            >
                              연결없음 ✎
                            </button>
                          );
                        })()}
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
                    {movedFrom && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-violet-700">
                        <span>
                          원래 <b>{movedFrom}호</b>인데 체크표에서 <b>계속 옮김</b>으로 여기에 있습니다.
                        </span>
                        <button
                          type="button"
                          onClick={() => void unmove(a)}
                          className="rounded bg-violet-100 px-1.5 py-0.5 font-bold text-violet-700 hover:bg-violet-200"
                          title={`${movedFrom}호로 되돌립니다`}
                        >
                          ↩ {movedFrom}호로 되돌리기
                        </button>
                      </p>
                    )}
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
                      // 「이미 배정됨」으로 막지 않습니다. 요일마다 다른 차를 타는 아이가
                      // 있어서, 다른 노선에 있다는 것만으로는 못 넣을 이유가 안 됩니다.
                      // 대신 **남은 요일이 몇인지** 그 자리에서 보여줍니다.
                      const taken = takenDays(slots, s.id);
                      const free = freeDays(slots, s.id);
                      const full = free.length === 0;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={busy || full}
                          onClick={() => void addStudent(r, s)}
                          title={
                            taken.size > 0
                              ? `이미 잡힌 요일: ${describeTaken(taken)}${full ? "" : ` · 넣을 요일: ${free.map((d) => DAY_LABEL[d]).join("·")}`}`
                              : "월~금 전부 넣습니다"
                          }
                          className={
                            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12px] " +
                            (full ? "bg-slate-50 text-slate-300" : "bg-blue-50 text-blue-900 hover:bg-blue-100")
                          }
                        >
                          <b>{s.name}</b>
                          <span className="text-[10px] text-slate-400">
                            {[s.grade, s.class_name].filter(Boolean).join(" ")}
                          </span>
                          {full ? (
                            <span className="ml-auto shrink-0 text-[10px] font-bold">월~금 모두 배정됨</span>
                          ) : taken.size > 0 ? (
                            <span className="ml-auto shrink-0 text-[10px] font-bold text-teal-700">
                              {free.map((d) => DAY_LABEL[d]).join("·")}요일로 넣기
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
                <p className="mt-1 px-1 text-[10px] text-slate-400">
                  <b>이미 다른 노선에 있어도 넣을 수 있습니다</b> — 그쪽에 잡힌 요일만 빼고 켭니다. 안 타는 요일은 아래 요일 버튼으로 끄세요.
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
