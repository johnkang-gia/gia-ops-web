"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// 사이드바 프로필 옆에 다는 작은 알림 배지입니다(요청: "채팅에 글이 올라오거나, 내업무,
// 전체업무등 내 업무목록에 업무가 등록되면 메뉴항목 프로필 옆에 알람형식으로 알 수 있도록").
// 두 가지를 합산해서 숫자 하나로 보여줍니다:
//  1) 안 읽은 채팅 - 부서별로 이미 있던 message_reads(마지막으로 읽은 시각)를 그대로 재사용
//  2) 새 업무 - task_list_reads(마지막으로 업무 탭을 연 시각) 이후 등록된, 내가 등록하지
//     않았으면서 나를 태그했거나 [전체]로 등록된 업무
//
// v0.57.2에서는 이 데이터 조회/실시간 구독을 배지 컴포넌트 자체 안에 뒀었는데, layout.tsx가
// 데스크톱 사이드바용/모바일 헤더용 두 곳에 배지를 동시에 렌더링하다 보니(화면 크기에 따라
// CSS로만 숨기는 방식이라 둘 다 항상 마운트됨) 똑같은 이름의 Realtime 채널을 두 번 동시에
// 구독하게 됐고, 이게 Supabase 쪽에서 문제를 일으켜 스테이징 전체가 먹통이 되는 원인이었던
// 것으로 보입니다(요청: "sql 도 롤백할 수 있게... 다시 넣어주고 sql 충돌안나게 다시 만들어줘").
// 그래서 조회/구독 로직을 NotificationProvider로 분리해 layout 최상단에서 딱 한 번만
// 실행되게 하고, 실제 배지(NotificationBell)는 그 결과를 Context로 읽기만 하는 얇은
// 컴포넌트로 바꿨습니다 - 여러 곳에 렌더링돼도 구독은 항상 하나입니다.
type Counts = { chatUnread: number; taskUnread: number };
const NotificationContext = createContext<Counts>({ chatUnread: 0, taskUnread: 0 });

export function NotificationProvider({
  userEmail,
  children,
}: {
  userEmail: string | null;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<Counts>({ chatUnread: 0, taskUnread: 0 });

  useEffect(() => {
    if (!userEmail) return; // 교사 계정 등 배지를 안 보여줄 화면에서는 조회/구독 자체를 생략
    const supabase = createClient();
    let cancelled = false;

    async function loadCounts() {
      const [{ data: departments }, { data: reads }, { data: taskRead }] = await Promise.all([
        supabase.from("departments").select("name"),
        supabase.from("message_reads").select("department, last_read_at").eq("user_email", userEmail!),
        supabase.from("task_list_reads").select("last_seen_at").eq("user_email", userEmail!).maybeSingle(),
      ]);
      if (cancelled) return;

      const readMap = new Map((reads ?? []).map((r) => [r.department as string, r.last_read_at as string]));
      let chatTotal = 0;
      for (const d of (departments as { name: string }[] | null) ?? []) {
        // 한 번도 그 채팅방을 읽은 적이 없으면(신규 부서 등) 과거 이력을 통째로 "안 읽음"으로
        // 세지 않고 건너뜁니다 - 실제로 처음 들어가서 한 번 읽으면 그 이후부터 정상 집계됩니다.
        const since = readMap.get(d.name);
        if (!since) continue;
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("department", d.name)
          .neq("author_email", userEmail!)
          .gt("created_at", since);
        chatTotal += count ?? 0;
      }

      let taskTotal = 0;
      const since = (taskRead as { last_seen_at: string } | null)?.last_seen_at;
      if (since) {
        const { data: newTasks } = await supabase
          .from("tasks")
          .select("id, owner_email, assignee_emails, origin_mode")
          .neq("owner_email", userEmail!)
          .gt("created_at", since);
        taskTotal = ((newTasks as { assignee_emails: string[]; origin_mode: string }[] | null) ?? []).filter(
          (t) => t.origin_mode === "전체" || t.assignee_emails?.includes(userEmail!)
        ).length;
      }

      if (!cancelled) setCounts({ chatUnread: chatTotal, taskUnread: taskTotal });
    }

    loadCounts();

    // 새 메시지/업무가 생기거나, 내가 어딘가에서 읽음 처리를 하면(message_reads/task_list_reads
    // 갱신) 그때마다 다시 세어 배지를 최신 상태로 유지합니다. 채널 이름에 이메일을 넣어두면
    // 충분히 고유하고, 이 Provider는 layout 최상단에서 딱 한 번만 마운트되므로 같은 이름의
    // 채널을 중복 구독할 일이 없습니다.
    const channel = supabase
      .channel("global-notification-bell-" + userEmail)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => loadCounts())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks" }, () => loadCounts())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads", filter: `user_email=eq.${userEmail}` },
        () => loadCounts()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_list_reads", filter: `user_email=eq.${userEmail}` },
        () => loadCounts()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userEmail]);

  return <NotificationContext.Provider value={counts}>{children}</NotificationContext.Provider>;
}

// 실제로 렌더링되는 작은 빨간 배지입니다. 데이터를 직접 조회하지 않고 위 Provider가 계산해둔
// 값을 Context로 읽기만 하므로, 데스크톱/모바일 두 군데에 동시에 놓아도 안전합니다.
export default function NotificationBell() {
  const { chatUnread, taskUnread } = useContext(NotificationContext);
  const total = chatUnread + taskUnread;
  if (total === 0) return null;

  return (
    <Link
      href="/work"
      title={`💬 안 읽은 채팅 ${chatUnread}건 · 🗂️ 새 업무 ${taskUnread}건`}
      className="absolute -left-1 -top-1 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm"
    >
      {total > 99 ? "99+" : total}
    </Link>
  );
}
