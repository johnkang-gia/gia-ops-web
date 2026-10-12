import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { loadStudents } from "@/lib/students";
import { computeAlltalkSync } from "@/lib/alltalkSyncServer";
import { normalizeItem, type RawImportRow } from "@/lib/paymentImport";

export const dynamic = "force-dynamic";

/**
 * **올톡 대조 › 「앱에 넣기」** — 올톡에는 있는데 앱에 같은 청구서가 없는 건을, 사람이
 * 「앱에 넣음」으로 판단한 것만 청구서(결제됐으면 입금까지)로 만듭니다.
 *
 * 판정은 **화면과 같은 함수**(`computeAlltalkSync`)로 서버에서 다시 냅니다. 화면이 보낸 줄
 * 내용을 그대로 믿고 넣으면, 그 사이 다른 사람이 금전 창에서 같은 청구서를 만들었을 때 한 장이
 * 더 생깁니다. 다시 판정해서 여전히 「앱에 없음 + 앱에 넣음」인 줄만 넣습니다.
 *
 * 같은 줄이 두 번 들어가지 않게 청구서에는 `import_source_key`(alltalk|대조 열쇠), 입금에는
 * 올톡 승인번호 열쇠를 남깁니다. 둘 다 유일 색인이 걸려 있습니다.
 *
 * 한 줄이 실패해도 나머지는 계속하고, 실패한 줄과 이유를 모아 돌려줍니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { fileId?: string; keys?: string[] } | null;
  const keys = new Set((body?.keys ?? []).filter((k) => typeof k === "string"));
  if (!body?.fileId || keys.size === 0) return NextResponse.json({ error: "넣을 줄을 고르지 못했습니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: file, error: fErr } = await supabase.from("alltalk_sync_files").select("rows").eq("id", body.fileId).maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!file) return NextResponse.json({ error: "그 파일을 찾지 못했습니다." }, { status: 404 });
  const raws = (file.rows as RawImportRow[]) ?? [];

  const out = await computeAlltalkSync(supabase, raws);
  if ("error" in out && out.error) return NextResponse.json({ error: out.error }, { status: 500 });
  const rows = ("rows" in out ? out.rows : []).filter((r) => keys.has(r.key));

  const ids = [...new Set(rows.map((r) => r.studentId).filter(Boolean))] as string[];
  const { rows: stu, error: sErr } = await loadStudents(supabase, { ids, status: "all" });
  if (sErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${sErr}` }, { status: 500 });
  const byId = new Map(stu.map((s) => [s.id, s]));

  const made: string[] = [];
  const failures: string[] = [];
  const skipped: string[] = [];

  for (const r of rows) {
    const label = `${r.studentName} ${r.why}`;
    if (r.code !== "앱에없음") {
      skipped.push(`${label}: 지금은 「${r.code}」 줄입니다(이미 맞춰졌거나 상태가 바뀜)`);
      continue;
    }
    if (r.mark?.decision !== "앱에 넣음") {
      skipped.push(`${label}: 「앱에 넣음」으로 표시되지 않았습니다`);
      continue;
    }
    const s = r.studentId ? byId.get(r.studentId) : undefined;
    if (!s) {
      failures.push(`${label}: 학생을 명부에서 찾지 못했습니다`);
      continue;
    }
    const amount = r.paidAmount > 0 ? r.paidAmount : r.openAmount;
    const issue = r.history[0]?.issuedAt ?? r.paidAt;
    if (!(amount > 0) || !issue) {
      failures.push(`${label}: 금액이나 날짜를 읽지 못했습니다`);
      continue;
    }
    const item = normalizeItem(r.why);
    const phone = r.linkKey ? r.linkKey.split("|")[2] || null : null;

    const { data: noRow, error: noErr } = await supabase.rpc("next_invoice_no");
    if (noErr) {
      failures.push(`${label}: 청구서 번호를 만들지 못했습니다(${noErr.message})`);
      continue;
    }
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert({
        invoice_no: noRow as unknown as string,
        stream: item.stream,
        category: item.stream === "학비" ? "학비" : null,
        student_id: s.id,
        student_name: s.name_en ?? s.name,
        student_name_ko: s.name,
        grade_label: s.class_name ?? (s.grade ? `${s.grade}학년` : null),
        issue_date: issue,
        billing_month: issue.slice(0, 7),
        due_date: issue,
        total_amount: amount,
        status: "발행",
        // 올톡으로 이미 나간 청구입니다. 안 보낸 것으로 두면 「올톡페이로 청구」 목록에 다시 올라옵니다.
        exported_at: new Date().toISOString(),
        export_batch: "올톡 대조",
        guardian_phone: phone,
        note: `올톡 대조에서 넣음 (${r.why}${r.mark?.memo ? ` · ${r.mark.memo}` : ""})`,
        import_source_key: `alltalk|${r.key}`,
        issued_by: me.email,
      })
      .select("id, invoice_no")
      .single();
    if (invErr || !inv) {
      const dup = /duplicate key|unique/i.test(invErr?.message ?? "");
      failures.push(`${label}: ${dup ? "이미 넣은 줄입니다" : `청구서를 만들지 못했습니다(${invErr?.message})`}`);
      continue;
    }
    const lineName = r.why && r.why !== item.itemName ? `${item.itemName} (${r.why})` : item.itemName;
    const { error: lineErr } = await supabase.from("invoice_lines").insert({ invoice_id: inv.id, seq: 1, name: lineName, qty: 1, unit_price: amount, amount });
    if (lineErr) {
      failures.push(`${label}: 청구서 ${inv.invoice_no}는 만들었지만 내역을 못 넣었습니다(${lineErr.message}). 그 청구서를 취소하고 다시 해주세요`);
      continue;
    }

    if (r.paidAmount > 0) {
      const { error: payErr } = await supabase.from("payments").insert({
        invoice_id: inv.id,
        student_id: s.id,
        paid_at: r.paidAt ?? issue,
        amount: r.paidAmount,
        kind: "입금",
        method: "올톡페이",
        method_kind: "올톡페이",
        payer_name: s.name,
        memo: `올톡페이 결제${r.approvals.length ? ` · 승인 ${r.approvals.join(", ")}` : ""} (올톡 대조)`,
        source: "올톡페이 가져오기",
        origin: "올톡페이",
        source_key: r.sourceKey ?? `alltalk|${r.key}|pay`,
        matched_by: me.email,
        created_by: me.email,
      });
      if (payErr) {
        const dup = /duplicate key|unique/i.test(payErr.message);
        failures.push(
          `${label}: 청구서 ${inv.invoice_no}는 만들었지만 입금을 못 넣었습니다(${dup ? "같은 승인번호의 입금이 이미 있습니다" : payErr.message}). 금전 창에서 확인해주세요`,
        );
        continue;
      }
    }
    made.push(`${r.studentName} ${inv.invoice_no}`);
    const { error: mErr } = await supabase
      .from("alltalk_sync_marks")
      .update({ memo: `${r.mark?.memo ? `${r.mark.memo} · ` : ""}${inv.invoice_no}로 넣음`, updated_by: me.email, updated_at: new Date().toISOString() })
      .eq("key", r.key);
    if (mErr) failures.push(`${label}: 청구서 ${inv.invoice_no}는 넣었지만 판단 기록을 못 고쳤습니다(${mErr.message})`);
  }

  const missing = [...keys].filter((k) => !rows.some((r) => r.key === k));
  if (missing.length) skipped.push(`${missing.length}줄은 지금 대조 결과에 없습니다(파일이 바뀌었거나 이미 처리됨)`);

  return NextResponse.json({ ok: true, made, failures, skipped });
}
