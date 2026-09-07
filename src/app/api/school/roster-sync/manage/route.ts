import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { applyRosterPlans, type RosterPlan } from "@/lib/rosterPlan";
import type { RosterField } from "@/lib/pasteRoster";

/** 구글시트 연결 관리와 대기함 처리. 사람이 로그인해서 쓰는 쪽입니다. */

export const dynamic = "force-dynamic";

type InboxRow = {
  id: string;
  name: string;
  kind: RosterPlan["kind"];
  reason: string | null;
  changes: RosterPlan["changes"];
  values: Partial<Record<RosterField, string>>;
  student_id: string | null;
  created_at: string;
};

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 필요합니다." }, { status: 403 });

  const supabase = await createClient();
  const [links, inbox] = await Promise.all([
    supabase.from("roster_sync_links").select("*").order("created_at"),
    supabase.from("roster_sync_inbox").select("*").eq("status", "대기").order("created_at"),
  ]);
  if (links.error) return NextResponse.json({ error: links.error.message }, { status: 500 });
  if (inbox.error) return NextResponse.json({ error: inbox.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, links: links.data ?? [], inbox: inbox.data ?? [] });
}

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const supabase = await createClient();

  // ── 연결 만들기 / 토큰 재발급 / 끄고 켜기 ────────────────────────────────
  if (action === "create") {
    const { data, error } = await supabase
      .from("roster_sync_links")
      .insert({ label: String(body?.label ?? "구글시트 명부"), token: newToken(), created_by: me.email })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, link: data });
  }

  if (action === "rotate") {
    const { data, error } = await supabase
      .from("roster_sync_links")
      .update({ token: newToken(), last_error: null })
      .eq("id", String(body?.id ?? ""))
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, link: data });
  }

  if (action === "toggle") {
    const { error } = await supabase
      .from("roster_sync_links")
      .update({ enabled: body?.enabled === true })
      .eq("id", String(body?.id ?? ""));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const { error } = await supabase.from("roster_sync_links").delete().eq("id", String(body?.id ?? ""));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── 대기함 처리 ─────────────────────────────────────────────────────────
  const ids = (body?.ids as string[] | undefined) ?? [];
  if (ids.length === 0) return NextResponse.json({ error: "고른 줄이 없습니다." }, { status: 400 });

  const { data: picked, error: pickErr } = await supabase
    .from("roster_sync_inbox")
    .select("*")
    .in("id", ids)
    .eq("status", "대기");
  if (pickErr) return NextResponse.json({ error: pickErr.message }, { status: 500 });
  const rows = (picked ?? []) as InboxRow[];
  if (rows.length === 0) return NextResponse.json({ error: "이미 처리된 줄입니다." }, { status: 400 });

  if (action === "ignore") {
    const { error } = await supabase
      .from("roster_sync_inbox")
      .update({ status: "무시", decided_at: new Date().toISOString(), decided_by: me.email })
      .in("id", rows.map((r) => r.id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ignored: rows.length });
  }

  if (action !== "apply") return NextResponse.json({ error: `모르는 요청입니다(${action}).` }, { status: 400 });

  // 「확인 필요」는 넣지 않습니다 - 같은 이름이 둘 이상이라 어느 학생인지 못 고른 줄입니다.
  const usable = rows.filter((r) => r.kind === "새로 등록" || r.kind === "바뀜");
  if (usable.length === 0) {
    return NextResponse.json({ error: "고른 줄은 모두 「확인 필요」라 넣을 수 없습니다." }, { status: 400 });
  }

  const plans: RosterPlan[] = usable.map((r, i) => ({
    rowNo: i,
    name: r.name,
    kind: r.kind,
    changes: r.changes ?? [],
    studentId: r.student_id ?? undefined,
  }));
  const done = await applyRosterPlans(supabase, plans, (p) => usable[p.rowNo]?.values ?? {});

  // 넣는 데 실패한 줄은 **대기함에 남깁니다.** 처리했다고 표시해버리면 안 들어간 학생이
  // 조용히 사라집니다.
  const okIds = usable
    .filter((r) => !done.failed.some((f) => f.startsWith(`${r.name}(`)))
    .map((r) => r.id);
  if (okIds.length > 0) {
    await supabase
      .from("roster_sync_inbox")
      .update({ status: "반영", decided_at: new Date().toISOString(), decided_by: me.email })
      .in("id", okIds);
  }

  return NextResponse.json({ ok: true, ...done });
}

/** 짧지 않게, 사람이 옮겨 적기 쉬운 글자만으로. */
function newToken(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 40; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
