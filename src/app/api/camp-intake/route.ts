import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readCampForm } from "@/lib/campFee";

/**
 * 캠프 신청 구글폼 → 앱. 폼 결과 시트에 붙인 앱스크립트가 새 응답마다(그리고 「지금까지 전부 보내기」로) 부릅니다.
 *
 * 로그인이 없으므로 토큰(camp_intake_links)으로 확인합니다. 명부 창구와 같은 원칙입니다(§2-3).
 *   · 들어온 응답은 「접수」 줄로만 쌓입니다. 학생 연결·금액 확정·청구서는 사람이 재무 › 캠프에서 합니다.
 *   · 이미 있는 응답이 다시 오면 **원문만** 새로 적습니다. 사람이 고친 주·셔틀·할인·연결을 폼이 덮지 않습니다.
 *   · 답에는 몇 줄을 받았는지만 적습니다. 스크립트 실행 기록에 아이 이름이 남지 않게 합니다.
 */

export const dynamic = "force-dynamic";

type Row = { row?: number; values?: unknown[] };

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: "서버 설정 오류입니다." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { token?: string; test?: boolean; header?: unknown[]; rows?: Row[] };
  const token = String(body.token ?? req.headers.get("x-gia-token") ?? "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "토큰이 없습니다." }, { status: 401 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: link, error: linkErr } = await supabase
    .from("camp_intake_links")
    .select("id, term_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (linkErr) return NextResponse.json({ ok: false, error: `연결을 읽지 못했습니다: ${linkErr.message}` }, { status: 500 });
  if (!link) return NextResponse.json({ ok: false, error: "모르는 토큰입니다. 재무 › 캠프에서 스크립트를 다시 복사하세요." }, { status: 403 });
  if (!link.enabled) return NextResponse.json({ ok: false, error: "꺼져 있는 연결입니다." }, { status: 403 });

  const mark = async (result: string) => {
    const { error } = await supabase
      .from("camp_intake_links")
      .update({ last_seen_at: new Date().toISOString(), last_result: result })
      .eq("id", link.id);
    return error?.message ?? null;
  };

  if (body.test === true) {
    const err = await mark("연결 시험 — 정상");
    if (err) return NextResponse.json({ ok: false, error: `기록을 남기지 못했습니다: ${err}` }, { status: 500 });
    return NextResponse.json({ ok: true, test: true });
  }

  const header = (body.header ?? []).map((h) => String(h ?? "").trim());
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (header.length === 0 || rows.length === 0) {
    await mark("머리줄이나 응답이 비어 있음");
    return NextResponse.json({ ok: false, error: "머리줄이나 응답이 비어 있습니다." }, { status: 400 });
  }

  const tsCol = header.findIndex((h) => /타임스탬프|timestamp/i.test(h));
  const prepared = rows
    .map((r) => {
      const values = Array.isArray(r.values) ? r.values : [];
      const answers: Record<string, string> = {};
      header.forEach((h, i) => {
        if (!h) return;
        const v = values[i];
        const s = v == null ? "" : String(v).trim();
        // 같은 머리줄이 두 번 있으면(폼 질문을 고쳐 다시 만든 경우) 값이 있는 쪽을 남깁니다.
        if (s || !(h in answers)) answers[h] = s;
      });
      const ts = tsCol >= 0 ? String(values[tsCol] ?? "").trim() : "";
      // 시트 줄 번호는 응답을 지우면 밀립니다. 제출 시각이 있으면 그것이 열쇠입니다.
      const key = ts ? `ts:${ts}` : r.row ? `row:${r.row}` : "";
      return { key, answers };
    })
    .filter((p) => p.key && Object.values(p.answers).some(Boolean));
  if (prepared.length === 0) {
    await mark("읽을 응답 없음");
    return NextResponse.json({ ok: true, received: 0, added: 0, refreshed: 0 });
  }

  const { data: existing, error: exErr } = await supabase
    .from("camp_applications")
    .select("id, source_key")
    .eq("term_id", link.term_id)
    .in("source_key", prepared.map((p) => p.key));
  if (exErr) {
    await mark(`읽기 실패: ${exErr.message}`);
    return NextResponse.json({ ok: false, error: `기존 신청을 읽지 못했습니다: ${exErr.message}` }, { status: 500 });
  }
  const idOf = new Map((existing ?? []).map((e) => [e.source_key as string, e.id as string]));

  const fresh = prepared.filter((p) => !idOf.has(p.key));
  let added = 0;
  if (fresh.length > 0) {
    const { error, count } = await supabase.from("camp_applications").insert(
      fresh.map((p) => {
        const f = readCampForm(p.answers);
        return {
          term_id: link.term_id,
          source_key: p.key,
          source: "구글폼",
          submitted_at: f.submitted_at,
          raw: p.answers,
          applicant_name: f.applicant_name,
          applicant_name_en: f.applicant_name_en,
          grade: f.grade,
          birth_date: f.birth_date,
          guardian_name: f.guardian_name,
          guardian_phone: f.guardian_phone,
          email: f.email,
          weeks: f.weeks,
          shuttle: f.shuttle,
          says_current: f.says_current,
          sibling: f.sibling,
          is_returning: f.returning,
        };
      }),
      { count: "exact" },
    );
    if (error) {
      await mark(`넣기 실패: ${error.message}`);
      return NextResponse.json({ ok: false, error: `신청을 넣지 못했습니다: ${error.message}` }, { status: 500 });
    }
    added = count ?? fresh.length;
  }

  const failed: string[] = [];
  let refreshed = 0;
  for (const p of prepared.filter((x) => idOf.has(x.key))) {
    const { error } = await supabase.from("camp_applications").update({ raw: p.answers }).eq("id", idOf.get(p.key)!);
    if (error) failed.push(error.message);
    else refreshed++;
  }

  const result = `받음 ${prepared.length} · 새로 ${added} · 원문 갱신 ${refreshed}${failed.length ? ` · 실패 ${failed.length}` : ""}`;
  const markErr = await mark(result);
  if (failed.length) return NextResponse.json({ ok: false, error: `원문 갱신 ${failed.length}줄 실패: ${failed[0]}` }, { status: 500 });
  return NextResponse.json({ ok: true, received: prepared.length, added, refreshed, warn: markErr ?? undefined });
}
