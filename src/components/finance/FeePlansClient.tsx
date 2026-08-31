"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { FeePlan, FeePaymentOption, FeeDiscount } from "@/lib/types";

// 요금제 · 할인 (재무 전용)
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
  const [showInactive, setShowInactive] = useState(false);

  const optionsByPlan = useMemo(() => {
    const m = new Map<string, FeePaymentOption[]>();
    for (const o of options) m.set(o.plan_id, [...(m.get(o.plan_id) ?? []), o]);
    return m;
  }, [options]);

  const shownPlans = plans.filter((p) => p.category === tab && (showInactive || p.active));
  const shownDiscounts = discounts.filter((d) => showInactive || d.active);

  async function addPlan() {
    if (!planForm.name.trim()) return setErr("요금제 이름을 넣어주세요.");
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

  async function addOption(plan: FeePlan) {
    const name = window.prompt(`${plan.name} — 납부 옵션 이름 (예: 월 납부 / 5개월 납부 / 1년 납부)`, "");
    if (!name?.trim()) return;
    const periodsRaw = window.prompt(`몇 ${plan.unit}분을 한 번에 내나요? (숫자)`, "1");
    if (periodsRaw === null) return;
    const rateRaw = window.prompt("할인율 (%). 없으면 0", "0");
    if (rateRaw === null) return;
    const periods = Math.max(1, Number(periodsRaw) || 1);
    const rate = Math.min(100, Math.max(0, Number(rateRaw) || 0)) / 100;

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("fee_payment_options")
      .insert({ plan_id: plan.id, name: name.trim(), periods, discount_rate: rate, sort_order: periods })
      .select()
      .single();
    setBusy(false);
    if (error || !data) return setErr(error?.message ?? "만들지 못했습니다.");
    setOptions((prev) => [...prev, data as FeePaymentOption]);
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
        <h1 className="text-lg font-bold text-slate-800">💰 요금제 · 할인</h1>
        <span className="text-[11px] text-slate-400">재무 권한이 있는 사람만 볼 수 있는 화면입니다.</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
        금액을 하나하나 적어두지 않습니다. <b>기준 금액 1회분</b>과 <b>납부 옵션</b>(몇 회분을 묶고 몇 % 깎는가)만
        정해두면 청구액이 저절로 나옵니다 — 요금이 오를 때 한 군데만 고치면 됩니다.
      </p>

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
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-bold " +
              (tab === t ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")
            }
          >
            {t}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          꺼둔 것도 보기
        </label>
      </div>

      {tab !== "할인" ? (
        <>
          <button
            onClick={() => setShowPlanForm((v) => !v)}
            className="mb-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            + {tab} 요금제 추가
          </button>
          {showPlanForm && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                value={planForm.name}
                onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value, category: tab }))}
                placeholder={tab === "학비" ? "예: 정규과정 / 방과후 5일반" : "예: 셔틀 / 교재비 / 교복"}
                className="w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
              <label className="text-[11px] text-slate-500">
                기준 금액
                <input
                  type="number"
                  value={planForm.base_amount}
                  onChange={(e) => setPlanForm((f) => ({ ...f, base_amount: Number(e.target.value) || 0 }))}
                  className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
              </label>
              <select
                value={planForm.unit}
                onChange={(e) => setPlanForm((f) => ({ ...f, unit: e.target.value as FeePlan["unit"] }))}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="월">월당</option>
                <option value="학기">학기당</option>
                <option value="연">연간</option>
                <option value="회">1회</option>
              </select>
              <button
                onClick={addPlan}
                disabled={busy}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                만들기
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {shownPlans.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-slate-400">
                아직 {tab} 요금제가 없습니다. 위에서 하나 만들어보세요.
              </p>
            )}
            {shownPlans.map((p) => (
              <div
                key={p.id}
                className={"rounded-xl border bg-white p-3 " + (p.active ? "border-slate-200" : "border-slate-200 opacity-50")}
              >
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                  <b className="text-sm text-slate-800">{p.name}</b>
                  <span className="text-xs text-slate-500">
                    {won(Number(p.base_amount))} / {p.unit}
                  </span>
                  {!p.active && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500">꺼둠</span>}
                  <button
                    onClick={() => togglePlan(p)}
                    className="ml-auto rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                  >
                    {p.active ? "끄기" : "켜기"}
                  </button>
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="py-1 font-semibold">납부 옵션</th>
                      <th className="py-1 font-semibold">회차</th>
                      <th className="py-1 font-semibold">할인</th>
                      <th className="py-1 text-right font-semibold">청구액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(optionsByPlan.get(p.id) ?? []).map((o) => (
                      <tr key={o.id} className="border-t border-slate-100">
                        <td className="py-1 font-semibold text-slate-700">{o.name}</td>
                        <td className="py-1 text-slate-500">
                          {o.periods}
                          {p.unit}
                        </td>
                        <td className="py-1 text-slate-500">
                          {Number(o.discount_rate) > 0 ? `${Math.round(Number(o.discount_rate) * 100)}%` : "-"}
                        </td>
                        <td className="py-1 text-right font-bold text-slate-800">{won(optionAmount(p, o))}</td>
                      </tr>
                    ))}
                    {(optionsByPlan.get(p.id) ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-2 text-center text-[11px] text-slate-300">
                          납부 옵션이 없습니다 — 학부모가 고를 것이 없다는 뜻입니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <button
                  onClick={() => addOption(p)}
                  disabled={busy}
                  className="mt-1.5 rounded border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  + 납부 옵션
                </button>
              </div>
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
          <button
            onClick={() => setShowDiscountForm((v) => !v)}
            className="mb-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            + 할인 항목 추가
          </button>
          {showDiscountForm && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                value={discountForm.name}
                onChange={(e) => setDiscountForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="할인 이름 (예: 형제 할인)"
                className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
              <select
                value={discountForm.kind}
                onChange={(e) => setDiscountForm((f) => ({ ...f, kind: e.target.value as "percent" | "amount" }))}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="percent">비율(%)</option>
                <option value="amount">정액(원)</option>
              </select>
              <input
                type="number"
                value={discountForm.value}
                onChange={(e) => setDiscountForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))}
                className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
              <select
                value={discountForm.category}
                onChange={(e) => setDiscountForm((f) => ({ ...f, category: e.target.value as "" | "학비" | "학비외" }))}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="">학비·학비외 모두</option>
                <option value="학비">학비만</option>
                <option value="학비외">학비외만</option>
              </select>
              <label className="flex items-center gap-1 text-[11px] text-slate-600" title="금액이 큰 감면은 걸고 승인받는 것이 안전합니다.">
                <input
                  type="checkbox"
                  checked={discountForm.requires_approval}
                  onChange={(e) => setDiscountForm((f) => ({ ...f, requires_approval: e.target.checked }))}
                />
                최고관리자 승인 필요
              </label>
              <input
                value={discountForm.description}
                onChange={(e) => setDiscountForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="설명(선택)"
                className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
              <button
                onClick={addDiscount}
                disabled={busy}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                만들기
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
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
                    <td className="px-2 py-1.5 text-slate-500">{d.category ?? "전체"}</td>
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

      <button
        onClick={() => router.refresh()}
        className="mt-3 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
      >
        새로 읽기
      </button>
    </div>
  );
}
