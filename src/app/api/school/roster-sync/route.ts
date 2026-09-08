import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FIELD_LABEL, parseRosterPaste } from "@/lib/pasteRoster";
import { planRoster, type StudentLite } from "@/lib/rosterPlan";

/**
 * 구글시트 스크립트가 명부를 보내는 창구입니다.
 *
 * 로그인이 없으므로 토큰 하나로 확인합니다. 그래서 **이 창구는 아무것도 돌려주지 않고,
 * 명부를 고치지도 않습니다.** 들어온 줄은 「반영 대기」로 쌓이고 사람이 앱에서 확인해야
 * 명부가 바뀝니다 - 시트를 편집하는 직원이면 스크립트의 토큰을 볼 수 있고, 그 토큰으로
 * 명부를 조용히 고칠 수 있으면 안 됩니다.
 *
 * 답으로는 「몇 줄 받아서 몇 줄이 대기함에 들어갔는지」만 알려줍니다. 스크립트 실행 기록에
 * 학생 이름이 남지 않게 하려는 것입니다.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? req.headers.get("x-gia-token") ?? "").trim();
  if (!token) return NextResponse.json({ error: "토큰이 없습니다." }, { status: 401 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: link } = await supabase
    .from("roster_sync_links")
    .select("id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (!link) return NextResponse.json({ error: "모르는 토큰입니다." }, { status: 403 });
  if (!link.enabled) return NextResponse.json({ error: "꺼져 있는 연결입니다." }, { status: 403 });

  const header = (body?.header as unknown[] | undefined)?.map((c) => String(c ?? "")) ?? [];
  const raw = (body?.rows as unknown[][] | undefined) ?? [];
  if (header.length === 0 || raw.length === 0) {
    await note(supabase, link.id, 0, 0, "머리줄이나 학생 줄이 비어 있습니다.");
    return NextResponse.json({ ok: false, error: "머리줄이나 학생 줄이 비어 있습니다." }, { status: 400 });
  }

  // 붙여넣기 화면과 **같은 읽기**를 씁니다. 시트에서 들어온 줄만 다르게 읽으면 두 길이
  // 다른 결과를 냅니다.
  const text = [header, ...raw].map((r) => r.map((c) => String(c ?? "")).join("\t")).join("\n");
  const parsed = parseRosterPaste(text, undefined, true);
  const rows = parsed.rows.filter((r) => !r.problem);

  // 무엇을 받았고 무엇으로 읽었는지. 이게 없으면 「왜 0줄인가」에 답할 수 없습니다.
  const headerText = header.join(" | ");
  const columnsText = parsed.mapping.map((f) => (f ? FIELD_LABEL[f] : "—")).join(" | ");
  if (rows.length === 0) {
    const why = parsed.mapping.includes("name")
      ? "이름이 든 줄이 없습니다."
      : `머리줄에서 이름 칸을 못 찾았습니다(받은 머리글: ${header.join(", ")}).`;
    await note(supabase, link.id, raw.length, 0, why, { header: headerText, columns: columnsText });
    return NextResponse.json({ ok: false, error: why }, { status: 400 });
  }

  const { data: students, error: stuErr } = await supabase
    .from("wr_students")
    .select("id, name, birth_date, name_en, grade, class_name, student_no, status, mother_phone, father_phone, parent_phone")
    .eq("is_demo", false);
  if (stuErr) {
    await note(supabase, link.id, raw.length, 0, stuErr.message, { header: headerText, columns: columnsText });
    return NextResponse.json({ error: stuErr.message }, { status: 500 });
  }

  const plans = planRoster((students ?? []) as StudentLite[], rows);
  // 「그대로」는 대기함에 넣지 않습니다. 바뀌는 것이 없는 줄까지 쌓이면 사람이 볼 수 없습니다.
  const queue = plans.filter((p) => p.kind !== "그대로");

  let queued = 0;
  const problems: string[] = [];
  for (const p of queue) {
    const v = rows.find((r) => r.rowNo === p.rowNo)?.values ?? {};
    const { error } = await supabase.from("roster_sync_inbox").insert({
      link_id: link.id,
      name: p.name,
      kind: p.kind,
      reason: p.reason ?? null,
      changes: p.changes,
      values: v,
      student_id: p.studentId ?? null,
      fingerprint: fingerprint(p.name, v),
    });
    // 이미 대기 중인 같은 줄이면 유일 색인에 걸립니다. 그건 실패가 아니라 「또 왔다」입니다.
    if (!error) queued++;
    else if (!error.message.includes("duplicate key")) problems.push(error.message);
  }

  // 갈래별로 몇 줄이었는지 그대로 적습니다. 「다 같아서 0」과 「못 읽어서 0」은 완전히
  // 다른 일인데, 숫자 0만 보고는 구별할 수 없습니다.
  const count = (k: string) => plans.filter((p) => p.kind === k).length;
  const detail =
    `읽은 줄 ${rows.length} · 새로 등록 ${count("새로 등록")} · 바뀜 ${count("바뀜")} · ` +
    `그대로 ${count("그대로")} · 확인 필요 ${count("확인 필요")}` +
    (queue.length > 0 && queued === 0 ? " · 이미 대기 중이라 다시 넣지 않음" : "");

  await note(supabase, link.id, raw.length, queued, problems[0] ?? null, {
    detail,
    header: headerText,
    columns: columnsText,
  });
  return NextResponse.json({ ok: true, received: raw.length, queued, pending: queue.length - queued, detail });
}

function fingerprint(name: string, values: Record<string, unknown>): string {
  const flat = Object.keys(values)
    .sort()
    .map((k) => `${k}=${String(values[k] ?? "")}`)
    .join("|");
  return `${name}::${flat}`;
}

async function note(
  supabase: SupabaseClient,
  linkId: string,
  received: number,
  queued: number,
  error: string | null,
  extra?: { detail?: string; header?: string; columns?: string },
) {
  // 마지막 수신 결과를 남깁니다. 스크립트가 조용히 실패하면 아무도 모르는 채로 명부가
  // 몇 주씩 뒤처집니다 - 화면에서 「마지막 수신 언제, 결과 무엇」을 볼 수 있어야 합니다.
  await supabase
    .from("roster_sync_links")
    .update({
      last_push_at: new Date().toISOString(),
      last_row_count: received,
      last_queued: queued,
      last_error: error,
      last_detail: extra?.detail ?? null,
      last_header: extra?.header ?? null,
      last_columns: extra?.columns ?? null,
    })
    .eq("id", linkId);
}
