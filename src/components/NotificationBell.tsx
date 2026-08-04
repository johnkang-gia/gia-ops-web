"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// 사이드바 프로필 옆에 다는 업무 알림 표시입니다. 두 곳으로 나뉩니다(요청: "동그라미 안의
// 숫자는 미확인 업무 개수로 하고, 확인이 되면 프로필 이름 맨 오른쪽에 둥근 네모박스안에 총
// 업무갯수를 표시해줘"):
//  1) NotificationBell - 프로필 아이콘 모서리의 작은 원형 배지. "미확인" 업무(태그됐거나
//     [전체]로 등록됐는데 아직 "업무 확인" 체크를 안 한 것) 개수만 보여주고, 하나라도 있으면
//     빨간색으로 깜빡입니다. 0이면 아예 안 보입니다.
//  2) TaskCountBadge - 프로필 이름 오른쪽 끝의 조용한 사각 배지. "내 업무" 총 개수(확인
//     여부와 무관하게 진행 중인 전체)를 항상 보여줍니다.
//
// MyTasksWidget과 같은 기준으로 "내 업무"를 셉니다 - 내가 등록자이거나, 태그된 담당자이거나,
// [전체]로 등록된 업무이면서 아직 완료되지 않은 것.
type Counts = { myTaskCount: number; needsAckCount: number; refresh: () => void };
const NotificationContext = createContext<Counts>({ myTaskCount: 0, needsAckCount: 0, refresh: () => {} });

type TaskRow = {
  owner_email: string;
  assignee_emails: string[] | null;
  origin_mode: string;
  status: string;
  acknowledged_by: { email: string; time: string }[] | null;
};

export function NotificationProvider({
  userEmail,
  children,
}: {
  userEmail: string | null;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<{ myTaskCount: number; needsAckCount: number }>({
    myTaskCount: 0,
    needsAckCount: 0,
  });

  useEffect(() => {
    if (!userEmail) return; // 교사 계정 등 배지를 안 보여줄 화면에서는 조회/구독 자체를 생략
    const supabase = createClient();
    let cancelled = false;

    async function loadCounts() {
      const { data } = await supabase
        .from("tasks")
        .select("owner_email, assignee_emails, origin_mode, status, acknowledged_by");
      if (cancelled) return;

      const mine = ((data as TaskRow[] | null) ?? []).filter(
        (t) =>
          (t.owner_email === userEmail || t.assignee_emails?.includes(userEmail!) || t.origin_mode === "전체") &&
          t.status !== "완료"
      );
      const needsAckCount = mine.filter(
        (t) =>
          t.owner_email !== userEmail &&
          (t.assignee_emails?.includes(userEmail!) || t.origin_mode === "전체") &&
          !(t.acknowledged_by ?? []).some((a) => a.email === userEmail)
      ).length;

      if (!cancelled) setCounts({ myTaskCount: mine.length, needsAckCount });
    }

    loadCounts();

    // 업무가 새로 생기거나, 상태·확인여부가 바뀌면 그때마다 다시 세어 배지를 최신 상태로
    // 유지합니다. 다만 "내가 방금 이 화면에서 확인 체크한" 경우는 Realtime 전파를 기다리지
    // 않고 아래 refresh()를 직접 호출해 즉시 반영합니다(요청: "확인 체크 하자마자 사라지게
    // 할 수 있어?" - 페이지를 새로 열어야만 반영되던 지연을 없앴습니다).
    const channel = supabase
      .channel("global-notification-bell-" + userEmail)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadCounts())
      .subscribe();

    // 다른 컴포넌트(업무 확인 체크박스 등)가 "지금 바로 다시 세어줘"라고 요청할 수 있도록
    // window 커스텀 이벤트로 loadCounts를 노출합니다. Context의 refresh()가 이 이벤트를 쏩니다.
    const onRefresh = () => loadCounts();
    window.addEventListener("gia-task-counts-refresh", onRefresh);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener("gia-task-counts-refresh", onRefresh);
    };
  }, [userEmail]);

  const refresh = useCallback(() => {
    window.dispatchEvent(new Event("gia-task-counts-refresh"));
  }, []);

  return <NotificationContext.Provider value={{ ...counts, refresh }}>{children}</NotificationContext.Provider>;
}

// 업무 확인 체크박스를 누른 직후 등, 배지를 Realtime 전파를 기다리지 않고 즉시 다시 세고 싶을
// 때 이 훅으로 얻은 함수를 호출합니다.
export function useRefreshTaskCounts() {
  return useContext(NotificationContext).refresh;
}

// 프로필 아이콘 모서리의 작은 원형 배지 - "미확인" 업무 개수. 데이터를 직접 조회하지 않고 위
// Provider가 계산해둔 값을 Context로 읽기만 하므로, 데스크톱/모바일 두 군데에 동시에 놓아도
// 안전합니다.
export default function NotificationBell() {
  const { needsAckCount } = useContext(NotificationContext);
  if (needsAckCount === 0) return null;

  return (
    <Link
      href="/work"
      title={`아직 확인하지 않은 업무 ${needsAckCount}건`}
      className="shell-badge-pop absolute -left-1 -top-1 z-10 flex h-4 min-w-[1rem] animate-pulse items-center justify-center rounded-full border-2 border-[var(--shell-bg,#ffffff)] bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm"
    >
      {needsAckCount > 99 ? "99+" : needsAckCount}
    </Link>
  );
}

// 프로필 이름 오른쪽 끝에 붙는 조용한 사각 배지 - "내 업무" 총 개수(확인 여부와 무관).
export function TaskCountBadge() {
  const { myTaskCount } = useContext(NotificationContext);
  if (myTaskCount === 0) return null;

  return (
    <Link
      href="/work"
      title={`내 업무 총 ${myTaskCount}건`}
      className="shell-badge-pop ml-auto shrink-0 rounded-md bg-[var(--shell-hover-bg,#f1f5f9)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--shell-text-muted,#64748b)] transition-colors"
    >
      {myTaskCount > 99 ? "99+" : myTaskCount}
    </Link>
  );
}
