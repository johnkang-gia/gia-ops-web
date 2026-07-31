"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Todo } from "@/lib/types";

// 홈 화면 할 일 목록에서 시간을 설정하면, 그 시간이 되었을 때 알려주는 공용 훅입니다.
// - 20초 간격으로 "아직 알림을 보내지 않았고(notified=false), 완료되지 않았고(done=false),
//   설정 시간이 지난" 할 일을 찾아서 브라우저 알림(권한이 있을 때)을 띄우고, onDue 콜백으로
//   화면 안 팝업도 함께 띄울 수 있게 해줍니다. 한 번 알림을 보낸 항목은 DB에 notified=true로
//   기록해서 새로고침해도 같은 알림이 중복으로 뜨지 않습니다.
// - 앱(브라우저 탭)이 열려 있는 동안에만 동작합니다. 탭이 완전히 꺼져 있으면 알림이 가지 않아요.
export function useTodoReminders(userEmail: string | null | undefined, onDue?: (todo: Todo) => void) {
  const notifiedRef = useRef<Set<string>>(new Set());
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;

  useEffect(() => {
    if (!userEmail) return;
    const supabase = createClient();
    let cancelled = false;

    async function checkDue() {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("todos")
        .select("*")
        .eq("user_email", userEmail)
        .eq("done", false)
        .eq("notified", false)
        .not("due_at", "is", null)
        .lte("due_at", nowIso);
      if (cancelled || !data) return;
      for (const todo of data as Todo[]) {
        if (notifiedRef.current.has(todo.id)) continue;
        notifiedRef.current.add(todo.id);
        fireBrowserNotification(todo);
        onDueRef.current?.(todo);
        supabase.from("todos").update({ notified: true }).eq("id", todo.id).then(() => {});
      }
    }

    checkDue();
    const timer = setInterval(checkDue, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userEmail]);
}

function fireBrowserNotification(todo: Todo) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification("⏰ 할 일 알림", { body: todo.text, tag: todo.id });
  } catch {
    // 일부 환경(모바일 브라우저 등)은 new Notification()을 직접 지원하지 않을 수 있음 - 무시
  }
}
