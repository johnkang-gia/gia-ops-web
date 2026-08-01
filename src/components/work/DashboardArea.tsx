"use client";

import { useState } from "react";
import type { Task } from "@/lib/types";

// 명도 대비를 계산해 배지 글자색을 흑/백으로 자동 결정합니다(참조 소스코드의 getContrastColor
// 그대로 - YIQ 공식으로 밝은 배경엔 검정 글씨, 어두운 배경엔 흰 글씨).
function getContrastColor(hex: string) {
  if (!hex || !hex.startsWith("#")) return "#ffffff";
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}

function TaskBadgeSection({
  title,
  icon,
  color,
  tasks,
  deptColorMap,
  onBadgeClick,
}: {
  title: string;
  icon: string;
  color: string;
  tasks: Task[];
  deptColorMap: Map<string, string>;
  onBadgeClick: (task: Task) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 6;
  const hasMore = tasks.length > MAX_VISIBLE;
  const visible = expanded ? tasks : tasks.slice(0, MAX_VISIBLE);

  return (
    <div className="glass flex flex-col p-3">
      <div className="flex items-center justify-between text-[13px] font-bold" style={{ color }}>
        <span className="flex items-center gap-1.5">
          {icon} {title}
        </span>
        <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[11px]">{tasks.length}</span>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-3 text-xs opacity-50">업무 없음</div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {visible.map((task) => {
              const deptColor = task.department ? deptColorMap.get(task.department) : null;
              const bg = deptColor || color;
              return (
                <button
                  key={task.id}
                  onClick={() => onBadgeClick(task)}
                  title={task.title}
                  style={{ backgroundColor: bg, color: getContrastColor(bg) }}
                  className="max-w-full truncate rounded-md px-2 py-1 text-[11px] font-semibold shadow-sm transition hover:brightness-110"
                >
                  {task.title}
                </button>
              );
            })}
          </div>
          {hasMore && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 self-center text-[11px] font-semibold text-slate-400 hover:text-slate-600"
            >
              {expanded ? "▲ 접기" : `▼ 더보기 (+${tasks.length - MAX_VISIBLE}건)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardArea({
  tasks,
  activeDepartmentName,
  deptColorMap,
  onSelectTask,
}: {
  tasks: Task[];
  activeDepartmentName: string;
  deptColorMap: Map<string, string>;
  onSelectTask: (id: string) => void;
}) {
  const completed = tasks.filter((t) => t.status === "완료");
  const active = tasks.filter((t) => t.status === "예정" || t.status === "진행중");
  const onHold = tasks.filter((t) => t.status === "보류");

  const progress = tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0;
  const r = 13;
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;

  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-3 flex items-center gap-2.5 border-b border-black/5 pb-2.5">
        <div className="flex flex-col items-center">
          <svg width="34" height="34" viewBox="0 0 34 34" className="-rotate-90">
            <circle cx="17" cy="17" r={r} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="3" />
            <circle
              cx="17"
              cy="17"
              r={r}
              fill="none"
              stroke="var(--wf-primary, #3b82f6)"
              strokeWidth="3"
              strokeDasharray={c}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-700"
            />
          </svg>
          <div className="text-[10px] font-bold text-blue-600">
            {completed.length}/{tasks.length}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold">📊 [{activeDepartmentName}] 업무 상황판</h3>
          <div className="text-[11px] opacity-60">{activeDepartmentName} 부서로 들어온 모든 업무를 한눈에 모아봅니다.</div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        <TaskBadgeSection title="전체 업무" icon="📋" color="#334155" tasks={tasks} deptColorMap={deptColorMap} onBadgeClick={(t) => onSelectTask(t.id)} />
        <TaskBadgeSection title="완료" icon="✅" color="#10b981" tasks={completed} deptColorMap={deptColorMap} onBadgeClick={(t) => onSelectTask(t.id)} />
        <TaskBadgeSection title="진행 & 대기" icon="🕐" color="#3b82f6" tasks={active} deptColorMap={deptColorMap} onBadgeClick={(t) => onSelectTask(t.id)} />
        <TaskBadgeSection title="보류 & 이슈" icon="⚠️" color="#f59e0b" tasks={onHold} deptColorMap={deptColorMap} onBadgeClick={(t) => onSelectTask(t.id)} />
      </div>
    </div>
  );
}
