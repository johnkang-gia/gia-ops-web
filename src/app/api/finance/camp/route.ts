import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { addDays, DUE_DAYS } from "@/lib/financePeriod";
import { gradeLabel } from "@/lib/feeItems";
import { loadStudentsWithPhones } from "@/lib/students";
import { campGroupOf, matchCampStudent } from "@/lib/campMatch";
import { addStudents } from "@/lib/studentAdd";
import { resolveRecipient, phonesOf, chosenRoleOf } from "@/lib/alltalkpay";
import { CAMP_DISCOUNTS, CAMP_SHUTTLES, campDiscountOf, campFee, campLineName, type CampDiscount, type CampShuttle } from "@/lib/campFee";

/**
 * 재무 › 캠프 의 모든 «고치기».
 *
 *   createTerm  캠프 학기를 「예정」으로 만듭니다(정규학기는 그대로 진행중).
 *   makeLink    구글폼 결과 시트의 앱스크립트가 쓸 토큰을 만듭니다.
 *   add         폼 밖에서 들어온 신청(전화 등)을 직접 적습니다.
 *   update      주·셔틀·할인·금액·상태·메모·학생 연결을 고칩니다.
 *   external    연결할 재학생이 없으면 「캠프」 상태 학생으로 명부에 넣고 잇습니다(같은 이름은 사람이 확인).
 *   issue       청구서 한 장(수강료 한 줄)을 만듭니다. 캠프마다 한 번.
 *   setStatus   캠프를 다시 열거나(예정) 닫습니다(종료). 정규학기 상태(진행중)는 여기서 건드리지 않습니다.
 *   autoLink    아직 학생이 안 이어진 신청을 명부와 대조해 확실한 것만 잇습니다(campMatch).
 *   bulkExternal 「재학생 아님」으로 답했고 명부에 없는 신청을 외부 학생으로 한꺼번에 넣고 잇습니다.
 *   bulkIssue   재학생 / 외부 학생 묶음별로 청구서를 한꺼번에 만듭니다(한 장 발행과 같은 issueApp).
 *
 * 금액은 화면이 보낸 숫자를 믿지 않고 여기서 다시 셉니다(§2-12). 사람이 금액을 직접 정한 경우만 그 값을 씁니다.
 */

export const dynamic = "force-dynamic";

const PATCHABLE = new Set([
  "applicant_name",
  "applicant_name_en",
  "grade",
  "birth_date",
  "guardian_name",
  "guardian_phone",
  "weeks",
  "shuttle",
  "says_current",
  "sibling",
  "is_returning",
  "discount_override",
  "amount_override",
  "status",
  "memo",
  "student_id",
]);

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });
  const by = me.name || me.email;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(b.action ?? "");
  const supabase = await createClient();

  if (action === "createTerm") {
    const termType = String(b.termType ?? "").trim();
    const year = String(b.year ?? "").trim();
    if (!/캠프/.test(termType) || !year) return NextResponse.json({ error: "캠프 종류와 연도를 고르세요." }, { status: 400 });
    const { data: same } = await supabase.from("terms").select("id").eq("term_type", termType).eq("year", year).maybeSingle();
    if (same) return NextResponse.json({ ok: true, termId: same.id, existed: true });
    const { data: caseId, error: idErr } = await supabase.rpc("next_term_case_id");
    if (idErr) return NextResponse.json({ error: `학기 번호를 만들지 못했습니다: ${idErr.message}` }, { status: 500 });
    const { data: made, error } = await supabase
      .from("terms")
      .insert({
        case_id: caseId as unknown as string,
        term_type: termType,
        year,
        start_date: (b.startDate as string) || null,
        end_date: (b.endDate as string) || null,
        status: "예정",
        shuttle_label: termType,
      })
      .select("id")
      .single();
    if (error || !made) return NextResponse.json({ error: error?.message ?? "캠프 학기를 만들지 못했습니다." }, { status: 500 });
    return NextResponse.json({ ok: true, termId: made.id });
  }

  if (action === "makeLink") {
    const termId = String(b.termId ?? "");
    if (!termId) return NextResponse.json({ error: "캠프 학기를 고르세요." }, { status: 400 });
    // 새로 만들면 예전 토큰은 끕니다. 스크립트에 남은 옛 토큰으로는 더 들어오지 않습니다.
    const { error: offErr } = await supabase.from("camp_intake_links").update({ enabled: false }).eq("term_id", termId);
    if (offErr) return NextResponse.json({ error: `예전 연결을 끄지 못했습니다: ${offErr.message}` }, { status: 500 });
    const token = randomBytes(24).toString("base64url");
    const { error } = await supabase.from("camp_intake_links").insert({ term_id: termId, token, created_by: by });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, token });
  }

  if (action === "add") {
    const termId = String(b.termId ?? "");
    const name = String(b.name ?? "").trim();
    if (!termId || !name) return NextResponse.json({ error: "학생 이름을 적어주세요." }, { status: 400 });
    const { data, error } = await supabase
      .from("camp_applications")
      .insert({
        term_id: termId,
        source: "직접",
        source_key: `manual:${Date.now()}:${randomBytes(3).toString("hex")}`,
        submitted_at: new Date().toISOString(),
        applicant_name: name,
        student_id: (b.studentId as string) || null,
        updated_by: by,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "setStatus") {
    const termId = String(b.termId ?? "");
    const status = String(b.status ?? "");
    if (!termId || !["예정", "종료"].includes(status)) return NextResponse.json({ error: "캠프와 상태(예정·종료)를 고르세요." }, { status: 400 });
    // 캠프 학기만 바꿉니다. 정규학기를 여기서 닫으면 「지금 학기」가 사라집니다.
    const { data, error } = await supabase.from("terms").update({ status }).eq("id", termId).ilike("term_type", "%캠프%").select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "캠프 학기를 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === "autoLink" || action === "bulkExternal" || action === "bulkIssue") {
    const termId = String(b.termId ?? "");
    if (!termId) return NextResponse.json({ error: "캠프 학기를 고르세요." }, { status: 400 });
    const { data: rows, error } = await supabase.from("camp_applications").select("*").eq("term_id", termId).neq("status", "취소");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const apps = (rows ?? []) as (CampAppRow & { applicant_name_en: string | null; birth_date: string | null; says_current: boolean | null; grade: string | null })[];
    // 보호자 번호는 동명이인을 가르는 재료입니다(campMatch). 응답에는 싣지 않습니다.
    const roster = await loadStudentsWithPhones(supabase, { status: "all" });
    if (roster.error) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${roster.error}` }, { status: 500 });
    const statusOf = new Map(roster.rows.map((r) => [r.id, r.status as string]));

    if (action === "autoLink") {
      let linked = 0;
      let ambiguous = 0;
      const failed: string[] = [];
      for (const a of apps.filter((x) => !x.student_id)) {
        const m = matchCampStudent(a, roster.rows);
        if (!m) continue;
        if ("ambiguous" in m) {
          ambiguous++;
          continue;
        }
        const { error: upErr } = await supabase
          .from("camp_applications")
          .update({ student_id: m.studentId, updated_by: by, updated_at: new Date().toISOString() })
          .eq("id", a.id)
          .is("student_id", null);
        if (upErr) failed.push(`${a.applicant_name}: ${upErr.message}`);
        else linked++;
      }
      // 이미 이어졌는데 그 학생이 재학생이 아닌 줄은 다시 봅니다. 옛 중복 줄(퇴소·빈 칸)에 잘못 붙어 «외부»로
      // 청구될 뻔한 경우입니다. 근거(전화·생일·재학 답)로 재학생 한 명이 나올 때만 옮기고, 청구서가 나간 줄은 두지 않습니다.
      let relinked = 0;
      for (const a of apps.filter((x) => x.student_id && !x.invoice_id && statusOf.get(x.student_id) !== "active")) {
        const m = matchCampStudent(a, roster.rows);
        if (!m || "ambiguous" in m || m.studentId === a.student_id || statusOf.get(m.studentId) !== "active") continue;
        const { error: upErr } = await supabase
          .from("camp_applications")
          .update({ student_id: m.studentId, updated_by: by, updated_at: new Date().toISOString() })
          .eq("id", a.id)
          .eq("student_id", a.student_id as string)
          .is("invoice_id", null);
        if (upErr) failed.push(`${a.applicant_name}: ${upErr.message}`);
        else relinked++;
      }
      return NextResponse.json({ ok: failed.length === 0, linked, relinked, ambiguous, failed, error: failed.length ? failed.join(" · ") : undefined });
    }

    if (action === "bulkExternal") {
      // 「재학생 아님」이라고 답했고 아직 안 이어진 줄만. 같은 이름이 명부에 있으면 넣지 않고 사람에게 남깁니다(addStudents).
      const targets = apps.filter((a) => !a.student_id && !a.says_current && a.applicant_name);
      let made = 0;
      const ask: string[] = [];
      const failed: string[] = [];
      for (const a of targets) {
        const res = await addStudents(
          supabase,
          [
            {
              name: a.applicant_name as string,
              name_en: a.applicant_name_en,
              grade: a.grade,
              birth_date: /^\d{4}-\d{2}-\d{2}$/.test(a.birth_date ?? "") ? a.birth_date : null,
              parent_phone: a.guardian_phone,
              status: "캠프",
            },
          ],
          { by },
        );
        if (res.needsConfirm.length > 0) {
          ask.push(a.applicant_name as string);
          continue;
        }
        const sid = res.inserted[0]?.id;
        if (!sid) {
          failed.push(`${a.applicant_name}: ${res.failed.join(" · ") || "학생을 만들지 못했습니다"}`);
          continue;
        }
        const { error: upErr } = await supabase.from("camp_applications").update({ student_id: sid, updated_by: by }).eq("id", a.id);
        if (upErr) failed.push(`${a.applicant_name}: 학생은 만들었지만 잇지 못했습니다(${upErr.message})`);
        else made++;
      }
      return NextResponse.json({ ok: failed.length === 0, made, ask, failed, error: failed.length ? failed.join(" · ") : undefined });
    }

    // bulkIssue
    const group = String(b.group ?? "");
    if (group !== "재학생" && group !== "외부") return NextResponse.json({ error: "재학생·외부 중 하나를 고르세요." }, { status: 400 });
    const invIds = apps.map((a) => a.invoice_id).filter((v): v is string => !!v);
    const liveInv = new Set<string>();
    if (invIds.length > 0) {
      const { data: invs, error: invErr } = await supabase.from("invoices").select("id, status").in("id", invIds);
      if (invErr) return NextResponse.json({ error: `청구서를 읽지 못했습니다: ${invErr.message}` }, { status: 500 });
      for (const v of invs ?? []) if (v.status !== "취소") liveInv.add(v.id as string);
    }
    const targets = apps.filter(
      (a) => a.student_id && !(a.invoice_id && liveInv.has(a.invoice_id)) && campGroupOf(statusOf.get(a.student_id) ?? null, a.says_current) === group,
    );
    const made: string[] = [];
    const failed: string[] = [];
    for (const a of targets) {
      const r = await issueApp(supabase, a, by);
      if (r.ok) made.push(r.invoiceNo);
      else failed.push(`${a.applicant_name}: ${r.error}`);
    }
    return NextResponse.json({ ok: failed.length === 0, made: made.length, failed, error: failed.length ? failed.join(" · ") : undefined });
  }

  const id = String(b.id ?? "");
  if (!id) return NextResponse.json({ error: "신청 줄이 없습니다." }, { status: 400 });
  const { data: app, error: appErr } = await supabase.from("camp_applications").select("*").eq("id", id).maybeSingle();
  if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });
  if (!app) return NextResponse.json({ error: "신청을 찾지 못했습니다." }, { status: 404 });

  // 이어 둔 청구서가 취소됐으면 «안 나간 것»으로 봅니다. 취소한 뒤 금액을 고쳐 다시 내는 길입니다.
  let liveInvoice = false;
  if (app.invoice_id) {
    const { data: inv, error } = await supabase.from("invoices").select("status").eq("id", app.invoice_id).maybeSingle();
    if (error) return NextResponse.json({ error: `청구서를 읽지 못했습니다: ${error.message}` }, { status: 500 });
    liveInvoice = !!inv && inv.status !== "취소";
  }

  if (action === "update") {
    const patch = (b.patch ?? {}) as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (PATCHABLE.has(k)) clean[k] = v === "" ? null : v;
    if ("shuttle" in clean && clean.shuttle != null && !CAMP_SHUTTLES.includes(clean.shuttle as CampShuttle))
      return NextResponse.json({ error: "셔틀 값이 이상합니다." }, { status: 400 });
    if ("discount_override" in clean && clean.discount_override != null && !CAMP_DISCOUNTS.includes(clean.discount_override as CampDiscount))
      return NextResponse.json({ error: "할인 값이 이상합니다." }, { status: 400 });
    // 청구서가 나간 뒤에는 금액을 바꾸는 칸을 잠급니다. 바꾸려면 청구서를 취소하고 다시 만듭니다 - 신청표와
    // 청구서가 다른 금액을 말하면 어느 쪽이 맞는지 아무도 모릅니다.
    if (liveInvoice && ["weeks", "shuttle", "says_current", "sibling", "is_returning", "discount_override", "amount_override", "student_id"].some((k) => k in clean))
      return NextResponse.json({ error: "이미 청구서가 나간 신청입니다. 금액·학생을 바꾸려면 청구서를 먼저 취소하세요." }, { status: 409 });
    if (Object.keys(clean).length === 0) return NextResponse.json({ ok: true });
    const { error } = await supabase
      .from("camp_applications")
      .update({ ...clean, updated_by: by, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "external") {
    if (app.student_id) return NextResponse.json({ error: "이미 학생이 연결되어 있습니다." }, { status: 409 });
    const res = await addStudents(
      supabase,
      [
        {
          name: app.applicant_name,
          name_en: app.applicant_name_en,
          grade: app.grade,
          birth_date: /^\d{4}-\d{2}-\d{2}$/.test(app.birth_date ?? "") ? app.birth_date : null,
          parent_phone: app.guardian_phone,
          status: "캠프",
          homonymOk: b.homonymOk === true,
        },
      ],
      { by },
    );
    if (res.needsConfirm.length > 0) return NextResponse.json({ ok: false, needsConfirm: res.needsConfirm }, { status: 409 });
    if (res.failed.length > 0 || res.inserted.length === 0)
      return NextResponse.json({ error: res.failed.join(" · ") || "학생을 만들지 못했습니다." }, { status: 500 });
    const sid = res.inserted[0].id;
    const { error } = await supabase.from("camp_applications").update({ student_id: sid, updated_by: by }).eq("id", id);
    if (error) return NextResponse.json({ error: `학생은 만들었지만 신청에 잇지 못했습니다: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, studentId: sid });
  }

  if (action === "issue") {
    if (liveInvoice) return NextResponse.json({ error: "이미 청구서가 나갔습니다." }, { status: 409 });
    const r = await issueApp(supabase, app as CampAppRow, by);
    return r.ok ? NextResponse.json({ ok: true, invoiceNo: r.invoiceNo, amount: r.amount }) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  return NextResponse.json({ error: "모르는 동작입니다." }, { status: 400 });
}

type CampAppRow = {
  id: string;
  term_id: string;
  student_id: string | null;
  status: string;
  applicant_name: string | null;
  weeks: number | null;
  shuttle: string | null;
  sibling: boolean | null;
  is_returning: boolean | null;
  discount_override: string | null;
  amount_override: number | null;
  guardian_phone: string | null;
  invoice_id: string | null;
};
type IssueResult = { ok: true; invoiceNo: string; amount: number } | { ok: false; error: string; status: number };

/** 신청 한 줄로 청구서 한 장. 한 장 발행과 일괄 발행이 같은 함수를 씁니다 - 두 길이 따로면 금액이 갈라집니다. */
async function issueApp(supabase: Awaited<ReturnType<typeof createClient>>, app: CampAppRow, by: string): Promise<IssueResult> {
  if (!app.student_id) return { ok: false, error: "먼저 학생을 연결하세요(재학생 고르기 또는 외부 학생으로 등록).", status: 400 };
  if (app.status === "취소") return { ok: false, error: "취소된 신청입니다.", status: 400 };

  const [{ data: term, error: termErr }, stuRes] = await Promise.all([
    supabase.from("terms").select("id, term_type, year").eq("id", app.term_id).maybeSingle(),
    loadStudentsWithPhones(supabase, { ids: [app.student_id], status: "all" }),
  ]);
  if (termErr || !term) return { ok: false, error: termErr?.message ?? "캠프 학기를 찾지 못했습니다.", status: 500 };
  if (stuRes.error) return { ok: false, error: stuRes.error, status: 500 };
  const student = stuRes.rows[0] as (typeof stuRes.rows)[number] | undefined;
  if (!student) return { ok: false, error: "연결한 학생을 명부에서 찾지 못했습니다.", status: 404 };

  const discount = campDiscountOf({
    isCurrent: student.status === "active",
    sibling: !!app.sibling,
    returning: !!app.is_returning,
    override: app.discount_override as CampDiscount | null,
  });
  const fee = campFee(app.weeks, app.shuttle as CampShuttle | null, discount);
  if (!fee && app.amount_override == null)
    return { ok: false, error: "참여 주(2주·3주)와 셔틀을 먼저 정하세요.", status: 400 };
  const amount = app.amount_override ?? fee!.amount;
  const termLabel = `${term.year} ${term.term_type}`;
  const lineName =
    app.weeks && app.shuttle ? campLineName(termLabel, app.weeks, app.shuttle as CampShuttle, discount) : `${termLabel} 수강료`;

  // 이 캠프의 수강료 항목(학기마다 하나). 청구서 줄이 이 번호를 가리켜서, 같은 학생에게 같은 캠프 수강료가 두 장
  // 나가는 것을 데이터베이스 문지기(guard_invoice_line_duplicate)가 막습니다.
  let itemId: string;
  {
    const { data: item, error } = await supabase
      .from("fee_items")
      .select("id")
      .eq("term_id", term.id)
      .eq("category", "캠프")
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: `캠프 항목을 읽지 못했습니다: ${error.message}`, status: 500 };
    if (item) itemId = item.id;
    else {
      const { data: made, error: mkErr } = await supabase
        .from("fee_items")
        .insert({
          term_id: term.id,
          category: "캠프",
          name: `${termLabel} Tuition`,
          name_ko: `${termLabel} 수강료`,
          unit_price: 0,
          default_grades: [],
          default_classes: [],
          target_scope: "개별",
          auto_apply: false,
          note: "캠프 화면이 만든 항목입니다. 금액은 신청마다 다르고 청구서 줄에 적힙니다.",
          created_by: by,
        })
        .select("id")
        .single();
      if (mkErr || !made) return { ok: false, error: `캠프 항목을 만들지 못했습니다: ${mkErr?.message}`, status: 500 };
      itemId = made.id;
    }
  }

  const billing = {
    billing_phone_role: (student as { billing_phone_role?: string | null }).billing_phone_role ?? null,
    billing_phone: (student as { billing_phone?: string | null }).billing_phone ?? null,
    mother_phone: (student as { mother_phone?: string | null }).mother_phone ?? null,
    father_phone: (student as { father_phone?: string | null }).father_phone ?? null,
    parent_phone: (student as { parent_phone?: string | null }).parent_phone ?? app.guardian_phone ?? null,
  };
  const recipient = resolveRecipient(phonesOf(billing), chosenRoleOf(billing));
  const issue = todayKst();
  const { data: noRow, error: noErr } = await supabase.rpc("next_invoice_no");
  if (noErr) return { ok: false, error: `번호를 만들지 못했습니다: ${noErr.message}`, status: 500 };

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      invoice_no: noRow as unknown as string,
      stream: "학비외",
      student_id: student.id,
      student_name: student.name_en?.trim() || student.name,
      student_name_ko: student.name,
      grade_label: gradeLabel({ grade: student.grade, className: student.class_name }),
      issue_date: issue,
      billing_month: issue.slice(0, 7),
      due_date: addDays(issue, DUE_DAYS),
      total_amount: amount,
      guardian_phone: recipient?.phone ?? app.guardian_phone ?? null,
      guardian_role: recipient?.role ?? null,
      term_id: term.id,
      category: "캠프",
      issued_by: by,
    })
    .select("id, invoice_no")
    .single();
  if (invErr || !inv) return { ok: false, error: invErr?.message ?? "청구서를 만들지 못했습니다.", status: 500 };

  const { error: lineErr } = await supabase
    .from("invoice_lines")
    .insert({ invoice_id: inv.id, seq: 1, name: lineName, item_id: itemId, qty: 1, unit_price: amount, amount });
  if (lineErr) {
    const { error: rbErr } = await supabase.from("invoices").delete().eq("id", inv.id);
    return {
      ok: false,
      error: rbErr
        ? `줄을 넣지 못했고(${lineErr.message}) 빈 청구서도 지우지 못했습니다(${rbErr.message}). 청구서 ${inv.invoice_no} 를 확인하세요.`
        : lineErr.code === "23505"
          ? `이 학생에게는 이미 이 캠프 수강료 청구서가 있습니다(${lineErr.message}).`
          : `줄을 넣지 못했습니다: ${lineErr.message}`,
      status: lineErr.code === "23505" ? 409 : 500,
    };
  }

  const { error: linkErr } = await supabase
    .from("camp_applications")
    .update({ invoice_id: inv.id, status: "확정", updated_by: by, updated_at: new Date().toISOString() })
    .eq("id", app.id);
  if (linkErr)
    return {
      ok: false,
      error: `청구서 ${inv.invoice_no} 는 만들었지만 신청에 적지 못했습니다(${linkErr.message}). 다시 누르지 말고 새로고침하세요.`,
      status: 500,
    };
  return { ok: true, invoiceNo: inv.invoice_no as string, amount: Number(amount) };
}
