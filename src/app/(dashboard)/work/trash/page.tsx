import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import TaskTrashClient from "@/components/work/TaskTrashClient";
import type { Task } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🗑 업무 휴지통이란?",
    lines: [
      "지운 업무가 7일 동안 머무는 곳입니다. 실수로 지웠거나 나중에 다시 필요해지면 여기서 되살릴 수 있습니다.",
      "7일이 지나면 자동으로 완전히 사라집니다. 그 뒤에는 되살릴 방법이 없습니다.",
      "본인이 등록했거나 태그된 업무, 또는 관리자만 볼 수 있습니다. 남이 지운 업무가 여기 보이지 않는 것은 정상입니다.",
      "등록자 본인이거나 관리자면 7일을 기다리지 않고 바로 영구삭제할 수도 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// 요청("삭제 휴지통 7일 복구")에 따른 업무 휴지통 화면입니다. RLS가 이미 "삭제한 지 7일
// 이내면서 본인/담당자/관리자"만 이 조회 결과에 포함되도록 걸러주므로(schema.sql 섹션 62),
// 여기서는 그냥 deleted_at is not null인 것만 조회하면 됩니다.
export default async function WorkTrashPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🗑 업무 휴지통</h1>
        <GuideButton title="업무 휴지통 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-6 text-xs text-slate-500">
        삭제한 업무는 7일 동안 여기서 복구할 수 있고, 그 이후에는 자동으로 완전히 삭제됩니다.
        본인이 등록했거나 태그된 업무, 또는 관리자만 볼 수 있습니다. 등록자 본인이거나 관리자면
        기다리지 않고 바로 영구삭제할 수도 있습니다.
      </p>
      <TaskTrashClient
        tasks={(data as Task[] | null) ?? []}
        currentUserEmail={me.email}
        isAdmin={isAdminUser(me)}
      />
    </div>
  );
}
