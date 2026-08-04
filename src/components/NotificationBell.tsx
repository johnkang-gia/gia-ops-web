"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// 사이드바 프로필 옆에 다는 작은 알림 배지입니다(요청: "채팅에 글이 올라오거나, 내업무,
// 전체업무등 내 업무목록에 업무가 등록되면 메뉴항목 프로필 옆에 알람형식으로 알 수 있도록").
// 두 가지를 합산해서 숫자 하나로 보여줍니다:
//  1) 안 읽은 채팅 - 부서별로 이미 있던 message_reads(마지막으로 읽은 시각)를 그대로 재사용
//  2) 새 업무 - task_list_reads(마지막으로 업무 탭을 연 시각) 이후 등록된, 내가 등록하지
//     않았으면서 나를 태그했거나 [전체]로 등록된 업무
// 새로 채팅을 읽거나 업무 탭을 열면(각 화면에서 알아서 읽음 시각을 갱신) 실시간 구독으로
// 곧바로 배지가 줄어듭니다. 클릭하면 업무 탭(채팅+업무목록이 모두 있는 곳)으로 이동합니다.
export default function NotificationBell({ userEmail }: { userEmail: string }) {
  const [chatUnread, setChatUnread] = useState(0);
  const [taskUnread, setTaskUnread] = useState(0);

  useEffect(() => {
    if (!userEmail) return;
    const supabase = createClient();
    let cancelled = false;

    async function loadCounts() {
      const [{ data: departments }, { data: reads }, { data: taskRead }] = await Promise.all([
        supabase.from("departments").select("name"),
        supabase.from("message_reads").select("department, last_read_at").eq("user_email", userEmail),
        supabase.from("task_list_reads").select("last_seen_at").eq("user_email", userEmail).maybeSingle(),
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
          .neq("author_email", userEmail)
          .gt("created_at", since);
        chatTotal += count ?? 0;
      }

      let taskTotal = 0;
      const since = (taskRead as { last_seen_at: string } | null)?.last_seen_at;
      if (since) {
        const { data: newTasks } = await supabase
          .from("tasks")
          .select("id, owner_email, assignee_emails, origin_mode")
          .neq("owner_email", userEmail)
          .gt("created_at", since);
        taskTotal = ((newTasks as { assignee_emails: string[]; origin_mode: string }[] | null) ?? []).filter(
          (t) => t.origin_mode === "전체" || t.assignee_emails?.includes(userEmail)
        ).length;
      }

      if (!cancelled) {
        setChatUnread(chatTotal);
        setTaskUnread(taskTotal);
      }
    }

    loadCounts();

    // 새 메시지/업무가 생기거나, 내가 어딘가에서 읽음 처리를 하면(message_reads/task_list_reads
    // 갱신) 그때마다 다시 세어 배지를 최신 상태로 유지합니다.
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
