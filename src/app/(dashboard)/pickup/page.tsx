import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import PickupCheckClient, { type PickupClassGroup, type PickupItem } from "@/components/pickup/PickupCheckClient";
import GuideButton from "@/components/common/GuideButton";
import TeacherTabs from "@/components/teacher/TeacherTabs";
import { getLang } from "@/lib/langServer";
import { makeT, type T } from "@/lib/lang";
import { classLabel } from "@/lib/i18nLabels";
import { isDemoAccount } from "@/lib/sharedAccounts";

// 사용 가이드도 화면 언어를 따라갑니다. 안내문은 문장이 길어서 한글·영어를 함께 적으면
// 모달이 두 배로 길어지고, 정작 자기 언어 문장을 찾느라 눈이 왔다 갔다 하게 됩니다.
function guideSections(t: T) {
  return [
    {
      title: t("🚗 내 반 픽업 체크란?", "🚗 What is this page?"),
      lines: [
        t(
          '학부모님께 전화나 문자로 "오늘은 제가 데리러 갑니다"라고 연락을 받으셨을 때, 담임 선생님이 직접 체크하는 화면입니다.',
          "When a parent calls or texts to say they will collect their child today, the homeroom teacher marks it here."
        ),
        t(
          "체크하면 하원 체크표·안내보드·차량 도착체크에 곧바로 반영되어, 그 학생은 셔틀 명단에서 빠지고 기사님·동승선생님이 기다리지 않습니다.",
          "The change appears immediately on the dismissal sheet, the lobby board and the vehicle check screen, so the student is removed from the shuttle list and nobody waits for them."
        ),
        t(
          "지금은 구글챗에 올라온 글을 자동으로 걸러 픽업을 반영하는 기존 방식과 함께 돌아갑니다. 구글챗으로도 알리셨다면 여기서 따로 누르지 않으셔도 되고, 눌러도 같은 결과라 문제없습니다.",
          "This runs alongside the existing method, where pickups posted in Google Chat are picked up automatically. If you already posted there you do not need to mark it here, and marking it anyway does no harm."
        ),
        t(
          "내 담임반 학생만 보입니다. 과목만 맡고 계신 선생님께는 이 메뉴가 보이지 않습니다.",
          "Only your homeroom students are shown. Teachers who only teach subjects do not see this menu."
        ),
      ],
    },
    {
      title: t("✅ 사용 방법", "✅ How to use it"),
      lines: [
        t(
          "학생 이름 옆의 [픽업]을 누르면 픽업으로 바뀌고, 한 번 더 누르면 원래대로 돌아갑니다.",
          "Tap [Pickup] next to a student to mark them, and tap again to undo."
        ),
        t(
          "[결석]은 그 학생이 오늘 등교하지 않은 경우입니다. 하원 차량과 무관하게 명단에서 빠집니다.",
          "[Absent] is for a student who did not come to school today. They are removed from the list regardless of the shuttle."
        ),
        t(
          "셔틀을 타지 않는 학생은 회색으로 표시되고 체크할 항목이 없습니다.",
          "Students who do not ride the shuttle are greyed out and have nothing to check."
        ),
        t(
          "잘못 눌렀으면 다시 눌러 되돌리면 됩니다. 하루가 지나면 자동으로 초기화됩니다.",
          "If you tap by mistake, tap again to undo. Everything resets automatically the next day."
        ),
      ],
    },
  ];
}

export const dynamic = "force-dynamic";

// 요청: "교사가 전화나, 다른 메세지로 픽업을 받은 경우, 체크를 할 수 있도록... 담임교사는 자기
// 반만 보이고, 과목교사선생님은 보이지 않도록"
//
// 담임(또는 부담임)으로 배정된 반이 있는 사람만 들어올 수 있고, 그 반 학생만 보입니다.
// 픽업 체크는 하원 체크표와 같은 곳(shuttle_boardings)에 저장되어 안내보드·도착체크·하원
// 운행 화면에 그대로 반영됩니다.
export default async function PickupPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const lang = await getLang();
  const t = makeT(lang);
  // 오리엔테이션 계정은 실제 하원 노선 대신 연습용 '데모' 노선을 봅니다. 셔틀 표들은 이미
  // term으로 나뉘어 있어서, 여기 한 줄만 바꾸면 나머지 조회는 그대로 두고도 실제 운행 데이터와
  // 완전히 분리됩니다(학생 명단 쪽은 DB 보안규칙이 알아서 데모 학생만 돌려줍니다).
  const shuttleTerm = isDemoAccount(me.email) ? "데모" : "정규학기";
  const supabase = await createClient();

  // 내가 담임 또는 부담임인 반. 하나도 없으면 이 화면을 쓸 일이 없습니다(과목 교사 등).
  const { data: classesData } = await supabase
    .from("wr_classes")
    .select("id, grade, class_name")
    .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`);
  const myClasses = classesData ?? [];

  if (myClasses.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-lg font-semibold text-slate-700">
          {t("담임으로 배정된 반이 없습니다.", "No homeroom class is assigned to you.")}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          {t(
            "이 화면은 담임 선생님이 자기 반 학생의 하원 픽업을 체크하는 곳입니다. 배정이 필요하시면 행정실에 문의해주세요.",
            "This page is for homeroom teachers to mark student pickups. Please contact the office if you need to be assigned."
          )}
        </p>
      </div>
    );
  }

  // 내 반 학생(공용 명부 - 보호자 연락처 등 개인정보는 빠져 있습니다).
  const classIds = myClasses.map((c) => c.id);
  const gradeClassPairs = myClasses.map((c) => `${c.grade ?? ""}|${c.class_name ?? ""}`);
  const { data: studentsData } = await supabase
    .from("wr_students_basic")
    .select("id, name, name_en, grade, class_name, class_id")
    .eq("status", "active")
    .order("name");
  // class_id가 아직 안 채워진 학생도 있어서 학년+반 이름으로도 한 번 더 걸러 붙입니다.
  const myStudents = (studentsData ?? []).filter(
    (s) =>
      (s.class_id && classIds.includes(s.class_id)) ||
      gradeClassPairs.includes(`${s.grade ?? ""}|${s.class_name ?? ""}`)
  );

  // 오늘 이 학생들이 타는 하원 셔틀 배정을 이름으로 찾아 붙입니다(배정표에는 학번이 없고
  // PDF 표기 그대로의 이름이 들어 있어서, 명부 이름과 맞춰봅니다).
  const todayWeekday = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);

  const { data: routesData } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", shuttleTerm);
  const routeIds = (routesData ?? []).map((r) => r.id);
  const routeById = new Map((routesData ?? []).map((r) => [r.id, r]));

  const { data: stopsData } = routeIds.length
    ? await supabase.from("shuttle_stops").select("id, route_id").in("route_id", routeIds)
    : { data: [] as { id: string; route_id: string }[] };
  const stopRouteById = new Map((stopsData ?? []).map((s) => [s.id, s.route_id]));
  const stopIds = (stopsData ?? []).map((s) => s.id);

  const { data: assignmentsData } = stopIds.length
    ? await supabase
        .from("shuttle_assignments_basic")
        .select("id, stop_id, student_name_raw, weekdays, override_route_id")
        .in("stop_id", stopIds)
    : { data: [] as { id: string; stop_id: string; student_name_raw: string; weekdays: number[]; override_route_id: string | null }[] };
  const todayAssignments = (assignmentsData ?? []).filter((a) => (a.weekdays as number[]).includes(todayWeekday));

  const { data: boardingsData } = todayAssignments.length
    ? await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status, override_route_id")
        .eq("service_date", today)
        .in("assignment_id", todayAssignments.map((a) => a.id))
    : { data: [] as { assignment_id: string; status: string; override_route_id: string | null }[] };
  const boardingByAssignment = new Map((boardingsData ?? []).map((b) => [b.assignment_id, b]));

  // 배정표 이름은 "김연우A"처럼 뒤에 표기가 붙거나 괄호 영문이 섞일 수 있어서, 비교할 때만
  // 괄호·공백을 떼고 맞춰봅니다.
  function normalize(name: string) {
    return name.split("(")[0].replace(/\s+/g, "").trim();
  }
  const assignmentByName = new Map<string, (typeof todayAssignments)[number]>();
  for (const a of todayAssignments) {
    const key = normalize(a.student_name_raw);
    if (!assignmentByName.has(key)) assignmentByName.set(key, a);
  }

  const groups: PickupClassGroup[] = myClasses
    .map((c) => {
      const students = myStudents.filter(
        (s) => (s.class_id && s.class_id === c.id) || (`${s.grade ?? ""}|${s.class_name ?? ""}` === `${c.grade ?? ""}|${c.class_name ?? ""}`)
      );
      const items: PickupItem[] = students.map((s) => {
        const a = assignmentByName.get(normalize(s.name));
        const b = a ? boardingByAssignment.get(a.id) : undefined;
        const baseRouteId = a ? stopRouteById.get(a.stop_id) ?? null : null;
        const routeId = (b?.override_route_id ?? a?.override_route_id ?? baseRouteId) ?? null;
        const route = routeId ? routeById.get(routeId) : null;
        return {
          studentId: s.id,
          name: s.name,
          nameEn: s.name_en,
          assignmentId: a?.id ?? null,
          routeLabel: route ? `${route.route_no}호` : null,
          status: (b?.status as PickupItem["status"]) ?? "예정",
        };
      });
      return {
        classId: c.id,
        label: classLabel(c.grade, c.class_name, lang),
        items,
      };
    })
    .filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <TeacherTabs isHomeroom />
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🚗 {t("내 반 픽업 체크", "My Class Pickup Check")}</h1>
        <GuideButton title={t("픽업 체크 사용 가이드", "Pickup check guide")} sections={guideSections(t)} />
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        {t(
          "학부모님께 직접 연락받은 픽업을 여기서 체크해주세요. 누르는 즉시 하원 체크표·안내보드·차량 도착체크에 반영됩니다. 구글챗으로 올라온 픽업은 지금처럼 자동으로도 반영되니, 두 방법을 함께 쓰셔도 됩니다.",
          "Mark pickups you were told about directly by a parent. Changes apply instantly to the shuttle boards. Pickups posted in Google Chat are still picked up automatically, so you can use either way."
        )}
      </p>
      <PickupCheckClient groups={groups} today={today} />
    </div>
  );
}
