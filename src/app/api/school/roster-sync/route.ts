import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FIELD_LABEL, parseRosterGrid } from "@/lib/pasteRoster";
import { planRoster, type StudentLite } from "@/lib/rosterPlan";
import { TEST_MARK } from "@/lib/rosterSync";

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

  // 두드린 사실을 **토큰이 맞기 전에** 남깁니다.
  //
  // 토큰이 틀리면 403으로 끝나고 아무 흔적이 없었습니다. 그러면 화면에는 「아직 없음」인데,
  // 그게 «오지 않았다»인지 «왔는데 토큰이 다르다»인지 구별할 수 없었습니다. 둘은 고치는
  // 곳이 다릅니다 - 앞은 ENDPOINT, 뒤는 TOKEN 입니다.
  //
  // 토큰은 앞 6글자만 적습니다. 진단하자고 열쇠를 통째로 적어두면 문을 열어두는 셈입니다.
  const { error: attemptErr } = await supabase.from("roster_sync_attempts").insert({
    token_prefix: token.slice(0, 6),
    link_id: link?.id ?? null,
    result: !link ? "토큰 모름" : !link.enabled ? "꺼진 연결" : body?.test === true ? "연결 시험" : "받음",
    note: !link ? "이 토큰을 가진 연결이 없습니다. 스크립트의 TOKEN 을 확인하세요." : null,
  });
  // 이 기록이 안 남으면 화면의 「두드린 기록 없음」이 거짓말이 됩니다 - 오지 않은 것과
  // 적지 못한 것이 같아 보이면, 진단하려고 만든 표가 오히려 사람을 속입니다.
  const attemptNote = attemptErr ? ` (진단 기록 실패: ${attemptErr.message})` : "";

  if (!link) return NextResponse.json({ error: `모르는 토큰입니다.${attemptNote}` }, { status: 403 });
  if (!link.enabled) return NextResponse.json({ error: `꺼져 있는 연결입니다.${attemptNote}` }, { status: 403 });

  // 연결 시험 - 주소·토큰·기록까지 한 번에 확인합니다. 아무것도 넣지 않습니다.
  //
  // 「스크립트는 성공인데 앱은 아직 없음」일 때, 무엇이 끊겼는지 가릴 방법이 없었습니다.
  // 이 버튼이 통하면 주소와 토큰과 기록은 멀쩡하다는 뜻이고, 남은 건 스크립트뿐입니다.
  if (body?.test === true) {
    const err = await note(supabase, link.id, 0, 0, null, {
      detail: "연결 시험 — 길과 토큰은 정상입니다(아무것도 넣지 않았습니다)",
      header: TEST_MARK,
      columns: TEST_MARK,
    });
    if (err) return NextResponse.json({ ok: false, error: `수신 기록을 남기지 못했습니다: ${err}` }, { status: 500 });
    return NextResponse.json({ ok: true, test: true, warn: attemptNote || undefined });
  }

  const header = (body?.header as unknown[] | undefined)?.map((c) => String(c ?? "")) ?? [];
  const raw = (body?.rows as unknown[][] | undefined) ?? [];
  if (header.length === 0 || raw.length === 0) {
    await note(supabase, link.id, 0, 0, "머리줄이나 학생 줄이 비어 있습니다.");
    return NextResponse.json({ ok: false, error: "머리줄이나 학생 줄이 비어 있습니다." }, { status: 400 });
  }

  // **격자 그대로** 읽습니다. 예전에는 탭·줄바꿈으로 이어붙인 글자로 만들었다가 다시
  // 쪼갰는데, 그 왕복에서 자료가 망가졌습니다 - 실제 명부의 머리줄에는 `After↵School`,
  // 자료 칸에는 `G2J↵(13)` 처럼 **칸 안에 줄바꿈**이 들어 있어서 한 줄이 두 줄로 쪼개졌고,
  // 영문 이름 자리에 악기 이름이 들어갔습니다.
  const parsed = parseRosterGrid([header, ...raw.map((r) => r.map((c) => String(c ?? "")))], undefined, true);
  const rows = parsed.rows.filter((r) => !r.problem);

  // 무엇을 받았고 무엇으로 읽었는지. 이게 없으면 「왜 0줄인가」에 답할 수 없습니다.
  //
  // 머리줄은 **찾은 줄**을 적습니다. 첫 줄을 적으면, 시트 맨 위에 제목이 있는 경우 화면에
  // 그 제목이 「받은 머리줄」로 뜨고 사람은 앱이 잘못 읽었다고 생각합니다.
  const headerText =
    (parsed.headerRowNo && parsed.headerRowNo > 1 ? `${parsed.headerRowNo}번째 줄: ` : "") +
    (parsed.header ?? header).join(" | ");
  const columnsText = parsed.mapping.map((f) => (f ? FIELD_LABEL[f] : "—")).join(" | ");
  if (rows.length === 0) {
    const why = parsed.mapping.includes("name")
      ? "이름이 든 줄이 없습니다."
      : `머리줄에서 이름 칸을 못 찾았습니다. 위에서 ${Math.min(15, raw.length + 1)}줄을 훑어봤지만 ` +
        `아는 칸이 두 개 이상인 줄이 없었습니다(첫 줄: ${header.filter(Boolean).join(", ") || "(전부 비어 있음)"}).`;
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
    (parsed.skippedRows > 0 ? `머리줄 위 ${parsed.skippedRows}줄은 건너뜀 · ` : "") +
    // 어디서 왜 멈췄는지. 조용히 빼면 「왜 스물여섯 명이 없지」가 됩니다.
    (parsed.cutFromRowNo ? `${parsed.cutFromRowNo}행 「${parsed.cutLabel}」 아래는 안 읽음 · ` : "") +
    `읽은 줄 ${rows.length} · 새로 등록 ${count("새로 등록")} · 바뀜 ${count("바뀜")} · ` +
    `그대로 ${count("그대로")} · 확인 필요 ${count("확인 필요")}` +
    (queue.length > 0 && queued === 0 ? " · 이미 대기 중이라 다시 넣지 않음" : "");

  // 「마지막 수신」을 못 적으면 화면에는 영영 「아직 없음」으로 남습니다. 그러면 스크립트는
  // 성공이라고 하는데 앱은 아무것도 못 받은 것처럼 보이고, 어디를 봐야 할지 알 수 없습니다.
  // 그래서 이건 조용히 넘기지 않고 **실패로 돌려줍니다** - 구글이 실행 실패를 메일로 알립니다.
  const noteErr = await note(supabase, link.id, raw.length, queued, problems[0] ?? null, {
    detail,
    header: headerText,
    columns: columnsText,
  });
  if (noteErr) {
    return NextResponse.json(
      { ok: false, error: `줄은 받았지만 수신 기록을 남기지 못했습니다: ${noteErr}`, received: raw.length, queued },
      { status: 500 },
    );
  }
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
): Promise<string | null> {
  // 마지막 수신 결과를 남깁니다. 스크립트가 조용히 실패하면 아무도 모르는 채로 명부가
  // 몇 주씩 뒤처집니다 - 화면에서 「마지막 수신 언제, 결과 무엇」을 볼 수 있어야 합니다.
  const { error: writeErr } = await supabase
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
  return writeErr ? writeErr.message : null;
}
