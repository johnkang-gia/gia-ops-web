"use client";

import DragScroll from "@/components/common/DragScroll";
import FeePlansModal from "./FeePlansModal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFinanceLive } from "@/lib/useFinanceLive";
import AlreadyPaidModal from "@/components/finance/AlreadyPaidModal";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import { departmentOf, gradeSortKey, type Department } from "@/lib/department";
import { addDays, DUE_DAYS } from "@/lib/financePeriod";
import { discountsForPlan, tuitionLine, tuitionTotal, discountUsable, type TuitionLine } from "@/lib/tuition";
import TermPicker, { initialTermId } from "./TermPicker";
import InvoicePreviewModal from "./InvoicePreviewModal";
import CancelInvoiceModal from "./CancelInvoiceModal";
import type { FeePlan, FeePaymentOption, FeeDiscount, Term, Invoice } from "@/lib/types";
import { PAYMENT_METHOD_KINDS } from "@/lib/payments";
import { todayKst } from "@/lib/kst";

/**
 * 학비 청구 명단 — 학생이 행, 납부 항목이 열.
 *
 * 학비외 항목(인보이스 명단)과 **근거가 다릅니다.** 저쪽은 「이 아이가 이 교재를 산다」는
 * 체크이고, 이쪽은 **학부모가 안내문에 √ 표시하고 서명해서 낸 납부 옵션**입니다. 그게 곧
 * 계약이라, 칸에 체크가 아니라 «어떤 옵션을 골랐는가»가 들어갑니다.
 *
 * ── 왜 금액을 표에 적어두지 않는가 ──
 *
 * 안내문의 숫자 아홉 개는 전부 「기준금액 × 회차수 × (1 − 할인율)」로 떨어집니다. 그래서
 * 요금표에는 기준금액 하나와 옵션만 두고, 금액은 볼 때마다 계산합니다. 적어두면 요금이
 * 오를 때 아홉 군데를 고쳐야 하고, 반드시 한 군데를 빠뜨립니다.
 *
 * ── 할인 ──
 *
 * 어떤 할인이 몇 %인지는 아직 정해지지 않았습니다. 그래서 할인을 코드에 박지 않고
 * [납부 항목 · 할인] 화면에서 만든 것을 **골라 붙입니다.** 붙인 근거(이유)를 함께 남깁니다 -
 * 몇 달 뒤에 「이 아이는 왜 깎였지」를 답할 수 있어야 합니다.
 */

export type TuitionStudent = {
  id: string;
  name: string;
  nameEn: string | null;
  grade: string | null;
  className: string | null;
  department: string | null;
};

export type EnrollRow = { id: string; student_id: string; plan_id: string; option_id: string | null; term_id: string | null };
export type StudentDiscountRow = {
  id: string;
  student_id: string;
  discount_id: string;
  term_id: string | null;
  /**
   * **어느 항목에 붙인 할인인가.** 비어 있으면 그 학생의 학비 전체입니다(예전 줄).
   *
   * 할인은 항목마다 다릅니다 - 정규과정에는 목사 자제·형제자매·유치부 졸업이, 방과후에는
   * 5개월납·10개월납이 붙습니다. 이 칸이 없을 때는 형제 할인을 붙이면 방과후에서도 10%가
   * 빠졌는데, 화면에는 오류가 아니라 그냥 깎인 금액으로 보입니다.
   */
  plan_id: string | null;
  reason: string | null;
};

type DeptTab = Department | "기타";
const DEPTS: DeptTab[] = ["초등부", "중고등부", "기타"];

const btn = "rounded-lg px-2.5 py-1 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40";

export default function TuitionGridClient({
  students,
  plans,
  options,
  discounts,
  terms,
  initialEnrollments,
  initialStudentDiscounts,
  recentInvoices,
  today,
  loadError,
  catalogPlans,
  canApprove,
  currentUserEmail,
}: {
  students: TuitionStudent[];
  plans: FeePlan[];
  options: FeePaymentOption[];
  discounts: FeeDiscount[];
  terms: Term[];
  initialEnrollments: EnrollRow[];
  initialStudentDiscounts: StudentDiscountRow[];
  recentInvoices: Invoice[];
  today: string;
  loadError: string | null;
  /**
   * 팝업에서 다루는 **모든** 납부 항목(학비·학비외). 표에 뜨는 `plans` 는 학비만이라
   * 따로 받습니다 - 팝업에서 학비외 항목이 안 보이면 거기서 고칠 수 없습니다.
   */
  catalogPlans: FeePlan[];
  /** 승인이 필요한 할인을 만들 수 있는 사람인가(최고관리자). */
  canApprove: boolean;
  currentUserEmail: string;
}) {
  // 돈에 닿는 자료가 바뀌면 이 화면이 함께 다시 그려집니다. 한 사람이 고치고
  // 여러 사람이 보는 화면이라, 고친 사람만 새 금액을 보면 안 됩니다.
  useFinanceLive(["wr_students"]);
  const notify = useToast();
  const [enrollments, setEnrollments] = useState(initialEnrollments);
  const [sdRows, setSdRows] = useState(initialStudentDiscounts);
  const [invoices, setInvoices] = useState(recentInvoices);
  const [termId, setTermId] = useState("");
  const [dept, setDept] = useState<DeptTab>("초등부");
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 납입기한은 **발행한 날로부터 이레**입니다. 앞 판은 오늘이 기본이었는데, 그대로 발행하면
  // 학부모가 문자를 받는 순간 이미 마감일입니다 - 다음 날이면 전부 연체로 넘어가고, 그러면
  // 연체 표시가 온통 빨개져서 정작 진짜 밀린 건이 묻힙니다.
  const [dueDate, setDueDate] = useState(() => addDays(today, DUE_DAYS));
  /**
   * 지금 열려 있는 칸. **한 번에 하나만** 엽니다 - 여럿 열리면 어느 아이의 어느 항목을
   * 고치는 중인지 헷갈리고, 돈에서 그건 엉뚱한 아이가 깎이는 일이 됩니다.
   */
  const [cellFor, setCellFor] = useState<{ studentId: string; planId: string } | null>(null);
  const [preview, setPreview] = useState<{ id: string; label: string } | null>(null);
  /**
   * 발행 취소하려는 청구서.
   *
   * 학비는 취소할 자리가 없었습니다. 잘못 발행한 장을 지울 방법이 없으니 그 학생은 다시
   * 발행할 수도 없었고(이미 발행됨으로 보임), 화면에는 「끝난 것」으로만 보였습니다.
   */
  const [cancelling, setCancelling] = useState<{ invoice: Invoice; studentName: string } | null>(null);
  const [onlyUnissued, setOnlyUnissued] = useState(false);
  /**
   * 납부 항목·할인 팝업.
   *
   * 예전에는 **다른 대분류 탭**이었습니다. 고치러 건너가면 보고 있던 표의 학기·부서·체크가
   * 전부 풀리고, 돌아와서 처음부터 다시 찾아야 했습니다 - 그러면 「나중에 정리하자」가 되고,
   * 그 사이 학부모에게는 옛 금액이 나갑니다.
   */
  const [plansOpen, setPlansOpen] = useState(false);

  useEffect(() => {
    setTermId(initialTermId(terms));
  }, [terms]);

  /**
   * **열 순서는 여기서 바로 바꿉니다.**
   *
   * 열 순서는 항목의 `sort_order` 인데, 그것을 바꾸려면 [납부 항목·할인] 팝업까지 가야
   * 했습니다. 정작 「이 열을 맨 뒤로」라고 생각하는 순간은 **표를 보고 있을 때**입니다.
   *
   * 끌어서 놓으면 그 자리에서 저장하고, 저장될 때까지는 화면이 먼저 움직입니다
   * (`orderOverride`) - 저장을 기다리면 손이 놓은 자리와 화면이 한 박자 어긋나 보입니다.
   */
  const [orderOverride, setOrderOverride] = useState<Record<string, number> | null>(null);
  const [dragPlan, setDragPlan] = useState<string | null>(null);
  const [overPlan, setOverPlan] = useState<string | null>(null);

  const orderOf = useCallback(
    (p: FeePlan) => orderOverride?.[p.id] ?? p.sort_order,
    [orderOverride],
  );

  const allPlans = useMemo(
    () => plans.filter((p) => p.active).sort((a, b) => orderOf(a) - orderOf(b) || a.name.localeCompare(b.name, "ko")),
    [plans, orderOf],
  );

  /**
   * 끌어다 놓은 자리로 열을 옮깁니다.
   *
   * **학비 항목 전체에 번호를 다시 매깁니다.** 보고 있는 갈래(정규과정만·방과후만)에서
   * 옮겼더라도, 번호는 전체가 한 줄로 이어져야 합니다 - 일부만 고치면 번호가 겹치고
   * 겹치면 이름순으로 밀려 「왜 안 옮겨지지」가 됩니다.
   */
  async function moveColumn(targetId: string) {
    const fromId = dragPlan;
    setDragPlan(null);
    setOverPlan(null);
    if (!fromId || fromId === targetId) return;

    const list = [...allPlans];
    const from = list.findIndex((p) => p.id === fromId);
    const to = list.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);

    const next: Record<string, number> = {};
    list.forEach((p, i) => (next[p.id] = i));
    setOrderOverride(next);

    const supabase = createClient();
    for (const [i, p] of list.entries()) {
      if (orderOf(p) === i) continue;
      const { error } = await supabase.from("fee_plans").update({ sort_order: i }).eq("id", p.id);
      // 조용히 넘기지 않습니다 - 화면에서는 옮겨졌는데 저장이 안 됐으면, 새로고침하면
      // 원래대로 돌아가고 사람은 자기가 잘못 끈 줄 압니다.
      if (error) {
        notify(`열 순서를 저장하지 못했습니다: ${error.message}`, "error");
        setOrderOverride(null);
        return;
      }
    }
    notify(`「${moved.name}」 열을 옮겼습니다.`, "success");
  }

  /**
   * **보고 있는 항목** — 정규과정만, 방과후만, 또는 전부.
   *
   * 발행은 예전부터 항목별로 됐지만, 화면은 늘 전부를 함께 보여줬습니다. 그래서
   * 「방과후만 이번 달 얼마 걷혔나」를 보려면 열을 눈으로 골라내야 했고, 열이 여럿이면
   * 표가 옆으로 길어져 이름과 금액이 멀어집니다.
   *
   * 여기서 고른 것이 **표의 열·합계·발행 대상 전부**를 정합니다. 보는 것과 발행하는 것이
   * 다르면, 화면에 안 보이는 항목이 청구서에 실려 나갑니다.
   */
  const [planTab, setPlanTab] = useState<string>("전체");
  const usedPlans = useMemo(
    () => (planTab === "전체" ? allPlans : allPlans.filter((p) => p.name === planTab)),
    [allPlans, planTab],
  );
  const optionsOf = useMemo(() => {
    const m = new Map<string, FeePaymentOption[]>();
    for (const o of options) {
      if (!o.active) continue;
      (m.get(o.plan_id) ?? m.set(o.plan_id, []).get(o.plan_id)!).push(o);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.periods - b.periods);
    return m;
  }, [options]);

  // 이 학기 것만 봅니다. 학기를 안 걸면 지난 학기 신청이 그대로 이번 청구에 붙습니다.
  const sameTerm = <T extends { term_id: string | null }>(r: T) => !r.term_id || !termId || r.term_id === termId;

  const enrollOf = useMemo(() => {
    const m = new Map<string, EnrollRow>();
    for (const e of enrollments) if (sameTerm(e)) m.set(`${e.student_id}|${e.plan_id}`, e);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollments, termId]);

  /** 학생별로 붙어 있는 할인 **줄**. 어느 항목에 거는지는 `discountsForPlan` 이 정합니다. */
  const sdOf = useMemo(() => {
    const m = new Map<string, StudentDiscountRow[]>();
    for (const sd of sdRows) (m.get(sd.student_id) ?? m.set(sd.student_id, []).get(sd.student_id)!).push(sd);
    return m;
  }, [sdRows]);

  /** 이 학생의 이 항목에 걸리는 할인. 서버(청구서 발행)와 **같은 함수**를 씁니다. */
  const discountsFor = useCallback(
    (studentId: string, planId: string) => discountsForPlan(sdOf.get(studentId) ?? [], discounts, planId, termId || null),
    [sdOf, discounts, termId],
  );

  /** 한 학생의 한 항목 줄. 화면과 서버가 **같은 함수**를 씁니다. */
  function lineFor(studentId: string, plan: FeePlan): TuitionLine | null {
    const e = enrollOf.get(`${studentId}|${plan.id}`);
    const option = options.find((o) => o.id === e?.option_id) ?? null;
    return tuitionLine(plan, option, discountsFor(studentId, plan.id));
  }
  /**
   * **비고 한 줄** — 「정규과정: 1년 납부 −10% · 목사자제 −10%」.
   *
   * 학부모가 묻는 것은 「얼마가 왜 깎였나」입니다. 할인 이름만 모아 두면 어느 항목에서
   * 깎였는지 알 수 없고, 그러면 답하려고 계산기를 다시 두드리게 됩니다. 옵션 할인(한 번에
   * 내서 깎이는 기본 할인)도 함께 적습니다 - 그것도 학부모에게는 할인입니다.
   */
  function remarkOf(studentId: string): { planId: string; planName: string; text: string }[] {
    const out: { planId: string; planName: string; text: string }[] = [];
    for (const p of usedPlans) {
      const line = lineFor(studentId, p);
      if (!line) continue;
      const bits: string[] = [];
      if (line.optionDiscount > 0) bits.push(`${line.optionName} −${won(line.optionDiscount)}`);
      for (const d of line.discounts) bits.push(`${d.name} −${won(d.amount)}`);
      if (bits.length === 0) continue;
      out.push({ planId: p.id, planName: p.name, text: bits.join(" · ") });
    }
    return out;
  }

  function totalOf(studentId: string): number {
    return tuitionTotal(usedPlans.map((p) => lineFor(studentId, p)));
  }

  // 학기 판정은 인보이스 명단과 **같은 식**을 씁니다. 두 화면이 다른 기준으로 「발행됨」을
  // 정하면, 한쪽에서 발행된 아이가 다른 쪽에서는 미발행으로 떠서 두 번 나갑니다.
  //
  // **한 학생에게 청구서가 여럿일 수 있습니다.** 정규과정과 방과후를 따로 발행하면 두 장이
  // 됩니다. 앞 판은 첫 장만 기억해서, 정규과정만 발행한 아이가 「발행됨」으로 바뀌고
  // 방과후는 영영 안 나갔습니다 - 오류가 아니라 «다 된 것처럼» 보이는 자리였습니다.
  const invoicesOf = useMemo(() => {
    const m = new Map<string, Invoice[]>();
    for (const v of invoices) {
      if (!v.student_id || v.status !== "발행" || v.category !== "학비") continue;
      const sameT = (v.term_id ?? "") === termId || (!v.term_id && terms.find((x) => x.id === termId)?.status === "진행중");
      if (!sameT) continue;
      const list = m.get(v.student_id);
      if (list) list.push(v);
      else m.set(v.student_id, [v]);
    }
    return m;
  }, [invoices, termId, terms]);

  /**
   * 이 학생의 이 항목이 이미 청구서에 담겼는가.
   *
   * `plan_scope` 가 비어 있는 청구서는 학비 **전부**를 담은 것입니다(항목별 발행이
   * 생기기 전에 나간 것 포함). 그런 장이 하나라도 있으면 모든 항목이 담긴 것으로 봅니다.
   */
  const billed = useMemo(() => {
    const m = new Map<string, { all: boolean; names: Set<string> }>();
    for (const [sid, list] of invoicesOf) {
      const names = new Set<string>();
      let all = false;
      for (const v of list) {
        const scope = (v as Invoice & { plan_scope?: string | null }).plan_scope ?? null;
        if (!scope) all = true;
        else for (const n of scope.split(" · ")) names.add(n.trim());
      }
      m.set(sid, { all, names });
    }
    return m;
  }, [invoicesOf]);

  /** 아직 청구서에 안 담긴 항목이 남아 있는가. */
  const hasUnbilled = (sid: string) => {
    const b = billed.get(sid);
    if (!b) return totalOf(sid) > 0;
    if (b.all) return false;
    return usedPlans.some((p) => lineFor(sid, p) && !b.names.has(p.name));
  };

  /** 대표로 보여줄 청구서 한 장(가장 최근). */
  const invoiceOf = useMemo(() => {
    const m = new Map<string, Invoice>();
    for (const [sid, list] of invoicesOf) m.set(sid, list[0]);
    return m;
  }, [invoicesOf]);

  const deptOf = (s: TuitionStudent): DeptTab => {
    const d = departmentOf({ department: s.department, grade: s.grade });
    return d === "초등부" || d === "중고등부" ? d : "기타";
  };

  const rows = useMemo(() => {
    let list = students.filter((s) => deptOf(s) === dept);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((s) => `${s.name} ${s.nameEn ?? ""} ${s.className ?? ""}`.toLowerCase().includes(needle));
    // 「미발행만」은 **남은 항목이 있는가**로 봅니다. 한 장 나갔다고 다 된 것이 아닙니다.
    if (onlyUnissued) list = list.filter((s) => hasUnbilled(s.id));
    return list.sort(
      (a, b) =>
        gradeSortKey(a.grade) - gradeSortKey(b.grade) ||
        (a.className ?? "").localeCompare(b.className ?? "", "ko") ||
        a.name.localeCompare(b.name, "ko"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, dept, q, onlyUnissued, billed]);

  /** 옵션을 고릅니다. 같은 학생·같은 항목은 **덮어씁니다** - 바꿀 때마다 줄이 쌓이면 청구서에 같은 항목이 두 번 찍힙니다. */
  async function pickOption(student: TuitionStudent, plan: FeePlan, optionId: string) {
    setBusy(true);
    const sb = createClient();
    const existing = enrollOf.get(`${student.id}|${plan.id}`);

    if (!optionId) {
      // 「신청 안 함」. 줄을 지웁니다 - active=false 로 두면 다시 고를 때 유니크 조건에 걸립니다.
      if (!existing) return setBusy(false);
      const { error } = await sb.from("student_fee_enrollments").delete().eq("id", existing.id);
      setBusy(false);
      if (error) return notify("지우지 못했습니다: " + error.message, "error");
      setEnrollments((p) => p.filter((x) => x.id !== existing.id));
      return;
    }

    if (existing) {
      const { error } = await sb.from("student_fee_enrollments").update({ option_id: optionId }).eq("id", existing.id);
      setBusy(false);
      if (error) return notify("바꾸지 못했습니다: " + error.message, "error");
      setEnrollments((p) => p.map((x) => (x.id === existing.id ? { ...x, option_id: optionId } : x)));
      return;
    }

    const { data, error } = await sb
      .from("student_fee_enrollments")
      .insert({ student_id: student.id, plan_id: plan.id, option_id: optionId, term_id: termId || null })
      .select("id, student_id, plan_id, option_id, term_id")
      .single();
    setBusy(false);
    if (error || !data) return notify("넣지 못했습니다: " + (error?.message ?? ""), "error");
    setEnrollments((p) => [...p, data as EnrollRow]);
  }

  /**
   * **이 학생의 이 항목에 할인을 붙이고 뗍니다.**
   *
   * 붙일 때 `plan_id` 를 함께 적습니다. 안 적으면 그 학생의 학비 전체에 걸려서, 정규과정
   * 형제 할인이 방과후·셔틀 금액에서도 빠집니다 - 화면에는 오류가 아니라 깎인 금액으로만
   * 보입니다.
   */
  async function toggleDiscount(student: TuitionStudent, plan: FeePlan, d: FeeDiscount, next: boolean) {
    setBusy(true);
    const sb = createClient();

    if (!next) {
      const row = (sdOf.get(student.id) ?? []).find(
        (r) => r.discount_id === d.id && (r.plan_id ?? null) === plan.id && (!r.term_id || !termId || r.term_id === termId),
      );
      if (!row) return setBusy(false);
      const { error } = await sb.from("student_fee_discounts").delete().eq("id", row.id);
      setBusy(false);
      if (error) return notify("떼지 못했습니다: " + error.message, "error");
      setSdRows((p) => p.filter((x) => x.id !== row.id));
      return;
    }

    const { data, error } = await sb
      .from("student_fee_discounts")
      .insert({ student_id: student.id, discount_id: d.id, plan_id: plan.id, term_id: termId || null })
      .select("id, student_id, discount_id, term_id, plan_id, reason")
      .single();
    setBusy(false);
    // 조용히 넘기지 않습니다 - 안 붙은 줄 모르고 청구서를 내보내면 금액이 말한 것과 다릅니다.
    if (error || !data) return notify("붙이지 못했습니다: " + (error?.message ?? ""), "error");
    setSdRows((p) => [...p, data as StudentDiscountRow]);
  }

  /** 항목을 안 정하고 붙어 있던 예전 줄을 뗍니다. */
  async function detachLoose(row: StudentDiscountRow) {
    setBusy(true);
    const { error } = await createClient().from("student_fee_discounts").delete().eq("id", row.id);
    setBusy(false);
    if (error) return notify("떼지 못했습니다: " + error.message, "error");
    setSdRows((p) => p.filter((x) => x.id !== row.id));
  }

  /** 보이는 명단 전원에게 한 옵션을 한 번에. 정규과정처럼 대부분이 같은 것을 고르는 항목에 씁니다. */
  async function fillColumn(plan: FeePlan, optionId: string) {
    const targets = checked.size > 0 ? rows.filter((s) => checked.has(s.id)) : rows;
    if (targets.length === 0) return;
    // 되묻지 않습니다. 요금제를 붙이는 것은 되돌릴 수 있는 편집입니다.
    setBusy(true);
    for (const s of targets) await pickOption(s, plan, optionId);
    setBusy(false);
    notify(`${targets.length}명에게 넣었습니다.`, "success");
  }

  /**
   * 어느 항목을 담아 발행할 것인가. 빈 집합이면 그 학생의 학비 **전부**입니다.
   *
   * 정규과정과 방과후는 납기도 다르고 그만두는 시점도 다릅니다. 한 장에 섞으면 그 장이
   * 반만 결제된 상태가 되어, 「방과후만 이번 달 얼마 걷혔나」를 셀 수가 없습니다.
   */
  /**
   * 「이미 받았습니다」로 넣는 창.
   *
   * 청구서가 있어야만 결제를 체크할 수 있어서, 이미 낸 분을 넣을 자리가 없었습니다. 여기서
   * 넣으면 **받은 날짜로** 청구서를 만들고(안 보냄 표시) 입금까지 한 번에 기록합니다.
   */
  const [alreadyFor, setAlreadyFor] = useState<TuitionStudent | null>(null);

  async function recordAlreadyPaid(s: TuitionStudent, paidAt: string, amount: number, method: string, memo: string, planIds: string[]) {
    setBusy(true);
    const res = await fetch("/api/finance/invoices/tuition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: s.id,
        dueDate: paidAt,
        termId: termId || null,
        planIds: planIds.length > 0 ? planIds : null,
        alreadyPaid: { paidAt, amount, method, memo },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return notify(`${s.name}: ${body.error ?? res.statusText}`, "error");
    setInvoices((p) => [body.invoice as Invoice, ...p]);
    setAlreadyFor(null);
    notify(`${s.name} — 이미 받은 것으로 넣었습니다(${won(body.paid ?? amount)}).`, "success");
  }

  /**
   * 청구서를 발행합니다.
   *
   * `only` 를 주면 **그 학생만** 발행합니다. 학생 줄의 [발행 →] 단추가 이 길로 옵니다.
   *
   * 앞 판은 그 단추가 체크 상태를 먼저 바꾸고(`setChecked`) 곧바로 이 함수를 불렀습니다.
   * 그런데 화면 상태는 바로 바뀌지 않아서, 이 함수가 볼 때는 **아직 아무도 안 골라진**
   * 상태였습니다 - 그래서 「발행할 학생을 골라주세요」가 떴습니다. 이미 학생을 짚어 누른
   * 단추인데 다시 고르라고 하니 사람은 무엇을 더 해야 하는지 알 수 없습니다.
   */
  async function issueChecked(planIds: string[], only?: string[]) {
    const scoped = planIds.length > 0;
    const pick = only ? new Set(only) : checked;
    const targets = rows.filter(
      (s) => pick.has(s.id) && (scoped ? planIds.some((pid) => lineFor(s.id, usedPlans.find((p) => p.id === pid)!)) : totalOf(s.id) > 0),
    );
    if (targets.length === 0) {
      notify("발행할 학생을 골라주세요(납부 옵션을 고르지 않은 학생은 제외됩니다).", "error");
      return;
    }
    const scopeLabel = scoped ? usedPlans.filter((p) => planIds.includes(p.id)).map((p) => p.name).join(" · ") : "학비 전체";
    // 학생 줄에서 한 명을 짚어 누른 것은 이미 「이 학생」이라고 말한 것입니다. 되물으면
    // 같은 대답을 두 번 하게 됩니다. 여러 명을 한꺼번에 보낼 때만 한 번 묻습니다.
    if (!only && !confirm(`${targets.length}명에게 「${scopeLabel}」 청구서를 발행합니다. 되돌리려면 취소해야 합니다.`)) return;

    setBusy(true);
    const made: Invoice[] = [];
    const failed: string[] = [];
    try {
      for (const s of targets) {
        const res = await fetch("/api/finance/invoices/tuition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: s.id, dueDate, termId: termId || null, planIds: scoped ? planIds : null }),
        });
        const ctype = res.headers.get("content-type") ?? "";
        if (!ctype.includes("application/json")) {
          const head = (await res.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ").trim();
          failed.push(`${s.name}(서버가 JSON 대신 ${ctype || "알 수 없는 형식"}을 돌려줬습니다 · ${res.status} · ${head})`);
          continue;
        }
        const body = await res.json().catch(() => ({}));
        if (res.ok) made.push(body.invoice as Invoice);
        // 한 명이 실패해도 나머지는 계속합니다. 다만 **누가 실패했는지 반드시 말합니다.**
        else failed.push(`${s.name}(${body.error ?? res.statusText})`);
      }
      if (made.length > 0) setInvoices((p) => [...made, ...p]);
      if (failed.length > 0) notify(`${made.length}건 발행 · ${failed.length}건 실패: ${failed.join(", ")}`, "error");
      else notify(`${made.length}건 발행했습니다.`, "success");
      setChecked(new Set());
    } finally {
      setBusy(false);
    }
  }

  const grandTotal = rows.reduce((n, s) => n + totalOf(s.id), 0);
  const unissued = rows.filter((s) => totalOf(s.id) > 0 && hasUnbilled(s.id)).length;

  if (usedPlans.length === 0) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
        <b>학비 항목이 아직 없습니다.</b> [납부 항목 · 할인] 화면에서 「학비」 항목을 먼저 만들어주세요 — 기본 요금표
        (정규과정 · 방과후 5/3/2일반)는 배포와 함께 자동으로 들어갑니다. 1~2분 뒤에도 비어 있으면 자동 반영이
        실패한 것입니다.
        <a href="/finance/plans" className="ml-2 underline">
          납부 항목 · 할인 열기 →
        </a>
      </div>
    );
  }

  return (
    <div>
      {loadError && (
        <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{loadError}</p>
      )}

      {/* ── 학기·부서·검색 ─────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TermPicker terms={terms} value={termId} onChange={setTermId} />
        <span className="flex gap-1">
          {DEPTS.map((d) => (
            <button
              key={d}
              onClick={() => {
                setDept(d);
                setChecked(new Set());
              }}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-semibold " +
                (dept === d ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
              }
            >
              {d}
            </button>
          ))}
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·반 검색"
          className="w-40 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        />
        <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
          <input type="checkbox" checked={onlyUnissued} onChange={(e) => setOnlyUnissued(e.target.checked)} />
          미발행만
        </label>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
            납부 기한
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[11px]"
            />
          </label>
          <button
            onClick={() => void issueChecked([])}
            disabled={busy || checked.size === 0}
            className={btn + " bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700"}
            title="고른 학생에게 학비 전부를 한 장으로 발행합니다(지난 미납도 함께 얹힙니다)"
          >
            🧾 고른 {checked.size}명 · 전체 발행
          </button>
          {/* 항목별 발행. 정규과정과 방과후는 납기도 그만두는 시점도 달라, 한 장에 섞으면
              그 장이 반만 결제된 상태가 됩니다. 항목이 하나뿐이면 「전체」와 같으므로
              굳이 두 번 보여주지 않습니다. */}
          {usedPlans.length > 1 &&
            usedPlans.map((p) => (
              <button
                key={p.id}
                onClick={() => void issueChecked([p.id])}
                disabled={busy || checked.size === 0}
                className={btn + " border border-emerald-300 bg-white px-2.5 py-1.5 text-emerald-700 hover:bg-emerald-50"}
                title={`${p.name}만 담은 청구서를 따로 발행합니다 — 지난 미납은 얹지 않습니다`}
              >
                🧾 {p.name}만
              </button>
            ))}
        </span>
      </div>

      {/* ── 보기: 정규과정 / 방과후 ─────────────────────────────────────────
          발행은 예전부터 항목별로 됐지만 화면은 늘 전부를 함께 보여줬습니다. 그래서
          「방과후만 얼마 걷혔나」를 보려면 열을 눈으로 골라내야 했고, 열이 여럿이면
          표가 옆으로 길어져 이름과 금액이 멀어집니다. */}
      {allPlans.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-bold text-slate-500">보기</span>
          {["전체", ...allPlans.map((p) => p.name)].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setPlanTab(name)}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
                (planTab === name ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
              }
            >
              {name}
            </button>
          ))}
          {planTab !== "전체" && (
            // 무엇이 가려졌는지 적습니다. 골라놓고 잊으면 「왜 금액이 적지」가 됩니다.
            <span className="text-[10px] text-sky-700">
              지금 「{planTab}」만 봅니다 — 합계·발행도 이 항목만입니다.
            </span>
          )}
        </div>
      )}

      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        칸에 <b>학부모가 고른 납부 옵션</b>을 넣습니다. 금액은 <b>기준금액 × 회차수 × (1 − 옵션 할인)</b>으로 그때그때
        계산합니다 — 요금이 오르면 [납부 항목 · 할인]에서 기준금액 하나만 고치면 전부 따라옵니다.
        <br />
        {/* 연 1회 내는 항목(Learning Management & Assessment Fee 등)을 학비외에 넣으면 이
            표에 안 뜨고, 청구 자료와 계속 어긋납니다. 어디에 넣어야 하는지를 이 자리에
            적어 둡니다 - 화면 밖에 있는 규칙은 아무도 모릅니다. */}
        <b>연 1회 내는 항목도 학비입니다.</b> 아래 <b>[📚 납부 항목 · 할인]</b> 의 <b>학비</b> 탭에서 단위를{" "}
        <b>연간</b>으로 만들고 <b>「1년 납부」 옵션 하나</b>를 붙이면 이 표에 열로 뜹니다. 이름은 나중에 <b>고치기</b>로
        바꿀 수 있고, 이미 나간 청구서는 그대로 남습니다.
      </p>

      {/* 항목·할인은 **청구를 하다가** 손대게 됩니다 - 「이 아이 할인이 목록에 없네」,
          「기준금액이 올랐네」. 화면을 옮겨야 하는 일은 대개 안 하게 되므로 이 자리에서
          엽니다. */}
      <button
        type="button"
        onClick={() => setPlansOpen(true)}
        className="mb-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[12px] font-bold text-indigo-700 transition hover:bg-indigo-100"
        title="기준금액·납부 옵션·할인을 이 화면에서 바로 고칩니다"
      >
        📚 납부 항목 · 할인
      </button>

      <FeePlansModal
        open={plansOpen}
        onClose={() => setPlansOpen(false)}
        plans={catalogPlans}
        options={options}
        discounts={discounts}
        canApprove={canApprove}
        currentUserEmail={currentUserEmail}
      />

      {/* ── 표 ─────────────────────────────────────────────────────── */}
      {/* 학비표도 잡아서 밀 수 있습니다. 여기는 세로도 갇혀 있어(70vh) 양쪽 다 밉니다. */}
      <DragScroll axis="both" className="g-scroll-x max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 w-8 border-b border-slate-200 bg-white px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((s) => checked.has(s.id))}
                  onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((s) => s.id)) : new Set())}
                  title="전부 고르기"
                />
              </th>
              <th className="sticky left-8 z-30 min-w-[150px] border-b border-r border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600">
                학생
              </th>
              {usedPlans.map((p) => (
                <th
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    setDragPlan(p.id);
                    e.dataTransfer.effectAllowed = "move";
                    // 담긴 자료가 없으면 파이어폭스는 끌기를 시작하지 않습니다.
                    e.dataTransfer.setData("text/plain", p.id);
                  }}
                  onDragEnd={() => {
                    setDragPlan(null);
                    setOverPlan(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragPlan || dragPlan === p.id) return;
                    e.preventDefault(); // 막지 않으면 놓을 수 없습니다.
                    e.dataTransfer.dropEffect = "move";
                    setOverPlan(p.id);
                  }}
                  onDragLeave={() => setOverPlan((o) => (o === p.id ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    void moveColumn(p.id);
                  }}
                  className={
                    "min-w-[168px] cursor-grab border-b border-r border-slate-100 bg-white px-2 py-1.5 align-bottom " +
                    (overPlan === p.id ? "!bg-teal-50 outline outline-2 outline-teal-400 " : "") +
                    (dragPlan === p.id ? "opacity-40 " : "")
                  }
                  title="제목을 끌어서 열 순서를 옮깁니다"
                >
                  <span className="block text-[11px] font-bold text-slate-700">
                    {/* 끌 수 있다는 것은 보여야 압니다 - 표시가 없으면 아무도 시도하지
                        않습니다. */}
                    <span className="mr-1 select-none text-slate-300">⠿</span>
                    {p.name}
                  </span>
                  <span className="block text-[10px] tabular-nums text-slate-400">
                    {won(Number(p.base_amount))} / {p.unit}
                  </span>
                  {/* 정규과정처럼 대부분이 같은 것을 고르는 항목은 한 번에 넣습니다. */}
                  <select
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.value) void fillColumn(p, e.target.value);
                      e.target.value = "";
                    }}
                    className="mt-0.5 w-full rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-semibold text-slate-600"
                    title={checked.size > 0 ? `고른 ${checked.size}명에게 한 번에` : `보이는 ${rows.length}명 전원에게 한 번에`}
                  >
                    <option value="">↓ {checked.size > 0 ? `고른 ${checked.size}명` : `${rows.length}명`}에게 한 번에</option>
                    {(optionsOf.get(p.id) ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
              <th className="min-w-[190px] border-b border-l border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600">
                비고 <span className="font-normal text-slate-400">(받는 할인)</span>
              </th>
              <th className="min-w-[104px] border-b border-l border-slate-200 bg-white px-2 py-1.5 text-right font-semibold text-slate-600">
                청구액
              </th>
              {/* **세 단추가 한 줄에 들어가야 합니다.** 미발행 줄에는 「미발행 · 💰 이미
                  받음 · 발행 →」 셋이 들어가는데 칸이 130px 이라 글자가 접혀 내려가면서
                  줄 높이가 들쭉날쭉했습니다. 접힌 글자는 반쯤 잘려 보여 무슨 단추인지
                  읽히지 않습니다. */}
              <th className="min-w-[218px] whitespace-nowrap border-b border-l border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600">
                청구서
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((s) => {
              const on = checked.has(s.id);
              const total = totalOf(s.id);
              const noteRows = remarkOf(s.id);
              /** 항목을 안 정하고 붙어 있는 줄(예전 줄). 비고에 「학비 전체」로 적습니다. */
              const loose = (sdOf.get(s.id) ?? []).filter((r) => !r.plan_id && (!r.term_id || !termId || r.term_id === termId));
              const inv = invoiceOf.get(s.id);
              return (
                <tr key={s.id} className={on ? "bg-teal-50/40" : "hover:bg-slate-50/60"}>
                  <td className={"sticky left-0 z-10 border-b border-slate-100 px-2 py-1 " + (on ? "bg-teal-50" : "bg-white")}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setChecked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className={"sticky left-8 z-10 border-b border-r border-slate-200 px-2 py-1 " + (on ? "bg-teal-50" : "bg-white")}>
                    <b className="text-slate-800">{s.name}</b>
                    <span className="ml-1 text-[10px] text-slate-400">
                      {[s.grade, s.className].filter(Boolean).join(" ")}
                    </span>
                  </td>

                  {usedPlans.map((p) => {
                    const line = lineFor(s.id, p);
                    const ds = discountsFor(s.id, p.id);
                    const open = cellFor?.studentId === s.id && cellFor.planId === p.id;
                    return (
                      <td key={p.id} className={"relative border-b border-r border-slate-100 px-1.5 py-1 " + (line ? "bg-teal-50/50" : "")}>
                        {/* **칸을 누르면 그 자리에서 정합니다.** 납부 옵션(분기납·1년납)이 먼저이고,
                            그 아래에 이 항목에만 붙는 할인이 옵니다 - 옵션은 계약이고 할인은
                            그 위에 얹는 것이라, 순서가 곧 계산 순서입니다. */}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setCellFor(open ? null : { studentId: s.id, planId: p.id })}
                          className={
                            "w-full rounded border px-1 py-0.5 text-left text-[11px] transition " +
                            (open ? "border-teal-500 bg-white ring-2 ring-teal-200" : "border-slate-200 hover:bg-white")
                          }
                          title="납부 옵션과 이 항목 할인을 정합니다"
                        >
                          <span className={line ? "font-semibold text-slate-700" : "text-slate-400"}>
                            {line ? line.optionName : "— 신청 안 함"}
                          </span>
                          {ds.length > 0 && (
                            <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                              할인 {ds.length}
                            </span>
                          )}
                          <span className="mt-0.5 block text-right font-bold tabular-nums text-teal-800">
                            {line ? won(line.amount) : "—"}
                          </span>
                        </button>

                        {open && (
                          <CellEditor
                            student={s}
                            plan={p}
                            optionId={enrollOf.get(`${s.id}|${p.id}`)?.option_id ?? ""}
                            options={optionsOf.get(p.id) ?? []}
                            usableDiscounts={discounts.filter(
                              (d) =>
                                (!d.category || d.category === "학비") &&
                                (!d.plan_id || d.plan_id === p.id) &&
                                (discountUsable(d, today) || ds.some((x) => x.id === d.id)),
                            )}
                            attached={ds}
                            line={line}
                            busy={busy}
                            onPickOption={(id) => void pickOption(s, p, id)}
                            onToggleDiscount={(d, next) => void toggleDiscount(s, p, d, next)}
                            onClose={() => setCellFor(null)}
                          />
                        )}
                      </td>
                    );
                  })}

                  {/* **비고 — 이 아이가 무엇을 얼마나 깎이는가.**

                      예전에는 이 자리에 할인 이름만 나란히 떴습니다. 할인이 항목마다 다른데
                      한 줄로 모아두니 「정규과정에서 깎인 건지 방과후에서 깎인 건지」를 알 수
                      없었고, 그건 학부모가 묻는 바로 그 물음입니다. 이제 항목별로 적습니다. */}
                  <td className="border-b border-l border-slate-200 px-2 py-1 align-top">
                    <div className="flex flex-col gap-0.5">
                      {noteRows.length === 0 && loose.length === 0 ? (
                        <span className="text-[11px] text-slate-300">기본 납부</span>
                      ) : (
                        noteRows.map((n) => (
                          <span key={n.planId} className="text-[11px] leading-snug">
                            <b className="text-slate-600">{n.planName}</b>{" "}
                            <span className="text-slate-500">{n.text}</span>
                          </span>
                        ))
                      )}
                      {/* 항목을 안 정하고 붙어 있던 예전 줄. 「학비 전체」라고 적고, 여기서 뗍니다 -
                          어디서 푸는지 모르면 아무도 안 풉니다. */}
                      {loose.map((r) => {
                        const d = discounts.find((x) => x.id === r.discount_id);
                        return (
                          <span key={r.id} className="flex items-center gap-1 text-[11px] text-violet-800">
                            <span className="rounded bg-violet-100 px-1 font-bold">학비 전체</span>
                            {d?.name ?? "지워진 할인"}
                            <button
                              onClick={() => void detachLoose(r)}
                              disabled={busy}
                              className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500 hover:bg-rose-100 hover:text-rose-700"
                              title="이 할인을 뗍니다"
                            >
                              ✕
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </td>

                  <td className="border-b border-l border-slate-200 px-2 py-1 text-right">
                    <span className={"font-bold tabular-nums " + (total > 0 ? "text-slate-800" : "text-slate-300")}>
                      {total > 0 ? won(total) : "—"}
                    </span>
                  </td>

                  <td className="whitespace-nowrap border-b border-l border-slate-200 px-2 py-1">
                    {inv ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {(invoicesOf.get(s.id) ?? []).map((v) => {
                          const scope = (v as Invoice & { plan_scope?: string | null }).plan_scope ?? null;
                          return (
                            <span key={v.id} className="inline-flex items-center gap-0.5">
                              <button
                                onClick={() => setPreview({ id: v.id, label: `${s.name} · ${v.invoice_no}` })}
                                className="text-[11px] font-bold text-emerald-700 underline"
                                title={scope ? `${scope} 청구서` : "학비 전부를 담은 청구서"}
                              >
                                {v.invoice_no}
                                {scope && <span className="ml-0.5 font-normal text-emerald-600">({scope})</span>}
                              </button>
                              {/* 잘못 발행한 장을 되돌릴 자리. 지우지 않고 취소로 남기므로
                                  나중에 무엇이 왜 취소됐는지 읽을 수 있습니다. */}
                              <button
                                onClick={() => setCancelling({ invoice: v, studentName: s.name })}
                                className="text-[11px] font-bold text-slate-300 hover:text-rose-600"
                                title="발행 취소 (지우지 않고 취소로 남깁니다)"
                              >
                                ↩
                              </button>
                            </span>
                          );
                        })}
                        {/* 한 장 나갔다고 다 된 것이 아닙니다. 남은 항목이 있으면 말해줍니다 -
                            아무 표시가 없으면 담당자는 끝난 줄로 읽습니다. */}
                        {hasUnbilled(s.id) && (
                          <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800" title="아직 청구서에 안 담긴 항목이 있습니다">
                            남음
                          </span>
                        )}
                      </span>
                    ) : total > 0 ? (
                      <span className="flex flex-nowrap items-center gap-1">
                        <span className="shrink-0 text-[11px] font-semibold text-amber-600">미발행</span>
                        {/* 이미 받은 건. 청구서를 받은 날짜로 만들고 입금까지 함께 넣습니다 -
                            지금 밀려 있는 「이미 낸 분들」을 여기서 하나씩 정리합니다. */}
                        <button
                          onClick={() => setAlreadyFor(s)}
                          disabled={busy}
                          className="shrink-0 whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-bold text-sky-800 hover:bg-sky-200 disabled:opacity-40"
                          title={`${s.name} — 이미 받은 돈으로 넣습니다 (청구서를 받은 날짜로 만들고 안 보냄 표시)`}
                        >
                          💰 이미 받음
                        </button>
                        <button
                          onClick={() => {
                            // 이 학생만 바로 발행합니다. 체크 상태를 거치지 않습니다 -
                            // 화면 상태는 바로 바뀌지 않아서 「골라주세요」가 떴습니다.
                            void issueChecked([], [s.id]);
                          }}
                          disabled={busy}
                          className="shrink-0 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-200 disabled:opacity-40"
                          title={`${s.name} 한 명만 지금 발행합니다 (${won(total)})`}
                        >
                          발행 →
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={usedPlans.length + 5} className="px-3 py-12 text-center text-sm text-slate-400">
                  학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>

          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <td className="sticky left-0 z-30 border-t-2 border-slate-300 bg-slate-100 px-2 py-1.5" colSpan={2}>
                <span className="text-[11px] font-bold text-slate-600">
                  {rows.length}명 · 미발행 {unissued}
                </span>
              </td>
              {usedPlans.map((p) => {
                const n = rows.filter((s) => lineFor(s.id, p)).length;
                const sum = rows.reduce((acc, s) => acc + (lineFor(s.id, p)?.amount ?? 0), 0);
                return (
                  <td key={p.id} className="border-t-2 border-r border-slate-300 bg-slate-100 px-1.5 py-1.5 text-right">
                    <span className="block text-[11px] font-bold text-slate-700">{n}명</span>
                    <span className="block text-[10px] tabular-nums text-slate-500">{won(sum)}</span>
                  </td>
                );
              })}
              <td className="border-t-2 border-l border-slate-300 bg-slate-100 px-2 py-1.5" />
              <td className="border-t-2 border-l border-slate-300 bg-slate-100 px-2 py-1.5 text-right">
                <span className="text-[13px] font-black tabular-nums text-slate-800">{won(grandTotal)}</span>
              </td>
              <td className="border-t-2 border-l border-slate-300 bg-slate-100 px-2 py-1.5" />
            </tr>
          </tfoot>
        </table>
      </DragScroll>

      {preview && <InvoicePreviewModal invoiceId={preview.id} label={preview.label} onClose={() => setPreview(null)} />}

      {/* 학비외 청구 화면과 **같은 창**입니다. 화면마다 따로 만들면 한쪽에만 경고가 붙습니다. */}
      {cancelling && (
        <CancelInvoiceModal
          invoice={cancelling.invoice}
          studentName={cancelling.studentName}
          onDone={(done) => setInvoices((p) => p.map((v) => (v.id === done.id ? done : v)))}
          onClose={() => setCancelling(null)}
        />
      )}

      {alreadyFor && (
        <AlreadyPaidModal
          title="이미 받은 학비 등록"
          studentName={alreadyFor.name}
          // 항목마다 **금액을 함께** 넘깁니다. 이름만 주면 「교복은 냈고 교재는 안 냈다」를
          // 골라도 얼마인지 몰라서, 결국 사람이 다시 계산해 적게 됩니다.
          lines={usedPlans
            .map((p) => ({ plan: p, line: lineFor(alreadyFor.id, p) }))
            .filter((x) => !!x.line)
            .map((x) => ({ id: x.plan.id, label: x.plan.name, amount: Number(x.line?.subtotal ?? 0) }))}
          busy={busy}
          onClose={() => setAlreadyFor(null)}
          onSubmit={(r) => void recordAlreadyPaid(alreadyFor, r.paidAt, r.amount, r.method, r.memo, r.pickedIds)}
        />
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        할인은 [납부 항목 · 할인]에서 만든 것만 붙일 수 있습니다. 비율 할인은 <b>옵션 할인을 뺀 금액</b>에 걸립니다 —
        연납 10%를 받은 학생에게 특별감면 10%를 붙이면 20%가 아니라 연납가에서 다시 10%입니다.
      </p>
    </div>
  );
}


/**
 * **칸 하나를 정하는 자리** — 납부 옵션이 먼저, 그 항목 할인이 그다음.
 *
 * ── 왜 칸 안에서 정하나 ────────────────────────────────────────────────────
 *
 * 예전에는 옵션은 칸의 고르개로, 할인은 줄 끝의 팝업으로 정했습니다. 그래서 「이 아이
 * 정규과정이 왜 이 금액이지」를 보려면 두 자리를 오가야 했고, 할인은 **어느 항목에 붙는지
 * 고를 수조차 없었습니다** - 붙이면 그 학생의 모든 항목에서 빠졌습니다.
 *
 * 이제 한 칸에서 정합니다. 위에 옵션(분기납·1년납 — 한 번에 내서 깎이는 기본 할인),
 * 아래에 이 항목에만 붙는 할인(목사 자제·형제자매 …). **순서가 곧 계산 순서**입니다:
 * 기준액 → 옵션 할인 → 소계 → 붙인 할인 → 청구액.
 *
 * 금액을 줄마다 적어 보여줍니다. 고르기 전에 얼마가 되는지 모르면, 고르고 나서 표를 보고
 * 다시 고치게 됩니다.
 */
function CellEditor({
  student,
  plan,
  optionId,
  options,
  usableDiscounts,
  attached,
  line,
  busy,
  onPickOption,
  onToggleDiscount,
  onClose,
}: {
  student: TuitionStudent;
  plan: FeePlan;
  optionId: string;
  options: FeePaymentOption[];
  /** 이 항목에 붙일 수 있는 할인만. 다른 항목 전용 할인이 여기 뜨면 잘못 붙습니다. */
  usableDiscounts: FeeDiscount[];
  attached: FeeDiscount[];
  line: TuitionLine | null;
  busy: boolean;
  onPickOption: (optionId: string) => void;
  onToggleDiscount: (d: FeeDiscount, next: boolean) => void;
  onClose: () => void;
}) {
  const on = new Set(attached.map((d) => d.id));

  return (
    <>
      {/* 바깥을 누르면 닫힙니다. 닫는 X 만 있으면 표를 이어 보려다 매번 그 작은 글자를 찾습니다. */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute left-0 top-full z-40 mt-1 w-[290px] rounded-xl border border-slate-300 bg-white p-2.5 text-left shadow-xl">
        <p className="mb-1.5 text-[11px] font-bold text-slate-700">
          {student.name} · {plan.name}
          <span className="ml-1 font-normal text-slate-400">기준 {won(Number(plan.base_amount))}/{plan.unit}</span>
        </p>

        <p className="mb-1 text-[10px] font-bold text-slate-500">① 납부 옵션 — 한 번에 낼수록 깎입니다</p>
        <div className="mb-2 flex flex-col gap-0.5">
          <label className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
            <input type="radio" checked={!optionId} disabled={busy} onChange={() => onPickOption("")} />
            <span className="text-[11px] text-slate-400">신청 안 함</span>
          </label>
          {options.map((o) => {
            const l = tuitionLine(plan, o, attached);
            return (
              <label key={o.id} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                <input type="radio" checked={optionId === o.id} disabled={busy} onChange={() => onPickOption(o.id)} />
                <span className="text-[11px] font-semibold text-slate-700">{o.name}</span>
                {Number(o.discount_rate) > 0 && (
                  <span className="rounded bg-teal-100 px-1 text-[10px] font-bold text-teal-800">
                    −{Math.round(Number(o.discount_rate) * 100)}%
                  </span>
                )}
                {/* **다른 옵션 금액도 함께 보입니다.** 고르기 전에 견주지 못하면 학부모 전화를
                    받은 채로 창을 여닫게 됩니다. */}
                <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-600">{won(l?.amount ?? 0)}</span>
              </label>
            );
          })}
          {options.length === 0 && (
            <p className="rounded bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">
              이 항목에는 납부 옵션이 없습니다. [📚 납부 항목 · 할인]에서 먼저 만들어주세요.
            </p>
          )}
        </div>

        <p className="mb-1 text-[10px] font-bold text-slate-500">② 이 항목에 붙는 할인</p>
        <div className="flex max-h-[160px] flex-col gap-0.5 overflow-y-auto">
          {usableDiscounts.length === 0 ? (
            <p className="rounded bg-slate-50 px-1.5 py-1 text-[10px] text-slate-400">
              이 항목에 걸 수 있는 할인이 없습니다. [📚 납부 항목 · 할인]의 <b>{plan.name}</b> 카드에서 만들어주세요.
            </p>
          ) : (
            usableDiscounts.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-violet-50">
                <input
                  type="checkbox"
                  checked={on.has(d.id)}
                  disabled={busy}
                  onChange={(e) => onToggleDiscount(d, e.target.checked)}
                />
                <span className="text-[11px] text-slate-700">{d.name}</span>
                <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                  {d.kind === "percent" ? `−${Math.round(Number(d.value) * 100)}%` : `−${won(Number(d.value))}`}
                </span>
                {d.requires_approval && (
                  <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800" title="최고관리자 승인이 필요한 할인입니다">
                    승인
                  </span>
                )}
              </label>
            ))
          )}
        </div>

        {/* 계산 순서를 그대로 보여줍니다. 「왜 이 금액인가」를 이 자리에서 답할 수 있어야
            학부모 전화에 바로 답합니다. */}
        <div className="mt-2 rounded-lg bg-slate-50 p-1.5 text-[10px] text-slate-600">
          {line ? (
            <>
              <div className="flex justify-between">
                <span>기준 {line.optionName}</span>
                <span className="tabular-nums">{won(line.base)}</span>
              </div>
              {line.optionDiscount > 0 && (
                <div className="flex justify-between text-teal-700">
                  <span>옵션 할인</span>
                  <span className="tabular-nums">−{won(line.optionDiscount)}</span>
                </div>
              )}
              {line.discounts.map((d) => (
                <div key={d.name} className="flex justify-between text-violet-700">
                  <span>{d.name}</span>
                  <span className="tabular-nums">−{won(d.amount)}</span>
                </div>
              ))}
              <div className="mt-0.5 flex justify-between border-t border-slate-200 pt-0.5 text-[11px] font-bold text-slate-800">
                <span>청구액</span>
                <span className="tabular-nums">{won(line.amount)}</span>
              </div>
            </>
          ) : (
            <span className="text-slate-400">옵션을 고르면 금액이 나옵니다.</span>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-1.5 w-full rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] font-bold text-white"
        >
          닫기
        </button>
      </div>
    </>
  );
}
