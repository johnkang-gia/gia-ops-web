import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { scanIntoEntries, type ScanSource } from "@/lib/attendanceEntries";
import { todayKey, type LearningRule, type RosterStudent } from "@/lib/attendanceDigest";

// 업무보드 인박스가 쓰는 출결 등록 창구입니다.
//
// GET  : 최근 메시지를 훑어 attendance_entries를 채우고(없는 것만), 목록을 돌려줍니다.
// PATCH: 사람이 등록/해제/무시로 상태를 바꿉니다.
//
// 담당자 요청: "지금 매번 확인을 하고 지워야 해서 왔다갔다 엄청 해서 힘들어."
// 그래서 셔틀 화면으로 넘어가지 않고 업무보드 안에서 끝나도록 만들었습니다.

export const dynamic = "force-dynamic";

const SCAN_DAYS = 14;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  // 로그인 확인은 사용자 클라이언트로, 실제 조회는 서비스 롤로 합니다.
  // 구글챗 미러는 RLS가 닫혀 있어 사용자 토큰으로는 읽을 수 없습니다.
  const userDb = await createClient();
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = serviceClient();
  if (!db) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });

  const now = new Date();
  const since = new Date(now.getTime() - SCAN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: students }, { data: rules }, { data: mirror }, { data: reqs }] = await Promise.all([
    db.from("wr_students").select("id, name, name_en, grade, class_name, birth_date").eq("status", "active").eq("is_demo", false),
    db.from("attendance_learning_rules").select("kind, pattern, student_name, category"),
    db
      .from("google_chat_mirror_messages")
      .select("id, content, created_at_google")
      .eq("source_key", "attendance")
      .gte("created_at_google", since)
      .order("created_at_google", { ascending: false })
      .limit(300),
    db
      .from("pickup_requests")
      .select("id, raw_text, summary, received_at, student_id, is_demo")
      .neq("status", "무시")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(300),
  ]);

  const roster = (students ?? []).map((s) => ({
    id: s.id as string,
    name: (s.name as string) ?? "",
    grade: (s.grade as string | null) ?? null,
    nameEn: (s.name_en as string | null) ?? null,
    birthDate: (s.birth_date as string | null) ?? null,
    className: (s.class_name as string | null) ?? null,
  })) as (RosterStudent & { id: string; className: string | null })[];

  const messages: ScanSource[] = [
    ...(mirror ?? []).map((m) => ({
      source: "googlechat" as const,
      messageId: String(m.id),
      text: (m.content as string | null) ?? "",
      sentAt: new Date(m.created_at_google as string),
    })),
    ...(reqs ?? [])
      .filter((r) => !r.is_demo)
      .map((r) => ({
        source: "toddle" as const,
        messageId: String(r.id),
        text: ((r.raw_text as string | null) ?? (r.summary as string | null) ?? "").toString(),
        sentAt: new Date((r.received_at as string) ?? Date.now()),
        studentId: (r.student_id as string | null) ?? null,
      })),
  ];

  const scan = await scanIntoEntries(db, messages, roster, (rules ?? []) as LearningRule[]);

  // 목록은 오늘 이후로 아직 살아 있는 것 + 확인이 필요한 것.
  // 지난 건은 인박스에 남겨봐야 손댈 일이 없어 걷어냅니다.
  const today = todayKey(now);
  const { data: entries } = await db
    .from("attendance_entries")
    .select("*")
    .gte("date_to", today)
    .neq("state", "무시")
    .order("date_from", { ascending: true })
    .limit(300);

  return NextResponse.json(
    { ok: true, scan, today, entries: entries ?? [] },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}

export async function PATCH(req: NextRequest) {
  const userDb = await createClient();
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    state?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    note?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const db = serviceClient();
  if (!db) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });

  const patch: Record<string, unknown> = {
    // 사람이 손댄 표시. 이게 켜지면 자동 스캔이 다시는 이 줄을 건드리지 않습니다.
    // "지웠는데 되살아난다"를 막는 자리입니다.
    touched_by_human: true,
  };
  if (body.state) {
    patch.state = body.state;
    patch.registered_at = body.state === "등록" ? new Date().toISOString() : null;
    patch.registered_by = body.state === "등록" ? (auth.user.email ?? null) : null;
    if (body.state === "등록") patch.reason = null; // 사람이 확인했으니 물음표를 지웁니다.
  }
  if (body.status) patch.status = body.status;
  if (body.dateFrom) patch.date_from = body.dateFrom;
  if (body.dateTo) patch.date_to = body.dateTo;
  if (body.note !== undefined) patch.note = body.note;

  const { data, error } = await db.from("attendance_entries").update(patch).eq("id", body.id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, entry: data });
}
