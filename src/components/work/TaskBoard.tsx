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
  isAdmin,
  currentUserEmail,
  onOpenTask,
  onToggleAck,
}: {
  status: TaskStatus;
  tasks: Task[];
  team: TeamMember[];
  deptColorMap: Map<string, string>;
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

export default function TaskBoard({
  tasks,
  team,
  deptColorMap,
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
  isAdmin: boolean;
  currentUserEmail: string;
  deptFilter: string;
  onOpenTask: (id: string) => void;
  onChangeStatus: (taskId: string, status: TaskStatus) => void;
  onToggleAck: (taskId: string, checked: boolean) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

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
          {/* 우측 컬럼 폭이 넓어져서(내 업무목록 위젯 아래) 상태 컬럼을 나란히 배치할 여유가
              생겼습니다 - 좁을 땐 1열로 쌓이고, 넓어지면 최대 4열(진행대기/진행중/보류이슈/완료)
              나란히 놓여 진짜 칸반보드처럼 드래그앤드롭할 수 있습니다. */}
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {STATUS_ORDER.map((status) => (
              <DroppableColumn
                key={status}
                status={status}
                tasks={tasks.filter((t) => t.status === status)}
                team={team}
                deptColorMap={deptColorMap}
                isAdmin={isAdmin}
                currentUserEmail={currentUserEmail}
                onOpenTask={onOpenTask}
                onToggleAck={onToggleAck}
              />
            ))}
          </div>
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
