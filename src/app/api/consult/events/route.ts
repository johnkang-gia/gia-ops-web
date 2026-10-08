import { NextResponse } from "next/server";
import { consultSession, newShortCode, staffOnly } from "@/lib/consult/access";
import { EVENT_COLUMNS } from "@/lib/consult/server";
import { isDemoAccount } from "@/lib/sharedAccounts";

export const dynamic = "force-dynamic";

/** 상담 행사 목록 — 선생님도 봅니다(진행 중인 행사의 자기 상담실을 찾으려고). */
export async function GET() {
  const s = await consultSession();
  if (!s.ok) return s.res;
  const { data, error } = await s.supabase
    .from("consult_events")
    .select(EVENT_COLUMNS)
    .eq("is_demo", isDemoAccount(s.me.email))
    .order("event_date", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

/** 새 상담 행사. 상담실과 명단은 만든 뒤 행사 화면에서 넣습니다. */
export async function POST(req: Request) {
  const s = await consultSession();
  if (!s.ok) return s.res;
  if (!s.staff) return staffOnly();

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    event_date?: string | null;
    end_date?: string | null;
    copy_rooms_from?: string | null;
  };
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "행사 이름을 적어 주세요." }, { status: 400 });

  // 짧은 주소가 겹치면(극히 드뭅니다) 한 번 더 뽑습니다.
  let inserted: { id: string } | null = null;
  let lastError = "";
  for (let i = 0; i < 3 && !inserted; i += 1) {
    const { data, error } = await s.supabase
      .from("consult_events")
      .insert({
        name,
        event_date: body.event_date || null,
        end_date: body.end_date || null,
        board_short_code: newShortCode(),
        is_demo: isDemoAccount(s.me.email),
        created_by: s.me.email,
      })
      .select("id")
      .single();
    if (data) inserted = data as { id: string };
    else lastError = error?.message ?? "알 수 없는 이유";
  }
  if (!inserted) return NextResponse.json({ error: `행사를 만들지 못했습니다: ${lastError}` }, { status: 500 });

  // 지난 행사의 상담실을 그대로 가져올 수 있습니다 - 학기마다 같은 교실·같은 선생님이 대부분입니다.
  if (body.copy_rooms_from) {
    const { data: rooms, error } = await s.supabase
      .from("consult_rooms")
      .select("name, teacher_email, teacher_name, grade_label, sort_order")
      .eq("event_id", body.copy_rooms_from);
    if (error) return NextResponse.json({ id: inserted.id, warning: `상담실을 가져오지 못했습니다: ${error.message}` });
    if (rooms && rooms.length) {
      const { error: insErr } = await s.supabase
        .from("consult_rooms")
        .insert((rooms as Record<string, unknown>[]).map((r) => ({ ...r, event_id: inserted!.id })));
      if (insErr) return NextResponse.json({ id: inserted.id, warning: `상담실을 가져오지 못했습니다: ${insErr.message}` });
    }
  }
  return NextResponse.json({ id: inserted.id });
}
