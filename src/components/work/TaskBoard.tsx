"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task, TaskStatus, TeamMember } from "@/lib/types";
import TaskCard from "./TaskCard";
import ActivityLog from "./ActivityLog";
import { STATUS_ORDER, STATUS_LABEL, STATUS_COLOR } from "./statusConfig";

function DroppableColumn({
  status,
  tasks,
  team,
  deptColorMap,
  modeColorMap,
  isAdmin,
  currentUserEmail,
  onOpenTask,
  onToggleAck,
}: {
  status: TaskStatus;
  tasks: Task[];
  team: TeamMember[];
  deptColorMap: Map<string, string>;
  modeColorMap: Map<string, string>;
  isAdmin: boolean;
  currentUserEmail: string;
  onOpenTask: (id: string) => void;
  onToggleAck: (taskId: string, checked: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={"flex flex-col gap-1 rounded-lg border p-2.5 transition " + (isOver ? "border-blue-300 bg-blue-50/50" : "border-transparent bg-black/[0.02]")}
    >
      <div className="flex items-center justify-between px-1 text-[13px] font-bold" style={{ color: STATUS_COLOR[status] }}>
        <span>{STATUS_LABEL[status]}</span>
        <span>{tasks.length}</span>
      </div>
      <SortableContext id={status} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="min-h-[60px]">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              team={team}
              deptColor={task.department ? deptColorMap.get(task.department) : null}
              modeColorMap={modeColorMap}
              isAdmin={isAdmin}
              currentUserEmail={currentUserEmail}
              onOpen={() => onOpenTask(task.id)}
              onToggleAcknowledge={(checked) => onToggleAck(task.id, checked)}
            />
          ))}
          {tasks.length === 0 && <p className="px-1 text-[11px] text-slate-300">여기로 카드를 끌어다 놓을 수 있어요</p>}
        </div>
      </SortableContext>
    </div>
  );
}

// 진행대기/진행중/완료는 항상 위에 쾌적하게 3열로 보여주고, 보류/이슈는 평소엔 접어둬서
// 화면을 덜 차지하게 합니다(요청 #10) - 업무카드를 클릭해 상세패널에서 상태를 "보류"로
// 바꾸면(TaskDetailPanel) 이 접힌 섹션으로 자동으로 들어갑니다. 드래그로 여기로 옮기는 것도
// 여전히 가능합니다.
const MAIN_STATUS_ORDER: TaskStatus[] = ["예정", "진행중", "완료"];
const HOLD_STATUS: TaskStatus = "보류";

export default function TaskBoard({
  tasks,
  team,
  deptColorMap,
  modeColorMap,
  isAdmin,
  currentUserEmail,
  deptFilter,
  onOpenTask,
  onChangeStatus,
  onToggleAck,
}: {
  tasks: Task[];
  team: TeamMember[];
  deptColorMap: Map<string, string>;
  modeColorMap: Map<string, string>;
  isAdmin: boolean;
  currentUserEmail: string;
  deptFilter: string;
  onOpenTask: (id: string) => void;
  onChangeStatus: (taskId: string, status: TaskStatus) => void;
  onToggleAck: (taskId: string, checked: boolean) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const holdTasks = tasks.filter((t) => t.status === HOLD_STATUS);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    let targetStatus: TaskStatus | null = null;
    if ((STATUS_ORDER as string[]).includes(String(over.id))) {
      targetStatus = over.id as TaskStatus;
    } else {
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) targetStatus = overTask.status;
    }

    const task = tasks.find((t) => t.id === active.id);
    if (task && targetStatus && task.status !== targetStatus) {
      onChangeStatus(task.id, targetStatus);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActivityLog department={deptFilter} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto p-3">
          {/* 진행대기/진행중/완료 3열을 항상 위에 쾌적하게 보여주고, 보류/이슈는 아래로 빼서
              평소엔 접어둡니다(요청 #10) - 넓은 화면에선 3열, 좁으면 1~2열로 쌓입니다. */}
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MAIN_STATUS_ORDER.map((status) => (
              <DroppableColumn
                key={status}
                status={status}
                tasks={tasks.filter((t) => t.status === status)}
                team={team}
                deptColorMap={deptColorMap}
                modeColorMap={modeColorMap}
                isAdmin={isAdmin}
                currentUserEmail={currentUserEmail}
                onOpenTask={onOpenTask}
                onToggleAck={onToggleAck}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setHoldOpen((v) => !v)}
            className="mt-3 flex w-full items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700 transition hover:bg-amber-100"
          >
            <span>⏸️ 보류/이슈 ({holdTasks.length})</span>
            <span>{holdOpen ? "숨기기 ▲" : "펼치기 ▼"}</span>
          </button>
          {holdOpen && (
            <div className="mt-2 grid grid-cols-1 items-start gap-3">
              <DroppableColumn
                status={HOLD_STATUS}
                tasks={holdTasks}
                team={team}
                deptColorMap={deptColorMap}
                modeColorMap={modeColorMap}
                isAdmin={isAdmin}
                currentUserEmail={currentUserEmail}
                onOpenTask={onOpenTask}
                onToggleAck={onToggleAck}
              />
            </div>
          )}
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="glass w-64 rounded-lg border-l-4 p-3 shadow-lg" style={{ borderLeftColor: activeTask.department ? deptColorMap.get(activeTask.department) ?? "#3b82f6" : "#3b82f6" }}>
              <div className="text-sm font-semibold text-slate-800">{activeTask.title}</div>
              {activeTask.description && <div className="mt-1 text-xs text-slate-500">{activeTask.description}</div>}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
