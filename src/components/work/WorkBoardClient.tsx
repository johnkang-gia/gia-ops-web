"use client";

import { useEffect, useMemo, useState } from "react";
import ActivityLogTicker from "./ActivityLogTicker";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import type { Task, TaskStatus, Department, TeamMember, TaskModeColor, GoogleChatMirrorMessage, WorkNotice } from "@/lib/types";
import { nameFor } from "@/lib/teamName";
import { renewRecurringTask } from "@/lib/recurrence";
import { useRefreshTaskCounts } from "@/components/NotificationBell";
import { useToast } from "@/components/common/ToastProvider";
import { STATUS_LABEL } from "./statusConfig";
import WorkspaceArea from "./WorkspaceArea";
import TaskDetailPanel from "./TaskDetailPanel";
import WorkGuideModal from "./WorkGuideModal";
import NoticeBanner from "./NoticeBanner";
import type { RosterStudent } from "@/lib/attendanceDigest";

type StatusToast = { id: string; taskId: string; text: string };

export default function WorkBoardClient({
  initialTasks,
  team,
  userEmail,
  departments,
  isAdmin,
  initialModeColors,
  initialMirrorMessages,
  roster,
  initialNotices,
  collapsedNoticeIds,
  canManageNotices,
  termLabel,
  termDday,
  elemActive,
}: {
  initialTasks: Task[];
  team: TeamMember[];
  userEmail: string;
  departments: Department[];
  isAdmin: boolean;
  initialModeColors: TaskModeColor[];
  initialMirrorMessages: GoogleChatMirrorMessage[];
  // 재적생 명단 - 출결내역 위젯이 문장에서 학생 이름을 명부와 대조할 때 씁니다(동명이인
  // 구분을 위해 학년 포함).
  roster: RosterStudent[];
  // 상단 전체공지(요청) - 최신 하나만 배너로 뜨고 나머지는 히스토리에서 봅니다.
  initialNotices: WorkNotice[];
  collapsedNoticeIds: string[];
  canManageNotices: boolean;
  // 학기 요약 배지(예: "26-27 1학기", 학기말 D-day, 초등부 재학생 수). 예전에는 페이지가
  // 자기 헤더 줄에 따로 그렸는데, 머리줄을 하나로 합치면서 이리로 넘겨받습니다.
  termLabel: string | null;
  termDday: number | null;
  elemActive: number;
}) {
  const [tasks, setTasks] = useRealtimeTable<Task>("tasks", initialTasks);
  const notify = useToast();
  const [deptList, setDeptList] = useState<Department[]>(departments);
  // 나/전체/공유 뱃지 색상은 관리자가 가끔만 바꾸는 설정값이라(부서 색상과 동일한 패턴),
  // 실시간 구독 없이 로컬 상태 + 낙관적 업데이트로 충분합니다.
  const [modeColors, setModeColors] = useState<TaskModeColor[]>(initialModeColors);
  // 구글챗 미러링(출결알림/선생님요청) - tasks와 동일한 이유로, 여기 한 곳에서만
  // useRealtimeTable을 부르고 배열을 그대로 WorkspaceArea에 내려줍니다. 패널마다 따로 구독하면
  // 같은 채널 이름이 중복돼 페이지가 열리지 않는 문제가 있었던 전례가 있습니다.
  const [mirrorMessages] = useRealtimeTable<GoogleChatMirrorMessage>("google_chat_mirror_messages", initialMirrorMessages);
  const online = useOnlineUsers(userEmail);

  const [activeDeptId, setActiveDeptId] = useState<string | null>(deptList[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<StatusToast[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const refreshTaskCounts = useRefreshTaskCounts();

  // 공유(태그된) 업무의 상태가 바뀌면 등록자·담당자 전원이 실시간으로 알 수 있게, 상태 변경만
  // 따로 감시하는 채널입니다. useRealtimeTable의 일반 구독은 화면 상태(tasks)를 갱신하는
  // 용도라 "무엇이 바뀌었는지"를 구분하지 않는데, 여기서는 status가 실제로 바뀐 경우에만,
  // 그리고 내가 바꾼 게 아니면서 내가 등록자/담당자로 태그된 업무일 때만 토스트를 띄웁니다.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("tasks-status-toast")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks" }, (payload) => {
        const oldRow = payload.old as Partial<Task>;
        const newRow = payload.new as Task;
        if (!oldRow.status || oldRow.status === newRow.status) return; // 상태가 실제로 바뀐 경우만
        if (!newRow.updated_by || newRow.updated_by === userEmail) return; // 내가 바꾼 건 알림 불필요
        const involved = newRow.owner_email === userEmail || newRow.assignee_emails?.includes(userEmail);
        if (!involved) return;
        const moverName = nameFor(team, newRow.updated_by);
        const id = `${newRow.id}-${Date.now()}`;
        setToasts((prev) => [...prev, { id, taskId: newRow.id, text: `${moverName}님이 "${newRow.title}" 업무를 '${STATUS_LABEL[newRow.status]}'(으)로 옮겼어요.` }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
      })
      // 새 업무가 등록되어 "내 업무목록"에 들어오는 경우(내가 태그되었거나 [전체] 모드로 등록된
      // 경우)도 매번 확인창(alert)을 띄우면 업무 흐름이 끊기니, 위 상태변경 토스트와 같은
      // 방식으로 잠시 떴다 자동으로 사라지는 알림만 보여줍니다(요청: "그냥 알려주는 용도로
      // 팝업이 잠시 뜨거나 했으면 좋겠어"). 내가 직접 등록한 업무는 이미 알고 있으니 제외합니다.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks" }, (payload) => {
        const newRow = payload.new as Task;
        if (newRow.owner_email === userEmail) return; // 내가 등록한 건 알림 불필요
        const forMe = newRow.assignee_emails?.includes(userEmail) || newRow.origin_mode === "전체";
        if (!forMe) return;
        const creatorName = nameFor(team, newRow.owner_email);
        const id = `${newRow.id}-new-${Date.now()}`;
        setToasts((prev) => [...prev, { id, taskId: newRow.id, text: `${creatorName}님이 새 업무 "${newRow.title}"를 등록했어요.` }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, team]);

  const activeDepartment = deptList.find((d) => d.id === activeDeptId) ?? deptList[0] ?? null;

  const deptColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deptList) if (d.color) map.set(d.name, d.color);
    return map;
  }, [deptList]);

  const modeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of modeColors) if (m.color) map.set(m.mode, m.color);
    return map;
  }, [modeColors]);

  async function handleModeColorChange(mode: TaskModeColor["mode"], color: string) {
    if (!isAdmin) return;
    setModeColors((prev) =>
      prev.some((m) => m.mode === mode) ? prev.map((m) => (m.mode === mode ? { ...m, color } : m)) : [...prev, { mode, color }]
    );
    const supabase = createClient();
    await supabase.from("task_mode_colors").upsert({ mode, color });
  }

  // archived_at이 채워진 업무는 야간 크론이 방금 업무기록으로 넘긴 것입니다. 최초 로드 쿼리는
  // 이미 걸러서 가져오지만(work/page.tsx), 그 이후 실시간 구독으로 들어오는 UPDATE 이벤트는
  // 필터 없이 그대로 반영되므로, 화면(칸반)에 계속 떠 있던 세션이라면 여기서 한 번 더 걸러야
  // 자정 직후 보드에서 즉시 사라집니다.
  const scopedTasks = useMemo(
    () => (activeDepartment ? tasks.filter((t) => t.department === activeDepartment.name && !t.archived_at) : []),
    [tasks, activeDepartment]
  );

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  function addTaskRow(task: Task) {
    setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
  }

  async function handleColorChange(dept: Department, color: string) {
    if (!isAdmin) return;
    setDeptList((prev) => prev.map((d) => (d.id === dept.id ? { ...d, color } : d)));
    const supabase = createClient();
    await supabase.from("departments").update({ color }).eq("id", dept.id);
  }

  async function changeStatus(taskId: string, status: TaskStatus) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    const position = Date.now();
    // '완료'로 들어가는 순간 완료 시각을 찍어둡니다(업무기록 화면의 "언제 했는지" 기준).
    // 완료에서 다시 다른 상태로 빠지면(재작업 등) 완료 시각도 함께 지워서, 나중에 다시
    // 완료했을 때 그 새 시각으로 갱신되게 합니다.
    const completedAt = status === "완료" ? new Date().toISOString() : null;
    // 실패 시 되돌릴 수 있도록 이전 값을 기억해둡니다(끊긴 와이파이 등으로 저장이 실패해도
    // 화면만 바뀐 채로 남아있지 않도록).
    const previous = task;
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status, position, updated_by: userEmail, completed_at: completedAt } : t))
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ status, position, updated_by: userEmail, completed_at: completedAt })
      .eq("id", taskId);
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? previous : t)));
      notify("업무 상태를 변경하지 못했습니다: " + error.message, "error");
      return;
    }
    await supabase.from("task_comments").insert({
      task_id: taskId,
      author_email: userEmail,
      content: `${nameFor(team, userEmail)}님이 업무를 '${STATUS_LABEL[status]}'(으)로 변경했습니다.`,
      department: task.department,
      is_system: true,
    });

    // 반복 업무는 완료되는 순간 바로 다음 회차를 새로 등록합니다(요청) - 상세패널에서 완료
    // 처리하는 경우와 로직을 공유합니다(src/lib/recurrence.ts의 renewRecurringTask).
    if (status === "완료" && task.recurrence) {
      const nextTask = await renewRecurringTask(supabase, task);
      if (nextTask) addTaskRow(nextTask);
    }
  }

  async function toggleAck(taskId: string, checked: boolean) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const already = task.acknowledged_by?.some((a) => a.email === userEmail);
    if (checked === !!already) return;
    // 화면은 즉시 반영(낙관적 업데이트)하되, 실제 DB 반영은 원자적 RPC로 처리합니다 - 여러
    // 사람이 거의 동시에 같은 업무를 "확인"해도 서로의 확인 기록이 덮어써지지 않습니다.
    const optimisticAck = checked
      ? [...(task.acknowledged_by ?? []), { email: userEmail, time: new Date().toISOString() }]
      : (task.acknowledged_by ?? []).filter((a) => a.email !== userEmail);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, acknowledged_by: optimisticAck } : t)));
    const supabase = createClient();
    const { data: updated, error } = await supabase.rpc("toggle_task_ack", { p_task_id: taskId, p_email: userEmail });
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? task : t)));
      notify("업무 확인 처리에 실패했습니다: " + error.message, "error");
      return;
    }
    if (updated) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...(updated as Task) } : t)));
    }
    // 사이드바 알림 배지가 Realtime 전파를 기다리지 않고 지금 바로 다시 세도록 알립니다
    // (요청: "확인 체크 하자마자 사라지게 할 수 있어?" - 페이지를 새로 열어야만 반영되던
    // 지연을 없앴습니다).
    refreshTaskCounts();
    if (checked) {
      await supabase.from("task_comments").insert({
        task_id: taskId,
        author_email: userEmail,
        content: `${nameFor(team, userEmail)}님이 업무를 확인했습니다.`,
        department: task.department,
        is_system: true,
      });
    }
  }

  if (!activeDepartment) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">
        등록된 부서가 없습니다. 먼저 부서를 추가해주세요.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 업무 보드 머리줄 - 한 줄만 씁니다.
          예전에는 ① 대분류 상단탭 ② 페이지 헤더(학기·재학생·가이드) ③ 부서 줄, 이렇게 세 겹이
          쌓여 있어서 정작 일하는 화면이 시작되기까지 세로 100px 넘게 잡아먹었습니다. 게다가 이
          줄에 있던 [업무기록]·[휴지통]·[업무 보고서] 링크는 대분류 상단탭의 [지난 업무]·[휴지통]·
          [보고서]와 같은 곳으로 가는 중복이었고, "채팅 위 업무등록 위젯에서…" 안내 문구는 한 번
          읽으면 그만인 글이 매일 자리를 차지하고 있었습니다. 전부 정리하고 지금 상황을 알려주는
          것(부서·학기·실시간 로그·접속자)만 남겼습니다. */}
      <div className="glass-panel flex shrink-0 flex-wrap items-center gap-1 border-b border-black/5 px-3 py-1.5">
        {deptList.map((dept) => {
          const active = dept.id === activeDeptId;
          return (
            <button
              key={dept.id}
              onClick={() => setActiveDeptId(dept.id)}
              style={active ? { backgroundColor: dept.color + "22", color: dept.color } : undefined}
              className={"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition " + (active ? "" : "text-slate-500 hover:bg-black/5")}
            >
              <span className="relative inline-block h-2.5 w-2.5 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: dept.color }}>
                {isAdmin && (
                  <input
                    type="color"
                    value={dept.color}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleColorChange(dept, e.target.value)}
                    className="absolute -left-1/2 -top-1/2 h-[200%] w-[200%] cursor-pointer opacity-0"
                    title={`${dept.name} 색상 변경 (관리자 전용)`}
                  />
                )}
              </span>
              {dept.name}
            </button>
          );
        })}
        {/* 요청: "실시간 로그를 맨위에 초등부 부서 나오는칸 가운데로 로그를 옮기고 한줄만
            표시되도록해서 누르면 전체로그가 뜨도록" - 부서 탭과 오른쪽 배지들 사이 가운데
            자리입니다. 남는 폭만큼만 차지하고, 넘치면 말줄임으로 줄어듭니다. */}
        <ActivityLogTicker department={activeDepartment.name} isAdmin={isAdmin} currentUserEmail={userEmail} />

        {/* 브라우저 기본 title 툴팁은 뜨는 데 시간이 걸리고 눈에 잘 안 띄어서, 직접 그린
            호버 팝오버로 바꿨습니다 - 배지에 마우스를 올리면 바로 접속자 이름 목록이 뜹니다. */}
        <div className="group relative shrink-0">
          <span className="flex cursor-default items-center gap-1 whitespace-nowrap rounded-full bg-black/5 px-2.5 py-1 text-[11px] text-slate-500">
            🟢 {online.length}명 접속중
          </span>
          {online.length > 0 && (
            <div className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden min-w-[140px] max-w-[220px] flex-col gap-0.5 rounded-lg border border-black/5 bg-white px-3 py-2 text-[11px] text-slate-600 shadow-lg group-hover:flex">
              <div className="mb-0.5 font-semibold text-slate-400">🟢 현재 접속중</div>
              {online.map((e) => (
                <span key={e} className="truncate">{nameFor(team, e)}</span>
              ))}
            </div>
          )}
        </div>
        {/* 학기·학기말 D-day·재학생 수. 예전에는 이 화면만을 위한 별도 헤더 줄에 있었는데,
            "지금 상황"을 알려주는 배지라는 점에서 부서·접속자와 성격이 같아 한 줄로 모았습니다. */}
        {termLabel && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-800">
            📚 {termLabel}
          </span>
        )}
        {termDday != null && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-purple-600 px-2 py-1 text-[11px] font-bold text-white">
            {termDday > 0 ? `학기말 D-${termDday}` : termDday === 0 ? "오늘 학기말" : "학기 종료"}
          </span>
        )}
        <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
          🎓 초등부 <b>{elemActive}</b>명
        </span>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          title="사용 가이드"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[12px] font-bold text-slate-600 transition hover:bg-black/10"
        >
          ❓
        </button>
      </div>

      {/* 요청: "전체공지가 있을경우 바로 상단으로 옮겨지고" - 부서 탭 바로 아래, 업무 화면
          맨 위에 배너로 띄웁니다. 최신 공지 하나만 뜨고, 사람마다 따로 접을 수 있습니다. */}
      <NoticeBanner
        initialNotices={initialNotices}
        collapsedIds={collapsedNoticeIds}
        activeDepartmentName={activeDepartment.name}
        team={team}
        userEmail={userEmail}
        canManage={canManageNotices}
      />

      {guideOpen && <WorkGuideModal onClose={() => setGuideOpen(false)} />}

      <div className="flex-1 overflow-hidden">
        <WorkspaceArea
          activeDepartment={activeDepartment}
          tasks={scopedTasks}
          team={team}
          deptColorMap={deptColorMap}
          modeColorMap={modeColorMap}
          onModeColorChange={handleModeColorChange}
          departments={deptList}
          isAdmin={isAdmin}
          currentUserEmail={userEmail}
          onOpenTask={setSelectedId}
          onChangeStatus={changeStatus}
          onToggleAck={toggleAck}
          onTaskCreated={addTaskRow}
          mirrorMessages={mirrorMessages}
          roster={roster}
        />
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          allTasks={tasks}
          team={team}
          online={online}
          currentUserEmail={userEmail}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
          onDeleted={(id) => {
            setTasks((prev) => prev.filter((t) => t.id !== id));
            setSelectedId(null);
          }}
        />
      )}

      {toasts.length > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
            {toasts.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedId(t.taskId);
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
                className="flex max-w-xs items-start gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-left text-[12px] text-slate-700 shadow-lg transition hover:bg-blue-50"
              >
                <span className="shrink-0">🔔</span>
                <span>{t.text}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
