"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Department, GoogleChatMirrorMessage, Task, TaskModeColor, TaskStatus, TeamMember } from "@/lib/types";
import ChatPanel from "./ChatPanel";
import TaskBoard from "./TaskBoard";
import QuickTaskWidget from "./QuickTaskWidget";
import AttendancePanels from "./AttendancePanels";
import PinnedMemo from "./PinnedMemo";
import { isMyTask } from "@/lib/myTask";
import type { RosterStudent } from "@/lib/attendanceDigest";

// 업무 보드 = 3존 관제탑(요청: "행정직원들이 이 페이지만 띄워놓고도 업무가 가능하도록").
//
// 칸의 자리는 실제로 쓰는 빈도로 정했습니다(요청: "가장 많이 쓰이는 것이 업무등록(등록창+채팅창)과
// 인박스인데 업무흐름판이 떡하니 가운데에 있어서 실용성이 떨어져").
//
//   · 등록·채팅 - 하루 종일 손이 가는 "입력 도구"입니다. 글을 쓰는 곳이니 눈과 손이 머무는
//     가운데, 가장 넓게 둡니다.
//   · 인박스   - 수시로 확인하는 "수신함"입니다. 읽는 흐름이 왼쪽에서 시작하니 왼쪽입니다.
//     인박스에서 [→업무등록]을 누르면 바로 옆 가운데에서 이어서 처리합니다.
//   · 흐름판   - 드래그로 진행상황을 옮기고 훑어보는 "현황판"입니다. 계속 보는 게 아니라
//     가끔 확인하는 것이니 오른쪽 좁은 칸에 두고, 안 볼 때는 접어서 막대만 남깁니다.
//
//   📥 인박스        💬 등록 · 채팅(가장 넓게)      🔀 업무 흐름판
//   학부모 문의      부서 메모(고정)                예정 ↓ 진행중 ↓ 완료 (세로)
//   출결내역         빠른 업무등록                  보류·이슈(접기)
//   출결알림         부서 채팅
//   선생님요청
//
// 양옆 칸은 접을 수 있습니다. 접으면 세로 막대만 남고 가운데가 그만큼 넓어집니다. 흐름판이
// 옆 칸이 되면서 3열 대신 위에서 아래로(예정→진행중→완료) 쌓이는 세로 배치를 씁니다 - 좁은
// 폭에 3열을 욱여넣으면 카드 제목이 다 잘립니다. 폭과 접힘 상태는 이 브라우저에 기억해둡니다.
const LAYOUT_STORAGE_KEY = "gia-ops-work-layout-v3";
const DEFAULT_LAYOUT = { leftWidth: 26, rightWidth: 27, leftOpen: true, rightOpen: true };
type Layout = typeof DEFAULT_LAYOUT;

// 한 칸이 이보다 좁아지면 안에 든 표·채팅이 읽을 수 없게 되므로 드래그를 여기서 멈춥니다.
const MIN_SIDE = 16;
const MAX_SIDE = 42;

function loadSavedLayout(): Layout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const p = JSON.parse(raw) as Partial<Layout>;
    return {
      leftWidth: typeof p.leftWidth === "number" ? p.leftWidth : DEFAULT_LAYOUT.leftWidth,
      rightWidth: typeof p.rightWidth === "number" ? p.rightWidth : DEFAULT_LAYOUT.rightWidth,
      leftOpen: typeof p.leftOpen === "boolean" ? p.leftOpen : DEFAULT_LAYOUT.leftOpen,
      rightOpen: typeof p.rightOpen === "boolean" ? p.rightOpen : DEFAULT_LAYOUT.rightOpen,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

// 세 칸이 모두 똑같이 생긴 머리글을 씁니다 - 어디를 보고 있는지가 같은 자리에서 같은 크기로
// 읽혀야 화면이 정돈돼 보입니다(요청: "제대로 깔끔하게 보이도록").
function Zone({
  icon,
  title,
  right,
  onCollapse,
  children,
  style,
  className,
}: {
  icon: string;
  title: string;
  right?: React.ReactNode;
  onCollapse?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <section className={"flex min-w-0 flex-col overflow-hidden " + (className ?? "")} style={style}>
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-black/5 bg-white/50 px-2.5">
        <span className="shrink-0 text-[11px] font-extrabold tracking-tight text-slate-500">
          {icon} {title}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1">{right}</div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title={`${title} 접기`}
            className="shrink-0 rounded px-1 text-[11px] text-slate-300 transition hover:bg-black/5 hover:text-slate-600"
          >
            ✕
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

// 접힌 칸 - 세로 막대만 남습니다. 눌러서 다시 펼칩니다.
function CollapsedRail({ icon, title, side, onOpen }: { icon: string; title: string; side: "left" | "right"; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${title} 펼치기`}
      className={
        "flex w-8 shrink-0 flex-col items-center gap-2 bg-black/[0.02] py-3 text-slate-400 transition hover:bg-black/5 hover:text-slate-700 " +
        (side === "left" ? "border-r border-black/5" : "border-l border-black/5")
      }
    >
      <span className="text-[13px]">{icon}</span>
      <span className="text-[11px] font-bold [writing-mode:vertical-rl]">{title}</span>
    </button>
  );
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
  roster,
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
  roster: RosterStudent[];
}) {
  // 서버 렌더링(첫 화면)과 클라이언트 첫 렌더가 반드시 같아야 하므로(hydration 불일치 방지),
  // 초기값은 항상 기본값으로 두고 마운트된 다음에만 저장된 값을 반영합니다.
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const hydratedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 흐름판의 [내 업무만 | 전체]는 존 머리글에 두려고 여기로 올렸습니다 - 스크롤되는 본문 안이
  // 아니라 항상 같은 자리에 고정돼 있어야 다른 칸의 머리글과 줄이 맞습니다.
  const [mineOnly, setMineOnly] = useState(true);

  // 마우스 드래그로 폭을 나누는 3단 레이아웃은 손가락 터치 화면에서 쓸 수 없어서, 작은
  // 화면에서는 탭으로 한 칸씩 전체 폭으로 보여줍니다. CSS(hidden/sm:flex)로만 나누면 두
  // 레이아웃이 동시에 마운트되어 ChatPanel이 같은 실시간 채널을 두 번 구독하면서 업무탭이
  // 아예 열리지 않는 문제가 있었으므로, 실제 폭을 보고 둘 중 하나만 마운트합니다.
  const [isMobileView, setIsMobileView] = useState(false);
  // 모바일 기본 탭도 가장 많이 쓰는 등록·채팅입니다.
  const [mobileTab, setMobileTab] = useState<"inbox" | "board" | "talk">("talk");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobileView(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobileView(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setLayout(loadSavedLayout());
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return; // 저장된 값을 불러오기 전이면(기본값 상태) 덮어쓰지 않습니다.
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // 시크릿 모드 등 localStorage를 못 쓰는 환경이면 이번 세션만 기억하지 않고 넘어갑니다.
    }
  }, [layout]);

  // 드래그로 좌/우 칸 폭 조절. 예전에는 window.innerWidth에서 사이드바 폭을 어림잡아 빼는
  // 방식이라 화면 크기나 사이드바 상태가 바뀌면 손끝과 경계선이 어긋났습니다. 실제 컨테이너
  // 폭을 재서 계산하면 항상 마우스를 따라옵니다.
  const startResize = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      const startX = e.clientX;
      const startValue = side === "left" ? layout.leftWidth : layout.rightWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        const deltaPercent = ((ev.clientX - startX) / box!.width) * 100;
        // 오른쪽 칸은 마우스를 왼쪽으로 끌수록 넓어지므로 부호가 반대입니다.
        let next = side === "left" ? startValue + deltaPercent : startValue - deltaPercent;
        next = Math.min(MAX_SIDE, Math.max(MIN_SIDE, next));
        setLayout((p) => (side === "left" ? { ...p, leftWidth: next } : { ...p, rightWidth: next }));
      }
      function onUp() {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [layout.leftWidth, layout.rightWidth]
  );

  const inbox = (
    <AttendancePanels
      messages={mirrorMessages}
      team={team}
      userEmail={currentUserEmail}
      department={activeDepartment.name}
      roster={roster}
      onTaskCreated={onTaskCreated}
    />
  );

  // compact: 흐름판이 오른쪽 좁은 칸에 들어가므로 3열 대신 세로로 쌓습니다.
  const board = (
    <TaskBoard
      tasks={tasks}
      team={team}
      deptColorMap={deptColorMap}
      modeColorMap={modeColorMap}
      isAdmin={isAdmin}
      currentUserEmail={currentUserEmail}
      onOpenTask={onOpenTask}
      onChangeStatus={onChangeStatus}
      onToggleAck={onToggleAck}
      mineOnly={mineOnly}
      compact={!isMobileView}
    />
  );

  const talk = (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 부서 공유 메모를 채팅 맨 위에 고정합니다 - 매일 봐야 하는 메모라 접힌 상태에서도 첫 줄이
          보입니다. 예전에는 흐름판 위에도 같은 메모가 한 번 더 그려지고 있었는데(ActivityLog),
          같은 내용이 화면에 두 번 나올 이유가 없어 이쪽만 남겼습니다. */}
      <PinnedMemo department={activeDepartment.name} currentUserEmail={currentUserEmail} />
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
  );

  // 흐름판 머리글에 들어가는 조작부 - 세 칸의 머리글 높이를 맞추려고 여기서 그립니다.
  // 흐름판과 똑같은 기준(isMyTask)으로 세야 머리글 숫자와 카드 수가 어긋나지 않습니다.
  const openCount = tasks.filter((t) => t.status !== "완료" && (!mineOnly || isMyTask(t, currentUserEmail))).length;
  const boardControls = (
    <>
      <div className="flex shrink-0 overflow-hidden rounded-full border border-black/10 text-[10px] font-bold">
        <button
          type="button"
          onClick={() => setMineOnly(true)}
          className={"px-2 py-0.5 transition " + (mineOnly ? "bg-blue-600 text-white" : "bg-white text-slate-400 hover:bg-slate-50")}
        >
          🙋 내 업무만
        </button>
        <button
          type="button"
          onClick={() => setMineOnly(false)}
          className={"px-2 py-0.5 transition " + (!mineOnly ? "bg-blue-600 text-white" : "bg-white text-slate-400 hover:bg-slate-50")}
        >
          🗂️ 전체
        </button>
      </div>
      <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] tabular-nums text-slate-400">진행 {openCount}건</span>
    </>
  );

  if (isMobileView) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="glass-panel flex shrink-0 divide-x divide-black/5 border-b border-black/5">
          {(
            [
              { key: "inbox", label: "📥 인박스" },
              { key: "talk", label: "💬 등록·채팅" },
              { key: "board", label: "🔀 흐름판" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setMobileTab(t.key)}
              className={"flex-1 py-2.5 text-xs font-bold transition " + (mobileTab === t.key ? "bg-blue-50 text-blue-600" : "text-slate-500")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {mobileTab === "inbox" && inbox}
          {mobileTab === "board" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-black/5 px-2.5">{boardControls}</div>
              <div className="min-h-0 flex-1 overflow-hidden">{board}</div>
            </div>
          )}
          {mobileTab === "talk" && talk}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/* ① 들어오는 것 - 학부모 문의·출결·선생님 요청을 한 곳에서 받습니다. */}
      {layout.leftOpen ? (
        <>
          <Zone icon="📥" title="인박스" onCollapse={() => setLayout((p) => ({ ...p, leftOpen: false }))} style={{ width: `${layout.leftWidth}%` }}>
            {inbox}
          </Zone>
          <div
            onMouseDown={startResize("left")}
            className="w-1 shrink-0 cursor-col-resize bg-black/5 transition hover:bg-blue-400"
          />
        </>
      ) : (
        <CollapsedRail icon="📥" title="인박스" side="left" onOpen={() => setLayout((p) => ({ ...p, leftOpen: true }))} />
      )}

      {/* ② 일하는 곳 - 등록창+채팅창. 가장 많이 쓰는 도구라 남는 폭을 전부 씁니다(요청).
          양옆을 접으면 화면 전체가 등록·채팅이 됩니다. */}
      <Zone icon="💬" title="등록 · 채팅" className="flex-1">
        {talk}
      </Zone>

      {/* ③ 현황판 - 흐름판은 드래그로 진행상황을 옮기고 훑어보는 용도라 오른쪽 좁은 칸이면
          충분합니다. 세로 스택(compact)이라 좁아도 카드가 잘리지 않고, 안 볼 때는 접습니다. */}
      {layout.rightOpen ? (
        <>
          <div
            onMouseDown={startResize("right")}
            className="w-1 shrink-0 cursor-col-resize bg-black/5 transition hover:bg-blue-400"
          />
          <Zone
            icon="🔀"
            title="흐름판"
            right={boardControls}
            onCollapse={() => setLayout((p) => ({ ...p, rightOpen: false }))}
            style={{ width: `${layout.rightWidth}%` }}
          >
            {board}
          </Zone>
        </>
      ) : (
        <CollapsedRail icon="🔀" title="흐름판" side="right" onOpen={() => setLayout((p) => ({ ...p, rightOpen: true }))} />
      )}
    </div>
  );
}
