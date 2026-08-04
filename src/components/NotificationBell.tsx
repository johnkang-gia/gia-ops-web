"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// 사이드바 프로필 옆에 다는 작은 알림 배지입니다. 처음에는 "안 읽은 채팅 + 새 업무"를
// 합산한 숫자였는데, 요청("프로필 옆에 동그라미 숫자를 띄우고, 그게 내업무 갯수를 뜻하고
// 새로운 업무가 생길때마다 빨간색으로 깜빡깜빡이도록 하고 업무확인하면 그냥 작은 원안에
// 숫자를 표시하게")에 따라 "지금 내 업무함에 있는 업무 개수"만 보여주는 배지로 바꿨습니다
// (채팅 안읽음은 이 배지에서 뺐습니다).
//
//  - 숫자: MyTasksWidget과 같은 기준으로 "내 업무"를 셉니다 - 내가 등록자이거나, 태그된
//    담당자이거나, [전체]로 등록된 업무이면서 아직 완료되지 않은 것.
//  - 깜빡임: 그중 내가 담당자로 태그됐거나 [전체]로 등록됐는데(등록자 본인 제외 - 등록자는
//    원래 확인 대상이 아님) 아직 업무 상세의 "업무 확인" 체크박스를 안 누른 업무가 하나라도
//    있으면 빨간색으로 깜빡입니다. 그 업무를 확인 체크하면(=acknowledged_by에 내 이메일이
//    들어가면) 더 이상 깜빡이지 않고 조용한 색의 숫자만 남습니다.
//
// v0.57.2에서는 이 조회/구독 로직을 배지 컴포넌트 자체 안에 뒀었는데, layout.tsx가 데스크톱
// 사이드바용/모바일 헤더용 두 곳에 배지를 동시에 렌더링하다 보니(화면 크기에 따라 CSS로만
// 숨기는 방식이라 둘 다 항상 마운트됨) 똑같은 이름의 Realtime 채널을 두 번 동시에 구독하게
// 됐고, 이게 Supabase 쪽에서 문제를 일으켜 스테이징 전체가 먹통이 되는 원인이었던 것으로
// 보입니다. 그래서 조회/구독 로직은 NotificationProvider로 분리해 layout 최상단에서 딱 한
// 번만 실행되게 하고, 실제 배지(NotificationBell)는 그 결과를 Context로 읽기만 하는 얇은
// 컴포넌트로 둡니다 - 여러 곳에 렌더링돼도 구독은 항상 하나입니다.
type Counts = { myTaskCount: number; needsAck: boolean };
const NotificationContext = createContext<Counts>({ myTaskCount: 0, needsAck: false });

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
  const [counts, setCounts] = useState<Counts>({ myTaskCount: 0, needsAck: false });

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
      const needsAck = mine.some(
        (t) =>
          t.owner_email !== userEmail &&
          (t.assignee_emails?.includes(userEmail!) || t.origin_mode === "전체") &&
          !(t.acknowledged_by ?? []).some((a) => a.email === userEmail)
      );

      if (!cancelled) setCounts({ myTaskCount: mine.length, needsAck });
    }

    loadCounts();

    // 업무가 새로 생기거나, 상태·확인여부가 바뀌면 그때마다 다시 세어 배지를 최신 상태로
    // 유지합니다. 이 Provider는 layout 최상단에서 딱 한 번만 마운트되므로 채널을 중복
    // 구독할 일이 없습니다.
    const channel = supabase
      .channel("global-notification-bell-" + userEmail)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadCounts())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userEmail]);

  return <NotificationContext.Provider value={counts}>{children}</NotificationContext.Provider>;
}

// 실제로 렌더링되는 작은 배지입니다. 데이터를 직접 조회하지 않고 위 Provider가 계산해둔
// 값을 Context로 읽기만 하므로, 데스크톱/모바일 두 군데에 동시에 놓아도 안전합니다.
export default function NotificationBell() {
  const { myTaskCount, needsAck } = useContext(NotificationContext);
  if (myTaskCount === 0) return null;

  return (
    <Link
      href="/work"
      title={
        needsAck
          ? `내 업무 ${myTaskCount}건 - 아직 확인하지 않은 업무가 있어요`
          : `내 업무 ${myTaskCount}건`
      }
      className={`absolute -left-1 -top-1 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full border-2 border-white px-1 text-[10px] font-bold leading-none text-white shadow-sm ${
        needsAck ? "animate-pulse bg-red-500" : "bg-slate-400"
      }`}
    >
      {myTaskCount > 99 ? "99+" : myTaskCount}
    </Link>
  );
}
