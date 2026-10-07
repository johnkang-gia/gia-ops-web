"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { won } from "@/lib/feeItems";
import type { FeePlan } from "@/lib/types";

export type AddonRow = {
  id: string;
  addon_plan_id: string;
  base_plan_id: string;
  combined_amount: number | string;
  active: boolean;
  note: string | null;
};

/**
 * **함께 하면 값이 바뀌는 프로그램** — 오케스트라·매쓰팀처럼 다른 방과후와 같이 할 때 합친 금액이
 * 정해진 것.
 *
 * 학교 안내문 그대로 **합친 금액**을 적습니다(주5회 + 오케스트라 = 55만원). 청구서에는 방과후는
 * 원래 금액, 이 프로그램은 차액으로 따로 한 줄이 나갑니다(`tuitionAddon.ts`). 프로그램을 하는
 * 아이만 요금표·학생 창에서 이 항목의 납부 옵션을 고르면 됩니다 - 안 고른 아이에게는 아무것도
 * 안 붙습니다.
 *
 * 새 프로그램은 [학비 요금표]에서 학비 항목으로 하나 만들고(혼자는 안 받으면 기준금액 0원), 여기서
 * 「함께 하는 항목 → 합친 금액」 줄을 더하면 됩니다. 조합마다 항목을 따로 만들지 않습니다.
 */
export default function AddonPricesPanel({ plans, rows }: { plans: FeePlan[]; rows: AddonRow[] }) {
  useFinanceLive();
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const tuitionPlans = useMemo(() => plans.filter((p) => p.category === "학비" && p.active), [plans]);
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? "(지운 항목)";
  const addonIds = useMemo(() => [...new Set(rows.map((r) => r.addon_plan_id))], [rows]);
  const [newAddon, setNewAddon] = useState("");
  const [draft, setDraft] = useState<Record<string, { base: string; amount: string }>>({});

  async function save(addonId: string) {
    const d = draft[addonId] ?? { base: "", amount: "" };
    const amount = Math.round(Number(String(d.amount).replace(/[^\d]/g, "")));
    if (!d.base) return notify("함께 하는 항목을 고르세요.", "error");
    if (d.base === addonId) return notify("같은 항목끼리는 묶을 수 없습니다.", "error");
    if (!Number.isFinite(amount) || amount <= 0) return notify("합친 금액을 적어주세요.", "error");
    setBusy(true);
    const { error } = await createClient()
      .from("fee_addon_prices")
      .upsert({ addon_plan_id: addonId, base_plan_id: d.base, combined_amount: amount, active: true }, { onConflict: "addon_plan_id,base_plan_id" });
    setBusy(false);
    if (error) return notify(`저장하지 못했습니다: ${error.message}`, "error");
    notify(`${planName(d.base)} + ${planName(addonId)} = ${won(amount)} 로 적었습니다.`, "success");
    setDraft((p) => ({ ...p, [addonId]: { base: "", amount: "" } }));
    router.refresh();
  }

  async function setAmount(r: AddonRow, raw: string) {
    const amount = Math.round(Number(raw.replace(/[^\d]/g, "")));
    if (!Number.isFinite(amount) || amount <= 0 || amount === Number(r.combined_amount)) return;
    setBusy(true);
    const { error } = await createClient().from("fee_addon_prices").update({ combined_amount: amount }).eq("id", r.id);
    setBusy(false);
    if (error) return notify(`고치지 못했습니다: ${error.message}`, "error");
    notify(`${planName(r.base_plan_id)} + ${planName(r.addon_plan_id)} = ${won(amount)}`, "success");
    router.refresh();
  }

  /** 지우지 않고 끕니다 - 지난 청구서가 왜 그 금액이었는지 설명할 수 있어야 합니다. */
  async function toggle(r: AddonRow) {
    setBusy(true);
    const { error } = await createClient().from("fee_addon_prices").update({ active: !r.active }).eq("id", r.id);
    setBusy(false);
    if (error) return notify(`바꾸지 못했습니다: ${error.message}`, "error");
    router.refresh();
  }

  const shown = [...addonIds, ...(newAddon && !addonIds.includes(newAddon) ? [newAddon] : [])];

  return (
    <section className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black text-violet-900">🎻 함께 하면 금액이 바뀌는 프로그램</h2>
        <span className="text-[11px] text-violet-700">
          안내문의 합친 금액을 그대로 적습니다. 청구서에는 방과후 금액 + 프로그램 차액으로 나뉘어 나갑니다. 하는 아이만 학생 창에서 이 항목의 납부 옵션을 고르세요.
        </span>
      </div>
      {shown.length === 0 && <p className="text-[12px] text-slate-500">아직 없습니다. 아래에서 프로그램 항목을 골라 시작하세요.</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {shown.map((addonId) => {
          const list = rows.filter((r) => r.addon_plan_id === addonId).sort((a, b) => Number(b.combined_amount) - Number(a.combined_amount));
          const addonPlan = plans.find((p) => p.id === addonId);
          const d = draft[addonId] ?? { base: "", amount: "" };
          return (
            <div key={addonId} className="rounded-lg border border-violet-200 bg-white p-2">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <b className="text-[13px] text-slate-800">{planName(addonId)}</b>
                <span className="text-[11px] text-slate-500">
                  혼자 할 때 {addonPlan && Number(addonPlan.base_amount) > 0 ? won(Number(addonPlan.base_amount)) : "신청 불가(기준금액 0원)"}
                </span>
              </div>
              <table className="w-full text-[12px]">
                <thead className="text-[10px] text-slate-400">
                  <tr>
                    <th className="text-left font-semibold">함께 하는 항목</th>
                    <th className="text-right font-semibold">합친 금액(월)</th>
                    <th className="text-right font-semibold">프로그램 몫</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const base = plans.find((p) => p.id === r.base_plan_id);
                    const delta = Number(r.combined_amount) - Number(base?.base_amount ?? 0);
                    return (
                      <tr key={r.id} className={"border-t border-slate-100 " + (r.active ? "" : "text-slate-300 line-through")}>
                        <td className="py-0.5">
                          {planName(r.base_plan_id)} <span className="text-[10px] text-slate-400">{base ? won(Number(base.base_amount)) : ""}</span>
                        </td>
                        <td className="py-0.5 text-right">
                          <input
                            defaultValue={String(Math.round(Number(r.combined_amount)))}
                            disabled={busy || !r.active}
                            onBlur={(e) => void setAmount(r, e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            className="w-24 rounded border border-slate-200 px-1 text-right tabular-nums"
                          />
                        </td>
                        <td className={"py-0.5 text-right tabular-nums " + (delta < 0 ? "font-bold text-rose-600" : "text-violet-800")} title={delta < 0 ? "합친 금액이 함께 하는 항목보다 작습니다 - 0원으로 청구됩니다" : ""}>
                          {won(Math.max(0, delta))}
                        </td>
                        <td className="py-0.5 text-right">
                          <button onClick={() => void toggle(r)} disabled={busy} className="text-[10px] font-bold text-slate-400 hover:text-slate-700" title={r.active ? "이 조합을 끕니다(지우지 않음)" : "다시 켭니다"}>
                            {r.active ? "끄기" : "켜기"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <select
                  value={d.base}
                  onChange={(e) => setDraft((p) => ({ ...p, [addonId]: { ...d, base: e.target.value } }))}
                  className="min-w-0 flex-1 rounded border border-dashed border-slate-300 px-1 py-0.5 text-[11px]"
                >
                  <option value="">＋ 함께 하는 항목…</option>
                  {tuitionPlans
                    .filter((p) => p.id !== addonId && !list.some((r) => r.base_plan_id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {won(Number(p.base_amount))}
                      </option>
                    ))}
                </select>
                <input
                  value={d.amount}
                  onChange={(e) => setDraft((p) => ({ ...p, [addonId]: { ...d, amount: e.target.value } }))}
                  placeholder="합친 금액"
                  className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px]"
                />
                <button onClick={() => void save(addonId)} disabled={busy} className="rounded bg-violet-700 px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-40">
                  더하기
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px]">
        <select value={newAddon} onChange={(e) => setNewAddon(e.target.value)} className="rounded border border-dashed border-violet-300 px-1 py-0.5">
          <option value="">＋ 새 프로그램 (학비 항목 고르기)…</option>
          {tuitionPlans
            .filter((p) => !addonIds.includes(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <span className="text-slate-500">목록에 없으면 아래 학비 요금표에서 항목을 먼저 만드세요.</span>
      </div>
    </section>
  );
}
