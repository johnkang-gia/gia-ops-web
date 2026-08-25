"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GoogleChatMirrorMessage, Task, TeamMember } from "@/lib/types";
import type { RosterStudent } from "@/lib/attendanceDigest";
import GoogleChatMirrorPanel from "./GoogleChatMirrorPanel";
import AttendanceDigestPanel from "./AttendanceDigestPanel";
import ParentInquiryPanel from "./ParentInquiryPanel";
import OfficeRequestsPanel from "./OfficeRequestsPanel";

// 통합 인박스(커맨드센터 개편): 학부모 문의·출결내역·출결알림·선생님요청 등 "들어오는 소식"을
// 필터 탭 하나의 패널로 모았습니다. 예전에는 학부모 문의/픽업/선생님요청 배너가 화면 곳곳에
// 흩어져 있어 "지금 뭘 확인해야 하지?"가 한눈에 안 됐습니다.
//
// 새 소식 알림(요청: "새로운 메시지가 등록되면 알림표시 - 모바일 알림처럼 작게 빨간 동그라미
// 숫자"): 탭마다 "마지막으로 그 탭을 본 시각"을 이 브라우저에 기억해두고, 그 뒤에 들어온
// 항목 수를 탭 오른쪽 위 빨간 원으로 띄웁니다. 탭을 열면 본 것으로 치고 원이 사라집니다.
// 예외로 [선생님요청]은 "보면 사라지는 안읽음"이 아니라 "아직 완료 처리하지 않은 건수"입니다 -
// 요청은 읽는 게 아니라 처리해야 끝나는 것이라서, 완료를 눌러야 숫자가 내려갑니다.
type TabKey = "inquiry" | "digest" | "chat" | "office";

const SEEN_STORAGE_KEY = "gia-work-inbox-seen-v1";

function loadSeen(): Record<TabKey, number> {
  const now = Date.now();
  // 처음 쓰는 브라우저에서는 "지금까지 온 것은 다 본 것"으로 시작합니다 - 첫 로드부터 지난
  // 메시지 수백 건이 전부 빨간 숫자로 뜨면 알림이 아니라 소음입니다.
  const fallback: Record<TabKey, number> = { inquiry: now, digest: now, chat: now, office: now };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Record<TabKey, number>>;
    return {
      inquiry: typeof p.inquiry === "number" ? p.inquiry : now,
      digest: typeof p.digest === "number" ? p.digest : now,
      chat: typeof p.chat === "number" ? p.chat : now,
      office: typeof p.office === "number" ? p.office : now,
    };
  } catch {
    return fallback;
  }
}

// 모바일 앱 아이콘의 알림 배지처럼 탭 오른쪽 위에 겹쳐 뜨는 빨간 원.
function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black leading-none text-white shadow">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function AttendancePanels({
  messages,
  team,
  userEmail,
  department,
  roster,
  onTaskCreated,
}: {
  messages: GoogleChatMirrorMessage[];
  team: TeamMember[];
  userEmail: string;
  department: string;
  roster: RosterStudent[];
  onTaskCreated?: (task: Task) => void;
}) {
  // 학부모 문의가 가장 자주 보는 것이므로 기본 탭입니다(기존 유지).
  const [tab, setTab] = useState<TabKey>("inquiry");
  const [officeOpen, setOfficeOpen] = useState(0);

  // 탭별 "마지막으로 본 시각". 서버 렌더링과 첫 렌더가 같아야 하므로(hydration) 마운트 후에만
  // 저장값을 불러오고, 그 전에는 배지를 아예 그리지 않습니다.
  const [seen, setSeen] = useState<Record<TabKey, number> | null>(null);
  useEffect(() => setSeen(loadSeen()), []);

  function markSeen(key: TabKey) {
    setSeen((prev) => {
      const next = { ...(prev ?? loadSeen()), [key]: Date.now() };
      try {
        localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* 시크릿 모드 등 - 이번 세션만 기억 못 해도 동작에는 문제 없습니다 */
      }
      return next;
    });
  }

  // 지금 보고 있는 탭은 새 항목이 실시간으로 들어와도 곧바로 본 것으로 칩니다 - 탭을 열어둔
  // 채로 새 글이 왔다고 그 탭 위에 빨간 원이 뜨면 이상합니다.
  useEffect(() => {
    if (seen) markSeen(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, messages.length]);

  // 학부모 문의의 새 항목 감지용 최근 접수시각 목록. 목록 화면(ParentInquiryPanel)은 탭이
  // 열려 있을 때만 마운트되므로, 배지는 여기서 가볍게 따로 봅니다 - 시각만 30건 가져오고,
  // 새 행이 INSERT되면 다시 읽습니다(채널 이름은 패널 쪽 "parent-inquiries"와 다르게).
  const [inquiryTimes, setInquiryTimes] = useState<number[]>([]);
  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    async function load() {
      const { data } = await supabase
        .from("pickup_requests")
        .select("received_at, is_demo")
        .eq("kind", "문의")
        .order("received_at", { ascending: false })
        .limit(30);
      if (stopped) return;
      setInquiryTimes(
        ((data as { received_at: string | null; is_demo?: boolean }[] | null) ?? [])
          .filter((r) => !r.is_demo && r.received_at)
          .map((r) => new Date(r.received_at as string).getTime())
      );
    }
    load();
    const channel = supabase
      .channel("parent-inquiries-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pickup_requests" }, () => load())
      .subscribe();
    return () => {
      stopped = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // 출결내역·출결알림은 같은 미러링 스트림(attendance)을 각자 방식으로 보여주므로, 배지도
  // 같은 스트림에서 "그 탭을 본 뒤 들어온 메시지 수"를 셉니다.
  const attendanceTimes = useMemo(
    () => messages.filter((m) => m.source_key === "attendance").map((m) => new Date(m.created_at_google).getTime()),
    [messages]
  );

  const unread: Record<TabKey, number> = useMemo(() => {
    if (!seen) return { inquiry: 0, digest: 0, chat: 0, office: officeOpen };
    return {
      inquiry: inquiryTimes.filter((t) => t > seen.inquiry).length,
      digest: attendanceTimes.filter((t) => t > seen.digest).length,
      chat: attendanceTimes.filter((t) => t > seen.chat).length,
      // 선생님요청은 안읽음이 아니라 미완료 건수 - 처리해야 끝나는 것이라 보기만 해서는 안 꺼집니다.
      office: officeOpen,
    };
  }, [seen, inquiryTimes, attendanceTimes, officeOpen]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "inquiry", label: "💬 학부모 문의" },
    { key: "digest", label: "📊 출결내역" },
    { key: "chat", label: "🚸 출결알림" },
    { key: "office", label: "❗ 선생님요청" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* "📥 인박스" 제목은 이 패널을 감싸는 존 머리글(WorkspaceArea)이 그리므로 여기서는
          필터 탭만 둡니다. 배지가 탭 밖으로 살짝 나가야 해서 overflow는 세로만 숨깁니다. */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5 pt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              markSeen(t.key);
            }}
            className={
              "relative flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
              (tab === t.key ? "bg-emerald-500 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
            }
          >
            {t.label}
            <UnreadDot count={unread[t.key]} />
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* 선생님요청 탭은 배지 숫자(미완료 건수)를 유지하기 위해 항상 마운트해두고 표시만
            전환합니다 - 다른 탭을 보고 있어도 새 요청이 오면 배지가 올라갑니다. */}
        <div className={tab === "office" ? "h-full" : "hidden"}>
          <OfficeRequestsPanel onOpenCountChange={setOfficeOpen} department={department} userEmail={userEmail} />
        </div>
        {tab === "inquiry" && <ParentInquiryPanel currentUserEmail={userEmail} full />}
        {tab === "digest" && (
          <AttendanceDigestPanel messages={messages} department={department} roster={roster} currentUserEmail={userEmail} />
        )}
        {tab === "chat" && (
          <GoogleChatMirrorPanel
            sourceKey="attendance"
            title="출결알림"
            icon="🚸"
            messages={messages}
            team={team}
            userEmail={userEmail}
            department={department}
            onTaskCreated={onTaskCreated}
          />
        )}
      </div>
    </div>
  );
}
