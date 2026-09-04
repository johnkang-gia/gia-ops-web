import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { scanIntoEntries, type ScanSource } from "@/lib/attendanceEntries";
import { buildStaffNames, todayKey, type LearningRule, type RosterStudent } from "@/lib/attendanceDigest";

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

// 'YYYY-MM-DD'에 며칠을 더하거나 뺍니다.
function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

  const [{ data: students }, { data: rules }, { data: staffRows }, { data: mirror }, { data: reqs }] = await Promise.all([
    db.from("wr_students").select("id, name, name_en, grade, class_name, birth_date").eq("status", "active").eq("is_demo", false),
    db.from("attendance_learning_rules").select("kind, pattern, student_name, category"),
    // 멘션을 지울 때 쓸 교직원 성함(세 낱말짜리 성함 대응).
    db.from("app_users").select("name, email").limit(500),
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

  const staffNames = buildStaffNames((staffRows as { name: string | null; email: string | null }[] | null) ?? []);

  const scan = await scanIntoEntries(db, messages, roster, (rules ?? []) as LearningRule[], staffNames);

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

  // 사람이 "출결 아님"으로 내린 것들의 키.
  //
  // 위 entries에서는 무시를 빼고 있어서, 화면은 그 항목을 "아직 등록 안 된 것"으로 오해하고
  // 계속 목록에 띄웁니다. 내린 것은 목록에서도 사라져야 하므로 키만 따로 실어 보냅니다.
  const { data: ignored } = await db
    .from("attendance_entries")
    .select("source_message_id, student_name, status")
    .eq("state", "무시")
    .gte("date_to", addDaysKey(today, -30));
  const dismissed = ((ignored as { source_message_id: string | null; student_name: string; status: string }[] | null) ?? [])
    .filter((r) => r.source_message_id)
    .map((r) => `${r.source_message_id}|${r.student_name}|${r.status}`);

  return NextResponse.json(
    { ok: true, scan, today, entries: entries ?? [], dismissed, staffNames },
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
    // 아직 등록 대상으로 잡히지 않은 항목(⬜)을 내릴 때 씁니다. id 대신 이 셋을 보냅니다.
    dismissKey?: { messageId: string; studentName: string; status: string; date?: string };
    // **오늘만 이 아이로.** 규칙을 만들지 않고 이 한 건만 사람이 정합니다.
    assign?: {
      messageId: string;
      /** 화면에 잘못 떠 있던 이름. 이 줄은 내려서 두 번 집계되지 않게 합니다. */
      fromName: string;
      status: string;
      dateFrom?: string;
      dateTo?: string;
      studentId: string;
      studentName: string;
    };
  };

  const db = serviceClient();
  if (!db) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });

  // ── 키로 내리기 ───────────────────────────────────────────────────────────
  //
  // 담당자: "'픽업'이 들어갔지만 픽업에 관한 글이 아닌 것 - 계속 픽업으로 집계돼."
  //
  // 이런 항목은 학생 대조에 실패해 등록 대상으로도 안 잡히는 경우가 있습니다(⬜). 그러면
  // 고칠 줄 자체가 없어서 아무것도 못 합니다. 그래서 줄을 새로 만들면서 곧바로 '무시'로
  // 둡니다 - "이 메시지의 이 항목은 출결이 아니다"라는 사실을 남기는 것입니다.
  if (!body.id && body.dismissKey) {
    const k = body.dismissKey;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(k.date ?? "") ? k.date! : todayKey(new Date());

    // 학생을 찾을 수 있으면 채워둡니다(나중에 "누구 것을 내렸는지" 되짚을 수 있도록).
    // 못 찾아도 그대로 진행합니다 - 내려야 하는 것들은 애초에 학생을 못 찾은 것들이라,
    // 여기서 막으면 가장 지워야 할 것을 가장 지울 수 없게 됩니다.
    const bare = k.studentName.replace(/\(.*$/, "").trim();
    let studentId: string | null = null;
    if (bare.length >= 2) {
      const { data: hit } = await db.from("wr_students").select("id").eq("is_demo", false).eq("status", "active").eq("name", bare).limit(2);
      const rows = (hit as { id: string }[] | null) ?? [];
      if (rows.length === 1) studentId = rows[0].id; // 동명이인이면 비워둡니다(엉뚱한 아이에 붙는 것이 더 나쁩니다).
    }

    const { error } = await db.from("attendance_entries").upsert(
      {
        source: "googlechat",
        source_message_id: k.messageId,
        student_id: studentId,
        student_name: k.studentName,
        status: k.status,
        date_from: day,
        date_to: day,
        state: "무시",
        touched_by_human: true,
        note: "사람이 출결이 아니라고 표시",
      },
      { onConflict: "source,source_message_id,student_name,status" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, dismissed: true });
  }

  // ── 오늘만 이 아이로 ──────────────────────────────────────────────────────
  //
  // "Vivian, Sophia pick up today" 처럼 이름 하나가 여러 아이를 가리킬 수 있습니다. 학교에
  // Sophia 가 둘이면 자동은 누구인지 정할 수 없습니다.
  //
  // 지금까지는 여기서 «가르치기»밖에 없었습니다. 그런데 가르치기는 **앞으로 모든 Sophia 를
  // 그 아이로** 만드는 일입니다. 오늘의 Sophia 가 소피아 민이라고 해서 다음 주 Sophia 도
  // 그 아이인 것은 아닙니다. 한 번 가르치면 그 뒤로는 틀려도 아무도 모르게 지나갑니다.
  //
  // 그래서 이 한 건만 정하는 길을 둡니다. 규칙은 만들지 않습니다.
  if (!body.id && body.assign) {
    const a = body.assign;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(a.dateFrom ?? "") ? a.dateFrom! : todayKey(new Date());
    const dayTo = /^\d{4}-\d{2}-\d{2}$/.test(a.dateTo ?? "") ? a.dateTo! : day;

    // ① 잘못 읽힌 이름으로 잡혀 있던 줄을 내립니다. 안 내리면 같은 연락이 두 아이로
    //    집계되어, 오지도 않은 아이가 결석 명단에 남습니다.
    if (a.fromName && a.fromName !== a.studentName) {
      const { error: offErr } = await db.from("attendance_entries").upsert(
        {
          source: "googlechat",
          source_message_id: a.messageId,
          student_name: a.fromName,
          status: a.status,
          date_from: day,
          date_to: dayTo,
          state: "무시",
          touched_by_human: true,
          note: `사람이 ${a.studentName} 으로 지정해 이 줄은 내림`,
        },
        { onConflict: "source,source_message_id,student_name,status" }
      );
      if (offErr) return NextResponse.json({ error: offErr.message }, { status: 500 });
    }

    // ② 고른 아이로 등록합니다.
    const { error } = await db.from("attendance_entries").upsert(
      {
        source: "googlechat",
        source_message_id: a.messageId,
        student_id: a.studentId,
        student_name: a.studentName,
        status: a.status,
        date_from: day,
        date_to: dayTo,
        state: "등록",
        touched_by_human: true,
        registered_at: new Date().toISOString(),
        registered_by: auth.user.email ?? null,
        reason: null,
        note: "이 건만 사람이 지정(규칙 없음)",
      },
      { onConflict: "source,source_message_id,student_name,status" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, assigned: true });
  }

  if (!body.id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

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
