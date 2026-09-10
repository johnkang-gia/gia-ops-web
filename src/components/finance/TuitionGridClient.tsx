"use client";

import { useEffect, useMemo, useState } from "react";
import AlreadyPaidModal from "@/components/finance/AlreadyPaidModal";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import { departmentOf, gradeSortKey, type Department } from "@/lib/department";
import { tuitionLine, tuitionTotal, discountUsable, type TuitionLine } from "@/lib/tuition";
import TermPicker, { initialTermId } from "./TermPicker";
import InvoicePreviewModal from "./InvoicePreviewModal";
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
}) {
  const notify = useToast();
  const [enrollments, setEnrollments] = useState(initialEnrollments);
  const [sdRows, setSdRows] = useState(initialStudentDiscounts);
  const [invoices, setInvoices] = useState(recentInvoices);
  const [termId, setTermId] = useState("");
  const [dept, setDept] = useState<DeptTab>("초등부");
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dueDate, setDueDate] = useState(today);
  const [discountFor, setDiscountFor] = useState<TuitionStudent | null>(null);
  const [preview, setPreview] = useState<{ id: string; label: string } | null>(null);
  const [onlyUnissued, setOnlyUnissued] = useState(false);

  useEffect(() => {
    setTermId(initialTermId(terms));
  }, [terms]);

  const allPlans = useMemo(
    () => plans.filter((p) => p.active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko")),
    [plans],
  );

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

  const discountsOf = useMemo(() => {
    const m = new Map<string, FeeDiscount[]>();
    for (const sd of sdRows) {
      if (!sameTerm(sd)) continue;
      const d = discounts.find((x) => x.id === sd.discount_id);
      if (!d) continue;
      (m.get(sd.student_id) ?? m.set(sd.student_id, []).get(sd.student_id)!).push(d);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdRows, discounts, termId]);

  /** 한 학생의 한 항목 줄. 화면과 서버가 **같은 함수**를 씁니다. */
  function lineFor(studentId: string, plan: FeePlan): TuitionLine | null {
    const e = enrollOf.get(`${studentId}|${plan.id}`);
    const option = options.find((o) => o.id === e?.option_id) ?? null;
    const ds = (discountsOf.get(studentId) ?? []).filter((d) => !d.plan_id || d.plan_id === plan.id);
    return tuitionLine(plan, option, ds);
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

  /** 보이는 명단 전원에게 한 옵션을 한 번에. 정규과정처럼 대부분이 같은 것을 고르는 항목에 씁니다. */
  async function fillColumn(plan: FeePlan, optionId: string) {
    const targets = checked.size > 0 ? rows.filter((s) => checked.has(s.id)) : rows;
    if (targets.length === 0) return;
    if (!confirm(`${targets.length}명에게 「${plan.name} · ${options.find((o) => o.id === optionId)?.name ?? ""}」을(를) 넣습니다.`)) return;
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

  async function issueChecked(planIds: string[]) {
    const scoped = planIds.length > 0;
    const targets = rows.filter(
      (s) => checked.has(s.id) && (scoped ? planIds.some((pid) => lineFor(s.id, usedPlans.find((p) => p.id === pid)!)) : totalOf(s.id) > 0),
    );
    if (targets.length === 0) {
      notify("발행할 학생을 골라주세요(납부 옵션을 고르지 않은 학생은 제외됩니다).", "error");
      return;
    }
    const scopeLabel = scoped ? usedPlans.filter((p) => planIds.includes(p.id)).map((p) => p.name).join(" · ") : "학비 전체";
    if (!confirm(`${targets.length}명에게 「${scopeLabel}」 청구서를 발행합니다. 되돌리려면 취소해야 합니다.`)) return;

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
      </p>

      {/* ── 표 ─────────────────────────────────────────────────────── */}
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white" style={{ maxHeight: "70vh" }}>
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
                <th key={p.id} className="min-w-[168px] border-b border-r border-slate-100 bg-white px-2 py-1.5 align-bottom">
                  <span className="block text-[11px] font-bold text-slate-700">{p.name}</span>
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
              <th className="min-w-[150px] border-b border-l border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600">
                할인
              </th>
              <th className="min-w-[104px] border-b border-l border-slate-200 bg-white px-2 py-1.5 text-right font-semibold text-slate-600">
                청구액
              </th>
              <th className="min-w-[130px] border-b border-l border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600">
                청구서
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((s) => {
              const on = checked.has(s.id);
              const total = totalOf(s.id);
              const ds = discountsOf.get(s.id) ?? [];
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
                    const e = enrollOf.get(`${s.id}|${p.id}`);
                    const line = lineFor(s.id, p);
                    return (
                      <td key={p.id} className={"border-b border-r border-slate-100 px-1.5 py-1 " + (line ? "bg-teal-50/50" : "")}>
                        <select
                          value={e?.option_id ?? ""}
                          disabled={busy}
                          onChange={(ev) => void pickOption(s, p, ev.target.value)}
                          className="w-full rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                        >
                          <option value="">— 신청 안 함</option>
                          {(optionsOf.get(p.id) ?? []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                              {Number(o.discount_rate) > 0 ? ` (−${Math.round(Number(o.discount_rate) * 100)}%)` : ""}
                            </option>
                          ))}
                        </select>
                        {/* 고른 옵션의 금액을 그 자리에 보여줍니다. 다른 화면에서 확인해야 하면
                            결국 확인하지 않고 발행합니다. */}
                        {line ? (
                          <span className="mt-0.5 block text-right text-[11px] font-bold tabular-nums text-teal-800" title={`기준 ${won(line.base)} − 옵션할인 ${won(line.optionDiscount)}`}>
                            {won(line.amount)}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-right text-[11px] text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}

                  <td className="border-b border-l border-slate-200 px-2 py-1">
                    <span className="flex flex-wrap items-center gap-1">
                      {ds.length === 0 ? (
                        <span className="text-[11px] text-slate-300">없음</span>
                      ) : (
                        ds.map((d) => (
                          <span
                            key={d.id}
                            className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800"
                            title={d.kind === "percent" ? `${Math.round(Number(d.value) * 100)}% 할인` : `${won(Number(d.value))} 할인`}
                          >
                            {d.name}
                          </span>
                        ))
                      )}
                      <button
                        onClick={() => setDiscountFor(s)}
                        className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500 hover:bg-slate-200"
                        title="이 학생에게 할인을 붙이거나 뗍니다"
                      >
                        ＋
                      </button>
                    </span>
                  </td>

                  <td className="border-b border-l border-slate-200 px-2 py-1 text-right">
                    <span className={"font-bold tabular-nums " + (total > 0 ? "text-slate-800" : "text-slate-300")}>
                      {total > 0 ? won(total) : "—"}
                    </span>
                  </td>

                  <td className="border-b border-l border-slate-200 px-2 py-1">
                    {inv ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {(invoicesOf.get(s.id) ?? []).map((v) => {
                          const scope = (v as Invoice & { plan_scope?: string | null }).plan_scope ?? null;
                          return (
                            <button
                              key={v.id}
                              onClick={() => setPreview({ id: v.id, label: `${s.name} · ${v.invoice_no}` })}
                              className="text-[11px] font-bold text-emerald-700 underline"
                              title={scope ? `${scope} 청구서` : "학비 전부를 담은 청구서"}
                            >
                              {v.invoice_no}
                              {scope && <span className="ml-0.5 font-normal text-emerald-600">({scope})</span>}
                            </button>
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
                      <span className="flex items-center gap-1">
                        <span className="text-[11px] font-semibold text-amber-600">미발행</span>
                        {/* 이미 받은 건. 청구서를 받은 날짜로 만들고 입금까지 함께 넣습니다 -
                            지금 밀려 있는 「이미 낸 분들」을 여기서 하나씩 정리합니다. */}
                        <button
                          onClick={() => setAlreadyFor(s)}
                          disabled={busy}
                          className="rounded bg-sky-100 px-1 text-[11px] font-bold text-sky-800 hover:bg-sky-200 disabled:opacity-40"
                          title={`${s.name} — 이미 받은 돈으로 넣습니다 (청구서를 받은 날짜로 만들고 안 보냄 표시)`}
                        >
                          💰 이미 받음
                        </button>
                        <button
                          onClick={() => {
                            setChecked(new Set([s.id]));
                            setTimeout(() => void issueChecked([]), 0);
                          }}
                          disabled={busy}
                          className="rounded bg-amber-100 px-1 text-[11px] font-bold text-amber-800 hover:bg-amber-200 disabled:opacity-40"
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
      </div>

      {discountFor && (
        <DiscountModal
          student={discountFor}
          discounts={discounts}
          termId={termId || null}
          today={today}
          mine={sdRows.filter((r) => r.student_id === discountFor.id && sameTerm(r))}
          onClose={() => setDiscountFor(null)}
          onChanged={(next) => setSdRows(next)}
          allRows={sdRows}
        />
      )}

      {preview && <InvoicePreviewModal invoiceId={preview.id} label={preview.label} onClose={() => setPreview(null)} />}

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
 * 한 학생에게 할인을 붙이고 뗍니다.
 *
 * **이유를 반드시 받습니다.** 몇 달 뒤 「이 아이는 왜 깎였지」를 답할 수 있어야 하고, 그때
 * 남아 있는 것은 기억이 아니라 이 칸입니다.
 */
function DiscountModal({
  student,
  discounts,
  termId,
  today,
  mine,
  allRows,
  onClose,
  onChanged,
}: {
  student: TuitionStudent;
  discounts: FeeDiscount[];
  termId: string | null;
  today: string;
  mine: StudentDiscountRow[];
  allRows: StudentDiscountRow[];
  onClose: () => void;
  onChanged: (next: StudentDiscountRow[]) => void;
}) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");

  const attached = new Set(mine.map((r) => r.discount_id));
  // 학비에 걸리는 할인만. 학비외 전용 할인이 여기 뜨면 잘못 붙습니다.
  const usable = discounts.filter((d) => (!d.category || d.category === "학비") && discountUsable(d, today));

  async function attach() {
    if (!pick) return notify("붙일 할인을 골라주세요.", "error");
    if (!reason.trim()) return notify("왜 붙이는지 적어주세요. 나중에 이 칸만 남습니다.", "error");
    setBusy(true);
    const { data, error } = await createClient()
      .from("student_fee_discounts")
      .insert({ student_id: student.id, discount_id: pick, term_id: termId, reason: reason.trim() })
      .select("id, student_id, discount_id, term_id, reason")
      .single();
    setBusy(false);
    if (error || !data) return notify("붙이지 못했습니다: " + (error?.message ?? ""), "error");
    onChanged([...allRows, data as StudentDiscountRow]);
    setPick("");
    setReason("");
  }

  async function detach(row: StudentDiscountRow) {
    setBusy(true);
    const { error } = await createClient().from("student_fee_discounts").delete().eq("id", row.id);
    setBusy(false);
    if (error) return notify("떼지 못했습니다: " + error.message, "error");
    onChanged(allRows.filter((r) => r.id !== row.id));
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold text-slate-800">
          {student.name} 할인
          <span className="ml-1 text-[11px] font-normal text-slate-400">
            {[student.grade, student.className].filter(Boolean).join(" ")}
          </span>
        </p>

        <ul className="mt-2 flex flex-col gap-1">
          {mine.length === 0 ? (
            <li className="rounded-lg bg-slate-50 px-2 py-2 text-center text-[12px] text-slate-400">붙은 할인이 없습니다.</li>
          ) : (
            mine.map((r) => {
              const d = discounts.find((x) => x.id === r.discount_id);
              return (
                <li key={r.id} className="flex items-center gap-2 rounded-lg bg-violet-50 px-2 py-1.5">
                  <b className="text-[12px] text-violet-900">{d?.name ?? "지워진 할인"}</b>
                  <span className="text-[11px] text-violet-700">
                    {d ? (d.kind === "percent" ? `${Math.round(Number(d.value) * 100)}%` : won(Number(d.value))) : ""}
                  </span>
                  {r.reason && <span className="text-[11px] text-slate-500">{r.reason}</span>}
                  <button
                    onClick={() => void detach(r)}
                    disabled={busy}
                    className="ml-auto text-[11px] font-semibold text-slate-400 underline hover:text-rose-600 disabled:opacity-40"
                  >
                    떼기
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="mt-3 border-t border-slate-100 pt-3">
          {usable.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-slate-500">
              지금 붙일 수 있는 할인이 없습니다.{" "}
              <a href="/finance/plans" className="underline">
                [납부 항목 · 할인]
              </a>
              에서 먼저 만들어주세요 — 어떤 할인이 몇 %인지는 사람이 정합니다.
            </p>
          ) : (
            <>
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]"
              >
                <option value="">할인 고르기</option>
                {usable
                  .filter((d) => !attached.has(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.kind === "percent" ? `${Math.round(Number(d.value) * 100)}%` : won(Number(d.value))}
                      {d.requires_approval ? " (승인 필요)" : ""}
                    </option>
                  ))}
              </select>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="왜 붙이는지 (필수)"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]"
              />
              <button
                onClick={() => void attach()}
                disabled={busy}
                className="mt-2 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
              >
                붙이기
              </button>
            </>
          )}
        </div>

        <button onClick={onClose} className="mt-3 w-full rounded-lg border border-slate-200 py-1.5 text-[12px] font-semibold text-slate-600">
          닫기
        </button>
      </div>
    </div>
  );
}

