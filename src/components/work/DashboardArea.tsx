"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Task } from "@/lib/types";

// 업무 상황판을 "많이 차지하지 않게" 압축했습니다 - 이전처럼 카드를 잔뜩 늘어놓는 대신, 상태별
// 숫자 배지 한 줄만 보여주고 클릭하면 그 상태의 업무 목록이 포탈 팝업으로 뜹니다(사이드바
// 부메뉴와 동일한 패턴 - document.body에 그려서 어떤 부모 영역에도 잘리지 않습니다).
type GroupKey = "all" | "완료" | "active" | "보류";

const GROUPS: { key: GroupKey; label: string; icon: string; color: string; filter: (t: Task) => boolean }[] = [
  { key: "all", label: "전체", icon: "📋", color: "#334155", filter: () => true },
  { key: "active", label: "진행 & 대기", icon: "🕐", color: "#3b82f6", filter: (t) => t.status === "예정" || t.status === "진행중" },
  { key: "보류", label: "보류 & 이슈", icon: "⚠️", color: "#f59e0b", filter: (t) => t.status === "보류" },
  { key: "완료", label: "완료", icon: "✅", color: "#10b981", filter: (t) => t.status === "완료" },
];

export default function DashboardArea({
  tasks,
  activeDepartmentName,
  deptColorMap,
  onSelectTask,
  compact = false,
}: {
  tasks: Task[];
  activeDepartmentName: string;
  deptColorMap: Map<string, string>;
  onSelectTask: (id: string) => void;
  // "전체 업무목록" 제목 옆에 아주 작게 넣기 위한 모드입니다(요청: "업무상황판을 오른쪽 전체
  // 업무목록 제목 옆에 아주 작게 배치") - 진행률 원형 그래프와 "[부서] 업무 상황판" 라벨을
  // 빼고, 상태별 숫자 뱃지 4개만 아이콘+숫자로 줄여서 보여줍니다(클릭하면 여전히 팝업으로
  // 목록을 볼 수 있습니다).
  compact?: boolean;
}) {
  const [openKey, setOpenKey] = useState<GroupKey | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const completed = tasks.filter((t) => t.status === "완료");
  const progress = tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0;
  const r = 13;
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;

  function openPopup(key: GroupKey, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 300) });
    setOpenKey(key);
  }

  const activeGroup = GROUPS.find((g) => g.key === openKey);
  const popupTasks = activeGroup ? tasks.filter(activeGroup.filter) : [];

  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        {GROUPS.map((g) => {
          const count = tasks.filter(g.filter).length;
          return (
            <button
              key={g.key}
              onClick={(e) => openPopup(g.key, e.currentTarget)}
              title={`${g.label} ${count}건`}
              style={{ backgroundColor: g.color + "1a", color: g.color }}
              className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold transition hover:brightness-95"
            >
              <span>{g.icon}</span>
              <span>{count}</span>
            </button>
          );
        })}

        {activeGroup &&
          pos &&
          typeof document !== "undefined" &&
          createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenKey(null)} />
              <div
                style={{ position: "fixed", top: pos.top, left: pos.left }}
                className="z-50 max-h-80 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
              >
                <div className="mb-1.5 flex items-center justify-between px-1.5 pt-0.5 text-[12px] font-bold" style={{ color: activeGroup.color }}>
                  <span>
                    {activeGroup.icon} {activeGroup.label}
                  </span>
                  <span>{popupTasks.length}건</span>
                </div>
                {popupTasks.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs opacity-50">업무 없음</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {popupTasks.map((task) => {
                      const deptColor = task.department ? deptColorMap.get(task.department) : null;
                      return (
                        <button
                          key={task.id}
                          onClick={() => {
                            onSelectTask(task.id);
                            setOpenKey(null);
                          }}
                          style={{ borderLeftColor: deptColor || activeGroup.color }}
                          className="truncate rounded-lg border-l-[3px] bg-black/[0.02] px-2 py-1.5 text-left text-[12px] hover:bg-black/5"
                          title={task.title}
                        >
                          {task.title}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>,
            document.body
          )}
      </div>
    );
  }

  return (
    <div className="glass flex h-full items-center gap-2 overflow-x-auto px-3 py-1.5">
      <div className="flex shrink-0 flex-col items-center">
        <svg width="26" height="26" viewBox="0 0 34 34" className="-rotate-90">
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
        <div className="text-[9px] font-bold text-blue-600">
          {completed.length}/{tasks.length}
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-[11px] font-bold opacity-70">📊 [{activeDepartmentName}] 업무 상황판</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {GROUPS.map((g) => {
            const count = tasks.filter(g.filter).length;
            return (
              <button
                key={g.key}
                onClick={(e) => openPopup(g.key, e.currentTarget)}
                style={{ backgroundColor: g.color + "1a", color: g.color }}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition hover:brightness-95"
              >
                <span>{g.icon}</span>
                <span>{g.label}</span>
                <span className="rounded-full bg-white/70 px-1.5">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeGroup &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenKey(null)} />
            <div
              style={{ position: "fixed", top: pos.top, left: pos.left }}
              className="z-50 max-h-80 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
            >
              <div className="mb-1.5 flex items-center justify-between px-1.5 pt-0.5 text-[12px] font-bold" style={{ color: activeGroup.color }}>
                <span>
                  {activeGroup.icon} {activeGroup.label}
                </span>
                <span>{popupTasks.length}건</span>
              </div>
              {popupTasks.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs opacity-50">업무 없음</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {popupTasks.map((task) => {
                    const deptColor = task.department ? deptColorMap.get(task.department) : null;
                    return (
                      <button
                        key={task.id}
                        onClick={() => {
                          onSelectTask(task.id);
                          setOpenKey(null);
                        }}
                        style={{ borderLeftColor: deptColor || activeGroup.color }}
                        className="truncate rounded-lg border-l-[3px] bg-black/[0.02] px-2 py-1.5 text-left text-[12px] hover:bg-black/5"
                        title={task.title}
                      >
                        {task.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
