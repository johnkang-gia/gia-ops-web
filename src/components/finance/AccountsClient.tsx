"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { accountLabel, treeOrder, type AccountRow } from "@/lib/revenueAccounts";

type Plan = { id: string; name: string; category: string; active: boolean; revenue_account_id: string | null };
type Cat = { id: string; name: string; revenue_account_id: string | null };
type Item = { id: string; code: string | null; name: string; name_ko: string | null; category: string; revenue_account_id: string | null };

const LEVELS = ["관", "항", "목"] as const;

export default function AccountsClient({
  accounts,
  plans,
  categories,
  items,
  loadError,
}: {
  accounts: (AccountRow & { note: string | null })[];
  plans: Plan[];
  categories: Cat[];
  items: Item[];
  loadError: string | null;
}) {
  useFinanceLive(["fee_categories"]);
  const notify = useToast();
  const router = useRouter();
  const tree = useMemo(() => treeOrder(accounts), [accounts]);
  const leaves = tree.filter((a) => a.level === "목" && a.active);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const catAcc = useMemo(() => new Map(categories.map((c) => [c.name, c.revenue_account_id])), [categories]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ code: "", name: "", level: "목" as (typeof LEVELS)[number], parent: "" });
  const [showItems, setShowItems] = useState(false);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      notify(error.message, "error");
      return false;
    }
    notify(ok, "success");
    router.refresh();
    return true;
  }

  const sb = () => createClient();
  const setPlan = (id: string, acc: string) => run(() => sb().from("fee_plans").update({ revenue_account_id: acc || null }).eq("id", id), "학비 항목의 과목을 정했습니다.");
  const setCat = (id: string, acc: string) => run(() => sb().from("fee_categories").update({ revenue_account_id: acc || null }).eq("id", id), "분류의 과목을 정했습니다.");
  const setItem = (id: string, acc: string) => run(() => sb().from("fee_items").update({ revenue_account_id: acc || null }).eq("id", id), "항목의 과목을 정했습니다.");

  async function add() {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!/^\d{3,6}$/.test(code)) return notify("코드는 숫자 3~6자리로 적어주세요.", "error");
    if (!name) return notify("과목 이름을 적어주세요.", "error");
    if (draft.level !== "관" && !draft.parent) return notify("위 과목을 골라주세요.", "error");
    const ok = await run(
      () => sb().from("revenue_accounts").insert({ code, name, level: draft.level, parent_id: draft.level === "관" ? null : draft.parent, sort_order: Number(code) }),
      `${code} ${name} 과목을 만들었습니다.`,
    );
    if (ok) setDraft({ code: "", name: "", level: "목", parent: "" });
  }

  const Picker = ({ value, onPick, fallback }: { value: string | null; onPick: (v: string) => void; fallback?: string }) => (
    <select
      value={value ?? ""}
      disabled={busy}
      onChange={(e) => onPick(e.target.value)}
      className={"w-56 rounded border px-1.5 py-0.5 text-[12px] " + (value ? "border-slate-200" : "border-amber-300 bg-amber-50")}
    >
      <option value="">{fallback ?? "— 정하지 않음 —"}</option>
      {leaves.map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-[16px] font-black text-slate-800">🏷 세입과목</h1>
        <span className="text-[11px] text-slate-500">한 번 정한 코드는 바꾸지 않습니다 — 지난 보고서가 그 번호를 가리킵니다. 안 쓰는 과목은 끕니다.</span>
      </div>
      {loadError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{loadError}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-[13px] font-black text-slate-700">과목 나무</h2>
          <ul className="space-y-0.5 text-[12px]">
            {tree.map((a) => (
              <li key={a.id} className={"flex items-center gap-2 " + (a.active ? "" : "text-slate-300 line-through")} style={{ paddingLeft: a.depth * 16 }}>
                <span className="w-12 text-[11px] tabular-nums text-slate-400">{a.code}</span>
                <span className={a.level === "목" ? "" : "font-bold"}>{a.name}</span>
                <span className="text-[10px] text-slate-400">{a.level}</span>
                <button
                  disabled={busy}
                  onClick={() => void run(() => sb().from("revenue_accounts").update({ active: !a.active }).eq("id", a.id), a.active ? "과목을 껐습니다." : "과목을 켰습니다.")}
                  className="ml-auto text-[10px] text-slate-400 hover:text-slate-700"
                >
                  {a.active ? "끄기" : "켜기"}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2 text-[12px]">
            <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="코드" className="w-16 rounded border border-slate-200 px-1.5 py-0.5" />
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="과목 이름" className="w-32 rounded border border-slate-200 px-1.5 py-0.5" />
            <select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value as (typeof LEVELS)[number] })} className="rounded border border-slate-200 px-1 py-0.5">
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {draft.level !== "관" && (
              <select value={draft.parent} onChange={(e) => setDraft({ ...draft, parent: e.target.value })} className="rounded border border-slate-200 px-1 py-0.5">
                <option value="">위 과목…</option>
                {tree
                  .filter((a) => (draft.level === "항" ? a.level === "관" : a.level !== "목"))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </option>
                  ))}
              </select>
            )}
            <button disabled={busy} onClick={() => void add()} className="rounded bg-slate-800 px-2 py-0.5 font-bold text-white hover:bg-slate-900 disabled:bg-slate-300">
              더하기
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-[13px] font-black text-slate-700">학비 항목 → 과목</h2>
          <ul className="space-y-1 text-[12px]">
            {plans.map((p) => (
              <li key={p.id} className={"flex items-center gap-2 " + (p.active ? "" : "text-slate-400")}>
                <span className={"rounded px-1 text-[10px] font-bold " + (p.category === "학비" ? "bg-indigo-50 text-indigo-700" : "bg-orange-50 text-orange-700")}>{p.category}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <Picker value={p.revenue_account_id} onPick={(v) => void setPlan(p.id, v)} />
              </li>
            ))}
          </ul>

          <h2 className="mb-2 mt-4 text-[13px] font-black text-slate-700">학비외 분류 → 과목</h2>
          <p className="mb-1 text-[11px] text-slate-500">분류에 정하면 그 아래 항목은 모두 따라갑니다.</p>
          <ul className="space-y-1 text-[12px]">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Picker value={c.revenue_account_id} onPick={(v) => void setCat(c.id, v)} />
              </li>
            ))}
          </ul>

          <button onClick={() => setShowItems(!showItems)} className="mt-4 text-[12px] font-bold text-teal-700 hover:underline">
            {showItems ? "▾" : "▸"} 학비외 항목마다 따로 정하기 ({items.filter((i) => i.revenue_account_id).length}개 따로 정함)
          </button>
          {showItems && (
            <ul className="mt-1 space-y-1 text-[12px]">
              {items.map((i) => {
                const inherit = catAcc.get(i.category);
                return (
                  <li key={i.id} className="flex items-center gap-2">
                    <span className="w-16 text-[10px] text-slate-400">{i.code}</span>
                    <span className="min-w-0 flex-1 truncate" title={i.name}>
                      {i.name_ko || i.name}
                    </span>
                    <Picker value={i.revenue_account_id} onPick={(v) => void setItem(i.id, v)} fallback={`분류 따름 (${inherit ? accountLabel(byId.get(inherit)) : "미정"})`} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
