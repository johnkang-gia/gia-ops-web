"use client";

import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import type { Task } from "@/lib/types";

// 통합 인박스의 항목(학부모 문의·선생님요청 등)을 클릭 한 번으로 업무 카드로 만드는 공용
// 헬퍼(커맨드센터 개편 ⓑ: "문의가 곧 업무가 되는 흐름"). QuickTaskWidget과 같은 형태로
// tasks에 넣되, 제목 앞에 출처를 붙여 어디서 온 업무인지 보드에서 바로 알 수 있게 합니다.
export async function createTaskFromInbox(opts: {
  title: string;
  description?: string | null;
  department: string;
  userEmail: string;
  urgent?: boolean;
}): Promise<{ task: Task | null; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      case_id: genCaseId("TSK"),
      title: opts.title.slice(0, 80),
      description: opts.description ?? null,
      status: "예정",
      priority: opts.urgent ? "긴급" : "보통",
      department: opts.department,
      owner_email: opts.userEmail,
      assignee_emails: [opts.userEmail],
      position: Date.now(),
      origin_mode: "나",
    })
    .select()
    .single();
  if (error || !data) return { task: null, error: error?.message ?? "등록 실패" };
  return { task: data as Task, error: null };
}
