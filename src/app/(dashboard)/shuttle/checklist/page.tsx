import { redirect } from "next/navigation";
import { loadHomonyms } from "@/lib/homonyms";
import { nameKey } from "@/lib/studentKey";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import Link from "next/link";
import ShuttleChecklistClient from "@/components/shuttle/ShuttleChecklistClient";
import GuideButton from "@/components/common/GuideButton";
import { isStaffOrAboveUser } from "@/lib/roles";
import { loadChecklistData } from "@/lib/checklistLoad";
import ChecklistMemoPanel from "@/components/shuttle/ChecklistMemoPanel";

const GUIDE_SECTIONS = [
  {
    title: "📋 하원 체크표란?",
    lines: [
      "오늘 하원 차량별로 누가 타는지 보여주는 명단입니다. 하루에도 여러 번 여는 화면이라 셔틀 메뉴 맨 위에 있습니다.",
      "부모님이 직접 데리러 오셔서 셔틀을 타지 않는 학생은 🚗(픽업), 결석한 학생은 🚫(결석)을 눌러주세요. 다시 누르면 취소됩니다.",
      "여기서 누른 내용은 안내보드·차량 도착체크·사무실 대시보드에 즉시 반영됩니다. 기사님과 동승 선생님이 기다리지 않습니다.",
      "담임 선생님이 [내 반 픽업 체크]에서 누른 것과, 구글챗에 올라온 픽업 글도 같은 칸에 자동으로 들어옵니다 - 세 방법을 함께 써도 충돌하지 않습니다.",
    ],
  },
  {
    title: "🚌 다른 차를 타야 할 때",
    lines: [
      "학생 이름을 눌러 원하는 노선 칸으로 끌어다 놓으면 차가 바뀝니다.",
      "옮긴 뒤 [계속 유지]와 [오늘만] 중에 고릅니다. 이사처럼 계속 바뀌는 경우는 [계속 유지], 오늘 하루 사정은 [오늘만]입니다.",
      "[오늘만]으로 옮긴 학생은 내일 원래 노선으로 돌아옵니다.",
    ],
  },
  {
    title: "🖨️ 인쇄와 학기 전환",
    lines: [
      "오른쪽 위 인쇄 버튼으로 종이 체크표를 뽑을 수 있습니다. 화면 버튼과 안내문은 인쇄본에서 빠집니다.",
      "상단에서 정규학기와 여름캠프2를 오갈 수 있습니다. 두 기간은 노선과 명단이 완전히 분리되어 있어 서로 섞이지 않습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// 하원 차량 체크표 - 사용자가 올려준 PDF(하원차량 체크표)와 같은 형태로, 노선(차량)별 오늘의
// 학생 명단을 한 화면에서 볼 수 있게 만든 화면입니다(요청: "하원차량 체크표를 내가 준
// 표처럼 페이지를 만들어주고"). 이름을 클릭하면 "픽업"(부모님이 직접 데려가심 - 셔틀을
// 타지 않음)·"결석" 상태로 바뀌고, 이름을 다른 노선 칸으로 끌어다 놓으면 계속 유지할지
// 오늘 하루만 옮길지 물어봅니다(요청: "차량을 수정하면 계속 수정된채로 있을건지, 오늘만
// 차량이 바뀌는 건지 물어보고"). 이 상태는 shuttle_boardings/shuttle_assignments에 바로
// 저장되어(RLS가 로그인한 교직원 전체의 쓰기를 허용) 실시간 셔틀(/shuttle/live)과
// 안내보드(/shuttle-board)에도 그대로 반영됩니다.
export default async function ShuttleChecklistPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const { term: termParam } = await searchParams;
  // 요청: "하원체크표에 정규학기 애들 체크가 하나도 안되어 있어" - 여름캠프2가 끝났으므로
  // 기본을 정규학기로 둡니다(예전엔 기본이 여름캠프2라 정규학기 명단이 비어 보였습니다).
  const term: "정규학기" | "여름캠프2" = termParam === "여름캠프2" ? "여름캠프2" : "정규학기";

  const supabase = await createClient();
  const homonymNames = new Set((await loadHomonyms()).names.map(nameKey));
  const { today, routes, items, roster, messages, persistentNotes, toddleBase, activityLog, rideAlongs } =
    await loadChecklistData(supabase, term, { homonymNames });
  // 모바일 하원 체크표는 도착체크 링크 열쇠로 열립니다. 이 학기의 켜진 링크 하나를 찾아 둡니다.
  const { data: mobileLink } = await supabase
    .from("shuttle_arrival_links")
    .select("token")
    .eq("term", term)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-lg font-bold">📋 하원 체크표</h1>
        {/* 업무보드에서 한 번에 왔으면 한 번에 돌아갈 수 있어야 합니다.
            오는 길만 있고 가는 길이 없으면, 사람은 결국 뒤로가기를 누르거나 메뉴를 다시 찾습니다. */}
        <Link
          href="/work"
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 print:hidden"
        >
          ← 업무보드
        </Link>
        <GuideButton className="print:hidden flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[12px] font-bold text-slate-600 transition hover:bg-black/10" title="하원 체크표 사용 가이드" sections={GUIDE_SECTIONS} />
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Link
            href="/shuttle/checklist?term=정규학기"
            className={"rounded-lg px-2.5 py-1 " + (term === "정규학기" ? "bg-gia-navy text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")}
          >
            정규학기
          </Link>
          <Link
            href="/shuttle/checklist?term=여름캠프2"
            className={"rounded-lg px-2.5 py-1 " + (term === "여름캠프2" ? "bg-amber-500 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")}
          >
            여름캠프2
          </Link>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500 print:hidden">
        오늘 하원 차량별 학생 명단입니다. 부모님이 직접 데리러 오셔서 셔틀을 타지 않는 학생은 🚗(픽업), 결석한 학생은
        🚫(결석)을 눌러주세요 - 다시 누르면 취소됩니다. 다른 차를 타야 하는 학생은 이름을 눌러 원하는 노선 칸으로 끌어다
        놓고, 계속 유지할지 오늘만 바꿀지 골라주세요.
      </p>
      <p className="mb-2 hidden text-sm font-bold print:block">GIA 하원 체크표 · {today}</p>
      <ChecklistMemoPanel
        term={term}
        today={today}
        actorName={me.name ?? me.email}
        mobileToken={(mobileLink?.token as string | undefined) ?? null}
      />
      <ShuttleChecklistClient
        routes={routes}
        items={items}
        roster={roster}
        initialMessages={messages}
        term={term}
        persistentNotes={persistentNotes}
        toddleBase={toddleBase}
        actor={{ email: me.email, name: me.name }}
        // 차번호는 노선 마스터 자료입니다. 판정은 @/lib/roles 한 곳에서 하고, 화면은
        // 결과만 받습니다 - 화면이 직위 글자를 다시 비교하면 기준이 둘로 갈립니다.
        canEditVehicle={isStaffOrAboveUser(me)}
        initialLog={activityLog}
        rideAlongs={rideAlongs}
      />
    </div>
  );
}
