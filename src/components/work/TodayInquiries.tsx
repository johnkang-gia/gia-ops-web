"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  notifyOpsBoardRefresh,
  OPS_REFRESH_CHANNEL,
  OPS_REFRESH_EVENT,
} from "@/lib/opsRefresh";
import { useToast } from "@/components/common/ToastProvider";
import { Who } from "@/components/common/HomonymProvider";
import { useStudentPanel } from "@/components/students/StudentPanelProvider";
import { loadStudents } from "@/lib/students";
import { kstDateOffset } from "@/lib/kst";
import {
  BADGE_STYLE,
  INQUIRY_BADGES,
  elapsedLabel,
  elapsedTone,
  isNoActionBadges,
  type InquiryBadge,
} from "@/lib/inquiryBadges";
import type { TeamMember } from "@/lib/types";
import PickupTriage, { type PickupRow, type StudentOption } from "@/components/pickup/PickupTriage";
import { loadHouseCandidates, type HouseChild } from "@/lib/houseCandidates";
import { chimeEnabled, playChime, primeChime, setChimeEnabled } from "@/lib/chime";
import { DesktopNotifyToggle, ProcessingReportButton, ReplyTemplates, StudentHistory } from "./InquiryExtras";

/**
 * 오늘의 문의사항 — 학부모가 오늘 쓴 글 전부와, 담당이 정해졌는데 아직 안 끝난 지난 글.
 *
 * 예전 「학부모 문의사항」 탭은 셔틀 기준 분류의 「문의」만 보여줬습니다. 인사로 판정된 글은
 * 본문 없이 무시로 내려갔고, 확인이 필요한 글은 다른 탭에 따로 쌓였습니다. 행정실이 하루 동안
 * 처리하는 것은 토들로 온 글 전체라서, 이제 **한 목록**에 뱃지만 붙여 보여줍니다.
 *
 * 두 단추를 나눕니다.
 *   - 답함: 학부모에게 답을 했다. 토들에 직원 답글이 달리면 수집기가 자동으로 채웁니다.
 *   - 처리 완료: 요청한 일이 끝났다. 일을 끝낸 직원이 누릅니다.
 * 「전달드리겠습니다」로 답했지만 청구서는 아직 안 나간 경우처럼, 둘은 시각이 다릅니다.
 * 누른 사람과 시각은 자동으로 남습니다 - 담당자를 미리 정해 두지 않고, 한 사람이 누릅니다.
 */

export type InquiryRow = {
  id: string;
  kind: string | null;
  source: string | null;
  status: string | null;
  service_date?: string | null;
  channel_id?: string | null;
  student_id: string | null;
  channel_label: string | null;
  sender_name: string | null;
  received_at: string;
  created_at: string | null;
  raw_text: string | null;
  summary: string | null;
  urgency: string | null;
  source_url: string | null;
  badges: string[] | null;
  replied_at: string | null;
  replied_by: string | null;
  replied_via: string | null;
  answered_at: string | null;
  answered_by: string | null;
  answered_via: string | null;
  assignees: string[] | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  skipped_at?: string | null;
  skipped_by?: string | null;
  announced_at?: string | null;
  announced_by?: string | null;
  is_demo?: boolean | null;
};

type Ctx = {
  rows: InquiryRow[];
  names: Map<string, string>;
  students: StudentOption[];
  houseOf: Map<string, HouseChild[]>;
  /** 같은 학생(없으면 같은 방)이 이번 주 같은 갈래로 몇 번째 연락했는가. 2 이상만 담깁니다. */
  repeatOf: Map<string, number>;
  canReport: boolean;
  /** 지금 누가 답하는 중인가(문의 번호 → 이름·시각). 다른 직원 화면에도 실시간으로 뜹니다. */
  replying: Map<string, { name: string; at: number }>;
  announceReplying: (id: string) => void;
  toddleTodayCount: number | null;
  loaded: boolean;
  reload: () => void;
  patch: (
    row: InquiryRow,
    change: Partial<InquiryRow>,
    okMsg?: string,
  ) => Promise<void>;
  me: string;
  staffName: (email: string | null) => string;
  team: TeamMember[];
};

const TodayCtx = createContext<Ctx | null>(null);

function useToday(): Ctx {
  const c = useContext(TodayCtx);
  if (!c) throw new Error("TodayInquiriesProvider 안에서만 씁니다.");
  return c;
}

const todayStartIso = () => `${kstDateOffset(0)}T00:00:00+09:00`;

const timeKst = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const dayKst = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });

type WeekRow = {
  id: string;
  student_id: string | null;
  channel_id?: string | null;
  badges: string[] | null;
  received_at: string;
  is_demo?: boolean | null;
};

/**
 * 반복 문의 — 같은 아이(번호가 없으면 같은 방)가 지난 7일 안에 **같은 갈래**로 다시 연락한 순번.
 * 인사·감사·기타는 세지 않습니다. 「또 물어보셨다」는 사실이 보여야 앞선 답이 부족했는지 돌아봅니다.
 */
function computeRepeats(rows: readonly WeekRow[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const r of rows) {
    const who = r.student_id ? `s:${r.student_id}` : r.channel_id ? `c:${r.channel_id}` : null;
    if (!who) continue;
    let best = 0;
    for (const b of r.badges ?? []) {
      if (b === "인사·감사" || b === "기타") continue;
      const k = `${who}|${b}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      best = Math.max(best, n);
    }
    if (best >= 2) out.set(r.id, best);
  }
  return out;
}

export function TodayInquiriesProvider({
  team,
  currentUserEmail,
  canReport = false,
  children,
}: {
  team: TeamMember[];
  currentUserEmail: string;
  /** 하루 처리 보고를 볼 수 있는가(관리자·개발자). */
  canReport?: boolean;
  children: ReactNode;
}) {
  const notify = useToast();
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [houseOf, setHouseOf] = useState<Map<string, HouseChild[]>>(new Map());
  const [weekRows, setWeekRows] = useState<WeekRow[]>([]);
  const [toddleTodayCount, setToddleTodayCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const studentsRef = useRef<StudentOption[]>([]);
  const knownIds = useRef<Set<string> | null>(null);
  const [replying, setReplying] = useState<Map<string, { name: string; at: number }>>(new Map());
  const replyCh = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  useEffect(() => primeChime(), []);
  // 「답하는 중」 — 저장하지 않고 열려 있는 화면끼리만 알립니다(10분 지나면 저절로 사라짐). 같은 학부모에게
  // 두 사람이 따로 답하는 일을 막는 용도라, 기록으로 남길 일은 아닙니다.
  useEffect(() => {
    const ch = createClient()
      .channel("inquiry-replying")
      .on("broadcast", { event: "replying" }, ({ payload }) => {
        const p = payload as { id: string; name: string; at: number };
        setReplying((prev) => new Map(prev).set(p.id, { name: p.name, at: p.at }));
      })
      .subscribe();
    replyCh.current = ch;
    return () => {
      void createClient().removeChannel(ch);
      replyCh.current = null;
    };
  }, []);
  useEffect(() => {
    studentsRef.current = students;
  }, [students]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const start = todayStartIso();
    // 칸을 콕 집지 않고 전부 받습니다 - 마이그레이션이 늦게 걸려도 조회가 통째로 실패하지 않습니다.
    const [todayRes, mineRes, hbRes, weekRes] = await Promise.all([
      supabase
        .from("pickup_requests")
        .select("*")
        .gte("received_at", start)
        .order("received_at", { ascending: true })
        .limit(400),
      // 담당이 정해졌는데 아직 안 끝난 지난 글. 날이 바뀌어도 맡은 일은 남아야 합니다.
      supabase
        .from("pickup_requests")
        .select("*")
        .lt("received_at", start)
        .is("answered_at", null)
        .neq("assignees", "{}")
        .order("received_at", { ascending: true })
        .limit(100),
      supabase
        .from("integration_heartbeats")
        .select("meta")
        .eq("key", "toddle-collector")
        .maybeSingle(),
      // 반복 문의 표시용 - 지난 7일. 칸을 콕 집지 않습니다(새 칸이 늦게 걸려도 조회가 안 깨지게).
      supabase
        .from("pickup_requests")
        .select("*")
        .gte("received_at", `${kstDateOffset(-6)}T00:00:00+09:00`)
        .order("received_at", { ascending: true })
        .limit(1500),
    ]);
    setWeekRows(((weekRes.data as WeekRow[] | null) ?? []).filter((r) => !r.is_demo));
    if (todayRes.error) {
      notify(
        "오늘의 문의사항을 읽지 못했습니다: " + todayRes.error.message,
        "error",
      );
      return;
    }
    const all = [
      ...((todayRes.data as InquiryRow[] | null) ?? []),
      ...((mineRes.data as InquiryRow[] | null) ?? []),
    ].filter((r) => !r.is_demo);
    setRows(all);
    // 새 토들 글이면 띠링. 처음 읽을 때는 울리지 않습니다 - 화면을 열 때마다 오늘 글 전부에 울리면 소음입니다.
    const ids = new Set(all.map((r) => r.id));
    if (knownIds.current) {
      const fresh = all.filter(
        (r) => !knownIds.current!.has(r.id) && r.source === "토들" && !isNoActionBadges(r.badges) && isNewRow(r),
      );
      if (fresh.length > 0) {
        playChime();
        notifyDesktop(fresh, studentsRef.current);
      }
    }
    knownIds.current = ids;
    // 형제방에서 온 확인 필요 줄은 «그 집 아이들» 후보를 붙입니다(PickupTriage 와 같은 길).
    const houseIds = all
      .filter((r) => r.status === "확인대기" && !r.student_id && r.channel_id)
      .map((r) => r.channel_id as string);
    if (houseIds.length > 0) {
      const { houseOf: h, problem } = await loadHouseCandidates(supabase, houseIds, studentsRef.current);
      if (problem) notify("형제방 아이 목록을 읽지 못했습니다: " + problem, "error");
      setHouseOf(h);
    } else setHouseOf(new Map());
    const meta = (
      hbRes.data as {
        meta?: { todayParentCount?: number | null } | null;
      } | null
    )?.meta;
    setToddleTodayCount(
      typeof meta?.todayParentCount === "number" ? meta.todayParentCount : null,
    );
    setLoaded(true);
  }, [notify]);

  useEffect(() => {
    // 이름은 학생 번호로 찾습니다(이름 글자로 다시 짐작하지 않습니다 - CLAUDE.md §2-4-8).
    (async () => {
      const { rows: st } = await loadStudents(createClient(), {
        status: "all",
      });
      setNames(new Map(st.map((s) => [s.id, s.name])));
      // 픽업 판단(확인 필요)에서 고를 수 있는 아이는 재학생만입니다.
      setStudents(
        st
          .filter((s) => s.status === "active")
          .map((s) => ({
            id: s.id,
            name: s.name,
            grade: s.grade,
            class_name: s.class_name,
            name_en: s.name_en,
            student_no: s.student_no,
            birth_date: s.birth_date,
          })),
      );
    })();
    void load();
    const supabase = createClient();
    // 구독에 조건을 걸지 않습니다 - 새로 생긴 줄은 조건에 안 걸립니다.
    const ch = supabase
      .channel("today-inquiries")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pickup_requests" },
        () => void load(),
      )
      .subscribe();
    const bc = supabase
      .channel(OPS_REFRESH_CHANNEL + "-today")
      .on("broadcast", { event: OPS_REFRESH_EVENT }, () => void load())
      .subscribe();
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      void supabase.removeChannel(ch);
      void supabase.removeChannel(bc);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  // 명부가 늦게 오면 형제방 후보를 그때 다시 붙입니다.
  useEffect(() => {
    if (students.length > 0) void load();
  }, [students, load]);

  const patch = useCallback(
    async (row: InquiryRow, change: Partial<InquiryRow>, okMsg?: string) => {
      // 화면을 먼저 바꾸고, 실패하면 이유를 띄우고 다시 읽습니다(조용히 넘기지 않습니다).
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, ...change } : r)),
      );
      const { error } = await createClient()
        .from("pickup_requests")
        .update(change)
        .eq("id", row.id);
      if (error) {
        notify("저장하지 못했습니다: " + error.message, "error");
        void load();
        return;
      }
      if (okMsg) notify(okMsg, "success");
      void notifyOpsBoardRefresh();
    },
    [load, notify],
  );

  const staffName = useCallback(
    (email: string | null) =>
      email ? (team.find((m) => m.email === email)?.name ?? email) : "",
    [team],
  );

  const repeatOf = useMemo(() => computeRepeats(weekRows), [weekRows]);
  const myName = team.find((m) => m.email === currentUserEmail)?.name ?? currentUserEmail;
  const announceReplying = useCallback(
    (id: string) => {
      const p = { id, name: myName, at: Date.now() };
      setReplying((prev) => new Map(prev).set(id, { name: p.name, at: p.at }));
      void replyCh.current?.send({ type: "broadcast", event: "replying", payload: p });
    },
    [myName],
  );

  const value = useMemo<Ctx>(
    () => ({
      rows,
      names,
      students,
      houseOf,
      repeatOf,
      canReport,
      replying,
      announceReplying,
      toddleTodayCount,
      loaded,
      reload: () => void load(),
      patch,
      me: currentUserEmail,
      staffName,
      team,
    }),
    [
      rows,
      names,
      students,
      houseOf,
      repeatOf,
      canReport,
      replying,
      announceReplying,
      toddleTodayCount,
      loaded,
      load,
      patch,
      currentUserEmail,
      staffName,
      team,
    ],
  );
  return <TodayCtx.Provider value={value}>{children}</TodayCtx.Provider>;
}

/** 지금 시각. 경과 시간이 흐르도록 30초마다 다시 그립니다. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const SOURCE_STYLE: Record<string, string> = {
  토들: "bg-blue-600 text-white",
  구글챗: "bg-emerald-600 text-white",
  전화: "bg-slate-700 text-white",
  직접입력: "bg-slate-500 text-white",
};

function badgesOf(r: InquiryRow): InquiryBadge[] {
  const b = (r.badges ?? []).filter((x): x is InquiryBadge =>
    (INQUIRY_BADGES as readonly string[]).includes(x),
  );
  if (b.length > 0) return b;
  return [
    r.kind === "픽업" ? "픽업·하원" : r.kind === "기타" ? "인사·감사" : "기타",
  ];
}

/** 정렬: 답 안 한 것(오래 기다린 순) → 답했지만 처리 남음 → 처리 완료. 인사는 따로 접습니다. */
/**
 * 바탕화면 알림. 크롬이 다른 창에 가려져 있어도 화면 구석에 뜹니다. 사람이 「허용」한 브라우저에서만 띄우고,
 * 이 화면을 보고 있을 때는 띄우지 않습니다(소리와 빨간 점으로 충분합니다).
 */
function notifyDesktop(rows: InquiryRow[], students: StudentOption[]) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted" || document.visibilityState === "visible") return;
  const nameOf = (id: string | null) => (id ? (students.find((x) => x.id === id)?.name ?? null) : null);
  const first = rows[0];
  const who = nameOf(first.student_id) ?? first.channel_label ?? "학부모";
  const n = new Notification(rows.length > 1 ? `새 토들 문의 ${rows.length}건` : `새 토들 문의 · ${who}`, {
    body: `${(first.badges ?? []).join("·")} ${first.summary ?? first.raw_text ?? ""}`.slice(0, 120),
    tag: "gia-inquiry",
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

/** 앱에 들어온 지 10분 안의 글. 빨간 점으로 «새 글»을 표시합니다(쓴 시각이 아니라 들어온 시각 기준). */
const NEW_MS = 10 * 60 * 1000;
function isNewRow(r: InquiryRow, now = Date.now()): boolean {
  const at = r.created_at ?? r.received_at;
  return now - new Date(at).getTime() < NEW_MS;
}

/** 사람이 누구인지·픽업인지 정해야 하는 글(오늘 이후 것만). */
function needsCheck(r: InquiryRow): boolean {
  return r.status === "확인대기" && (r.service_date ?? kstDateOffset(0)) >= kstDateOffset(0);
}

function order(a: InquiryRow, b: InquiryRow): number {
  // 확인 필요가 맨 위입니다 - 판단이 늦으면 아이가 잘못된 차에 탑니다.
  const rank = (r: InquiryRow) => (needsCheck(r) && !r.answered_at ? -1 : r.answered_at ? 2 : r.replied_at ? 1 : 0);
  return rank(a) - rank(b) || a.received_at.localeCompare(b.received_at);
}

export function TodayInquiriesPanel() {
  const { rows, toddleTodayCount, loaded, canReport, staffName, me, patch, announceReplying } = useToday();
  const notifyP = useToast();
  const now = useNow();
  const [mineOnly, setMineOnly] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<InquiryBadge | "전체">("전체");
  const [showGreetings, setShowGreetings] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const start = todayStartIso();
  const todays = rows.filter((r) => r.received_at >= start);
  // 넘긴 글은 목록에서 내립니다. 처리 완료와 달리 «한 일»로 세지 않습니다(보고·통계에서 빠짐).
  const live = rows.filter((r) => !r.skipped_at);
  const skipped = rows.filter((r) => !!r.skipped_at);
  // 「확인 필요」는 따로 칸을 두지 않고 같은 목록 맨 위에 「확인 필요」 뱃지로 섭니다. 줄을 펼치면 판단하는
  // 고르개가 나옵니다(Row). 인사로 분류됐어도 판단이 남은 글은 접힌 칸에 숨기지 않습니다.
  const actionable = live.filter((r) => !isNoActionBadges(badgesOf(r)) || needsCheck(r));
  const greetings = live.filter((r) => isNoActionBadges(badgesOf(r)) && !needsCheck(r));
  const counts = new Map<InquiryBadge, number>();
  for (const r of actionable)
    for (const b of badgesOf(r)) counts.set(b, (counts.get(b) ?? 0) + 1);

  // 내 것 = 나에게 맡겨진 글 + 내가 답했거나 끝낸 글.
  const isMine = (r: InquiryRow) =>
    (r.assignees ?? []).includes(me) || r.replied_by === me || r.answered_by === me;
  const filtered = actionable
    .filter((r) => filter === "전체" || badgesOf(r).includes(filter))
    .filter((r) => !mineOnly || isMine(r))
    .sort(order);
  const open = filtered.filter((r) => !r.answered_at);
  const done = filtered.filter((r) => !!r.answered_at);
  const waiting = actionable.filter(
    (r) => !r.replied_at && !r.answered_at,
  ).length;
  const toddleInApp = todays.filter((r) => r.source === "토들").length;
  // 오늘 마감 — 오후 3시가 넘으면 오늘 안에 끝내야 하는 픽업·출결·확인 필요 미처리 건을 맨 위에 모읍니다.
  const kstHour = Number(new Date(now).toLocaleString("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false }));
  const dueToday =
    kstHour >= 15
      ? actionable.filter(
          (r) =>
            !r.answered_at &&
            r.received_at >= start &&
            (needsCheck(r) || badgesOf(r).some((b) => b === "픽업·하원" || b === "출결" || b === "셔틀")),
        )
      : [];

  // ── 탭 제목에 답 기다림 수 ─────────────────────────────────────────
  // 다른 탭에서 일하는 동안에도 「(3) GIA 운영」으로 보입니다. 화면을 떠나면 원래 제목으로 돌려놓습니다.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = waiting > 0 ? `(${waiting}) ${base}` : base;
    return () => {
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
  }, [waiting]);

  // ── 키보드 ──────────────────────────────────────────────────────
  // ↑↓ 줄 옮기기 · Enter 펼치기 · R 답하기 · D 처리 완료 · S 넘기기. 글을 치는 칸 안에서는 가로채지 않습니다.
  const keyRef = useRef({ open, cursor, openId });
  keyRef.current = { open, cursor, openId };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input,textarea,select,[contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { open: list, cursor: cur } = keyRef.current;
      if (list.length === 0) return;
      const idx = Math.max(0, list.findIndex((r) => r.id === cur));
      const row = list.find((r) => r.id === cur) ?? null;
      const k = e.key.toLowerCase();
      if (k === "arrowdown" || k === "arrowup") {
        e.preventDefault();
        const next = list[Math.min(list.length - 1, Math.max(0, cur ? idx + (k === "arrowdown" ? 1 : -1) : 0))];
        setCursor(next.id);
        document.getElementById(`inq-${next.id}`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (!row) return;
      const nowIso = new Date().toISOString();
      if (k === "enter") {
        e.preventDefault();
        setOpenId((v) => (v === row.id ? null : row.id));
      } else if (k === "r") {
        e.preventDefault();
        if (row.source_url) {
          announceReplying(row.id);
          window.open(row.source_url, "_blank", "noopener");
        } else if (!row.replied_at) void patch(row, { replied_at: nowIso, replied_by: me, replied_via: "앱" }, "답함으로 표시했습니다.");
      } else if (k === "d") {
        e.preventDefault();
        void patch(row, { answered_at: nowIso, answered_by: me, answered_via: "수동" }, "처리 완료로 표시했습니다.");
      } else if (k === "s") {
        e.preventDefault();
        if (needsCheck(row)) return notifyP("처리 대기 글은 펼쳐서 넘기기를 눌러 주세요(픽업 판단도 함께 내립니다).", "error");
        void patch(row, { skipped_at: nowIso, skipped_by: me }, "넘겼습니다.");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [patch, me, announceReplying, notifyP]);

  /**
   * 경보 뱃지(지연·오늘 마감)를 누르면 **그 글만 펼쳐 화면 가운데로** 가져옵니다.
   *
   * 예전에는 펼치기만 해서, 목록 아래쪽 글은 펼쳐진 줄도 모르고 다시 찾아야 했습니다. 펼친 글이 하나뿐이도록
   * `openId` 하나만 쓰므로 다른 뱃지를 누르면 앞 글은 저절로 접힙니다. 걸러진 상태(뱃지 필터·내 것만)라 목록에
   * 없는 글이면 필터를 풀어서 보이게 한 뒤 굴립니다 - 눌렀는데 아무 일도 안 일어나는 것이 가장 나쁩니다.
   * 스크롤은 펼친 내용이 그려진 다음에 해야 가운데가 맞아서, 렌더 뒤(useEffect)로 미룹니다.
   */
  const scrollToRef = useRef<string | null>(null);
  const jumpTo = (r: InquiryRow) => {
    if (filter !== "전체" && !badgesOf(r).includes(filter)) setFilter("전체");
    if (mineOnly && !isMine(r)) setMineOnly(false);
    setOpenId(r.id);
    setCursor(r.id);
    scrollToRef.current = r.id;
  };
  useEffect(() => {
    const id = scrollToRef.current;
    if (!id || openId !== id) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`inq-${id}`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        scrollToRef.current = null;
      }
    });
    return () => cancelAnimationFrame(raf);
  });

  // 답변 지연 — 1시간 넘게 아무도 답하지 않은 글.
  const late = actionable.filter(
    (r) => !r.replied_at && !r.answered_at && now - new Date(r.received_at).getTime() >= 60 * 60 * 1000,
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 space-y-1.5 border-b border-black/5 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="font-bold text-slate-700">
            답 기다림{" "}
            <span
              className={waiting > 0 ? "text-rose-600" : "text-emerald-600"}
            >
              {waiting}
            </span>
          </span>
          <span className="text-slate-500">
            처리 남음 {actionable.filter((r) => !r.answered_at).length}
          </span>
          {/* 수집기가 센 오늘 토들 글 수와 앱에 들어온 수. 다르면 빠진 것이 있다는 뜻입니다. */}
          <span
            className={
              "ml-auto tabular-nums " +
              (toddleTodayCount != null && toddleTodayCount > toddleInApp
                ? "font-bold text-rose-600"
                : "text-slate-400")
            }
            title="토들 수집기가 센 오늘 학부모 글 수 → 앱에 들어온 토들 글 수"
          >
            오늘 토들 {toddleTodayCount ?? "?"} → 앱 {toddleInApp}
          </span>
          <a
            href="/work/raw-log"
            target="_blank"
            rel="noreferrer"
            className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100"
            title="원문함 — 들어온 연락 원문을 날짜별·방별로 그대로 봅니다(새 창)"
          >
            📚
          </a>
          <DesktopNotifyToggle />
          <ChimeToggle />
          {canReport && <ProcessingReportButton staffName={staffName} />}
        </div>
        {late.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">
            <span>⏰ 1시간 넘게 답 못 한 문의 {late.length}건</span>
            {late.slice(0, 6).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => jumpTo(r)}
                className={"rounded px-1.5 hover:bg-white/30 " + (openId === r.id ? "bg-white text-rose-700" : "bg-white/20")}
                title="누르면 이 문의만 펼쳐 화면 가운데로 옵니다"
              >
                <LateName r={r} /> {elapsedLabel(r.received_at, now)}
              </button>
            ))}
          </div>
        )}
        {dueToday.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-amber-400 px-2 py-1 text-[11px] font-bold text-amber-950">
            <span>⏳ 오늘 마감 — 하원 전에 끝낼 픽업·출결 {dueToday.length}건</span>
            {dueToday.slice(0, 8).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => jumpTo(r)}
                className={"rounded px-1.5 hover:bg-white/60 " + (openId === r.id ? "bg-white" : "bg-white/40")}
                title="누르면 이 문의만 펼쳐 화면 가운데로 옵니다"
              >
                <LateName r={r} />
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          <Chip
            active={mineOnly}
            onClick={() => setMineOnly((v) => !v)}
            label={`👤 내 것 ${actionable.filter(isMine).length}`}
            cls={mineOnly ? "border-blue-400 bg-blue-50 text-blue-700" : ""}
          />
          <Chip
            active={filter === "전체"}
            onClick={() => setFilter("전체")}
            label={`전체 ${actionable.length}`}
          />
          {INQUIRY_BADGES.filter((b) => b !== "인사·감사" && counts.get(b)).map(
            (b) => (
              <Chip
                key={b}
                active={filter === b}
                onClick={() => setFilter(b)}
                label={`${b} ${counts.get(b)}`}
                cls={BADGE_STYLE[b]}
              />
            ),
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {!loaded ? (
          <p className="p-4 text-center text-xs text-slate-400">불러오는 중…</p>
        ) : open.length === 0 && mineOnly ? (
          <p className="p-4 text-center text-xs text-slate-400">내 것으로 남은 문의가 없습니다.</p>
        ) : open.length === 0 ? (
          <p className="p-4 text-center text-xs text-emerald-600">
            처리할 문의가 없습니다.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {open.map((r) => (
              <Row
                key={r.id}
                r={r}
                now={now}
                open={openId === r.id}
                focused={cursor === r.id}
                onToggle={() => {
                  setCursor(r.id);
                  setOpenId(openId === r.id ? null : r.id);
                }}
              />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600"
            >
              {showDone ? "▾" : "▸"} 처리 완료 {done.length}건
            </button>
            {showDone && (
              <ul className="mt-1 space-y-1 opacity-70">
                {done.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    now={now}
                    open={openId === r.id}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {greetings.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowGreetings((v) => !v)}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600"
            >
              {showGreetings ? "▾" : "▸"} 인사·감사 {greetings.length}건 (답할
              것 없음)
            </button>
            {showGreetings && (
              <ul className="mt-1 space-y-1 opacity-70">
                {greetings.sort(order).map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    now={now}
                    open={openId === r.id}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="mt-3 text-center text-[10px] text-slate-300">
          단축키 ↑↓ 줄 이동 · Enter 펼치기 · R 답하기 · D 처리 완료 · S 넘기기
        </p>
        {skipped.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowSkipped((v) => !v)}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600"
            >
              {showSkipped ? "▾" : "▸"} 넘긴 글 {skipped.length}건
            </button>
            {showSkipped && (
              <ul className="mt-1 space-y-1 opacity-60">
                {skipped.sort(order).map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    now={now}
                    open={openId === r.id}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  cls = "",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  cls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-2 py-0.5 text-[10px] font-bold transition " +
        (active
          ? "ring-2 ring-blue-500 ring-offset-1 "
          : "opacity-80 hover:opacity-100 ") +
        (cls || "border-slate-200 bg-white text-slate-600")
      }
    >
      {label}
    </button>
  );
}

/**
 * 경보 뱃지(지연·오늘 마감) 안의 이름. **학생 창을 열지 않습니다**(`plain`).
 * 뱃지는 「그 글로 가서 처리하라」는 단추인데, 이름 부분을 누르면 학생 창이 열려 가로막혔습니다 - 처리하러 눌렀는데
 * 학생 기본정보가 뜨면 두 번 일하게 됩니다. 동명이인 표시(반)는 그대로 붙습니다.
 */
function LateName({ r }: { r: InquiryRow }) {
  const { names } = useToday();
  const name = r.student_id ? names.get(r.student_id) : null;
  return name ? <Who id={r.student_id} name={name} plain /> : <>{r.channel_label ?? "누구?"}</>;
}

function Who2({ r }: { r: InquiryRow }) {
  const { names } = useToday();
  const name = r.student_id ? names.get(r.student_id) : null;
  if (name)
    return (
      <Who id={r.student_id} name={name} className="font-bold text-slate-800" />
    );
  // 학생 번호가 없으면 어느 방(집)에서 온 글인지만 적습니다. 이름을 짐작해 적지 않습니다.
  return (
    <span
      className="font-bold text-slate-500"
      title="학생을 아직 정하지 못했습니다"
    >
      {r.channel_label ?? "누구?"}
    </span>
  );
}

/**
 * 직원이 메모장·전화로 적어 올린 문의의 글을 고칩니다. 토들 글은 학부모가 쓴 원문이라 고치지 않습니다.
 * 요약과 원문을 같은 글로 맞춰 저장합니다 - 한쪽만 바뀌면 접힌 줄과 펼친 줄이 다른 말을 합니다.
 */
function EditableText({ r, onSaved }: { r: InquiryRow; onSaved: () => void | Promise<void> }) {
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.summary || r.raw_text || "");
  const [busy, setBusy] = useState(false);
  if (!editing)
    return (
      <div className="group relative">
        <p className="whitespace-pre-wrap rounded bg-slate-50 p-1.5 pr-14 text-[11px] text-slate-700">{r.raw_text || r.summary || "(내용 없음)"}</p>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setText(r.summary || r.raw_text || "");
            setEditing(true);
          }}
          className="absolute right-1 top-1 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 shadow-sm ring-1 ring-indigo-100 hover:bg-indigo-50"
        >
          ✏️ 고치기
        </button>
      </div>
    );
  async function save() {
    const t = text.trim();
    if (!t) return notify("빈 글로는 저장할 수 없습니다.", "error");
    setBusy(true);
    const res = await fetch("/api/pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit-text", id: r.id, text: t }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) return notify(`저장하지 못했습니다: ${(json as { error?: string }).error ?? "연결 오류"}`, "error");
    setEditing(false);
    notify("글을 고쳤습니다.", "success");
    await onSaved();
  }
  return (
    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
        rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
        className="w-full rounded border border-indigo-200 p-1.5 text-[11px] text-slate-800"
      />
      <div className="flex items-center justify-end gap-1.5 text-[10px]">
        <span className="mr-auto text-slate-400">Ctrl/⌘+Enter 저장 · Esc 취소</span>
        <button onClick={() => setEditing(false)} className="rounded px-2 py-0.5 font-bold text-slate-500 hover:bg-slate-100">
          취소
        </button>
        <button disabled={busy} onClick={() => void save()} className="rounded bg-indigo-600 px-2 py-0.5 font-bold text-white disabled:bg-slate-300">
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}

function Row({
  r,
  now,
  open,
  focused = false,
  onToggle,
}: {
  r: InquiryRow;
  now: number;
  open: boolean;
  /** 키보드로 고른 줄. */
  focused?: boolean;
  onToggle: () => void;
}) {
  const { patch, me, staffName, team, names, repeatOf, students, houseOf, reload, replying, announceReplying } = useToday();
  const studentPanel = useStudentPanel();
  const rp = replying.get(r.id);
  const replyingNow = !r.replied_at && rp && Date.now() - rp.at < 10 * 60 * 1000 ? rp : null;
  const repeat = repeatOf.get(r.id);
  const notify = useToast();
  const [announcing, setAnnouncing] = useState(false);
  const tone = elapsedTone(r.received_at, now);
  const toneCls = {
    calm: "bg-slate-100 text-slate-500",
    warn: "bg-amber-100 text-amber-700",
    late: "bg-rose-600 text-white",
  }[tone];
  const isOld = r.received_at < todayStartIso();
  const assignees = r.assignees ?? [];
  const mine = assignees.includes(me);

  /**
   * 픽업·하원 글은 펼치지 않고 바로 픽업으로 넘깁니다. 학생이 정해진 글은 시각만 물어 확정하고, 학생을 모르는
   * 글은 펼쳐서 픽업 판단 칸(학생·날짜·시각)을 띄웁니다 - 누구인지 모르는 채로 체크표에 올리지 않습니다.
   */
  const pickupish = badgesOf(r).includes("픽업·하원");
  const pickupDone = r.kind === "픽업" && r.status === "확정";
  const [forceTriage, setForceTriage] = useState(false);
  const [pickingUp, setPickingUp] = useState(false);
  async function quickPickup() {
    if (pickingUp) return;
    if (!r.student_id) {
      setForceTriage(true);
      if (!open) onToggle();
      notify("누구인지 아직 모르는 글입니다. 펼친 칸에서 학생을 고르고 픽업을 누르세요.", "info");
      return;
    }
    const t = window.prompt("몇 시에 데리러 오나요? (예: 14:30 · 모르면 비워 두세요)", "");
    if (t === null) return;
    setPickingUp(true);
    const res = await fetch("/api/pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm",
        id: r.id,
        studentId: r.student_id,
        serviceDate: r.service_date ?? kstDateOffset(0),
        ...(t.trim() ? { pickupTime: t.trim() } : {}),
      }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string; noShuttleRow?: boolean }) : {};
    setPickingUp(false);
    if (!res || !res.ok) return notify(`픽업으로 넘기지 못했습니다: ${json.error ?? "연결 오류"}`, "error");
    notify(json.noShuttleRow ? "픽업으로 등록했습니다(셔틀을 안 타는 아이라 체크표 줄은 없습니다)." : "픽업으로 등록했습니다. 하원 체크표에 반영됐습니다.", "success");
    reload();
  }
  /**
   * 요약이 믿을 만하지 않은 글은 원문을 그대로 보여줍니다. 누구 글인지 모르거나(학생 없음) 갈래가 「기타」면
   * AI 요약이 뜻을 바꿨을 수 있고, 요약만 보고 처리하면 학부모가 한 말과 다른 일을 하게 됩니다.
   */
  /**
   * 이미 문의로 올라간 글을 학생 특이사항으로 옮깁니다. 적을 글은 한 번 보여주고 고칠 수 있게 합니다 - 학부모 말투
   * 그대로보다 «무엇을 기억해야 하는지»로 적는 편이 나중에 읽기 쉽습니다. 문의는 지우지 않고 처리 완료로 내립니다.
   */
  async function moveToProfileNote() {
    if (!r.student_id) {
      notify("누구 이야기인지 아직 모르는 글입니다. 학생을 먼저 연결해 주세요.", "error");
      return;
    }
    const t = window.prompt("학생 특이사항에 적을 내용(고쳐도 됩니다)", (r.raw_text || r.summary || "").trim());
    if (t === null || !t.trim()) return;
    const res = await fetch("/api/pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "profile-note", id: r.id, studentId: r.student_id, text: t.trim() }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string; name?: string }) : {};
    if (!res || !res.ok) return notify(json.error ?? "특이사항으로 옮기지 못했습니다.", "error");
    notify(`${json.name ?? "학생"} 특이사항에 적고 문의를 처리 완료로 내렸습니다.`, "success");
    reload();
  }
  const unclear = !r.student_id || badgesOf(r).includes("기타") || !r.summary;

  const nowIso = () => new Date().toISOString();
  const toggleReplied = () =>
    r.replied_at
      ? patch(
          r,
          { replied_at: null, replied_by: null, replied_via: null },
          "답함을 되돌렸습니다.",
        )
      : patch(r, { replied_at: nowIso(), replied_by: me, replied_via: "앱" });
  const toggleDone = () =>
    r.answered_at
      ? patch(
          r,
          { answered_at: null, answered_by: null, answered_via: null },
          "처리 완료를 되돌렸습니다.",
        )
      : patch(
          r,
          { answered_at: nowIso(), answered_by: me, answered_via: "수동" },
          "처리 완료로 표시했습니다.",
        );

  const toggleSkip = async () => {
    if (r.skipped_at) return patch(r, { skipped_at: null, skipped_by: null }, "넘긴 글을 되돌렸습니다.");
    // 확인 필요 글을 넘기면 픽업 판단도 «아님»으로 내립니다. 안 그러면 픽업 인박스에 계속 남습니다.
    if (needsCheck(r)) {
      const res = await fetch("/api/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ignore", id: r.id }),
      }).catch(() => null);
      if (!res || !res.ok) notify("픽업 판단을 내리지 못했습니다. 픽업 인박스에서 한 번 더 확인해 주세요.", "error");
    }
    return patch(r, { skipped_at: nowIso(), skipped_by: me }, "넘겼습니다(목록에서 내림).");
  };
  /** 답할 것 없음(인사·감사)으로 잘못 간 글을 다시 올립니다. 뱃지를 「기타」로 바꾸면 목록으로 돌아옵니다. */
  const raise = () => patch(r, { badges: ["기타"] }, "다시 올렸습니다. 분류를 맞게 고쳐 주세요.");

  /**
   * 확성기 — 이 문의를 전체 공지로 올립니다. 공지 쓰기는 관리자만 할 수 있어서 함수(announce_inquiry)가
   * 문의 한 건을 올리는 일만 대신합니다. 이미 올린 글은 한 번 더 묻습니다(같은 공지가 두 장 뜨지 않게).
   */
  async function announce() {
    if (announcing) return;
    const who = r.student_id ? (names.get(r.student_id) ?? null) : null;
    const head = (who ?? r.channel_label ?? "문의") + " · " + badgesOf(r).join("·");
    if (r.announced_at && !window.confirm(`이미 ${timeKst(r.announced_at)}에 공지로 올렸습니다. 한 번 더 올릴까요?`)) return;
    if (!r.announced_at && !window.confirm(`이 문의를 모든 직원 화면 위 공지로 띄울까요?\n\n${head}\n${(r.summary || r.raw_text || "").slice(0, 100)}`)) return;
    setAnnouncing(true);
    const body = [
      r.summary ?? "",
      r.raw_text && r.raw_text !== r.summary ? `\n원문: ${r.raw_text.slice(0, 600)}` : "",
      `\n(${r.source ?? "?"} · ${dayKst(r.received_at)} ${timeKst(r.received_at)} · 올린 사람 ${staffName(me)})`,
    ].join("");
    const { error } = await createClient().rpc("announce_inquiry", {
      p_id: r.id,
      p_title: `📢 ${head}`,
      p_body: body,
    });
    setAnnouncing(false);
    if (error) notify("공지로 올리지 못했습니다: " + error.message, "error");
    else notify("전체 공지로 올렸습니다.", "success");
  }

  // 처리 완료된 줄은 한 줄로 접습니다 - 아이와 내용, 되돌리기만. 끝난 일에 단추 넷이 그대로 있으면 아직 할
  // 일처럼 보이고, 남은 일이 묻힙니다. 누가 언제 끝냈는지는 마우스를 올리면 보입니다.
  if (r.answered_at && !open) {
    return (
      <li
        id={`inq-${r.id}`}
        className="flex items-center gap-1.5 rounded-lg border border-black/5 bg-slate-50 px-2 py-1 text-[11.5px]"
        title={`처리 완료 · ${staffName(r.answered_by)} ${timeKst(r.answered_at)}${r.replied_at ? ` · 답함 ${r.replied_via === "토들 답글" ? r.replied_by ?? "" : staffName(r.replied_by)}` : ""}`}
      >
        <span className="shrink-0 text-emerald-600">✓</span>
        <span className="shrink-0">
          <Who2 r={r} />
        </span>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 truncate text-left text-slate-500">
          {r.summary || r.raw_text || "(내용 없음)"}
        </button>
        <button
          type="button"
          onClick={() => void toggleDone()}
          className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 hover:bg-white hover:text-slate-600"
          title="처리 완료를 되돌려 목록으로 올립니다"
        >
          ↩ 되돌리기
        </button>
      </li>
    );
  }

  return (
    <li
      id={`inq-${r.id}`}
      className={
        (focused ? "ring-2 ring-blue-400 " : "") +
        // 접힌 줄은 한 줄 높이입니다. 글이 많은 날 한 화면에 열 몇 줄은 보여야 「뭐가 남았나」가 한눈에 들어옵니다.
        (open ? "rounded-lg border bg-white px-2 py-1.5 text-[12px] shadow-sm " : "rounded border bg-white px-1.5 py-0.5 text-[11px] ") +
        (mine && !r.answered_at ? "border-amber-400 " : "border-black/5 ") +
        (r.urgency === "높음" && !r.replied_at ? "ring-1 ring-rose-300" : "")
      }
    >
      <div className="flex items-start gap-1.5">
        {isNewRow(r, now) && !r.replied_at && (
          <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" title="새 글 (들어온 지 10분 안)" />
        )}
        {/* 앞자리 — 글이 올라온 시각과 그 뒤로 지난 시간. 「몇 분 만에 답했나」는 적지 않습니다 - 사람을 재는 숫자가
            화면에 늘 떠 있으면 빨리 답하는 것이 목표가 되고, 그 숫자는 월간 보고(ProcessingReport)에만 남깁니다.
            답한 글은 색만 초록으로 바꿔 «답함»을 표시합니다. */}
        <span
          className={
            "shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums " +
            (r.replied_at ? "bg-emerald-50 text-emerald-700" : toneCls)
          }
          title={r.replied_at ? `답함 · 올라온 시각 ${timeKst(r.received_at)}` : `올라온 시각 ${timeKst(r.received_at)}`}
        >
          {r.replied_at ? "✓ " : "⏱ "}
          {timeKst(r.received_at)} · {elapsedLabel(r.received_at, now)}
        </span>
        <span
          className={
            "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold " +
            (SOURCE_STYLE[r.source ?? ""] ?? "bg-slate-400 text-white")
          }
        >
          {r.source ?? "?"}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <div className={open ? "flex flex-wrap items-center gap-1" : "flex min-w-0 items-center gap-1 overflow-hidden"}>
            {badgesOf(r).map((b) => (
              <span
                key={b}
                className={
                  "rounded-full border px-1.5 text-[9px] font-bold " +
                  BADGE_STYLE[b]
                }
              >
                {b}
              </span>
            ))}
            {/* 자동이 누구인지·무엇인지 못 정한 글. 오류가 아니라 «사람이 고를 차례»라서 경고색을 쓰지 않습니다 -
                노란 ⚠ 가 줄마다 붙어 있으면 고장난 화면처럼 보이고, 정작 급한 지연 경보가 묻힙니다. */}
            {needsCheck(r) && (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-1.5 text-[9px] font-bold text-indigo-700" title="학생·날짜·처리 종류를 사람이 고르면 끝납니다. 펼치면 처리 칸이 열려 있습니다.">
                🛠 처리 대기
              </span>
            )}
            {/* 이름을 누르면 학생 창(기본·셔틀·하원수단·특이사항·출결)이 뜹니다 - <Who> 가 이미 하는 일입니다. */}
            <Who2 r={r} />
            {replyingNow && (
              <span className="animate-pulse rounded-full bg-sky-100 px-1.5 text-[9px] font-bold text-sky-700" title="토들 방을 열고 답하는 중입니다">
                ✍️ {replyingNow.name} 답하는 중
              </span>
            )}
            {repeat && (
              <span
                className="rounded-full bg-purple-100 px-1.5 text-[9px] font-bold text-purple-700"
                title="같은 아이(또는 같은 방)가 지난 7일 같은 갈래로 다시 연락했습니다"
              >
                🔁 이번 주 {repeat}번째
              </span>
            )}
            {isOld && <span className="text-[10px] tabular-nums text-slate-400">{dayKst(r.received_at)}</span>}
            {!open && assignees.length > 0 && (
              <span className="shrink-0 rounded bg-amber-50 px-1 text-[9px] font-bold text-amber-700" title={`담당 → ${assignees.map(staffName).join(", ")}`}>
                담당 {staffName(assignees[0])}{assignees.length > 1 ? ` +${assignees.length - 1}` : ""}
              </span>
            )}
            {/* 접힌 줄은 요약을 같은 줄 오른쪽에 붙입니다(한 줄). 펼치면 아래 문단으로 내려옵니다. */}
            {!open && (
              <span className="min-w-0 flex-1 truncate text-slate-600">
                {unclear && r.raw_text ? r.raw_text : r.summary || r.raw_text || "(내용 없음)"}
              </span>
            )}
          </div>
          {open && (
          <p className="mt-0.5 text-slate-700">
            {unclear && r.raw_text ? (
              <>
                <span className="mr-1 rounded bg-slate-200 px-1 text-[9px] font-bold text-slate-600" title="요약이 불확실해 학부모가 쓴 글을 그대로 보여줍니다">
                  원문
                </span>
                {r.raw_text}
              </>
            ) : (
              r.summary || r.raw_text || "(내용 없음)"
            )}
          </p>
          )}
        </button>
        {/* 단추는 접힌 줄에서는 가로 한 줄, 펼치면 세로 묶음. 세로로 셋이 서면 접힌 줄도 세 줄 높이가 됩니다. */}
        <div className={open ? "flex w-[4.5rem] shrink-0 flex-col gap-1" : "flex shrink-0 items-center gap-0.5"}>
          {pickupish && !pickupDone && (
            <button
              type="button"
              disabled={pickingUp}
              onClick={() => void quickPickup()}
              className="rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold text-white hover:bg-amber-600 disabled:bg-slate-300"
              title="이 글을 바로 픽업으로 등록합니다(하원 체크표에 반영)"
            >
              🚗 픽업 등록
            </button>
          )}
          {pickupish && pickupDone && (
            <span className="rounded border border-amber-300 px-1 py-0.5 text-center text-[10px] font-bold text-amber-700" title="픽업으로 등록된 글입니다">
              🚗 픽업됨
            </span>
          )}
          {/* 답하기 — 토들 글이면 그 방을 새 창으로 엽니다. 거기서 답을 달면 수집기가 직원 답글을 보고
              「답함」을 스스로 채웁니다(누가·몇 분 만에). 토들 방이 없는 글(전화·메모)은 누르면 바로 답함입니다. */}
          {r.replied_at ? (
            <button
              type="button"
              onClick={() => void toggleReplied()}
              className="rounded border border-emerald-300 px-1 py-0.5 text-[10px] font-bold text-emerald-700"
              title="답함 되돌리기"
            >
              ✓ 답함
            </button>
          ) : (
            <span className="flex">
              <button
                type="button"
                onClick={() => {
                  if (r.source_url) {
                    announceReplying(r.id);
                    window.open(r.source_url, "_blank", "noopener");
                  } else void toggleReplied();
                }}
                className="flex-1 rounded-l bg-emerald-600 px-1 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-700"
                title={
                  r.source_url
                    ? "토들 방을 엽니다. 거기서 답하면 「답함」이 자동으로 체크됩니다."
                    : "토들 방이 없는 글입니다. 답했으면 누르세요."
                }
              >
                답하기
              </button>
              {r.source_url && (
                <button
                  type="button"
                  onClick={() => void toggleReplied()}
                  className="rounded-r border-l border-emerald-500 bg-emerald-600 px-1 text-[10px] text-white hover:bg-emerald-700"
                  title="토들 말고 전화 등으로 답했으면 여기서 답함으로 표시합니다"
                >
                  ✓
                </button>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={() => void toggleDone()}
            className={
              "rounded px-1 py-0.5 text-[10px] font-bold " +
              (r.answered_at ? "border border-slate-300 text-slate-500" : "bg-slate-800 text-white hover:bg-slate-700")
            }
            title={r.answered_at ? "처리 완료 되돌리기" : "요청한 일이 끝났으면 누릅니다"}
          >
            {r.answered_at ? "✓ 완료" : "처리 완료"}
          </button>
          <span className="flex gap-0.5">
            <button
              type="button"
              onClick={() => void toggleSkip()}
              className={
                "flex-1 rounded px-1 py-0.5 text-[10px] font-bold " +
                (r.skipped_at ? "border border-slate-300 text-slate-500" : "border border-slate-200 text-slate-400 hover:bg-slate-50")
              }
              title={r.skipped_at ? "넘긴 것을 되돌립니다" : "할 일이 없는 글을 목록에서 내립니다(처리 건수에 안 들어감)"}
            >
              {r.skipped_at ? "되돌림" : "넘기기"}
            </button>
            <button
              type="button"
              disabled={announcing}
              onClick={() => void announce()}
              className={"rounded px-0.5 text-[11px] " + (r.announced_at ? "bg-amber-100 ring-1 ring-amber-300" : "hover:bg-amber-50")}
              title={r.announced_at ? `${timeKst(r.announced_at)} 전체 공지로 올림 · ${staffName(r.announced_by ?? null)}` : "모든 직원 화면에 공지로 띄웁니다"}
            >
              📢
            </button>
          </span>
        </div>
      </div>

      {/* 누가 무엇을 했는지 — 펼쳤을 때. 접힌 줄에서는 앞자리 색(✓ 초록)과 담당 뱃지가 대신합니다. */}
      {open && (r.replied_at || r.answered_at || r.skipped_at || r.announced_at || assignees.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
          {r.replied_at && (
            <span>
              답함 ·{" "}
              {r.replied_via === "토들 답글"
                ? `토들 · ${r.replied_by ?? ""}`
                : staffName(r.replied_by)}{" "}
              {timeKst(r.replied_at)}
            </span>
          )}
          {r.answered_at && (
            <span className="text-slate-700">
              처리 완료 · {staffName(r.answered_by)} {timeKst(r.answered_at)}
            </span>
          )}
          {r.skipped_at && (
            <span>
              넘김 · {staffName(r.skipped_by ?? null)} {timeKst(r.skipped_at)}
            </span>
          )}
          {r.announced_at && (
            <span className="font-bold text-amber-700">
              📢 공지 · {staffName(r.announced_by ?? null)} {timeKst(r.announced_at)}
            </span>
          )}
          {assignees.length > 0 && (
            <span className="font-bold text-amber-700">
              담당 → {assignees.map(staffName).join(", ")}
            </span>
          )}
        </div>
      )}

      {open && (
        <div className="mt-1.5 space-y-1.5 border-t border-black/5 pt-1.5">
          {r.source !== "토들" ? (
            <EditableText r={r} onSaved={reload} />
          ) : (
            r.raw_text && (
              <p className="whitespace-pre-wrap rounded bg-slate-50 p-1.5 text-[11px] text-slate-700">
                {r.raw_text}
              </p>
            )
          )}
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <button
              type="button"
              onClick={() => void moveToProfileNote()}
              className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-bold text-violet-700 hover:bg-violet-100"
              title="이 글을 학생 창 「특이사항」에 적고, 문의는 처리 완료로 내립니다(원문은 그대로 남습니다)"
            >
              📝 특이사항으로 옮기기
            </button>
            {!needsCheck(r) && (
              <button
                type="button"
                onClick={() => setForceTriage((v) => !v)}
                className={
                  "rounded border px-1.5 py-0.5 font-bold " +
                  (forceTriage ? "border-indigo-400 bg-indigo-100 text-indigo-800" : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100")
                }
                title="학생·날짜·처리 종류(픽업·결석·지각·물건 챙기기 등)를 골라 등록합니다. 자동이 안 잡은 일을 여기서 올립니다."
              >
                🛠 처리
              </button>
            )}
            {r.sender_name && <span>보낸 사람 {r.sender_name}</span>}
            {r.source_url && (
              <a
                href={r.source_url}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-blue-600 hover:underline"
              >
                토들 원문 ↗
              </a>
            )}
          </div>
          {/* 처리 칸은 «필요할 때 꺼내는 메뉴»입니다. 자동이 못 정한 글(처리 대기)은 처음부터 열려 있고, 그 밖의 글은
              「🛠 처리」를 눌러 엽니다 - 물건 챙기기처럼 자동이 안 잡는 일을 여기서 등록해 모든 직원 화면에 띄웁니다. */}
          {(needsCheck(r) || forceTriage) && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-1.5">
              <p className="mb-0.5 flex items-center gap-2 text-[10px] font-bold text-indigo-700">
                <span>🛠 처리하기 — 학생·날짜를 정하고 픽업·결석·지각·물건 챙기기 등을 고릅니다</span>
                {!needsCheck(r) && (
                  <button type="button" onClick={() => setForceTriage(false)} className="ml-auto rounded px-1 text-slate-400 hover:bg-white" title="처리 칸 닫기">
                    닫기
                  </button>
                )}
              </p>
              <PickupTriage
                rows={[r as unknown as PickupRow]}
                students={students}
                onChanged={reload}
                onDecided={() => {
                  // 처리(픽업·출결·전달사항 등)가 끝났으면 처리 완료가 마지막 단계입니다. 묻고 바로 내려서 두 번 누르지 않게
                  // 합니다. 취소하면 처리만 된 상태로 둡니다 - 답장이 아직 남은 글이 있습니다.
                  if (r.answered_at) return;
                  if (window.confirm("처리했습니다. 이 문의를 처리 완료로 내릴까요?\n(취소하면 처리만 된 상태로 남습니다)")) void toggleDone();
                }}
                compact
                embedded
                houseOf={houseOf}
              />
            </div>
          )}
          {isNoActionBadges(badgesOf(r)) && !needsCheck(r) && (
            <button
              type="button"
              onClick={() => void raise()}
              className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700"
              title="답할 것 없음으로 분류됐지만 답해야 하는 글이면 목록으로 올립니다"
            >
              ↑ 답할 것으로 다시 올리기
            </button>
          )}
          <ReplyTemplates
            badges={badgesOf(r)}
            studentName={r.student_id ? (names.get(r.student_id) ?? null) : null}
            me={me}
          />
          <StudentHistory rowId={r.id} studentId={r.student_id} channelId={r.channel_id ?? null} />
          {r.student_id && (
            <button
              type="button"
              onClick={() => studentPanel.open(r.student_id as string, "문의")}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100"
              title="학생 창을 오른쪽에 띄워 지난 문의 전부를 봅니다. 메모장은 그대로 쓸 수 있습니다."
            >
              📂 지난 문의 전체 보기
            </button>
          )}
          <BadgeEditor r={r} />
          <AssignEditor r={r} team={team} />
        </div>
      )}
    </li>
  );
}

/** 분류를 사람이 고칩니다. AI가 놓친 뱃지를 붙이거나 틀린 것을 뗍니다. */
function BadgeEditor({ r }: { r: InquiryRow }) {
  const { patch } = useToday();
  const cur = badgesOf(r);
  const toggle = (b: InquiryBadge) => {
    const next = cur.includes(b)
      ? cur.filter((x) => x !== b)
      : [...cur.filter((x) => x !== "인사·감사"), b];
    void patch(r, { badges: next.length > 0 ? next : ["기타"] });
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-bold text-slate-400">분류</span>
      {INQUIRY_BADGES.map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => toggle(b)}
          className={
            "rounded-full border px-1.5 text-[9px] font-bold " +
            (cur.includes(b)
              ? BADGE_STYLE[b]
              : "border-slate-200 bg-white text-slate-300")
          }
        >
          {b}
        </button>
      ))}
    </div>
  );
}

/** 담당 지정. 지정된 사람 화면의 「오늘 꼭 기억」 맨 위에 뜹니다. */
function AssignEditor({ r, team }: { r: InquiryRow; team: TeamMember[] }) {
  const { patch, me } = useToday();
  const cur = r.assignees ?? [];
  const toggle = (email: string) => {
    const next = cur.includes(email)
      ? cur.filter((e) => e !== email)
      : [...cur, email];
    void patch(r, {
      assignees: next,
      assigned_by: me,
      assigned_at: new Date().toISOString(),
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-bold text-slate-400">담당</span>
      {team.map((m) => (
        <button
          key={m.email}
          type="button"
          onClick={() => toggle(m.email)}
          className={
            "rounded-full border px-1.5 text-[10px] " +
            (cur.includes(m.email)
              ? "border-amber-400 bg-amber-100 font-bold text-amber-800"
              : "border-slate-200 bg-white text-slate-500")
          }
        >
          {m.name ?? m.email}
          {m.email === me ? " (나)" : ""}
        </button>
      ))}
    </div>
  );
}

/**
 * 오늘 꼭 기억 — 처리 완료가 안 된 담당 건.
 *
 * 보는 사람마다 순서가 다릅니다. **내가 맡은 것이 맨 위**이고, 다른 사람이 맡은 것은 흐리게
 * 뒤에 둡니다. 날이 바뀌어도 처리 완료를 누를 때까지 남습니다(「2일째」).
 */
export function RememberStrip() {
  const { rows, me, staffName, patch } = useToday();
  const today = kstDateOffset(0);
  const pending = rows.filter(
    (r) => (r.assignees ?? []).length > 0 && !r.answered_at && !r.skipped_at,
  );
  if (pending.length === 0) return null;
  const mine = pending
    .filter((r) => (r.assignees ?? []).includes(me))
    .sort((a, b) => a.received_at.localeCompare(b.received_at));
  const others = pending
    .filter((r) => !(r.assignees ?? []).includes(me))
    .sort((a, b) => a.received_at.localeCompare(b.received_at));
  const days = (iso: string) => {
    const d = new Date(iso).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul",
    });
    const n = Math.round(
      (new Date(today).getTime() - new Date(d).getTime()) / 86400000,
    );
    return n > 0 ? `${n + 1}일째` : "오늘";
  };
  return (
    <div className="flex shrink-0 items-start gap-2 overflow-x-auto border-t border-amber-200 bg-amber-50/70 px-2.5 py-1.5">
      <span className="shrink-0 pt-0.5 text-[11px] font-bold text-amber-800">
        📌 오늘 꼭 기억
      </span>
      <div className="flex flex-wrap gap-1.5">
        {[...mine, ...others].map((r) => {
          const isMine = (r.assignees ?? []).includes(me);
          return (
            <span
              key={r.id}
              className={
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] " +
                (isMine
                  ? "border-amber-400 bg-white font-bold text-slate-800"
                  : "border-slate-200 bg-white/60 text-slate-400")
              }
            >
              {isMine && (
                <span className="rounded bg-amber-500 px-1 text-[9px] text-white">
                  내 담당
                </span>
              )}
              {badgesOf(r)
                .slice(0, 1)
                .map((b) => (
                  <span
                    key={b}
                    className={
                      "rounded-full border px-1 text-[9px] " + BADGE_STYLE[b]
                    }
                  >
                    {b}
                  </span>
                ))}
              <Who2 r={r} />
              <span className="max-w-[16rem] truncate">{r.summary ?? ""}</span>
              <span className="text-[9px] text-slate-400">
                {days(r.received_at)}
              </span>
              {!isMine && (
                <span className="text-[9px]">
                  → {(r.assignees ?? []).map(staffName).join(", ")}
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  void patch(
                    r,
                    {
                      answered_at: new Date().toISOString(),
                      answered_by: me,
                      answered_via: "수동",
                    },
                    "처리 완료로 표시했습니다.",
                  )
                }
                className="ml-0.5 rounded bg-slate-800 px-1.5 text-[9px] font-bold text-white hover:bg-slate-700"
              >
                처리 완료
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 지난 문의사항 — 날짜를 골라 그날 들어온 글을 한눈에, 또는 낱말로 전체를 찾습니다.
 *
 * 문의는 지우지 않고 쌓입니다(학부모가 쓴 시각 received_at 이 날짜입니다). 오늘 칸은 오늘 것과
 * 맡은 일만 보여주므로, 지난 날의 글은 여기서 찾습니다. 원문은 90일이 지나면 비워지지만 요약·뱃지·
 * 학생·누가 답했고 처리했는지는 남아 검색됩니다.
 * ────────────────────────────────────────────────────────────────────────── */

const WD = ["일", "월", "화", "수", "목", "금", "토"];

function shiftDay(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayTitle(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[d.getUTCDay()]})`;
}

/** PostgREST or() 안에 들어갈 글자. 쉼표·괄호는 조건을 깨뜨리므로 뺍니다. */
function safeTerm(q: string): string {
  return q.replace(/[,()*%\\]/g, " ").trim();
}

export function PastInquiriesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="날짜를 골라 그날 들어온 문의를 보거나, 낱말로 지난 문의 전체를 찾습니다"
        className="shrink-0 rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 transition hover:bg-slate-50"
      >
        🗂️ 지난 문의사항
      </button>
      {open && <PastInquiriesModal onClose={() => setOpen(false)} />}
    </>
  );
}

function PastInquiriesModal({ onClose }: { onClose: () => void }) {
  const { names } = useToday();
  const notify = useToast();
  const today = kstDateOffset(0);
  const [day, setDay] = useState(kstDateOffset(-1));
  const [q, setQ] = useState("");
  const [term, setTerm] = useState(""); // 검색을 누른 낱말(입력 중에는 조회하지 않습니다)
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<InquiryBadge | "전체">("전체");
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase.from("pickup_requests").select("*");
    if (term) {
      const t = safeTerm(term);
      // 학생 이름은 번호로 바꿔 찾습니다 - 이름 글자 칸을 다시 짐작하지 않습니다(§2-4-8).
      const ids = [...names.entries()]
        .filter(([, n]) =>
          n.replace(/\s+/g, "").includes(t.replace(/\s+/g, "")),
        )
        .map(([id]) => id);
      const conds = [
        `summary.ilike.*${t}*`,
        `raw_text.ilike.*${t}*`,
        `channel_label.ilike.*${t}*`,
        `sender_name.ilike.*${t}*`,
      ];
      if (ids.length > 0)
        conds.push(`student_id.in.(${ids.slice(0, 50).join(",")})`);
      query = query
        .or(conds.join(","))
        .order("received_at", { ascending: false })
        .limit(300);
    } else {
      query = query
        .gte("received_at", `${day}T00:00:00+09:00`)
        .lt("received_at", `${shiftDay(day, 1)}T00:00:00+09:00`)
        .order("received_at", { ascending: true })
        .limit(500);
    }
    const { data, error } = await query;
    setLoading(false);
    if (error) {
      notify("지난 문의를 읽지 못했습니다: " + error.message, "error");
      return;
    }
    setRows(((data as InquiryRow[] | null) ?? []).filter((r) => !r.is_demo));
  }, [day, term, names, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // 이 창에서 답함·처리 완료를 눌러도 바로 다시 그립니다.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("past-inquiries")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pickup_requests" },
        () => void load(),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const counts = new Map<InquiryBadge, number>();
  for (const r of rows)
    for (const b of badgesOf(r)) counts.set(b, (counts.get(b) ?? 0) + 1);
  const shown = rows.filter(
    (r) => filter === "전체" || badgesOf(r).includes(filter),
  );
  const waiting = rows.filter(
    (r) => !isNoActionBadges(badgesOf(r)) && !r.answered_at,
  ).length;

  // 검색 결과는 날짜별로 묶어 보여줍니다.
  const groups = new Map<string, InquiryRow[]>();
  for (const r of shown) {
    const k = new Date(r.received_at).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul",
    });
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <div
      className="fixed inset-0 z-[900] flex items-start justify-center bg-black/40 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/5 px-4 py-2.5">
          <h2 className="text-sm font-bold text-slate-800">🗂️ 지난 문의사항</h2>
          {!term && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDay(shiftDay(day, -1))}
                className="rounded border px-1.5 text-xs hover:bg-slate-50"
              >
                ◀
              </button>
              <input
                type="date"
                value={day}
                max={today}
                onChange={(e) => e.target.value && setDay(e.target.value)}
                className="rounded border px-1.5 py-0.5 text-xs"
              />
              <button
                type="button"
                disabled={day >= today}
                onClick={() => setDay(shiftDay(day, 1))}
                className="rounded border px-1.5 text-xs hover:bg-slate-50 disabled:opacity-30"
              >
                ▶
              </button>
              <span className="text-xs font-bold text-slate-600">
                {dayTitle(day)}
              </span>
            </div>
          )}
          <form
            className="ml-auto flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter("전체");
              setTerm(q.trim());
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="학생·낱말로 전체 검색 (예: 패딩, 청구서)"
              className="w-56 rounded border px-2 py-0.5 text-xs"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-blue-700"
            >
              검색
            </button>
            {term && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setTerm("");
                }}
                className="rounded border px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"
              >
                날짜로 보기
              </button>
            )}
          </form>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-3 py-1 text-[12px] font-bold text-white hover:bg-slate-700"
          >
            닫기
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-black/5 px-4 py-1.5">
          <span className="mr-1 text-[11px] text-slate-500">
            {term
              ? `「${term}」 검색 ${rows.length}건${rows.length >= 300 ? "(최근 300건까지)" : ""}`
              : `${rows.length}건`}{" "}
            · 처리 안 됨{" "}
            <b className={waiting > 0 ? "text-rose-600" : "text-emerald-600"}>
              {waiting}
            </b>
          </span>
          <Chip
            active={filter === "전체"}
            onClick={() => setFilter("전체")}
            label={`전체 ${rows.length}`}
          />
          {INQUIRY_BADGES.filter((b) => counts.get(b)).map((b) => (
            <Chip
              key={b}
              active={filter === b}
              onClick={() => setFilter(b)}
              label={`${b} ${counts.get(b)}`}
              cls={BADGE_STYLE[b]}
            />
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {loading && rows.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">
              불러오는 중…
            </p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">
              {term ? "찾는 문의가 없습니다." : "이날 들어온 문의가 없습니다."}
            </p>
          ) : (
            [...groups.entries()].map(([d, list]) => (
              <div key={d} className="mb-2">
                {term && (
                  <div className="sticky top-0 z-10 bg-white/95 py-0.5 text-[11px] font-bold text-slate-500">
                    {dayTitle(d)}
                  </div>
                )}
                <ul className="space-y-1">
                  {list.map((r) => (
                    <Row
                      key={r.id}
                      r={r}
                      now={now}
                      open={openId === r.id}
                      onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 소리 켜기/끄기. 이 브라우저에만 기억합니다. */
function ChimeToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(chimeEnabled()), []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !on;
        setChimeEnabled(next);
        setOn(next);
        if (next) playChime();
      }}
      title={on ? "새 토들 문의가 오면 띠링 소리가 납니다. 누르면 끕니다." : "소리가 꺼져 있습니다. 누르면 켭니다."}
      className="rounded-full border border-black/10 bg-white px-1.5 py-0.5 text-[11px] hover:bg-slate-50"
    >
      {on ? "🔔" : "🔕"}
    </button>
  );
}
