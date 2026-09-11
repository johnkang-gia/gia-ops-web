"use client";

import { ALL_SCOPE } from "@/lib/department";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCurrentTerm } from "@/lib/termQuery";
import type { DayReminder, Department, GoogleChatMirrorMessage, Task, TaskModeColor, TaskStatus, TeamMember, WorkTag } from "@/lib/types";
import WorkCalendar from "./WorkCalendar";
import NoteBoard from "./NoteBoard";
import GoogleChatRooms from "./GoogleChatRooms";
import PickupAlarmBar from "./PickupAlarmBar";
import TaskBoard from "./TaskBoard";
import QuickTaskWidget from "./QuickTaskWidget";
import AttendancePanels from "./AttendancePanels";
import IntegrationStatus from "./IntegrationStatus";
import DayEntryDialog, { DayReminderDialog, type DayEntryKind } from "./DayEntryDialog";
import AcademicItemDialog from "@/components/academic/AcademicItemDialog";
import type { ChecklistTemplate, Term } from "@/lib/types";
import { isMyTask } from "@/lib/myTask";
import { addDays } from "@/lib/taskSpan";
import { todayKst } from "@/lib/kst";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
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
const LAYOUT_STORAGE_KEY = "gia-ops-work-layout-v4";
const DEFAULT_LAYOUT = { leftWidth: 26, rightWidth: 27, leftOpen: true, rightOpen: true, inboxTopHeight: 55 };
type Layout = typeof DEFAULT_LAYOUT;

// 한 칸이 이보다 좁아지면 안에 든 표·채팅이 읽을 수 없게 되므로 드래그를 여기서 멈춥니다.
//
// 넓은 모니터에서는 %가 곧 큰 픽셀입니다 - 26%가 2,300px 이 되어 인박스 하나가 화면 4분의
// 1을 차지했습니다. 그래서 아래 한계를 12%까지 내렸습니다.
const MIN_SIDE = 12;
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
      inboxTopHeight: typeof p.inboxTopHeight === "number" ? p.inboxTopHeight : DEFAULT_LAYOUT.inboxTopHeight,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * 칸 사이의 폭 조절 손잡이.
 *
 * 예전에는 4px 짜리 선에 5% 검정 배경이라 **있는 줄도 몰랐습니다.** 넓은 모니터에서는
 * 더더욱 안 보입니다. 폭을 줄이려 해도 잡을 곳을 못 찾으니 못 줄입니다.
 *
 * 그래서 잡는 자리를 넓히고(10px), 가운데에 손잡이 점을 찍고, 마우스를 올리면 파랗게
 * 굵어집니다. **두 번 누르면 원래 폭으로 돌아갑니다** - 너무 좁게 만들어 놓고 되돌리지
 * 못하는 일이 없도록.
 */
function ResizeHandle({ onStart, onReset }: { onStart: (e: React.MouseEvent) => void; onReset: () => void }) {
  return (
    <div
      onMouseDown={onStart}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation="vertical"
      title="끌어서 칸 넓이를 바꿉니다 · 두 번 누르면 원래대로"
      className="group flex w-2.5 shrink-0 cursor-col-resize items-center justify-center bg-slate-200/80 transition-colors hover:bg-blue-400 active:bg-blue-500"
    >
      <span className="flex flex-col gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-[3px] w-[3px] rounded-full bg-slate-400 group-hover:bg-white" />
        ))}
      </span>
    </div>
  );
}

/** 위아래로 나눈 칸의 높이 손잡이. 가로 손잡이(ResizeHandle)와 같은 규칙입니다. */
function HeightHandle({ onStart, onReset }: { onStart: (e: React.MouseEvent) => void; onReset: () => void }) {
  return (
    <div
      onMouseDown={onStart}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation="horizontal"
      title="끌어서 위아래 높이를 바꿉니다 · 두 번 누르면 원래대로"
      className="group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center bg-slate-200/80 transition-colors hover:bg-blue-400 active:bg-blue-500"
    >
      <span className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-[3px] w-[3px] rounded-full bg-slate-400 group-hover:bg-white" />
        ))}
      </span>
    </div>
  );
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
  onPickupDone,
  onTaskCreated,
  mirrorMessages,
  roster,
  tags,
  onTagsChanged,
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
  /** 픽업 업무를 끝내고 업무보드에서 내립니다(업무 기록에도 안 남습니다). */
  onPickupDone: (taskId: string) => void | Promise<void>;
  onTaskCreated?: (task: Task) => void;
  // 구글챗 두 방(출결알림/선생님요청)을 실시간 미러링한 결과입니다. useRealtimeTable을 여기서
  // 두 번(패널마다 한 번씩) 부르면 같은 테이블 이름으로 채널이 중복 구독되어 페이지가 아예
  // 열리지 않는 문제가 있었던 전례가 있어서(tasks/채팅과 동일한 이유), 상위인
  // WorkBoardClient에서 한 번만 구독하고 배열을 그대로 내려받아 각 패널이 sourceKey로만
  // 걸러서 보여줍니다.
  mirrorMessages: GoogleChatMirrorMessage[];
  roster: RosterStudent[];
  /**
   * 색 이름표. **위에서 한 번 읽어 내려줍니다** - 달력과 상세 창이 따로 읽으면 방금 만든
   * 태그가 한쪽에만 보이고, 사람은 「안 만들어졌나」 하고 또 만듭니다.
   */
  tags: WorkTag[];
  onTagsChanged?: () => void;
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
  // 레이아웃이 동시에 마운트되어 같은 실시간 채널을 두 번 구독하는 문제가 있었으므로,
  // 실제 폭을 보고 둘 중 하나만 마운트합니다.
  const [isMobileView, setIsMobileView] = useState(false);
  // 모바일 기본 탭도 가장 많이 쓰는 등록·달력입니다.
  const notify = useToast();
  const [noteOpen, setNoteOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<"inbox" | "board" | "talk">("talk");
  /** 달력에서 누른 날짜. 그 날 마감으로 새 업무를 만드는 창을 엽니다. */
  const [newTaskDay, setNewTaskDay] = useState<string | null>(null);
  /** 달력에서 끌어서 고른 기간. */
  const [newTaskRange, setNewTaskRange] = useState<{ from: string; to: string } | null>(null);

  // ── 날짜를 누르면 갈래부터 고릅니다 ───────────────────────────────────
  //
  // 예전에는 누르는 즉시 업무 등록이었습니다. 그러다 보니 그날만 챙길 일(약·병원)도,
  // 해마다 오는 행사(졸업식·PBL)도 전부 업무 한 줄이 됐습니다. 앞엣것은 흐름판을 하루살이
  // 쪽지로 덮고, 뒤엣것은 그해가 지나면 흔적도 없이 사라집니다.
  /** 갈래를 고르는 중인 날짜. */
  const [dayPick, setDayPick] = useState<string | null>(null);
  /** 🔔 알림을 적는 중인 날짜. */
  const [reminderDay, setReminderDay] = useState<string | null>(null);
  /** 🎓 학사로 등록하는 중인 날짜. */
  const [academicDay, setAcademicDay] = useState<string | null>(null);
  const [academicTerm, setAcademicTerm] = useState<Term | null>(null);
  const [academicTemplates, setAcademicTemplates] = useState<ChecklistTemplate[]>([]);

  /** 그날의 알림들. */
  const [reminders, setReminders] = useState<DayReminder[]>([]);

  const loadReminders = useCallback(async () => {
    // 이번 달 앞뒤로 넉넉히. 달력이 지난달·다음달 칸을 함께 그리기 때문입니다.
    const from = addDays(todayKst(), -45);
    const to = addDays(todayKst(), 120);
    // 「전체」 탭은 거르지 않습니다 - 모아 보라고 있는 탭인데 거르면 언제나 빕니다.
    let q = createClient().from("day_reminders").select("*").gte("day", from).lte("day", to).order("day");
    if (activeDepartment.name !== ALL_SCOPE) q = q.eq("department", activeDepartment.name);
    const { data, error } = await q;
    if (error) {
      // 조용히 비워두지 않습니다. 빈 달력은 「챙길 게 없다」로 읽히는데, 사실은
      // 「못 읽어왔다」입니다. 둘은 완전히 다른 이야기입니다.
      notify(`알림을 읽지 못했습니다: ${error.message}`, "error");
      return;
    }
    setReminders((data as DayReminder[] | null) ?? []);
  }, [activeDepartment.name, notify]);

  useEffect(() => {
    void loadReminders();
    const supabase = createClient();
    const ch = supabase
      .channel("day-reminders")
      .on("postgres_changes", { event: "*", schema: "public", table: "day_reminders" }, () => void loadReminders())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadReminders]);

  async function toggleReminder(r: DayReminder) {
    const next = !r.done;
    // 화면부터 바꿉니다 - 누르고 아무 일도 안 일어나면 사람은 두 번 세 번 누릅니다.
    setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, done: next } : x)));
    const { error } = await createClient()
      .from("day_reminders")
      .update({ done: next, done_by: next ? currentUserEmail : null, done_at: next ? new Date().toISOString() : null })
      .eq("id", r.id);
    if (error) {
      setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, done: r.done } : x)));
      notify(`표시하지 못했습니다: ${error.message}`, "error");
    }
  }

  async function deleteReminder(r: DayReminder) {
    // 되묻지 않습니다. 알림 한 줄을 지우는 것은 되돌릴 만큼 큰 일이 아닙니다.
    const { error } = await createClient().from("day_reminders").delete().eq("id", r.id);
    if (error) {
      notify(`지우지 못했습니다: ${error.message}`, "error");
      return;
    }
    setReminders((prev) => prev.filter((x) => x.id !== r.id));
  }

  /** 학사 팝업이 쓸 자료. 누르는 사람만 쓰므로 그때 읽습니다. */
  async function openAcademic(day: string) {
    setAcademicDay(day);
    if (academicTerm) return;
    const supabase = createClient();
    const [{ term, error: tErr }, { data: tpl }] = await Promise.all([
      // `is_current` 는 요금 학기표(fee_terms)의 칸입니다. 학사 학기표는 `status` 로
      // 「진행중」을 나타냅니다 - 없는 칸을 물어봐서 팝업이 열리자마자 오류가 났습니다.
      fetchCurrentTerm<Term>(supabase),
      supabase.from("academic_checklist_templates").select("*").order("sort_order", { ascending: true }),
    ]);
    if (tErr) {
      notify(`학기 정보를 읽지 못했습니다: ${tErr}`, "error");
      return;
    }
    // 학기가 아직 없는 것은 오류가 아닙니다 - 팝업은 열리고, 「학기시작 2주 전」 같은
    // 상대 날짜만 못 씁니다. 그 사실은 팝업 안에서 알려줍니다.
    setAcademicTerm(term ?? null);
    setAcademicTemplates((tpl as ChecklistTemplate[] | null) ?? []);
  }

  function pickKind(kind: DayEntryKind) {
    const day = dayPick;
    setDayPick(null);
    if (!day) return;
    if (kind === "알림") setReminderDay(day);
    else if (kind === "업무") setNewTaskDay(day);
    else void openAcademic(day);
  }

  /**
   * 제목을 그 자리에서 고칩니다.
   *
   * 상세 창을 열어야만 고칠 수 있으면 오타 한 글자를 고치려고 창을 열고 닫습니다. 대개
   * 안 고치고 넘어가고, 그 오타가 몇 달 남습니다.
   */
  async function renameTask(task: Task, title: string) {
    const { error } = await createClient().from("tasks").update({ title }).eq("id", task.id);
    if (error) {
      notify(`제목을 바꾸지 못했습니다: ${error.message}`, "error");
      return;
    }
    onTaskCreated?.({ ...task, title });
  }

  /**
   * 달력에서 끌어다 놓아 마감일만 바꿉니다.
   *
   * 낙관적으로 화면부터 옮기지 않습니다 - 실패했는데 화면만 옮겨져 있으면, 사람은 옮긴 줄
   * 알고 그 날짜를 믿습니다. 저장이 끝나고 부모가 목록을 다시 받아 그릴 때 옮겨집니다.
   */
  async function moveDue(task: Task, dayKey: string) {
    // 마감은 그 날 저녁 6시로 둡니다. 날짜만 바꾸는 것이라 시각은 하루의 끝 무렵이 자연스럽고,
    // 자정으로 두면 「그날까지」인지 「그 전날까지」인지 사람마다 다르게 읽습니다.
    // 기간짜리는 **기간째** 옮깁니다. 끝날만 옮기면 「3일짜리 일」이 소리 없이 늘거나
    // 줄어드는데, 화면에는 그냥 옮겨진 것처럼 보입니다.
    const endKey = task.due_at ? new Date(task.due_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : null;
    const length = task.start_on && endKey ? Math.round((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${task.start_on}T00:00:00Z`)) / 86400000) : 0;
    const nextStart = length > 0 ? addDays(dayKey, -length) : task.start_on;

    const patch = { due_at: `${dayKey}T18:00:00+09:00`, start_on: nextStart };
    const { error } = await createClient().from("tasks").update(patch).eq("id", task.id);
    if (error) {
      notify(`마감일을 바꾸지 못했습니다: ${error.message}`, "error");
      return;
    }
    onTaskCreated?.({ ...task, ...patch });
  }

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

  /**
   * 왼쪽 칸 — 위는 «들어오는 것», 아래는 «구글챗».
   *
   * 아래를 구글챗으로 둔 이유: 직원들은 구글챗을 띄워놓고 일합니다. 읽기만 되면 답할 때마다
   * 구글챗을 열어야 해서 창이 하나도 안 줄고, 그러면 이 화면을 놓을 자리가 여전히 없습니다.
   * 읽고 답하는 것까지 한 칸 안에서 돼야 창 하나를 실제로 닫습니다.
   *
   * 위아래 비율은 이 브라우저에 기억해둡니다 - 사람마다 문의를 더 보는 날과 채팅을 더 보는
   * 날이 다릅니다.
   */
  // 인박스 안 위아래 나누기. 가로 손잡이와 같은 방식이되 기준이 컨테이너의 높이입니다.
  const inboxRef = useRef<HTMLDivElement>(null);
  const startVerticalResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const box = inboxRef.current?.getBoundingClientRect();
      if (!box) return;
      const startY = e.clientY;
      const startValue = layout.inboxTopHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      function onMove(ev: MouseEvent) {
        const delta = ((ev.clientY - startY) / box!.height) * 100;
        // 한쪽이 너무 얇아지면 안에 든 글을 읽을 수 없습니다.
        const next = Math.min(85, Math.max(15, startValue + delta));
        setLayout((p) => ({ ...p, inboxTopHeight: next }));
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
    [layout.inboxTopHeight],
  );

  const inbox = (
    <div ref={inboxRef} className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 overflow-hidden" style={{ height: `${layout.inboxTopHeight}%` }}>
        <AttendancePanels
          messages={mirrorMessages}
          team={team}
          userEmail={currentUserEmail}
          department={activeDepartment.name}
          roster={roster}
          onTaskCreated={onTaskCreated}
        />
      </div>
      <HeightHandle
        onStart={startVerticalResize}
        onReset={() => setLayout((p) => ({ ...p, inboxTopHeight: DEFAULT_LAYOUT.inboxTopHeight }))}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <GoogleChatRooms messages={mirrorMessages} currentUserName={team.find((m) => m.email === currentUserEmail)?.name ?? null} />
      </div>
    </div>
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
      onPickupDone={onPickupDone}
      mineOnly={mineOnly}
      compact={!isMobileView}
    />
  );

  /**
   * 가운데 — 등록 + 달력.
   *
   * 여기 있던 채팅창을 뺐습니다. 사무실에 다 같이 앉아 있으니 말로 해버려서 거의 안 쓰였고,
   * 안 쓰는 것이 화면에서 가장 넓은 자리를 차지하고 있었습니다.
   *
   * 대신 **언제 무엇이 몰려 있는가**를 봅니다. 흐름판(오른쪽)은 «무엇이 어디까지 됐나»를
   * 보는 자리라 둘은 겹치지 않습니다 - 흐름판만 보면 다음 주 수요일에 마감이 다섯 개 겹친
   * 것을 그날 아침에야 압니다.
   */
  const center = (
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
          prefillDay={newTaskDay}
          prefillRange={newTaskRange}
          onPrefillUsed={() => {
            setNewTaskDay(null);
            setNewTaskRange(null);
          }}
          tags={tags}
          onTagsChanged={onTagsChanged}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pt-1">
        <WorkCalendar
          tasks={tasks}
          tags={tags}
          reminders={reminders}
          onToggleReminder={(r) => void toggleReminder(r)}
          onDeleteReminder={(r) => void deleteReminder(r)}
          onPickDate={setDayPick}
          onPickRange={(from, to) => setNewTaskRange({ from, to })}
          onOpenTask={(t) => onOpenTask(t.id)}
          onMoveDue={(t, dayKey) => void moveDue(t, dayKey)}
          onRename={(t, title) => void renameTask(t, title)}
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
              { key: "talk", label: "🗓️ 등록·달력" },
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
          {mobileTab === "inbox" && (
            <div className="flex h-full flex-col overflow-hidden">
              {/* 모바일에서도 연결상태를 볼 수 있게 인박스 탭 위에 한 줄로 둡니다. */}
              <div className="flex h-7 shrink-0 items-center justify-end border-b border-black/5 px-2.5">
                <IntegrationStatus />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">{inbox}</div>
            </div>
          )}
          {mobileTab === "board" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-black/5 px-2.5">{boardControls}</div>
              <div className="min-h-0 flex-1 overflow-hidden">{board}</div>
            </div>
          )}
          {mobileTab === "talk" && center}
        </div>
      </div>
    );
  }

  /**
   * 공용 쪽지 - 말로 하고 지나가는 것을 남기는 자리. 채팅창이 있던 몫입니다.
   *
   * **인박스 아래로는 내려가지 않습니다.** 왼쪽 칸은 위아래로 이미 나뉘어 있어서(들어오는
   * 것 · 구글챗) 거기까지 쪽지가 깔리면 세 겹이 됩니다. 등록·달력 아래에서 흐름판까지만
   * 깔면 쪽지는 여전히 «지나가다 보이는 자리»에 있고, 왼쪽은 세로로 길게 쓸 수 있습니다.
   */
  const noteStrip = noteOpen ? (
    <div className="h-[132px] shrink-0 border-t border-black/10 bg-white/60 px-2.5 py-1.5">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[11px] font-bold text-slate-600">📝 쪽지</span>
        <span className="text-[10px] text-slate-400">다같이 봅니다 · 지난 것은 저절로 떨어집니다</span>
        <button onClick={() => setNoteOpen(false)} className="ml-auto rounded px-1.5 text-[11px] text-slate-400 hover:bg-slate-100" title="접기">
          ▾
        </button>
      </div>
      <div className="h-[96px]">
        <NoteBoard
          department={activeDepartment.name}
          currentUserEmail={currentUserEmail}
          currentUserName={team.find((m) => m.email === currentUserEmail)?.name ?? null}
        />
      </div>
    </div>
  ) : (
    <button
      onClick={() => setNoteOpen(true)}
      className="flex h-7 shrink-0 items-center gap-1.5 border-t border-black/10 bg-white/60 px-2.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
    >
      📝 쪽지 <span className="font-normal text-slate-400">펼치기</span>
    </button>
  );

  return (
    // 맨 위 한 줄은 **곧 하원할 아이**입니다. 픽업 연락은 아침에 오고 아이는 오후에 나가서,
    // 그 사이 몇 시간 동안 목록 어딘가에 조용히 적혀 있을 뿐입니다. 그 시각이 되어도 아무
    // 일도 일어나지 않고, 잊으면 아무 오류 없이 아이가 교실에 남습니다.
    <div className="flex h-full flex-col overflow-hidden">
      <PickupAlarmBar />
      {/* 왼쪽(인박스)은 화면 끝까지 내려오고, 쪽지는 등록·달력부터 흐름판까지의 아래에만 깔립니다. */}
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      {/* ① 들어오는 것 - 학부모 문의·출결·선생님 요청을 한 곳에서 받습니다. 머리글 오른쪽에
          토들·구글챗 연결상태 불이 들어옵니다(요청: "인박스탭제목 오른쪽 빈공간에 토들: 초록불
          구글챗: 초록불 형식으로"). */}
      {layout.leftOpen ? (
        <>
          <Zone
            icon="📥"
            title="인박스"
            right={<IntegrationStatus />}
            onCollapse={() => setLayout((p) => ({ ...p, leftOpen: false }))}
            style={{ width: `${layout.leftWidth}%` }}
          >
            {inbox}
          </Zone>
          <ResizeHandle
            onStart={startResize("left")}
            onReset={() => setLayout((p) => ({ ...p, leftWidth: DEFAULT_LAYOUT.leftWidth }))}
          />
        </>
      ) : (
        <CollapsedRail icon="📥" title="인박스" side="left" onOpen={() => setLayout((p) => ({ ...p, leftOpen: true }))} />
      )}

      {/* ②③ 등록·달력 + 흐름판, 그리고 그 아래 폭만큼 깔리는 쪽지. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ② 일하는 곳 - 등록창 + 달력. 남는 폭을 전부 씁니다. */}
          <Zone icon="🗓️" title="등록 · 달력" className="flex-1">
            {center}
          </Zone>

          {/* ③ 현황판 - 흐름판은 드래그로 진행상황을 옮기고 훑어보는 용도라 오른쪽 좁은 칸이면
              충분합니다. 세로 스택(compact)이라 좁아도 카드가 잘리지 않고, 안 볼 때는 접습니다. */}
          {layout.rightOpen ? (
            <>
              <ResizeHandle
                onStart={startResize("right")}
                onReset={() => setLayout((p) => ({ ...p, rightWidth: DEFAULT_LAYOUT.rightWidth }))}
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

        {/* ④ 공용 쪽지 - 등록·달력 아래에서 흐름판까지. 접을 수 있게 두되 기본은 펼침입니다 -
            접힌 채로 두면 붙일 생각이 안 납니다. */}
        {noteStrip}
      </div>

      </div>

      {/* ── 날짜를 누르면 뜨는 것들 ────────────────────────────────────
          갈래 → 그 갈래의 등록 창. 업무는 창을 따로 띄우지 않고 위쪽 등록 칸에 날짜를
          채워 넣습니다 - 이미 잘 쓰던 자리라 새 창을 하나 더 만들 이유가 없습니다. */}
      {dayPick && <DayEntryDialog day={dayPick} onPick={pickKind} onClose={() => setDayPick(null)} />}
      {reminderDay && (
        <DayReminderDialog
          day={reminderDay}
          department={activeDepartment.name}
          authorEmail={currentUserEmail}
          authorName={team.find((m) => m.email === currentUserEmail)?.name ?? null}
          onClose={() => setReminderDay(null)}
          onSaved={() => void loadReminders()}
        />
      )}
      {academicDay && (
        <AcademicItemDialog
          currentTerm={academicTerm}
          templateCount={academicTemplates.length}
          templates={academicTemplates}
          initialDate={academicDay}
          onClose={() => setAcademicDay(null)}
          onSaved={(msg) => {
            notify(msg, "success");
            setAcademicTerm(null);
          }}
        />
      )}
    </div>
  );
}
