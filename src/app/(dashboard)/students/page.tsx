import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { WrStudent } from "@/lib/types";
import StudentSearchClient from "@/components/students/StudentSearchClient";
import GuideButton from "@/components/common/GuideButton";
import { CURRENT_SHUTTLE_TERM } from "@/lib/shuttleTerm";

const GUIDE_SECTIONS = [
  {
    title: "🔍 학생 정보 조회란?",
    lines: [
      "학교 전체 재학생을 이름/학번으로 검색해 인적사항·학적사항을 확인합니다.",
      "업무·사건기록·주간 학생 관찰기록 등 그 학생과 관련된 기록도 한 화면에서 함께 볼 수 있습니다.",
    ],
  },
  {
    title: "👀 접근 권한",
    lines: ["관리자·행정직원만 접근할 수 있습니다. 교사는 자신이 맡은 학생의 위클리 리포트만 볼 수 있습니다."],
  },
];

export const dynamic = "force-dynamic";

// 행정직원/관리자(+개발자)만 접근 가능합니다 - 교사는 자기 담당 학생의 위클리 리포트만 보고,
// 여기서는 학교 전체 학생의 사건기록·업무언급까지 한 번에 볼 수 있어 접근을 좁혀둡니다.
export default async function StudentsSearchPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  if (!isStaffOrAboveUser(me)) {
    redirect("/home");
  }

  // "재적" 학생만 보이던 것을, 검색이 안 된다는 문의에 맞춰 전체 학생(비재적 포함)으로 넓혔습니다.
  // 비재적 학생은 프로필 화면 상단 뱃지로 구분됩니다.
  const { data } = await supabase
    .from("wr_students")
    .select(
      "id, student_no, name, name_en, grade, class_name, class_id, birth_date, phone, parent_phone, parent_email, gender, allergies, address, note, custom_fields, status, shuttle_mode, photo_path, created_at"
    )
    .order("name", { ascending: true });

  // 셔틀 타는 아이 표시(요청 ⑨: "학생명부에도 셔틀여부로 체크되도록").
  //
  // 명부의 shuttle_mode는 **손으로 적는 값**이고, 실제로 차에 배정됐는지는 별개입니다.
  // 그래서 여기서는 명부값이 아니라 **실제 배정**을 봅니다 - 명부에 "하원"이라 적혀 있어도
  // 배정이 없으면 그 아이는 아무 차에도 안 탑니다. 둘이 어긋나는 것이 실제로 사고가 나는
  // 지점이라, 어긋나면 화면에서 알려줍니다.
  const [{ data: routeRows }, { data: stopRows }, { data: asgRows }] = await Promise.all([
    supabase.from("shuttle_routes").select("id, route_no, direction").eq("term", CURRENT_SHUTTLE_TERM).eq("active", true),
    supabase.from("shuttle_stops").select("id, route_id"),
    supabase.from("shuttle_assignments").select("student_id, stop_id").not("student_id", "is", null).limit(5000),
  ]);
  const routeById = new Map(
    ((routeRows ?? []) as { id: string; route_no: string; direction: string }[]).map((r) => [r.id, r])
  );
  const routeOfStop = new Map(((stopRows ?? []) as { id: string; route_id: string }[]).map((s) => [s.id, s.route_id]));
  const shuttleByStudent: Record<string, string> = {};
  for (const a of (asgRows ?? []) as { student_id: string; stop_id: string }[]) {
    const r = routeById.get(routeOfStop.get(a.stop_id) ?? "");
    if (!r) continue; // 지난 학기·꺼둔 노선의 배정은 세지 않습니다.
    const prev = shuttleByStudent[a.student_id] ?? "";
    const tag = `${r.direction} ${r.route_no}호`;
    shuttleByStudent[a.student_id] = prev ? (prev.includes(tag) ? prev : `${prev} · ${tag}`) : tag;
  }

  // 사진은 비공개 버킷이라 서명 주소가 필요합니다. **한 번에 묶어서** 받습니다 - 한 명씩
  // 받으면 137번을 부르게 되고, 목록이 그만큼 늦게 뜹니다.
  const photoPaths = ((data as WrStudent[] | null) ?? []).map((s) => s.photo_path).filter((v): v is string => !!v);
  const photoUrlByPath: Record<string, string> = {};
  if (photoPaths.length > 0) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("student-photos")
      .createSignedUrls(photoPaths, 60 * 60);
    if (signErr) console.error("[학생 조회] 사진 주소를 못 만들었습니다:", signErr.message);
    for (const r of signed ?? []) if (r.path && r.signedUrl) photoUrlByPath[r.path] = r.signedUrl;
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">🎓 학생 조회</h1>
          <span className="ml-auto flex items-center gap-2">
            <a href="/students/photos" className="rounded-lg border border-slate-300 px-2.5 py-1 text-[12px] font-bold text-slate-700 hover:bg-slate-50">
              📸 사진 등록
            </a>
            <GuideButton title="학생 정보 조회 사용 가이드" sections={GUIDE_SECTIONS} />
          </span>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          재학·졸업·퇴학 탭으로 나눠 봅니다. 같은 학생은 항상 같은 학번(고유번호)으로 관리되며, 카드를 누르면 통합
          프로필로 이동합니다.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <StudentSearchClient
          students={(data as WrStudent[] | null) ?? []}
          shuttleByStudent={shuttleByStudent}
          photoUrlByPath={photoUrlByPath}
        />
      </div>
    </div>
  );
}
