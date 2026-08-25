import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser, isStaffOrAboveUser } from "@/lib/roles";
import WorkBoardClient from "@/components/work/WorkBoardClient";
import type { Task, Department, TeamMember, TaskModeColor, GoogleChatMirrorMessage, WorkNotice } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🗂️ 업무 보드란?",
    lines: [
      "학교에서 오가는 일을 카드 한 장씩으로 만들어 상태(예정·진행중·완료·보류)를 옮겨가며 관리하는 화면입니다. 앱에서 가장 자주 여는 곳입니다.",
      "카드에 사람을 태그하면 그 사람 화면에 알림이 뜹니다. 부서를 지정하면 부서 탭에서 묶여 보입니다.",
      "구글챗에 올라온 글이 자동으로 이 화면에 미러링됩니다. 챗을 따로 열지 않아도 무슨 요청이 들어왔는지 여기서 함께 볼 수 있습니다.",
      "완료한 업무는 사라지지 않고 [지난 업무]에 학기별로 쌓입니다. 지운 업무는 [휴지통]에서 7일간 되살릴 수 있습니다.",
    ],
  },
  {
    title: "📢 전체공지",
    lines: [
      "관리자·행정직원이 올린 전체공지는 이 화면 맨 위에 뜹니다. 새 공지가 올라오면 이전 공지는 내려가고 새 공지가 올라옵니다.",
      "다 읽은 공지는 각자 접어둘 수 있고, 접어도 다른 사람 화면에는 그대로 보입니다.",
      "지난 공지는 공지 오른쪽 위 히스토리 아이콘에서 전부 볼 수 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// WorkFlatform 참조의 ClientApp은 별도 설명 문구 없이 사이드바+워크스페이스가 화면 전체를
// 채우는 구조입니다 - 여기서도 상단 안내문 없이 WorkBoardClient가 가용 공간 전체를 차지하도록
// 구성했습니다(요청 #2: UI/UX 그대로 이식).
export default async function WorkPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const [tasksRes, teamRes, deptRes, modeColorRes, mirrorRes] = await Promise.all([
    // deleted_at도 명시적으로 걸러야 합니다 - RLS는 등록자/담당자/관리자에게 휴지통 조회용으로
    // deleted_at is not null(7일 이내) 행도 select 허용하는 별도 정책이 OR로 붙어있어서, 여기서
    // 걸러주지 않으면 방금 삭제한 업무가 등록자/담당자 눈에는 업무보드에 계속 남아있게 됩니다
    // (요청: "업무를 삭제해도 계속 표시되").
    supabase.from("tasks").select("*").is("archived_at", null).is("deleted_at", null).order("position", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("departments").select("*").order("sort_order", { ascending: true }),
    supabase.from("task_mode_colors").select("*"),
    // 구글챗 미러링(출결알림/선생님요청) 최근 메시지입니다. 아직 SQL 마이그레이션을 실행하지
    // 않은 상태(테이블이 없는 상태)에서도 페이지가 죽지 않도록, supabase-js는 테이블이 없으면
    // 에러 없이 {data:null,error}를 돌려주는 특성을 이용해 아래에서 항상 ?? []로 방어합니다.
    supabase
      .from("google_chat_mirror_messages")
      .select("*")
      .order("created_at_google", { ascending: false })
      .limit(200),
  ]);

  // 출결내역 위젯이 "정서안만 픽업" 같은 문장에서 이름을 추측하지 않고 실제 명부와 대조하도록
  // 재적생 명단을 가져옵니다. 동명이인(같은 이름 여러 명)을 문장의 학년 힌트("2학년 김재이",
  // "김재이(2)")로 구분해야 해서 학년도 함께 가져옵니다.
  const { data: rosterData } = await supabase.from("wr_students_basic").select("name, grade, name_en").eq("status", "active");
  const roster = ((rosterData as { name: string; grade: string | null; name_en: string | null }[] | null) ?? []).map((s) => ({
    name: s.name,
    grade: s.grade,
    nameEn: s.name_en,
  }));

  const team = (teamRes.data as TeamMember[] | null) ?? [];
  const isAdmin = isAdminUser(me);

  // 업무 보드 상단 전체공지(요청: "업무에서 전체공지가 있을경우 바로 상단으로 옮겨지고").
  // 최신 하나만 상단에 뜨지만 히스토리도 같은 목록에서 보여주므로 최근 100건을 함께 가져오고,
  // 내가 접어둔 공지 id도 같이 받아서 첫 화면부터 접힌 상태로 그려지게 합니다.
  const [noticesRes, collapsesRes] = await Promise.all([
    supabase.from("work_notices").select("*").is("archived_at", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("work_notice_collapses").select("notice_id").eq("user_email", me.email),
  ]);
  const notices = (noticesRes.data as WorkNotice[] | null) ?? [];
  const collapsedNoticeIds = ((collapsesRes.data as { notice_id: string }[] | null) ?? []).map((c) => c.notice_id);

  // 상단 학교 요약(요청: 업무 대시보드에도 지금 무슨 학기·학기말까지 남은 기간, 초등부 재학생 수).
  const [{ data: termRows }, elemCountRes] = await Promise.all([
    supabase.from("terms").select("term_type, year, end_date").eq("status", "진행중").order("start_date", { ascending: false }).limit(1),
    supabase.from("wr_students_basic").select("id", { count: "exact", head: true }).eq("status", "active").eq("department", "초등부"),
  ]);
  const tr = (termRows ?? [])[0] as { term_type?: string; year?: string; end_date?: string | null } | undefined;
  const termLabel = tr ? `${tr.year ?? ""} ${tr.term_type ?? ""}`.trim() : null;
  const termDday = tr?.end_date ? Math.ceil((new Date(tr.end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
  const elemActive = elemCountRes.count ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* 업무 대시보드 상단 학교 요약(학기·학기말 D-day·초등부 재학생) + 가이드 버튼. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 pb-1">
        {termLabel && (
          <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-bold text-purple-800">📚 {termLabel}</span>
        )}
        {termDday != null && (
          <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[11px] font-bold text-white">
            {termDday > 0 ? `학기말 D-${termDday}` : termDday === 0 ? "오늘 학기말" : "학기 종료"}
          </span>
        )}
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
          🎓 초등부 재학생 <b>{elemActive}</b>명
        </span>
        <div className="ml-auto">
          <GuideButton title="업무 보드 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>
      {/* 칸반이 남은 높이를 전부 쓰도록 - min-h-0이 없으면 내용이 길어질 때 이 칸이 늘어나
          화면 전체가 스크롤됩니다. */}
      <div className="min-h-0 flex-1">
      <WorkBoardClient
        initialTasks={(tasksRes.data as Task[] | null) ?? []}
        team={team}
        userEmail={me.email}
        departments={(deptRes.data as Department[] | null) ?? []}
        isAdmin={isAdmin}
        initialModeColors={(modeColorRes.data as TaskModeColor[] | null) ?? []}
        initialMirrorMessages={(mirrorRes.data as GoogleChatMirrorMessage[] | null) ?? []}
        roster={roster}
        initialNotices={notices}
        collapsedNoticeIds={collapsedNoticeIds}
        canManageNotices={isStaffOrAboveUser(me)}
      />
      </div>
    </div>
  );
}
