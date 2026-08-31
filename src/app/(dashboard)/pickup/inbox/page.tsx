import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { kstParts } from "@/lib/shuttleTracking";
import GuideButton from "@/components/common/GuideButton";
import PickupInboxClient, { type PickupRow, type StudentOption } from "@/components/pickup/PickupInboxClient";
import { type ScheduleRow } from "@/components/pickup/UpcomingPickups";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "📥 픽업 인박스란?",
    lines: [
      "학부모가 픽업을 알려오는 길이 여러 갈래입니다 - 토들 개인 채팅방, 학교 전화, 담임 선생님께 직접 연락. 그 전부가 이 화면 한 곳에 모입니다.",
      "예전에는 행정직원이 토들 채팅방 100개를 하나하나 열어 확인하고, 구글챗에 옮겨 적고, 다시 앱에 체크했습니다. 오후 4시에 하원 지도를 나가면 그 시간에 온 메시지는 놓쳤습니다.",
      "이제 사무실 PC의 토들 수집기가 새 메시지를 자동으로 가져오고, AI가 '픽업인지 / 누구인지 / 몇 시인지'를 뽑아 명부와 대조합니다. 확신이 서면 바로 픽업으로 체크되고, 애매한 것만 여기 [확인이 필요한 픽업]에 남습니다.",
    ],
  },
  {
    title: "✅ 무엇을 확인해야 하나요?",
    lines: [
      "[확인이 필요한 픽업]만 보시면 됩니다. 나머지는 이미 처리된 것입니다.",
      "여기로 오는 경우는 둘입니다 - (1) AI가 픽업인지 확신하지 못했거나, (2) 학생을 명부에서 한 명으로 특정하지 못했을 때. 형제 자매가 함께 있는 채팅방에서 누구인지 안 적혀 있으면 여기로 옵니다.",
      "학생을 고르면 그 즉시 하원 체크표에 픽업으로 표시되고, 하원 운영화면에도 바로 뜹니다.",
      "픽업이 아닌 내용이면 [픽업 아님]을 눌러주세요. 잘못 눌렀으면 맨 아래 접힌 목록에서 되돌릴 수 있습니다.",
    ],
  },
  {
    title: "⚠️ 빨간 경고가 떴다면",
    lines: [
      "토들 수집기가 멈췄다는 뜻입니다. 조용히 멈춰서 픽업을 통째로 놓치는 것이 가장 나쁜 상황이라, 10분만 신호가 끊겨도 크게 알려드립니다.",
      "대부분은 사무실 PC에서 토들 로그인이 풀린 경우입니다 - 그 PC의 크롬에서 토들에 다시 로그인하면 바로 복구됩니다.",
      "고쳐질 때까지는 토들을 직접 확인하시고, 아래 [손으로 접수]에 붙여넣어 주세요. 붙여넣기만 해도 AI가 학생과 시각을 찾아냅니다.",
    ],
  },
  {
    title: "🔒 학부모 대화는 어떻게 다루나요?",
    lines: [
      "픽업이 아니라고 판단된 메시지는 본문을 저장하지 않습니다. 같은 메시지를 반복해서 다시 읽지 않기 위한 표시만 남깁니다.",
      "픽업 건의 본문도 보관 기간이 지나면 자동으로 지워집니다.",
      "수집기가 메시지를 가져가도 토들의 '안 읽음' 표시는 그대로 남습니다. 답장이 필요한 진짜 문의는 예전처럼 직원이 확인하고 답하시면 됩니다.",
    ],
  },
];

export default async function PickupInboxPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const today = kstParts(new Date()).iso;

  const [rowsRes, studentsRes, heartbeatRes, schedulesRes] = await Promise.all([
    supabase
      .from("pickup_requests")
      .select("*")
      .gte("service_date", today)
      .order("received_at", { ascending: false })
      .limit(200),
    supabase
      .from("wr_students")
      .select("id, name, grade, class_name, name_en, student_no, birth_date")
      .eq("is_demo", false)
      .eq("status", "active")
      .order("name"),
    supabase.from("integration_heartbeats").select("last_seen_at, status, detail").eq("key", "toddle-collector").maybeSingle(),
    // 앞으로 예정된 픽업. 오늘 것만 보면 "이번주 목금" 같은 예약을 놓칩니다.
    supabase
      .from("pickup_schedules")
      .select("id, service_date, pickup_time, student_name, student_id, status, needs_confirm, source_note, homeroom_email, request_id, pickup_requests(raw_text, summary, channel_label, source_url, source_chat_id, received_at)")
      .gte("service_date", today)
      .in("status", ["예정", "적용됨", "실패"])
      .order("service_date", { ascending: true })
      .limit(200),
  ]);

  return (
    // 담당자: "픽업 인박스가 화면을 너무 좁게 써." max-w-3xl(768px)은 폰을 기준으로 잡은
    // 폭이라, 24인치 모니터에서 오른쪽 절반이 통째로 비어 있었습니다. 폭을 풀고 안쪽에서
    // 두 단으로 나눕니다.
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">📥 픽업 인박스</h1>
        <GuideButton title="픽업 인박스 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        토들·전화·선생님 연락으로 들어온 픽업이 모두 여기 모입니다. <b>[확인이 필요한 픽업]</b>만 봐주시면 되고, 나머지는
        자동으로 하원 체크표에 반영됩니다.
      </p>

      <PickupInboxClient
        initialRows={(rowsRes.data as PickupRow[] | null) ?? []}
        students={(studentsRes.data as StudentOption[] | null) ?? []}
        collector={
          (heartbeatRes.data as { last_seen_at: string; status: string | null; detail: string | null } | null) ?? null
        }
        schedules={(schedulesRes.data as ScheduleRow[] | null) ?? []}
      />
    </div>
  );
}
