"use client";

import { useEffect, useRef, useState } from "react";
import type { Department, GoogleChatMirrorMessage, Task, TaskModeColor, TaskStatus, TeamMember } from "@/lib/types";
import ChatPanel from "./ChatPanel";
import TaskBoard from "./TaskBoard";
import MyTasksWidget from "./MyTasksWidget";
import AllTasksWidget from "./AllTasksWidget";
import QuickTaskWidget from "./QuickTaskWidget";
import GoogleChatMirrorPanel from "./GoogleChatMirrorPanel";
import AttendanceDigestPanel from "./AttendanceDigestPanel";

// 참조 소스코드(WorkspaceArea.tsx)의 마우스 드래그 리사이저를 그대로 옮겼습니다 - 서드파티
// 라이브러리 없이 mousedown/mousemove/mouseup만으로 좌측 폭(%)과 좌측 상단 높이(%)를 조절합니다.
const LAYOUT_STORAGE_KEY = "gia-ops-work-layout-v1";
// 요청: "지금 업무 상황판을 살짝 늘려서, 반으로 나누고, 왼쪽은 출결알림, 오른쪽은 선생님요청
// 으로 만들어줘" - 예전에 업무상황판+행정요청위젯이 있던 좌측 상단 자리를(업무상황판은 전체
// 업무목록 제목 옆으로 옮기고, 행정요청은 제거했으므로) 구글챗 미러링 두 스트림 자리로
// 재활용합니다. 텍스트 몇 줄이 보여야 하니 기존(14%)보다 살짝 늘렸습니다.
const DEFAULT_LAYOUT = { leftWidth: 45, leftTopHeight: 22, rightTopHeight: 30 };

function loadSavedLayout(): typeof DEFAULT_LAYOUT {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    return {
      leftWidth: typeof parsed.leftWidth === "number" ? parsed.leftWidth : DEFAULT_LAYOUT.leftWidth,
      leftTopHeight: typeof parsed.leftTopHeight === "number" ? parsed.leftTopHeight : DEFAULT_LAYOUT.leftTopHeight,
      rightTopHeight: typeof parsed.rightTopHeight === "number" ? parsed.rightTopHeight : DEFAULT_LAYOUT.rightTopHeight,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export default function WorkspaceArea({
  activeDepartment,
  tasks,
  team,
  deptColorMap,
  modeColorMap,
  onModeColorChange,
  departments,
  isAdmin,
  currentUserEmail,
  onOpenTask,
  onChangeStatus,
  onToggleAck,
  onTaskCreated,
  mirrorMessages,
}: {
  activeDepartment: Department;
  tasks: Task[];
  team: TeamMember[];
  deptColorMap: Map<string, string>;
  modeColorMap: Map<string, string>;
  onModeColorChange: (mode: TaskModeColor["mode"], color: string) => void;
  departments: Department[];
  isAdmin: boolean;
  currentUserEmail: string;
  onOpenTask: (id: string) => void;
  onChangeStatus: (taskId: string, status: TaskStatus) => void;
  onToggleAck: (taskId: string, checked: boolean) => void;
  onTaskCreated?: (task: Task) => void;
  // 구글챗 두 방(출결알림/선생님요청)을 실시간 미러링한 결과입니다. useRealtimeTable을 여기서
  // 두 번(패널마다 한 번씩) 부르면 같은 테이블 이름으로 채널이 중복 구독되어 페이지가 아예
  // 열리지 않는 문제가 있었던 전례가 있어서(tasks/채팅과 동일한 이유), 상위인
  // WorkBoardClient에서 한 번만 구독하고 배열을 그대로 내려받아 각 패널이 sourceKey로만
  // 걸러서 보여줍니다.
  mirrorMessages: GoogleChatMirrorMessage[];
}) {
  // 부서 헤더는 상위(WorkBoardClient)의 부서탭 바 하나로 통합했기 때문에 여기서는 별도
  // 헤더 없이 바로 본문을 채웁니다(세로 공간 절약).
  // 왼쪽: 업무 상황판(숫자 배지 한 줄뿐이라 아주 작게) + 채팅(크게, 실제 업무 도구라 화면을
  // 최대한 내줍니다). 오른쪽: 내 업무목록(위젯) + 칸반보드(진행대기/진행중/보류이슈/완료).
  // 크기를 한 번 조절하면 다음에 업무탭에 다시 들어와도 그대로 유지되도록(요청) 브라우저
  // localStorage에 저장해둡니다 - 서버에 저장할 만큼 중요한 값은 아니고, 이 기기에서만
  // 기억하면 충분합니다.
  // 서버 렌더링(첫 화면)과 클라이언트 첫 렌더가 반드시 같아야 하므로(hydration 불일치 방지),
  // useState 초기값은 항상 기본값으로 두고, 마운트된 다음에만 저장된 값을 불러와 반영합니다.
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LAYOUT.leftWidth);
  const [leftTopHeight, setLeftTopHeight] = useState(DEFAULT_LAYOUT.leftTopHeight);
  const [rightTopHeight, setRightTopHeight] = useState(DEFAULT_LAYOUT.rightTopHeight);
  const hydratedRef = useRef(false);
  // 마우스 드래그로 폭을 나누는 좌우 2단 레이아웃은 손가락 터치 화면에서는 쓸 수 없어서(요청:
  // 모바일에서도 모든 메뉴를 수월하게), 작은 화면에서는 탭으로 채팅/칸반/내업무를 전체 폭으로
  // 하나씩 보여주는 별도 레이아웃을 씁니다(아래 mobileTab 상태).
  const [mobileTab, setMobileTab] = useState<"board" | "chat" | "mine">("chat");

  // 모바일/데스크톱 레이아웃을 CSS(hidden/sm:flex)로만 나누면 두 레이아웃이 동시에 DOM에
  // 마운트되어, ChatPanel·TaskBoard(ActivityLog)가 같은 실시간 채널 이름으로 두 번 구독하게
  // 되면서 페이지 자체가 열리지 않는 문제가 있었습니다. 실제 화면 폭을 봐서 둘 중 하나만
  // 마운트하도록 바꿨습니다(서버 렌더링과 첫 렌더는 항상 데스크톱 기준으로 맞춰 hydration
  // 불일치를 피하고, 마운트된 다음에만 실제 폭을 반영합니다).
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobileView(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobileView(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const saved = loadSavedLayout();
    setLeftWidth(saved.leftWidth);
    setLeftTopHeight(saved.leftTopHeight);
    setRightTopHeight(saved.rightTopHeight);
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return; // 저장된 값을 아직 불러오기 전이면(기본값 상태) 덮어쓰지 않습니다.
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ leftWidth, leftTopHeight, rightTopHeight }));
    } catch {
      // 시크릿 모드 등 localStorage를 쓸 수 없는 환경이면 그냥 이번 세션만 기억하지 않고 넘어갑니다.
    }
  }, [leftWidth, leftTopHeight, rightTopHeight]);

  function startColResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftWidth;
    function onMove(moveEvent: MouseEvent) {
      const containerWidth = window.innerWidth - 224; // 사이드바 폭(w-56=224px) 대략 보정
      const deltaPercent = ((moveEvent.clientX - startX) / containerWidth) * 100;
      let next = startLeft + deltaPercent;
      if (next < 25) next = 25;
      if (next > 65) next = 65;
      setLeftWidth(next);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function startRowResize(setter: (v: number) => void, current: number, min = 15, max = 60) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      function onMove(moveEvent: MouseEvent) {
        const containerHeight = window.innerHeight - 130;
        const deltaPercent = ((moveEvent.clientY - startY) / containerHeight) * 100;
        let next = current + deltaPercent;
        if (next < min) next = min;
        if (next > max) next = max;
        setter(next);
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
  }

  if (isMobileView) {
    return (
      /* 모바일(작은 화면): 마우스 드래그로 나누는 2단 레이아웃 대신, 탭으로 채팅/칸반/내업무를
          하나씩 전체 폭으로 보여줍니다 - 터치 화면에서 리사이저를 쓸 수 없어서(요청). 데스크톱
          레이아웃과 동시에 마운트하면 ChatPanel/ActivityLog의 실시간 채널이 중복 구독되어 업무탭
          자체가 열리지 않는 문제가 있었으므로, 둘 중 하나만 마운트합니다. */
      <div className="flex h-full flex-col overflow-hidden">
        <div className="glass-panel flex shrink-0 divide-x divide-black/5 border-b border-black/5">
          {(
            [
              { key: "chat", label: "💬 채팅" },
              { key: "board", label: "🗂️ 칸반" },
              { key: "mine", label: "📋 내 업무" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setMobileTab(t.key)}
              className={
                "flex-1 py-2.5 text-xs font-bold transition " +
                (mobileTab === t.key ? "bg-blue-50 text-blue-600" : "text-slate-500")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {mobileTab === "chat" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="shrink-0 border-b border-black/5 pb-1">
                <QuickTaskWidget
                  department={activeDepartment.name}
                  team={team}
                  currentUserEmail={currentUserEmail}
                  onTaskCreated={onTaskCreated}
                  modeColorMap={modeColorMap}
                  isAdmin={isAdmin}
                  onModeColorChange={onModeColorChange}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChatPanel
                  department={activeDepartment.name}
                  departments={departments}
                  team={team}
                  userEmail={currentUserEmail}
                  tasks={tasks}
                  onTaskCreated={onTaskCreated}
                />
              </div>
            </div>
          )}
          {mobileTab === "board" && (
            <TaskBoard
              tasks={tasks}
              team={team}
              deptColorMap={deptColorMap}
              modeColorMap={modeColorMap}
              isAdmin={isAdmin}
              currentUserEmail={currentUserEmail}
              deptFilter={activeDepartment.name}
              onOpenTask={onOpenTask}
              onChangeStatus={onChangeStatus}
              onToggleAck={onToggleAck}
            />
          )}
          {mobileTab === "mine" && (
            <div className="flex h-full flex-col overflow-hidden">
              {/* 예전 업무상황판+행정요청 자리를 구글챗 미러링(출결알림)으로 바꿨습니다(요청
                  2, 3). 업무상황판은 아래 "전체 업무목록" 제목 옆으로 옮겼습니다(요청 1).
                  선생님요청 방은 아직 만들어지지 않아서(구글챗_미러링_설정가이드 STEP 5) 패널
                  자체를 잠시 빼뒀습니다 - 방이 생기고 환경변수를 넣으면 다시 추가하면 됩니다. */}
              {/* 왼쪽은 구글챗 원문 그대로(출결알림), 오른쪽은 그 원문에서 결석·픽업 키워드를
                  뽑아 정리한 요약(출결내역)입니다(요청 3). */}
              <div className="flex shrink-0 divide-x divide-black/5 overflow-hidden" style={{ height: "40%" }}>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <GoogleChatMirrorPanel
                    sourceKey="attendance"
                    title="출결알림"
                    icon="🚸"
                    messages={mirrorMessages}
                    team={team}
                    userEmail={currentUserEmail}
                    department={activeDepartment.name}
                    onTaskCreated={onTaskCreated}
                  />
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <AttendanceDigestPanel messages={mirrorMessages} />
                </div>
              </div>
              {/* 내 업무목록 / 전체 업무목록을 좌우로 나눠 보여줍니다(요청: "내 업무목록을
                  반으로 나눠서 한쪽은 내업무목록, 다른쪽은 전체 업무목록으로"). 모바일은 폭이
                  좁아 두 칸이 빡빡하지만, 항목 자체가 제목 한 줄+마감/상태 뱃지로 짧아서
                  좌우분할로도 충분히 읽힙니다. */}
              <div className="flex min-h-0 flex-1 divide-x divide-black/5 overflow-hidden border-t border-black/5">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <MyTasksWidget tasks={tasks} currentUserEmail={currentUserEmail} onOpenTask={onOpenTask} />
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <AllTasksWidget
                    tasks={tasks}
                    onOpenTask={onOpenTask}
                    activeDepartmentName={activeDepartment.name}
                    deptColorMap={deptColorMap}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 데스크톱(그 외 화면 폭): 기존 마우스 드래그로 폭/높이를 조절하는 2단 레이아웃 그대로 유지
  return (
    <div className="flex h-full overflow-hidden">
      {/* 왼쪽: 구글챗 미러링 두 방(출결알림/선생님요청, 반씩) + 빠른 업무등록 위젯(항상 고정) +
          채팅(나머지 공간). 예전 업무상황판+행정요청 자리였는데, 업무상황판은 오른쪽 "전체
          업무목록" 제목 옆으로 옮기고(요청 1) 행정요청은 없앴습니다(요청 2, 구글챗 미러링으로
          대체). */}
      <div className="flex flex-col overflow-hidden" style={{ width: `${leftWidth}%` }}>
        {/* 왼쪽은 구글챗 원문 그대로(출결알림), 오른쪽은 그 원문에서 결석·픽업 키워드를 뽑아
            정리한 요약(출결내역)입니다(요청 3). */}
        <div className="flex items-stretch divide-x divide-black/5 overflow-hidden" style={{ height: `${leftTopHeight}%` }}>
          <div className="min-w-0 flex-1 overflow-hidden">
            <GoogleChatMirrorPanel
              sourceKey="attendance"
              title="출결알림"
              icon="🚸"
              messages={mirrorMessages}
              team={team}
              userEmail={currentUserEmail}
              department={activeDepartment.name}
              onTaskCreated={onTaskCreated}
            />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <AttendanceDigestPanel messages={mirrorMessages} />
          </div>
        </div>
        <div
          onMouseDown={startRowResize(setLeftTopHeight, leftTopHeight, 8, 40)}
          className="h-1 shrink-0 cursor-row-resize bg-black/5 transition hover:bg-blue-400"
        />
        <div className="flex min-h-0 flex-col overflow-hidden" style={{ height: `${100 - leftTopHeight}%` }}>
          <div className="shrink-0 border-b border-black/5 pb-1">
            <QuickTaskWidget
              department={activeDepartment.name}
              team={team}
              currentUserEmail={currentUserEmail}
              onTaskCreated={onTaskCreated}
              modeColorMap={modeColorMap}
              isAdmin={isAdmin}
              onModeColorChange={onModeColorChange}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatPanel
              department={activeDepartment.name}
              departments={departments}
              team={team}
              userEmail={currentUserEmail}
              tasks={tasks}
              onTaskCreated={onTaskCreated}
            />
          </div>
        </div>
      </div>

      <div onMouseDown={startColResize} className="w-1 shrink-0 cursor-col-resize bg-black/5 transition hover:bg-blue-400" />

      {/* 오른쪽: 내 업무목록/전체 업무목록(좌우 분할 위젯) + 칸반보드(진행대기/진행중/보류이슈/완료, 드래그앤드롭) */}
      <div className="flex flex-col overflow-hidden" style={{ width: `${100 - leftWidth}%` }}>
        {/* 내 업무목록을 좌우로 나눠, 왼쪽은 나와 관계있는 업무만(내가 등록·태그되거나 전체
            모드), 오른쪽은 지금 볼 수 있는 업무 전체를 보여줍니다(요청: "내 업무목록을 반으로
            나눠서 한쪽은 내업무목록, 다른쪽은 전체 업무목록으로 표시되도록"). */}
        <div className="flex divide-x divide-black/5 overflow-hidden" style={{ height: `${rightTopHeight}%` }}>
          <div className="min-w-0 flex-1 overflow-hidden">
            <MyTasksWidget tasks={tasks} currentUserEmail={currentUserEmail} onOpenTask={onOpenTask} />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <AllTasksWidget
              tasks={tasks}
              onOpenTask={onOpenTask}
              activeDepartmentName={activeDepartment.name}
              deptColorMap={deptColorMap}
            />
          </div>
        </div>
        <div
          onMouseDown={startRowResize(setRightTopHeight, rightTopHeight)}
          className="h-1 shrink-0 cursor-row-resize bg-black/5 transition hover:bg-blue-400"
        />
        <div className="overflow-hidden" style={{ height: `${100 - rightTopHeight}%` }}>
          <TaskBoard
            tasks={tasks}
            team={team}
            deptColorMap={deptColorMap}
            modeColorMap={modeColorMap}
            isAdmin={isAdmin}
            currentUserEmail={currentUserEmail}
            deptFilter={activeDepartment.name}
            onOpenTask={onOpenTask}
            onChangeStatus={onChangeStatus}
            onToggleAck={onToggleAck}
          />
        </div>
      </div>
    </div>
  );
}
