"use client";

import { useEffect, useMemo, useState } from "react";
import type { GoogleChatMirrorMessage } from "@/lib/types";
import type { RosterStudent } from "@/lib/attendanceDigest";
import AttendanceDigestPanel from "./AttendanceDigestPanel";
import OfficeRequestsPanel from "./OfficeRequestsPanel";
import { useToast } from "@/components/common/ToastProvider";
import { createTaskFromInbox } from "@/lib/taskFromInbox";

// 통합 인박스(커맨드센터 개편): 학부모 문의·출결내역·출결알림·선생님요청 등 "들어오는 소식"을
// 필터 탭 하나의 패널로 모았습니다. 예전에는 학부모 문의/픽업/선생님요청 배너가 화면 곳곳에
// 흩어져 있어 "지금 뭘 확인해야 하지?"가 한눈에 안 됐습니다.
//
// 새 소식 알림(요청: "새로운 메시지가 등록되면 알림표시 - 모바일 알림처럼 작게 빨간 동그라미
// 숫자"): 탭마다 "마지막으로 그 탭을 본 시각"을 이 브라우저에 기억해두고, 그 뒤에 들어온
// 항목 수를 탭 오른쪽 위 빨간 원으로 띄웁니다. 탭을 열면 본 것으로 치고 원이 사라집니다.
// 예외로 [선생님요청]은 "보면 사라지는 안읽음"이 아니라 "아직 완료 처리하지 않은 건수"입니다 -
// 요청은 읽는 게 아니라 처리해야 끝나는 것이라서, 완료를 눌러야 숫자가 내려갑니다.
//
// 학부모 문의(토들)는 인박스에서 뺐습니다. 토들 글은 이제 가운데 「오늘의 문의사항」이 전부 받고, 같은 글이
// 두 자리에 뜨면 한쪽에서 처리한 것이 다른 쪽에는 남아 «아직 안 한 일»로 보입니다. 인박스는 구글챗에서
// 들어오는 두 갈래(출결알림 방 → 출결내역, 선생님요청 방 → 선생님요청)만 봅니다. 토들 픽업의 「확인 필요」
// 칸도 같은 이유로 뺐습니다 - 학생 연결은 오늘의 문의사항 줄에서 합니다.
type TabKey = "digest" | "office";

const SEEN_STORAGE_KEY = "gia-work-inbox-seen-v1";

function loadSeen(): Record<TabKey, number> {
  const now = Date.now();
  // 처음 쓰는 브라우저에서는 "지금까지 온 것은 다 본 것"으로 시작합니다 - 첫 로드부터 지난
  // 메시지 수백 건이 전부 빨간 숫자로 뜨면 알림이 아니라 소음입니다.
  const fallback: Record<TabKey, number> = { digest: now, office: now };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Record<TabKey, number>>;
    return {
      digest: typeof p.digest === "number" ? p.digest : now,
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
  userEmail,
  department,
  roster,
}: {
  messages: GoogleChatMirrorMessage[];
  userEmail: string;
  department: string;
  roster: RosterStudent[];
}) {
  const [tab, setTab] = useState<TabKey>("digest");
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

  // 출결내역·출결알림은 같은 미러링 스트림(attendance)을 각자 방식으로 보여주므로, 배지도
  // 같은 스트림에서 "그 탭을 본 뒤 들어온 메시지 수"를 셉니다.
  const attendanceTimes = useMemo(
    () => messages.filter((m) => m.source_key === "attendance").map((m) => new Date(m.created_at_google).getTime()),
    [messages]
  );
  const teacherMessages = useMemo(
    () =>
      messages
        .filter((m) => m.source_key === "teacher_requests")
        .sort((a, b) => b.created_at_google.localeCompare(a.created_at_google)),
    [messages]
  );
  const teacherTimes = useMemo(() => teacherMessages.map((m) => new Date(m.created_at_google).getTime()), [teacherMessages]);

  const unread: Record<TabKey, number> = useMemo(() => {
    if (!seen) return { digest: 0, office: officeOpen };
    return {
      digest: attendanceTimes.filter((t) => t > seen.digest).length,
      // 선생님요청은 앱 창구의 미완료 건수 + 구글챗 방에 마지막으로 본 뒤 들어온 글 수입니다.
      office: officeOpen + teacherTimes.filter((t) => t > seen.office).length,
    };
  }, [seen, attendanceTimes, teacherTimes, officeOpen]);

  // 「🚸 출결알림」 탭을 내렸습니다. 이 탭은 구글챗의 출결알림 방을 그대로 옮겨 보여주는
  // 자리였는데, **바로 아래 칸(구글챗)이 같은 방을 이미 보여줍니다.** 창을 여러 개 띄우지
  // 않으려고 만든 자리가 한 화면 안에서 같은 내용을 두 번 띄우는 자리가 됐고, 그러면 어느
  // 쪽이 최신인지 묻게 됩니다. 구글챗에서 읽어 만든 출결 판정은 [출결내역] 탭에 남습니다.
  const tabs: { key: TabKey; label: string }[] = [
    { key: "digest", label: "📊 출결내역" },
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
        <div className={tab === "office" ? "flex h-full flex-col overflow-hidden" : "hidden"}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TeacherChatRequests messages={teacherMessages} department={department} userEmail={userEmail} />
            <OfficeRequestsPanel onOpenCountChange={setOfficeOpen} department={department} userEmail={userEmail} />
          </div>
        </div>
        {tab === "digest" && (
          <div className="flex h-full flex-col overflow-hidden">
            {/* 「오늘 하원체크」는 업무보드 맨 위로 올라갔습니다. 같은 화면에 두 번 뜨면
                둘 중 하나는 아무도 안 보게 되고, 안 보는 자리가 생기면 그 자리에만 있는
                정보가 언젠가 묻힙니다. */}
            {/* 두 창구 대조 띠는 걷었습니다. 매일 봐야 하는 자리에 아무도 안 보는 띠가
                있으면, 그 아래 진짜 봐야 하는 것까지 함께 넘어갑니다. */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <AttendanceDigestPanel messages={messages} department={department} roster={roster} currentUserEmail={userEmail} />
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

const timeKst = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * 구글챗 「선생님요청」 방에 올라온 글.
 *
 * 선생님들은 앱 창구보다 구글챗 방에 먼저 씁니다. 그 방을 읽어 둔 자료(google_chat_mirror_messages)가 이미
 * 있었는데 인박스는 앱 창구만 보여서, 방에 쓴 요청은 구글챗을 따로 열어야 보였습니다. 글은 구글챗 쪽이
 * 원본이라 여기서는 읽고 업무로 옮기는 것만 합니다.
 */
function TeacherChatRequests({
  messages,
  department,
  userEmail,
}: {
  messages: GoogleChatMirrorMessage[];
  department: string;
  userEmail: string;
}) {
  const notify = useToast();
  const [tasked, setTasked] = useState<Set<string>>(new Set());
  const shown = messages.slice(0, 60);

  async function toTask(m: GoogleChatMirrorMessage) {
    const who = m.sender_display_name ?? "선생님";
    const { error } = await createTaskFromInbox({
      title: `[${who} 요청] ${m.content.replace(/\s+/g, " ").slice(0, 50)}`,
      description: `구글챗 선생님요청 방 · ${who} · ${timeKst(m.created_at_google)}\n\n${m.content}`,
      department,
      userEmail,
    });
    if (error) notify("업무 등록 실패: " + error, "error");
    else {
      notify("업무로 등록했습니다.", "success");
      setTasked((prev) => new Set(prev).add(m.id));
    }
  }

  return (
    <div className="border-b border-black/5 px-2 pb-2">
      <p className="px-1 pb-1 pt-1 text-[10px] font-bold text-slate-400">구글챗 · 선생님요청 방</p>
      {shown.length === 0 ? (
        <p className="px-1 text-[11px] text-slate-400">
          구글챗 선생님요청 방에서 읽어온 글이 없습니다. 방이 꺼져 있으면 관리 › 연동 상태에서 켜 주세요.
        </p>
      ) : (
        <ul className="space-y-1">
          {shown.map((m) => (
            <li key={m.id} className="rounded-lg bg-white px-2 py-1.5 text-[12px] shadow-sm ring-1 ring-black/5">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="rounded bg-sky-100 px-1 font-bold text-sky-700">구글챗</span>
                <b className="text-slate-600">{m.sender_display_name ?? "?"}</b>
                <span className="tabular-nums">{timeKst(m.created_at_google)}</span>
                <button
                  type="button"
                  disabled={tasked.has(m.id) || !!m.task_id}
                  onClick={() => void toTask(m)}
                  className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                >
                  {tasked.has(m.id) || m.task_id ? "업무 등록됨" : "→ 업무"}
                </button>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-slate-700">{m.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
