"use client";

import { useMemo, useState } from "react";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { FeePlan, FeePaymentOption, FeeDiscount } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import StatCard from "@/components/viz/StatCard";
import BarRow from "@/components/viz/BarRow";
import Donut from "@/components/viz/Donut";

// 납부 항목 · 할인 (재무 전용)
//
// 용어는 학교 문서(‘25-26학년도 학비 납부옵션’)를 그대로 씁니다. '요금제'는 통신사 말이라
// 학교에서 쓰지 않습니다. 무엇에 얼마를 받는가 = **납부 항목**(정규과정·방과후 5일반·셔틀·
// 교재비), 몇 회분을 묶고 몇 % 깎는가 = **납부 옵션**(월 납부·5개월 납부·10개월 납부).
//
// 담당자: "할인률과 항목들을 자유롭게 설정할 수 있게 만들어줘. 형제할인 같은 부분 원래는
//         있는데 없애신다고 하셨거든. 그래서 자유롭게 만들었다가 없앴다가 될 수 있게."
//
// **지우기 버튼이 없습니다.** 켜고 끄기만 있습니다. 지워버리면 작년 청구서가 왜 그 금액
// 이었는지 설명할 수 없게 됩니다. "지금 쓰는 할인"과 "그때 썼던 할인"은 다른 물음이고,
// 둘 다 답할 수 있어야 합니다.

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

/** 청구액 = 기준금액 × 회차 × (1 - 할인율). 화면과 실제 계산이 같은 식을 씁니다. */
function optionAmount(plan: FeePlan, opt: FeePaymentOption): number {
  return Math.round(Number(plan.base_amount) * opt.periods * (1 - Number(opt.discount_rate)));
}

const EMPTY_PLAN = {
  category: "학비" as "학비" | "학비외",
  name: "",
  base_amount: 0,
  unit: "월" as FeePlan["unit"],
  description: "",
};

const EMPTY_DISCOUNT = {
  name: "",
  description: "",
  kind: "percent" as "percent" | "amount",
  value: 0,
  category: "" as "" | "학비" | "학비외",
  /**
   * **어느 납부 항목에 붙는 할인인가.**
   *
   * 할인은 항목마다 다릅니다 - 정규과정에는 목사 자제·형제자매·유치부 졸업이, 방과후에는
   * 5개월납·10개월납이 붙습니다. 비워두면 그 분류(학비/학비외) 전체에 걸립니다.
   */
  plan_id: "",
  requires_approval: false,
  effective_from: "",
  effective_to: "",
};

export default function FeePlansClient({
  plans: initialPlans,
  options: initialOptions,
  discounts: initialDiscounts,
  canApprove,
  currentUserEmail,
  loadError,
}: {
  plans: FeePlan[];
  options: FeePaymentOption[];
  discounts: FeeDiscount[];
  /** 최고관리자인가. '승인 필요' 할인을 만들 수 있는지 등에 씁니다. */
  canApprove: boolean;
  currentUserEmail: string;
  loadError: string | null;
}) {
  // 돈에 닿는 자료가 바뀌면 이 화면이 함께 다시 그려집니다. 한 사람이 고치고
  // 여러 사람이 보는 화면이라, 고친 사람만 새 금액을 보면 안 됩니다.
  useFinanceLive();
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const [options, setOptions] = useState(initialOptions);
  const [discounts, setDiscounts] = useState(initialDiscounts);
  const [tab, setTab] = useState<"학비" | "학비외" | "할인">("학비");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [discountForm, setDiscountForm] = useState(EMPTY_DISCOUNT);
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  /**
   * **고치는 중인 항목.**
   *
   * 지금까지 만든 항목은 켜고 끄는 것밖에 못 했습니다. 이름이 길거나 오타가 나면 끄고 새로
   * 만들어야 했는데, 그러면 **이미 그 항목으로 등록해 둔 학생이 통째로 떨어져 나갑니다**
   * (`student_fee_enrollments` 가 항목 번호를 가리킵니다). 화면에는 오류가 아니라 「아무도
   * 안 고른 항목」으로 보입니다.
   *
   * 이름을 고쳐도 **이미 나간 청구서는 안 바뀝니다** — 청구서에는 발행 시점의 이름이 글자로
   * 굳어 있습니다(`invoice_lines.name`). 지난 청구서가 왜 그 이름이었는지 설명할 수 있어야
   * 하니 그게 맞습니다.
   */
  const [editPlan, setEditPlan] = useState<FeePlan | null>(null);

  /**
   * **납부 옵션을 그 자리에서 적습니다.**
   *
   * 예전에는 `window.prompt` 세 번(이름 → 회차 → 할인율)이었습니다. 창이 뜨는 동안 **다른
   * 옵션 금액이 안 보여서**, 「5개월납을 몇 %로 할까」를 견줄 재료가 화면에서 사라졌습니다.
   * 셋 중 하나에서 취소를 누르면 앞에 친 것도 함께 날아갔습니다.
   */
  const [optForm, setOptForm] = useState<
    { planId: string; id: string | null; name: string; periods: number; rate: number } | null
  >(null);

  /** 항목 카드 안에서 바로 만드는 할인. 이 항목에만 붙습니다. */
  const [planDiscForm, setPlanDiscForm] = useState<
    { planId: string; name: string; kind: "percent" | "amount"; value: number } | null
  >(null);
  const [showInactive, setShowInactive] = useState(false);

  /** 항목별 할인 목록. 항목 카드가 제 할인을 그 자리에서 보여줍니다. */
  const discountsByPlan = useMemo(() => {
    const m = new Map<string, FeeDiscount[]>();
    for (const d of discounts) if (d.plan_id) m.set(d.plan_id, [...(m.get(d.plan_id) ?? []), d]);
    return m;
  }, [discounts]);

  const optionsByPlan = useMemo(() => {
    const m = new Map<string, FeePaymentOption[]>();
    for (const o of options) m.set(o.plan_id, [...(m.get(o.plan_id) ?? []), o]);
    return m;
  }, [options]);

  // 표에 뜨는 순서와 **같은 기준**으로 세웁니다(`sort_order`). 여기서만 다른 순서로 보이면,
  // 끌어서 옮겨놓고 청구 표를 열었을 때 그대로가 아닙니다.
  const shownPlans = plans
    .filter((p) => p.category === tab && (showInactive || p.active))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"));

  /** 지금 끌고 있는 항목. 놓을 자리를 표시하는 데도 씁니다. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  /**
   * **끌어서 순서 바꾸기.**
   *
   * 청구 표의 열 순서가 이 순서입니다. 자주 쓰는 항목이 뒤에 있으면 표를 옆으로 밀어야
   * 닿는데, 지금까지는 순서를 바꾸는 길이 아예 없었습니다(만든 순서로 굳었습니다).
   *
   * 옮긴 순서는 **그 갈래 전체에 다시 번호를 매겨** 저장합니다. 옮긴 줄 하나만 고치면
   * 번호가 겹치고, 겹치면 그 뒤로는 이름순으로 밀려 「왜 안 옮겨지지」가 됩니다.
   */
  async function dropOn(targetId: string) {
    const fromId = dragId;
    setDragId(null);
    setOverId(null);
    if (!fromId || fromId === targetId) return;

    const list = [...shownPlans];
    const from = list.findIndex((p) => p.id === fromId);
    const to = list.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);

    // 화면을 먼저 옮깁니다. 저장을 기다리면 손이 놓은 자리와 화면이 한 박자 어긋나 보입니다.
    const orderById = new Map(list.map((p, i) => [p.id, i]));
    setPlans((prev) => prev.map((p) => (orderById.has(p.id) ? { ...p, sort_order: orderById.get(p.id)! } : p)));

    const supabase = createClient();
    const changed = list.filter((p, i) => p.sort_order !== i);
    for (const [i, p] of list.entries()) {
      if (p.sort_order === i) continue;
      const { error } = await supabase.from("fee_plans").update({ sort_order: i }).eq("id", p.id);
      // 조용히 넘기지 않습니다 - 화면에서는 옮겨졌는데 저장이 안 됐으면, 새로고침하면
      // 원래대로 돌아가고 사람은 자기가 잘못 끈 줄 압니다.
      if (error) {
        setErr(`순서를 저장하지 못했습니다: ${error.message}`);
        return;
      }
    }
    if (changed.length > 0) router.refresh();
  }
  const shownDiscounts = discounts.filter((d) => showInactive || d.active);

  async function addPlan() {
    if (!planForm.name.trim()) return setErr("항목 이름을 넣어주세요.");
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("fee_plans")
      .insert({
        category: planForm.category,
        name: planForm.name.trim(),
        description: planForm.description.trim() || null,
        base_amount: planForm.base_amount,
        unit: planForm.unit,
        sort_order: plans.length,
        created_by: currentUserEmail,
      })
      .select()
      .single();
    setBusy(false);
    if (error || !data) return setErr(error?.message ?? "만들지 못했습니다.");
    setPlans((prev) => [...prev, data as FeePlan]);
    setPlanForm(EMPTY_PLAN);
    setShowPlanForm(false);
  }

  /**
   * 납부 옵션 저장 — **새로 만들 때와 고칠 때가 같은 자리**입니다.
   *
   * 옵션 번호를 학생 등록(`student_fee_enrollments`)이 가리킵니다. 그래서 고칠 때 지우고
   * 새로 만들면 그 옵션을 고른 학생이 통째로 떨어져 나가는데, 화면에는 오류가 아니라
   * 「아무도 안 고른 옵션」으로 보입니다.
   */
  async function saveOption() {
    const form = optForm;
    if (!form) return;
    if (!form.name.trim()) return setErr("옵션 이름을 넣어주세요.");
    const periods = Math.max(1, Number(form.periods) || 1);
    const discount_rate = Math.min(100, Math.max(0, Number(form.rate) || 0)) / 100;

    setBusy(true);
    setErr(null);
    const supabase = createClient();

    if (form.id) {
      const patch = { name: form.name.trim(), periods, discount_rate };
      const { error } = await supabase.from("fee_payment_options").update(patch).eq("id", form.id);
      setBusy(false);
      if (error) return setErr(error.message);
      setOptions((prev) => prev.map((x) => (x.id === form.id ? { ...x, ...patch } : x)));
      setOptForm(null);
      return;
    }

    const { data, error } = await supabase
      .from("fee_payment_options")
      .insert({ plan_id: form.planId, name: form.name.trim(), periods, discount_rate, sort_order: periods })
      .select()
      .single();
    setBusy(false);
    if (error || !data) return setErr(error?.message ?? "만들지 못했습니다.");
    setOptions((prev) => [...prev, data as FeePaymentOption]);
    setOptForm(null);
  }

  /**
   * **이 항목에만 붙는 할인**을 항목 카드에서 바로 만듭니다.
   *
   * 할인 탭까지 건너가서 만들면 「어느 항목 것이었지」를 다시 골라야 하고, 그 자리에서는
   * 그 항목의 기준금액·옵션이 안 보입니다. 10%가 얼마인지 모르는 채로 10%를 적게 됩니다.
   */
  async function addPlanDiscount() {
    const form = planDiscForm;
    if (!form) return;
    if (!form.name.trim()) return setErr("할인 이름을 넣어주세요.");
    const plan = plans.find((p) => p.id === form.planId);
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const value = form.kind === "percent" ? (Number(form.value) || 0) / 100 : Number(form.value) || 0;
    const { data, error } = await supabase
      .from("fee_discounts")
      .insert({
        name: form.name.trim(),
        kind: form.kind,
        value,
        category: plan?.category ?? null,
        plan_id: form.planId,
        sort_order: discounts.length,
        created_by: currentUserEmail,
      })
      .select()
      .single();
    if (error || !data) {
      setBusy(false);
      return setErr(error?.message ?? "만들지 못했습니다.");
    }
    await supabase.from("fee_discount_log").insert({
      discount_id: data.id,
      discount_name: form.name.trim(),
      action: "생성",
      after_value: data,
      changed_by: currentUserEmail,
    });
    setBusy(false);
    setDiscounts((prev) => [data as FeeDiscount, ...prev]);
    setPlanDiscForm(null);
  }

  async function savePlan() {
    const p = editPlan;
    if (!p) return;
    if (!p.name.trim()) return setErr("항목 이름을 넣어주세요.");
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const patch = {
      name: p.name.trim(),
      description: (p.description ?? "").trim() || null,
      base_amount: Number(p.base_amount) || 0,
      unit: p.unit,
    };
    const { error } = await supabase.from("fee_plans").update(patch).eq("id", p.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setPlans((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    setEditPlan(null);
  }

  async function togglePlan(plan: FeePlan) {
    const next = !plan.active;
    setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, active: next } : p)));
    const supabase = createClient();
    const { error } = await supabase.from("fee_plans").update({ active: next }).eq("id", plan.id);
    if (error) {
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? plan : p)));
      setErr(error.message);
    }
  }

  async function addDiscount() {
    if (!discountForm.name.trim()) return setErr("할인 이름을 넣어주세요.");
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const value = discountForm.kind === "percent" ? (discountForm.value || 0) / 100 : discountForm.value || 0;
    const { data, error } = await supabase
      .from("fee_discounts")
      .insert({
        name: discountForm.name.trim(),
        description: discountForm.description.trim() || null,
        kind: discountForm.kind,
        value,
        category: discountForm.category || null,
        // 항목을 고르면 그 항목 전용입니다. 안 고르면 그 분류(학비/학비외) 전체에 걸립니다.
        plan_id: discountForm.plan_id || null,
        requires_approval: discountForm.requires_approval,
        effective_from: discountForm.effective_from || null,
        effective_to: discountForm.effective_to || null,
        sort_order: discounts.length,
        created_by: currentUserEmail,
      })
      .select()
      .single();
    if (error || !data) {
      setBusy(false);
      return setErr(error?.message ?? "만들지 못했습니다.");
    }
    await supabase.from("fee_discount_log").insert({
      discount_id: data.id,
      discount_name: discountForm.name.trim(),
      action: "생성",
      after_value: data,
      changed_by: currentUserEmail,
    });
    setBusy(false);
    setDiscounts((prev) => [data as FeeDiscount, ...prev]);
    setDiscountForm(EMPTY_DISCOUNT);
    setShowDiscountForm(false);
  }

  /** 끄기·켜기. 지우지 않습니다 - 지난 청구서의 근거가 사라지기 때문입니다. */
  async function toggleDiscount(d: FeeDiscount) {
    const next = !d.active;
    const reason = window.prompt(
      next ? `"${d.name}"을 다시 켭니다. 이유를 적어주세요(기록에 남습니다).` : `"${d.name}"을 끕니다. 이유를 적어주세요.\n\n지우는 것이 아니라 끄는 것이라, 이 할인으로 이미 계산된 청구서는 그대로 남습니다.`,
      ""
    );
    if (reason === null) return;
    setDiscounts((prev) => prev.map((x) => (x.id === d.id ? { ...x, active: next } : x)));
    const supabase = createClient();
    const { error } = await supabase.from("fee_discounts").update({ active: next }).eq("id", d.id);
    if (error) {
      setDiscounts((prev) => prev.map((x) => (x.id === d.id ? d : x)));
      return setErr(error.message);
    }
    await supabase.from("fee_discount_log").insert({
      discount_id: d.id,
      discount_name: d.name,
      action: next ? "켬" : "끔",
      before_value: { active: d.active },
      after_value: { active: next },
      changed_by: currentUserEmail,
      reason: reason.trim() || null,
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-extrabold text-[var(--g-ink)]">💰 납부 항목 · 할인</h1>
        <Badge tone="accent">재무 권한 전용</Badge>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--g-muted)]">
        금액을 하나하나 적어두지 않습니다. <b>기준 금액 1회분</b>과 <b>납부 옵션</b>(몇 회분을 묶고 몇 % 깎는가)만
        정해두면 청구액이 저절로 나옵니다 — 요금이 오를 때 한 군데만 고치면 됩니다.
      </p>

      {/* 한눈에 보는 요약. 목록만 있으면 "지금 이 학교의 요금 구조가 어떤 모양인지"를
          매번 머리로 재구성해야 합니다. */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="학비 항목" value={plans.filter((p) => p.category === "학비" && p.active).length} unit="개" />
        <StatCard label="학비외 항목" value={plans.filter((p) => p.category === "학비외" && p.active).length} unit="개" tone="ok" />
        <StatCard label="쓰는 중인 할인" value={discounts.filter((d) => d.active).length} unit="개" tone="warn" />
        <Card hover className="flex items-center gap-3 px-4 py-3">
          <Donut
            value={discounts.filter((d) => d.active).length}
            max={Math.max(1, discounts.length)}
            size={64}
            thickness={8}
            color="var(--g-accent)"
          />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[var(--g-muted)]">할인 중 켜둔 비율</div>
            <div className="text-[11px] leading-relaxed text-[var(--g-muted)]">
              꺼둔 것 {discounts.filter((d) => !d.active).length}개는 <b>지운 게 아니라 꺼둔 것</b>입니다.
            </div>
          </div>
        </Card>
      </div>

      {loadError && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          읽지 못했습니다: {loadError} — 진단 화면에서 마이그레이션이 걸렸는지 확인해주세요.
        </p>
      )}
      {err && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {err}
          <button onClick={() => setErr(null)} className="ml-2 font-bold underline">닫기</button>
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["학비", "학비외", "할인"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "glass"} onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          꺼둔 것도 보기
        </label>
      </div>

      {tab !== "할인" ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button variant="glass" size="sm" onClick={() => setShowPlanForm((v) => !v)}>
              + {tab} 항목 추가
            </Button>
            {/* 청구 표의 열 순서가 여기 순서입니다. 그 사실을 적어두지 않으면, 표에서 열을
                옮기려고 표 쪽을 뒤지게 됩니다. */}
            <span className="text-[11px] text-[var(--g-muted)]">
              ⠿ 를 잡고 <b>끌어서 순서를 옮길 수 있습니다</b> — 이 순서가 청구 표의 열 순서입니다.
            </span>
          </div>
          {showPlanForm && (
            <div className="g-panel mb-3 flex flex-wrap items-end gap-2 p-3">
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value, category: tab }))}
                placeholder={tab === "학비" ? "예: 정규과정 / 방과후 5일반" : "예: 셔틀 / 교재비 / 교복"}
                className="w-56"
              />
              <label className="text-[11px] text-slate-500">
                기준 금액
                <Input
                  type="number"
                  value={planForm.base_amount}
                  onChange={(e) => setPlanForm((f) => ({ ...f, base_amount: Number(e.target.value) || 0 }))}
                  className="ml-1 w-32"
                />
              </label>
              <Select
                value={planForm.unit}
                onChange={(e) => setPlanForm((f) => ({ ...f, unit: e.target.value as FeePlan["unit"] }))}
                >
                <option value="월">월당</option>
                <option value="학기">학기당</option>
                <option value="연">연간</option>
                <option value="회">1회</option>
              </Select>
              <Button size="sm" onClick={addPlan} disabled={busy}>만들기</Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {shownPlans.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-slate-400">
                아직 {tab} 항목이 없습니다. 위에서 하나 만들어보세요.
              </p>
            )}
            {shownPlans.map((p) => (
              (() => {
                const opts = optionsByPlan.get(p.id) ?? [];
                // 막대는 **가장 비싼 옵션**을 기준으로 그립니다. 그래야 "연납이 얼마나 큰
                // 덩어리인지"와 "월납이 그중 얼마인지"가 한눈에 견줍니다.
                const maxAmt = Math.max(1, ...opts.map((o) => optionAmount(p, o)));
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(p.id);
                      e.dataTransfer.effectAllowed = "move";
                      // 파이어폭스는 담긴 자료가 없으면 끌기를 시작하지 않습니다.
                      e.dataTransfer.setData("text/plain", p.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragId || dragId === p.id) return;
                      e.preventDefault(); // 막지 않으면 놓을 수 없습니다.
                      e.dataTransfer.dropEffect = "move";
                      setOverId(p.id);
                    }}
                    onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      void dropOn(p.id);
                    }}
                    className={
                      "rounded-2xl transition " +
                      (overId === p.id ? "ring-2 ring-teal-400 ring-offset-2" : "") +
                      (dragId === p.id ? " opacity-40" : "")
                    }
                  >
                  <Card hover className={p.active ? "" : "opacity-55"}>
                    <CardHeader>
                      <div className="flex flex-wrap items-baseline gap-2">
                        {/* 끌 수 있다는 것은 **보여야** 압니다. 아무 표시 없이 끌리기만 하면
                            아무도 시도하지 않습니다. */}
                        <span className="cursor-grab select-none text-slate-300" title="끌어서 순서를 옮깁니다">
                          ⠿
                        </span>
                        <CardTitle>{p.name}</CardTitle>
                        <span className="text-[11px] font-semibold text-[var(--g-muted)]">
                          {won(Number(p.base_amount))} / {p.unit}
                        </span>
                        {!p.active && <Badge>꺼둠</Badge>}
                      </div>
                      <div className="flex gap-1">
                        {/* 이름·금액을 고치는 자리. 없으면 오타 하나 때문에 항목을 새로
                            만들게 되고, 그러면 그 항목으로 등록해 둔 학생이 통째로 떨어져
                            나갑니다. */}
                        <Button size="sm" variant="glass" onClick={() => setEditPlan({ ...p })}>
                          고치기
                        </Button>
                        <Button size="sm" variant="glass" onClick={() => togglePlan(p)}>
                          {p.active ? "끄기" : "켜기"}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      {editPlan?.id === p.id && (
                        <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--g-accent)] bg-white/70 p-2">
                          <Input
                            value={editPlan.name}
                            onChange={(e) => setEditPlan((f) => (f ? { ...f, name: e.target.value } : f))}
                            className="w-64"
                            placeholder="항목 이름"
                          />
                          <label className="text-[11px] text-slate-500">
                            기준 금액
                            <Input
                              type="number"
                              value={editPlan.base_amount}
                              onChange={(e) =>
                                setEditPlan((f) => (f ? { ...f, base_amount: Number(e.target.value) || 0 } : f))
                              }
                              className="ml-1 w-32"
                            />
                          </label>
                          <Select
                            value={editPlan.unit}
                            onChange={(e) => setEditPlan((f) => (f ? { ...f, unit: e.target.value as FeePlan["unit"] } : f))}
                          >
                            <option value="월">월당</option>
                            <option value="학기">학기당</option>
                            <option value="연">연간</option>
                            <option value="회">1회</option>
                          </Select>
                          <Button size="sm" onClick={() => void savePlan()} disabled={busy}>
                            저장
                          </Button>
                          <Button size="sm" variant="glass" onClick={() => setEditPlan(null)}>
                            취소
                          </Button>
                          <p className="w-full text-[10px] text-[var(--g-muted)]">
                            이름을 고쳐도 <b>이미 나간 청구서는 그대로</b>입니다 — 청구서에는 발행 시점의 이름이 굳어
                            있습니다. 등록해 둔 학생과 앞으로 나갈 청구서에만 새 이름이 쓰입니다.
                          </p>
                        </div>
                      )}
                      {opts.map((o) => (
                        <div key={o.id}>
                          <BarRow
                            label={o.name}
                            value={optionAmount(p, o)}
                            max={maxAmt}
                            suffix="원"
                            color={Number(o.discount_rate) > 0 ? "#10b981" : "var(--g-accent)"}
                          />
                          <div className="ml-[5.25rem] flex items-center gap-1.5 text-[10px] text-[var(--g-muted)]">
                            <span>
                              {o.periods}
                              {p.unit}분
                            </span>
                            {Number(o.discount_rate) > 0 && (
                              <span className="font-bold text-emerald-600">
                                −{Math.round(Number(o.discount_rate) * 100)}%
                              </span>
                            )}
                            {/* 옵션도 고칠 수 있어야 합니다. 옵션 번호를 학생 등록이
                                가리키므로 지우고 새로 만들면 고른 학생이 떨어져 나갑니다. */}
                            <button
                              type="button"
                              onClick={() =>
                                setOptForm({
                                  planId: p.id,
                                  id: o.id,
                                  name: o.name,
                                  periods: o.periods,
                                  rate: Math.round(Number(o.discount_rate) * 100),
                                })
                              }
                              disabled={busy}
                              className="rounded px-1 font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                              title="옵션 이름·회차·할인율을 고칩니다"
                            >
                              고치기
                            </button>
                          </div>
                        </div>
                      ))}
                      {opts.length === 0 && (
                        <p className="py-2 text-center text-[11px] text-[var(--g-muted)]">
                          납부 옵션이 없습니다 — 학부모가 고를 것이 없다는 뜻입니다.
                          {p.unit === "연" && (
                            <>
                              <br />
                              연 1회 내는 항목도 <b>「1년 납부」 옵션 하나</b>는 있어야 명단에 뜹니다.
                            </>
                          )}
                        </p>
                      )}
                      {/* **옵션을 그 자리에서 적습니다.** 창을 띄우면 다른 옵션 금액이 가려져,
                          「5개월납을 몇 %로 할까」를 견줄 재료가 화면에서 사라집니다. */}
                      {optForm?.planId === p.id ? (
                        <div className="mt-1 flex flex-wrap items-end gap-1.5 rounded-lg border border-[var(--g-accent)] bg-white/70 p-2">
                          <Input
                            value={optForm.name}
                            onChange={(e) => setOptForm((f) => (f ? { ...f, name: e.target.value } : f))}
                            placeholder="예: 1년 납부"
                            className="w-36"
                          />
                          <label className="text-[11px] text-slate-500">
                            몇 {p.unit}분
                            <Input
                              type="number"
                              value={optForm.periods}
                              onChange={(e) => setOptForm((f) => (f ? { ...f, periods: Number(e.target.value) || 1 } : f))}
                              className="ml-1 w-16"
                            />
                          </label>
                          <label className="text-[11px] text-slate-500">
                            할인 %
                            <Input
                              type="number"
                              value={optForm.rate}
                              onChange={(e) => setOptForm((f) => (f ? { ...f, rate: Number(e.target.value) || 0 } : f))}
                              className="ml-1 w-16"
                            />
                          </label>
                          {/* 적는 동안 금액이 따라 움직입니다. 다 적고 저장한 뒤에야 금액을 보면
                              틀린 것을 고치려고 같은 자리를 또 엽니다. */}
                          <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold tabular-nums text-slate-700">
                            {won(
                              Math.round(
                                Number(p.base_amount) *
                                  Math.max(1, optForm.periods || 1) *
                                  (1 - Math.min(100, Math.max(0, optForm.rate || 0)) / 100),
                              ),
                            )}
                          </span>
                          <Button size="sm" onClick={() => void saveOption()} disabled={busy}>
                            저장
                          </Button>
                          <Button size="sm" variant="glass" onClick={() => setOptForm(null)}>
                            취소
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="soft"
                          onClick={() => setOptForm({ planId: p.id, id: null, name: "", periods: 1, rate: 0 })}
                          disabled={busy}
                          className="mt-1"
                        >
                          + 납부 옵션
                        </Button>
                      )}

                      {/* ── 이 항목에 붙는 할인 ─────────────────────────────────────
                          할인은 항목마다 다릅니다. 정규과정에는 목사 자제·형제자매·유치부
                          졸업이, 방과후에는 5개월납·10개월납이 붙습니다. 한 목록으로 두면
                          청구 표에서 고를 때 남의 항목 할인이 섞여 뜨고, 잘못 붙은 할인은
                          오류가 아니라 그냥 깎인 금액으로 보입니다. */}
                      <div className="mt-2 border-t border-dashed border-slate-200 pt-2">
                        <div className="mb-1 flex flex-wrap items-center gap-1">
                          <span className="text-[11px] font-bold text-slate-500">이 항목 할인</span>
                          {(discountsByPlan.get(p.id) ?? []).length === 0 && (
                            <span className="text-[10px] text-slate-400">아직 없습니다</span>
                          )}
                          {(discountsByPlan.get(p.id) ?? []).map((d) => (
                            <span
                              key={d.id}
                              className={
                                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold " +
                                (d.active ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-400 line-through")
                              }
                            >
                              {d.name}
                              <span className="font-extrabold">
                                {d.kind === "percent" ? `−${Math.round(Number(d.value) * 100)}%` : `−${won(Number(d.value))}`}
                              </span>
                              <button
                                type="button"
                                onClick={() => void toggleDiscount(d)}
                                className="text-slate-400 hover:text-slate-700"
                                title={d.active ? "이 할인을 끕니다(지우지 않습니다)" : "다시 켭니다"}
                              >
                                {d.active ? "끄기" : "켜기"}
                              </button>
                            </span>
                          ))}
                        </div>
                        {planDiscForm?.planId === p.id ? (
                          <div className="flex flex-wrap items-end gap-1.5 rounded-lg border border-violet-300 bg-violet-50/60 p-2">
                            <Input
                              value={planDiscForm.name}
                              onChange={(e) => setPlanDiscForm((f) => (f ? { ...f, name: e.target.value } : f))}
                              placeholder="예: 목사 자제 / 형제자매"
                              className="w-40"
                            />
                            <Select
                              value={planDiscForm.kind}
                              onChange={(e) =>
                                setPlanDiscForm((f) => (f ? { ...f, kind: e.target.value as "percent" | "amount" } : f))
                              }
                            >
                              <option value="percent">％ 비율</option>
                              <option value="amount">원 정액</option>
                            </Select>
                            <Input
                              type="number"
                              value={planDiscForm.value}
                              onChange={(e) => setPlanDiscForm((f) => (f ? { ...f, value: Number(e.target.value) || 0 } : f))}
                              className="w-24"
                            />
                            <Button size="sm" onClick={() => void addPlanDiscount()} disabled={busy}>
                              만들기
                            </Button>
                            <Button size="sm" variant="glass" onClick={() => setPlanDiscForm(null)}>
                              취소
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPlanDiscForm({ planId: p.id, name: "", kind: "percent", value: 10 })}
                            className="rounded-lg border border-violet-300 px-2 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-50"
                          >
                            + 이 항목 할인
                          </button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  </div>
                );
              })()
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900">
            할인은 <b>지우지 않고 끕니다.</b> 지워버리면 작년 청구서가 왜 그 금액이었는지 설명할 수 없게 됩니다 —
            &quot;지금 쓰는 할인&quot;과 &quot;그때 썼던 할인&quot;은 다른 물음이고, 둘 다 답할 수 있어야 합니다.
            켜고 끈 기록은 이유와 함께 남습니다.
          </div>
          <Button variant="glass" size="sm" className="mb-2" onClick={() => setShowDiscountForm((v) => !v)}>
            + 할인 항목 추가
          </Button>
          {showDiscountForm && (
            <div className="g-panel mb-3 flex flex-wrap items-end gap-2 p-3">
              <Input
                value={discountForm.name}
                onChange={(e) => setDiscountForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="할인 이름 (예: 형제 할인)"
                className="w-44"
              />
              <Select
                value={discountForm.kind}
                onChange={(e) => setDiscountForm((f) => ({ ...f, kind: e.target.value as "percent" | "amount" }))}
                
              >
                <option value="percent">비율(%)</option>
                <option value="amount">정액(원)</option>
              </Select>
              <Input
                type="number"
                value={discountForm.value}
                onChange={(e) => setDiscountForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))}
                className="w-24"
              />
              {/* **어느 항목에 붙는 할인인가.** 할인은 항목마다 다릅니다 - 정규과정에는 목사
                  자제·형제자매가, 방과후에는 5개월납·10개월납이 붙습니다. 안 고르면 그
                  분류(학비/학비외) 전체에 걸립니다. */}
              <Select
                value={discountForm.plan_id}
                onChange={(e) => setDiscountForm((f) => ({ ...f, plan_id: e.target.value }))}
                title="이 할인이 붙는 납부 항목"
              >
                <option value="">항목 가리지 않음</option>
                {plans
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.category} · {p.name}
                    </option>
                  ))}
              </Select>
              <Select
                value={discountForm.category}
                onChange={(e) => setDiscountForm((f) => ({ ...f, category: e.target.value as "" | "학비" | "학비외" }))}
                disabled={!!discountForm.plan_id}
                title={discountForm.plan_id ? "항목을 고르면 그 항목의 분류를 따릅니다" : undefined}
              >
                <option value="">학비·학비외 모두</option>
                <option value="학비">학비만</option>
                <option value="학비외">학비외만</option>
              </Select>
              <label className="flex items-center gap-1 text-[11px] text-slate-600" title="금액이 큰 감면은 걸고 승인받는 것이 안전합니다.">
                <Input
                  type="checkbox"
                  checked={discountForm.requires_approval}
                  onChange={(e) => setDiscountForm((f) => ({ ...f, requires_approval: e.target.checked }))}
                />
                최고관리자 승인 필요
              </label>
              <Input
                value={discountForm.description}
                onChange={(e) => setDiscountForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="설명(선택)"
                className="min-w-[10rem] flex-1"
              />
              <Button size="sm" onClick={addDiscount} disabled={busy}>만들기</Button>
            </div>
          )}

          <div className="g-panel-solid overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/50 text-[var(--g-muted)]">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">할인 이름</th>
                  <th className="px-2 py-1.5 font-semibold">깎는 값</th>
                  <th className="px-2 py-1.5 font-semibold">적용 범위</th>
                  <th className="px-2 py-1.5 font-semibold">기간</th>
                  <th className="px-2 py-1.5 font-semibold">승인</th>
                  <th className="px-2 py-1.5 text-right font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {shownDiscounts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      아직 할인 항목이 없습니다.
                    </td>
                  </tr>
                )}
                {shownDiscounts.map((d) => (
                  <tr key={d.id} className={"border-t border-slate-100 " + (d.active ? "" : "opacity-45")}>
                    <td className="px-2 py-1.5">
                      <b className="text-slate-800">{d.name}</b>
                      {d.description && <div className="text-[10px] text-slate-400">{d.description}</div>}
                    </td>
                    <td className="px-2 py-1.5 font-semibold text-slate-700">
                      {d.kind === "percent" ? `${Math.round(Number(d.value) * 100)}%` : won(Number(d.value))}
                    </td>
                    {/* 어느 항목 것인지 적습니다. 「학비」라고만 적혀 있으면 정규과정 할인인지
                        방과후 할인인지 알 수 없고, 그러면 청구 표에서 엉뚱한 칸에 붙입니다. */}
                    <td className="px-2 py-1.5 text-slate-500">
                      {d.plan_id ? (
                        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-800">
                          {plans.find((p) => p.id === d.plan_id)?.name ?? "지워진 항목"}
                        </span>
                      ) : (
                        <>{d.category ?? "전체"}</>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">
                      {d.effective_from || d.effective_to ? `${d.effective_from ?? "…"} ~ ${d.effective_to ?? "…"}` : "제한 없음"}
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{d.requires_approval ? "필요" : "-"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => toggleDiscount(d)}
                        className={
                          "rounded px-2 py-0.5 text-[11px] font-bold " +
                          (d.active
                            ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border border-slate-300 text-slate-500 hover:bg-slate-50")
                        }
                      >
                        {d.active ? "쓰는 중 · 끄기" : "꺼둠 · 켜기"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!canApprove && (
            <p className="mt-2 text-[11px] text-slate-400">
              &apos;승인 필요&apos;로 표시된 할인은 학생에게 붙일 때 최고관리자 승인이 있어야 합니다.
            </p>
          )}
        </>
      )}

      <Button variant="ghost" size="sm" className="mt-3" onClick={() => router.refresh()}>
        새로 읽기
      </Button>
    </div>
  );
}
