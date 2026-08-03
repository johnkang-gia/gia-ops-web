"use client";

import { useState } from "react";
import type { Department, Task, TaskModeColor, TaskStatus, TeamMember } from "@/lib/types";
import DashboardArea from "./DashboardArea";
import ChatPanel from "./ChatPanel";
import TaskBoard from "./TaskBoard";
import MyTasksWidget from "./MyTasksWidget";
import QuickTaskWidget from "./QuickTaskWidget";

// 참조 소스코드(WorkspaceArea.tsx)의 마우스 드래그 리사이저를 그대로 옮겼습니다 - 서드파티
// 라이브러리 없이 mousedown/mousemove/mouseup만으로 좌측 폭(%)과 좌측 상단 높이(%)를 조절합니다.
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
  const [leftWidth, setLeftWidth] = useState(45);
  const [leftTopHeight, setLeftTopHeight] = useState(14);
  const [rightTopHeight, setRightTopHeight] = useState(30);

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
