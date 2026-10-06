import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStudents } from "@/lib/students";
import { planTargets } from "@/lib/tuition";
import { departmentOf } from "@/lib/department";

/**
 * **진급 · 학기 넘기기** — 지난 학기의 수강 등록 · 할인 · 학비외 개별 선택을 새 학기로 옮깁니다.
 *
 * 새 학기마다 139명의 학비 항목·옵션·할인을 손으로 다시 고르면 몇 명은 반드시 빠지고, 빠진
 * 아이는 오류가 아니라 「청구할 것이 없는 아이」로 보입니다. 그래서 지난 학기를 그대로 옮기되,
 * **그대로 옮기면 틀리는 줄**은 옮기지 않고 이유를 적어 사람에게 보여줍니다.
 *
 *   · 퇴소한 아이 → 옮기지 않습니다(명부 재학생만)
 *   · 학년이 올라 대상이 바뀐 항목(예: 6학년이 되어 중고등부) → 같은 이름의 새 부서 항목이
 *     하나뿐이면 그쪽으로 바꿔 옮기고 「바뀜」으로 표시, 아니면 옮기지 않고 사람에게 묻습니다
 *   · 이미 새 학기에 있는 줄 → 건드리지 않습니다(두 번 눌러도 안전)
 *   · 학생별 금액 조정(override) → 옮기되 표시합니다. 학기마다 다시 정하는 경우가 많습니다
 *
 * 부서 판정은 `departmentOf` 한 곳입니다(6학년은 중고등부, CLAUDE.md 2-2).
 * 지우는 일은 하지 않습니다. 지난 학기 줄은 그대로 남습니다.
 */

type Plan = {
  id: string;
  name: string;
  category: string;
  active: boolean;
  target_scope?: string | null;
  target_departments?: string[] | null;
  target_grades?: string[] | null;
  target_classes?: string[] | null;
};
type Enroll = { id: string; student_id: string; plan_id: string; option_id: string | null; note: string | null; override_amount: number | string | null; override_note: string | null };
type Disc = { id: string; student_id: string; discount_id: string; plan_id: string | null; reason: string | null; granted_by: string | null; approved_by: string | null; approved_at: string | null };
type SFItem = { id: string; student_id: string; item_id: string; mode: string; qty: number; note: string | null };
type FItem = { id: string; code: string | null; name: string; category: string; term_id: string | null };
type Opt = { id: string; plan_id: string; name: string };

export type PromoLine = {
  kind: "등록" | "할인" | "학비외";
  label: string;
  /** 옮김 · 바뀜(다른 항목으로) · 있음(이미 새 학기에) · 안 옮김 */
  verdict: "옮김" | "바뀜" | "있음" | "안 옮김";
  why?: string;
  flag?: string;
};
export type PromoStudent = { studentId: string; name: string; grade: string | null; dept: string | null; lines: PromoLine[] };

export type PromoPlan = {
  students: PromoStudent[];
  inserts: {
    enrollments: Record<string, unknown>[];
    discounts: Record<string, unknown>[];
    items: Record<string, unknown>[];
  };
  counts: { move: number; changed: number; exists: number; skipped: number };
};

const strip = (s: string) =>
  s
    .replace(/\(?\s*(초등부|중고등부|초등|중고등|elementary|secondary)\s*\)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

export async function buildPromotion(supabase: SupabaseClient, fromTerm: string, toTerm: string, me: string): Promise<{ plan: PromoPlan | null; error: string | null }> {
  if (fromTerm === toTerm) return { plan: null, error: "같은 학기로는 옮길 수 없습니다." };
  const [stu, plans, opts, enr, enrTo, disc, discTo, items, sfi, sfiTo, discNames] = await Promise.all([
    loadStudents(supabase, { order: "grade" }),
    supabase.from("fee_plans").select("id, name, category, active, target_scope, target_departments, target_grades, target_classes"),
    supabase.from("fee_payment_options").select("id, plan_id, name"),
    supabase.from("student_fee_enrollments").select("id, student_id, plan_id, option_id, note, override_amount, override_note").eq("term_id", fromTerm).eq("active", true),
    supabase.from("student_fee_enrollments").select("student_id, plan_id").eq("term_id", toTerm),
    supabase.from("student_fee_discounts").select("id, student_id, discount_id, plan_id, reason, granted_by, approved_by, approved_at").eq("term_id", fromTerm).eq("active", true),
    supabase.from("student_fee_discounts").select("student_id, discount_id, plan_id").eq("term_id", toTerm),
    supabase.from("fee_items").select("id, code, name, category, term_id").in("term_id", [fromTerm, toTerm]),
    supabase.from("student_fee_items").select("id, student_id, item_id, mode, qty, note").eq("term_id", fromTerm),
    supabase.from("student_fee_items").select("student_id, item_id").eq("term_id", toTerm),
    supabase.from("fee_discounts").select("id, name"),
  ]);
  const err = stu.error ?? plans.error?.message ?? opts.error?.message ?? enr.error?.message ?? enrTo.error?.message ?? disc.error?.message ?? discTo.error?.message ?? items.error?.message ?? sfi.error?.message ?? sfiTo.error?.message ?? discNames.error?.message;
  if (err) return { plan: null, error: err };

  const planById = new Map(((plans.data ?? []) as Plan[]).map((p) => [p.id, p]));
  const optById = new Map(((opts.data ?? []) as Opt[]).map((o) => [o.id, o]));
  const optsByPlan = new Map<string, Opt[]>();
  for (const o of (opts.data ?? []) as Opt[]) optsByPlan.set(o.plan_id, [...(optsByPlan.get(o.plan_id) ?? []), o]);
  const discName = new Map(((discNames.data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
  const haveEnr = new Set(((enrTo.data ?? []) as { student_id: string; plan_id: string }[]).map((r) => `${r.student_id}|${r.plan_id}`));
  const haveDisc = new Set(((discTo.data ?? []) as { student_id: string; discount_id: string; plan_id: string | null }[]).map((r) => `${r.student_id}|${r.discount_id}|${r.plan_id ?? ""}`));
  const haveItem = new Set(((sfiTo.data ?? []) as { student_id: string; item_id: string }[]).map((r) => `${r.student_id}|${r.item_id}`));
  const fItems = (items.data ?? []) as FItem[];
  const oldItem = new Map(fItems.filter((i) => i.term_id === fromTerm).map((i) => [i.id, i]));
  const newItems = fItems.filter((i) => i.term_id === toTerm);

  const enrBy = new Map<string, Enroll[]>();
  for (const e of (enr.data ?? []) as Enroll[]) enrBy.set(e.student_id, [...(enrBy.get(e.student_id) ?? []), e]);
  const discBy = new Map<string, Disc[]>();
  for (const d of (disc.data ?? []) as Disc[]) discBy.set(d.student_id, [...(discBy.get(d.student_id) ?? []), d]);
  const sfiBy = new Map<string, SFItem[]>();
  for (const s of (sfi.data ?? []) as SFItem[]) sfiBy.set(s.student_id, [...(sfiBy.get(s.student_id) ?? []), s]);

  const plan: PromoPlan = { students: [], inserts: { enrollments: [], discounts: [], items: [] }, counts: { move: 0, changed: 0, exists: 0, skipped: 0 } };
  const tally = (l: PromoLine) => {
    if (l.verdict === "옮김") plan.counts.move++;
    else if (l.verdict === "바뀜") plan.counts.changed++;
    else if (l.verdict === "있음") plan.counts.exists++;
    else plan.counts.skipped++;
  };

  for (const s of stu.rows) {
    const who = { grade: s.grade, className: s.class_name, department: s.department };
    const lines: PromoLine[] = [];
    // 옛 항목 → 새 학기에 실제로 붙는 항목. 할인이 이 표를 따라갑니다.
    const planMap = new Map<string, string | null>();

    for (const e of enrBy.get(s.id) ?? []) {
      const p = planById.get(e.plan_id);
      if (!p) continue;
      let target: Plan | null = p.active && planTargets(p, who) ? p : null;
      let verdict: PromoLine["verdict"] = "옮김";
      let why: string | undefined;
      if (!target) {
        const cands = [...planById.values()].filter((q) => q.id !== p.id && q.active && q.category === p.category && strip(q.name) === strip(p.name) && planTargets(q, who));
        if (cands.length === 1) {
          target = cands[0];
          verdict = "바뀜";
          why = `${p.name} → ${target.name} (${departmentOf({ department: s.department, grade: s.grade }) ?? "부서 미정"})`;
        } else {
          verdict = "안 옮김";
          why = !p.active ? "꺼진 항목입니다" : cands.length > 1 ? "옮길 항목 후보가 여럿입니다 — 직접 골라주세요" : "지금 학년·반·부서의 대상이 아닙니다 — 직접 골라주세요";
        }
      }
      if (target && haveEnr.has(`${s.id}|${target.id}`)) {
        verdict = "있음";
        why = undefined;
      }
      planMap.set(p.id, verdict === "안 옮김" ? null : (target?.id ?? null));
      const flag = e.override_amount != null ? `금액 조정 ${Number(e.override_amount).toLocaleString("ko-KR")}원도 함께 옮깁니다 — 이번 학기에도 맞는지 확인` : undefined;
      const line: PromoLine = { kind: "등록", label: p.name, verdict, why, flag: verdict === "옮김" || verdict === "바뀜" ? flag : undefined };
      lines.push(line);
      tally(line);
      if ((verdict === "옮김" || verdict === "바뀜") && target) {
        // 다른 항목으로 바뀌면 납부 옵션도 그 항목 것이어야 합니다. 이름이 같은 옵션을 찾고, 없으면 비웁니다.
        const oldOpt = e.option_id ? optById.get(e.option_id) : undefined;
        const option = target.id === p.id ? e.option_id : oldOpt ? ((optsByPlan.get(target.id) ?? []).find((o) => o.name === oldOpt.name)?.id ?? null) : null;
        plan.inserts.enrollments.push({
          student_id: s.id,
          term_id: toTerm,
          plan_id: target.id,
          option_id: option,
          note: e.note,
          override_amount: e.override_amount,
          override_note: e.override_note,
          active: true,
          created_by: me,
        });
        haveEnr.add(`${s.id}|${target.id}`);
      }
    }

    for (const d of discBy.get(s.id) ?? []) {
      const name = discName.get(d.discount_id) ?? "할인";
      let planId = d.plan_id;
      let verdict: PromoLine["verdict"] = "옮김";
      let why: string | undefined;
      if (d.plan_id) {
        const mapped = planMap.get(d.plan_id);
        if (mapped === undefined) {
          // 그 항목에 등록이 없던 할인. 붙을 곳이 없으니 옮기지 않습니다.
          verdict = "안 옮김";
          why = "붙어 있던 항목이 등록되어 있지 않습니다";
        } else if (mapped === null) {
          verdict = "안 옮김";
          why = "붙어 있던 항목을 옮기지 않았습니다";
        } else {
          if (mapped !== d.plan_id) verdict = "바뀜";
          planId = mapped;
        }
      }
      if (verdict !== "안 옮김" && haveDisc.has(`${s.id}|${d.discount_id}|${planId ?? ""}`)) verdict = "있음";
      const line: PromoLine = { kind: "할인", label: name, verdict, why, flag: verdict === "옮김" || verdict === "바뀜" ? "할인은 학기마다 다시 확인합니다" : undefined };
      lines.push(line);
      tally(line);
      if (verdict === "옮김" || verdict === "바뀜") {
        plan.inserts.discounts.push({
          student_id: s.id,
          discount_id: d.discount_id,
          term_id: toTerm,
          plan_id: planId,
          reason: d.reason,
          granted_by: d.granted_by ?? me,
          approved_by: d.approved_by,
          approved_at: d.approved_at,
          active: true,
        });
        haveDisc.add(`${s.id}|${d.discount_id}|${planId ?? ""}`);
      }
    }

    for (const x of sfiBy.get(s.id) ?? []) {
      const old = oldItem.get(x.item_id);
      if (!old) continue;
      // 학기를 시작할 때 항목이 복사되며 번호(code)도 같이 넘어옵니다. 번호가 먼저, 없으면 분류+이름.
      const byCode = old.code ? newItems.filter((n) => n.code === old.code) : [];
      const cands = byCode.length > 0 ? byCode : newItems.filter((n) => n.category === old.category && n.name === old.name);
      let verdict: PromoLine["verdict"] = "옮김";
      let why: string | undefined;
      const target = cands.length === 1 ? cands[0] : null;
      if (!target) {
        verdict = "안 옮김";
        why = cands.length === 0 ? "새 학기에 같은 항목이 없습니다" : "새 학기에 같은 이름 항목이 여럿입니다";
      } else if (haveItem.has(`${s.id}|${target.id}`)) verdict = "있음";
      const line: PromoLine = { kind: "학비외", label: `${old.name}${x.mode === "exclude" ? " (빼기)" : ""}`, verdict, why };
      lines.push(line);
      tally(line);
      if (verdict === "옮김" && target) {
        plan.inserts.items.push({ student_id: s.id, item_id: target.id, term_id: toTerm, mode: x.mode, qty: x.qty, note: x.note, updated_by: me });
        haveItem.add(`${s.id}|${target.id}`);
      }
    }

    if (lines.length > 0) plan.students.push({ studentId: s.id, name: s.name, grade: s.grade, dept: departmentOf({ department: s.department, grade: s.grade }), lines });
  }

  return { plan, error: null };
}

/** 미리 본 그대로 넣습니다. 표마다 실패를 모아 돌려줍니다 - 절반만 들어간 것을 「완료」로 보이지 않게. */
export async function applyPromotion(supabase: SupabaseClient, plan: PromoPlan): Promise<{ done: Record<string, number>; errors: string[] }> {
  const done: Record<string, number> = { 등록: 0, 할인: 0, 학비외: 0 };
  const errors: string[] = [];
  const put = async (table: string, rows: Record<string, unknown>[], key: string) => {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase.from(table).insert(chunk);
      if (error) errors.push(`${key}: ${error.message}`);
      else done[key] += chunk.length;
    }
  };
  // 등록이 먼저입니다. 할인은 항목(plan)에 매달리므로 등록 없이 들어가면 붙을 곳이 없습니다.
  await put("student_fee_enrollments", plan.inserts.enrollments, "등록");
  await put("student_fee_discounts", plan.inserts.discounts, "할인");
  await put("student_fee_items", plan.inserts.items, "학비외");
  return { done, errors };
}
