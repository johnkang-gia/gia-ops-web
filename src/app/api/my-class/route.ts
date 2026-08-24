import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { toKoreanDisplayName, type RosterEntry } from "@/lib/pickupParse";

export const dynamic = "force-dynamic";

// 교사 자기반 대시보드용 데이터입니다(요청: "자기반 아이들 어머님께서 문의하신 사항을 띄울 수
// 있게 (...) 픽업의 경우 시간을 명시한경우 (...) 누가 몇시에 픽업인지").
//
// 로그인한 교사 본인만 자기 반 것을 봅니다. pickup_requests에는 문의를 받을 때 그 학생의 담임
// 이메일(homeroom_email)을 함께 적어두므로, 담임 이메일로 걸러 이 선생님 반의 문의·픽업만
// 골라냅니다. 조회는 service role로 하되(교사는 pickup_requests 직접 열람 권한이 없을 수 있어서),
// 반드시 로그인 사용자의 이메일로만 좁혀 다른 반 문의가 새지 않게 합니다. 데모 계정(gia-demo…)은
// 데모 문의(is_demo=true)만, 실제 교사는 실제 문의만 봅니다.
export async function GET() {
  const me = await getCurrentAppUser();
  if (!me?.email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const email = me.email;
  const demo = isDemoAccount(email);
  const today = new Date().toISOString().slice(0, 10);

  // 내 담임/부담임 반(머리말 표시용).
  const { data: classes } = await supabase
    .from("wr_classes")
    .select("grade, class_name, teacher_email, sub_teacher_email, is_demo")
    .or(`teacher_email.eq.${email},sub_teacher_email.eq.${email}`)
    .eq("is_demo", demo);
  const classLabel = (classes ?? [])
    .map((c) => `${c.grade ?? ""}학년 ${c.class_name ?? ""}반`.trim())
    .join(" · ");

  // 이름 한글화용 명부(데모/실제 분리).
  const { data: roster } = await supabase
    .from("wr_students")
    .select("id, name, name_en, grade")
    .eq("status", "active")
    .eq("is_demo", demo);
  const nameRoster: RosterEntry[] = (roster ?? []).map((s) => ({
    id: s.id as string,
    name: (s.name as string) ?? "",
    name_en: (s.name_en as string | null) ?? null,
    grade: (s.grade as string | null) ?? null,
  }));

  // 내 반 문의·픽업. 최근 7일, '무시'(취소/오분류) 제외.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabase
    .from("pickup_requests")
    .select("*")
    .eq("homeroom_email", email)
    .eq("is_demo", demo)
    .neq("status", "무시")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(80);

  const display = (r: Record<string, unknown>) =>
    toKoreanDisplayName(
      (r.matched_name as string | null) ?? (r.ai_student_name as string | null),
      r.channel_label as string | null,
      nameRoster
    ) ??
    (r.matched_name as string | null) ??
    (r.ai_student_name as string | null) ??
    "미확인";

  // 오늘 픽업(시각 명시 우선). 요청: "누가 몇시에 픽업인지 알려줄 수 있는".
  const pickups = (rows ?? [])
    .filter((r) => r.kind === "픽업" && (r.service_date as string | null) === today)
    .map((r) => ({
      id: r.id as string,
      student: display(r),
      time: (r.ai_pickup_time as string | null) ?? null,
      note: (r.summary as string | null) ?? (r.ai_note as string | null) ?? null,
      urgent: r.urgency === "높음",
    }))
    // 시각이 있는 픽업을 먼저, 그 안에서는 이른 시각 순으로.
    .sort((a, b) => {
      if (!!a.time !== !!b.time) return a.time ? -1 : 1;
      return (a.time ?? "").localeCompare(b.time ?? "");
    });

  // 우리 반 문의(픽업이 아닌 것). 답하지 않은 것을 위로.
  const inquiries = (rows ?? [])
    .filter((r) => r.kind !== "픽업")
    .map((r) => ({
      id: r.id as string,
      student: display(r),
      type: (r.inquiry_type as string | null) ?? null,
      summary: (r.summary as string | null) ?? "",
      urgent: r.urgency === "높음",
      at: r.received_at as string,
      answered: !!r.answered_at,
      url: (r.source_url as string | null) ?? null,
      raw: (r.raw_text as string | null) ?? (r.summary as string | null) ?? null,
    }))
    .sort((a, b) => {
      if (a.answered !== b.answered) return a.answered ? 1 : -1; // 미답변 먼저
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1; // 급한 것 먼저
      return b.at.localeCompare(a.at); // 최신 먼저
    });

  return NextResponse.json({
    teacherName: me.name ?? null,
    classLabel: classLabel || (demo ? "데모 담임반" : null),
    demo,
    pickups,
    inquiries,
  });
}
