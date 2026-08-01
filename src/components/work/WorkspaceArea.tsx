"use client";

import { useState } from "react";
import type { Department, Task, TaskStatus, TeamMember } from "@/lib/types";
import DashboardArea from "./DashboardArea";
import ChatPanel from "./ChatPanel";
import TaskBoard from "./TaskBoard";

// 참조 소스코드(WorkspaceArea.tsx)의 마우스 드래그 리사이저를 그대로 옮겼습니다 - 서드파티
// 라이브러리 없이 mousedown/mousemove/mouseup만으로 좌측 폭(%)과 좌측 상단 높이(%)를 조절합니다.
export default function WorkspaceArea({
  activeDepartment,
  tasks,
  team,
  deptColorMap,
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
  departments: Department[];
  isAdmin: boolean;
  currentUserEmail: string;
  onOpenTask: (id: string) => void;
  onChangeStatus: (taskId: string, status: TaskStatus) => void;
  onToggleAck: (taskId: string, checked: boolean) => void;
  onTaskCreated?: (task: Task) => void;
}) {
  // 채팅이 핵심 업무 도구(업무 등록도 채팅에서 이루어짐)라 채팅에 화면을 더 내주고, 업무
  // 상황판/칸반은 참고용으로 작게 둡니다(좌:우 = 대략 3:7).
  const [leftWidth, setLeftWidth] = useState(30);
  const [topHeight, setTopHeight] = useState(25);

  function startColResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftWidth;
    function onMove(moveEvent: MouseEvent) {
      const containerWidth = window.innerWidth - 224; // 사이드바 폭(w-56=224px) 대략 보정
      const deltaPercent = ((moveEvent.clientX - startX) / containerWidth) * 100;
      let next = startLeft + deltaPercent;
      if (next < 20) next = 20;
      if (next > 60) next = 60;
      setLeftWidth(next);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function startRowResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startTop = topHeight;
    function onMove(moveEvent: MouseEvent) {
      const containerHeight = window.innerHeight - 130;
      const deltaPercent = ((moveEvent.clientY - startY) / containerHeight) * 100;
      let next = startTop + deltaPercent;
      if (next < 15) next = 15;
      if (next > 60) next = 60;
      setTopHeight(next);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="glass-panel flex shrink-0 items-center gap-2.5 border-b border-black/5 px-5 py-3">
        <div className="rounded-lg p-2" style={{ backgroundColor: activeDepartment.color + "22" }}>
          <span style={{ color: activeDepartment.color }}>#</span>
        </div>
        <div>
          <h2 className="text-[15px] font-bold">{activeDepartment.name}</h2>
          <div className="text-[11px] opacity-60">{activeDepartment.name} 전용 업무 및 소통 공간입니다.</div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 왼쪽: 업무 상황판(작게) + 칸반(작게) - 참고용 요약 */}
        <div className="flex flex-col overflow-hidden" style={{ width: `${leftWidth}%` }}>
          <div className="overflow-hidden" style={{ height: `${topHeight}%` }}>
            <DashboardArea tasks={tasks} activeDepartmentName={activeDepartment.name} deptColorMap={deptColorMap} onSelectTask={onOpenTask} />
          </div>
          <div
            onMouseDown={startRowResize}
            className="h-1 shrink-0 cursor-row-resize bg-black/5 transition hover:bg-blue-400"
          />
          <div className="overflow-hidden" style={{ height: `${100 - topHeight}%` }}>
            <TaskBoard
              tasks={tasks}
              team={team}
              deptColorMap={deptColorMap}
              isAdmin={isAdmin}
              currentUserEmail={currentUserEmail}
              deptFilter={activeDepartment.name}
              onOpenTask={onOpenTask}
              onChangeStatus={onChangeStatus}
              onToggleAck={onToggleAck}
            />
          </div>
        </div>

        <div onMouseDown={startColResize} className="w-1 shrink-0 cursor-col-resize bg-black/5 transition hover:bg-blue-400" />

        {/* 오른쪽: 채팅 - 여기서 메시지를 보내는 것만으로 업무가 등록됩니다(@담당자 태그) */}
        <div className="overflow-hidden" style={{ width: `${100 - leftWidth}%` }}>
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
  );
}
