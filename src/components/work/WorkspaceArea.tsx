"use client";

import { useEffect, useRef, useState } from "react";
import type { Department, Task, TaskModeColor, TaskStatus, TeamMember } from "@/lib/types";
import DashboardArea from "./DashboardArea";
import ChatPanel from "./ChatPanel";
import TaskBoard from "./TaskBoard";
import MyTasksWidget from "./MyTasksWidget";
import QuickTaskWidget from "./QuickTaskWidget";

// 참조 소스코드(WorkspaceArea.tsx)의 마우스 드래그 리사이저를 그대로 옮겼습니다 - 서드파티
// 라이브러리 없이 mousedown/mousemove/mouseup만으로 좌측 폭(%)과 좌측 상단 높이(%)를 조절합니다.
const LAYOUT_STORAGE_KEY = "gia-ops-work-layout-v1";
const DEFAULT_LAYOUT = { leftWidth: 45, leftTopHeight: 14, rightTopHeight: 30 };

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

  return (
    <div className="flex h-full overflow-hidden">
      {/* 왼쪽: 업무 상황판(숫자만, 작게) + 빠른 업무등록 위젯(항상 고정) + 채팅(나머지 공간) */}
      <div className="flex flex-col overflow-hidden" style={{ width: `${leftWidth}%` }}>
        <div className="overflow-hidden" style={{ height: `${leftTopHeight}%` }}>
          <DashboardArea tasks={tasks} activeDepartmentName={activeDepartment.name} deptColorMap={deptColorMap} onSelectTask={onOpenTask} />
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

      {/* 오른쪽: 내 업무목록(위젯) + 칸반보드(진행대기/진행중/보류이슈/완료, 드래그앤드롭) */}
      <div className="flex flex-col overflow-hidden" style={{ width: `${100 - leftWidth}%` }}>
        <div className="overflow-hidden" style={{ height: `${rightTopHeight}%` }}>
          <MyTasksWidget tasks={tasks} currentUserEmail={currentUserEmail} onOpenTask={onOpenTask} />
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
