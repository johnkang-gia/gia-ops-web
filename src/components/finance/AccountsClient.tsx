"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { accountLabel, nextAccountCode, treeOrder, type AccountRow } from "@/lib/revenueAccounts";

type Plan = { id: string; name: string; category: string; active: boolean; revenue_account_id: string | null };
type Cat = { id: string; name: string; revenue_account_id: string | null };
type Item = { id: string; code: string | null; name: string; name_ko: string | null; category: string; revenue_account_id: string | null };


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

  async function add(level: "관" | "항" | "목", parent: AccountRow | null, name: string) {
    const n = name.trim();
    if (!n) {
      notify("과목 이름을 적어주세요.", "error");
      return false;
    }
    // 코드는 사람이 고르지 않습니다. 같은 자리에서 두 사람이 동시에 넣으면 데이터베이스의 유일 검사가 막고, 그 말을 그대로 전합니다.
    const code = nextAccountCode(accounts, level, parent);
    if (!code) {
      notify(`${parent ? accountLabel(parent) + " 아래에" : ""} 더 넣을 번호 자리가 없습니다.`, "error");
      return false;
    }
    return run(
      () => sb().from("revenue_accounts").insert({ code, name: n, level, parent_id: parent?.id ?? null, sort_order: Number(code) }),
      `${code} ${n} 과목을 만들었습니다.`,
    );
  }
  const rename = (a: AccountRow, name: string) =>
    run(() => sb().from("revenue_accounts").update({ name: name.trim() }).eq("id", a.id), `${a.code} 이름을 「${name.trim()}」(으)로 바꿨습니다.`);
  const toggle = (a: AccountRow) =>
    run(() => sb().from("revenue_accounts").update({ active: !a.active }).eq("id", a.id), a.active ? `${a.code} ${a.name} 과목을 껐습니다.` : `${a.code} ${a.name} 과목을 켰습니다.`);

  // 이 과목에 매달린 것 - 한눈에 「어디에 쓰이고 있나」가 보여야 끄거나 이름을 바꿀 때 망설이지 않습니다.
  const usage = useMemo(() => {
    const m = new Map<string, { plans: number; cats: number; items: number }>();
    const bump = (id: string | null, k: "plans" | "cats" | "items") => {
      if (!id) return;
      const u = m.get(id) ?? { plans: 0, cats: 0, items: 0 };
      u[k]++;
      m.set(id, u);
    };
    plans.forEach((p) => bump(p.revenue_account_id, "plans"));
    categories.forEach((c) => bump(c.revenue_account_id, "cats"));
    items.forEach((i) => bump(i.revenue_account_id, "items"));
    return m;
  }, [plans, categories, items]);

  const kidsOf = (id: string) => tree.filter((a) => a.parent_id === id);
  const roots = tree.filter((a) => a.level === "관" || !a.parent_id || !byId.has(a.parent_id));

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
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[13px] font-black text-slate-700">과목 나무</h2>
            <span className="text-[11px] text-slate-400">관 → 항 → 목 · 코드는 자동으로 붙습니다</span>
          </div>
          <div className="space-y-3">
            {roots.map((g) => (
              <div key={g.id} className={"overflow-hidden rounded-xl border " + (g.active ? "border-slate-300" : "border-slate-200 opacity-50")}>
                <NodeRow node={g} busy={busy} usage={usage} onRename={rename} onToggle={toggle} />
                <div className="space-y-2 p-2">
                  {kidsOf(g.id).map((h) => (
                    <div key={h.id} className={"rounded-lg border " + (h.active ? "border-slate-200" : "border-slate-100 opacity-50")}>
                      <NodeRow node={h} busy={busy} usage={usage} onRename={rename} onToggle={toggle} />
                      <ul className="divide-y divide-slate-50 px-1">
                        {kidsOf(h.id).map((m) => (
                          <li key={m.id}>
                            <NodeRow node={m} busy={busy} usage={usage} onRename={rename} onToggle={toggle} />
                          </li>
                        ))}
                      </ul>
                      <AddRow level="목" parent={h} accounts={accounts} busy={busy} onAdd={add} />
                    </div>
                  ))}
                  <AddRow level="항" parent={g} accounts={accounts} busy={busy} onAdd={add} />
                </div>
              </div>
            ))}
            <AddRow level="관" parent={null} accounts={accounts} busy={busy} onAdd={add} />
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

type RowProps = {
  busy: boolean;
  usage: Map<string, { plans: number; cats: number; items: number }>;
  onRename: (a: AccountRow, name: string) => Promise<boolean>;
  onToggle: (a: AccountRow) => Promise<boolean>;
};

/**
 * 과목 한 줄. 컴포넌트를 화면 함수 **밖**에 둡니다 - 안에 두면 저장하는 순간(busy) 다시 그려지며
 * 새 컴포넌트로 바뀌어, 고치던 이름이 사라지고 입력칸이 닫힙니다.
 */
function NodeRow({ node, busy, usage, onRename, onToggle }: { node: AccountRow } & RowProps) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(node.name);
    const u = usage.get(node.id);
    const head = node.level === "관" ? "bg-slate-800 text-white px-3 py-2" : node.level === "항" ? "bg-slate-50 px-2 py-1.5" : "px-1 py-1";
    return (
      <div className={"flex items-center gap-2 text-[12px] " + head}>
        <span className={"w-11 shrink-0 tabular-nums " + (node.level === "관" ? "text-slate-300" : "text-slate-400")}>{node.code}</span>
        {editing ? (
          <form
            className="flex flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== node.name) void onRename(node, name).then((ok) => ok && setEditing(false));
              else setEditing(false);
            }}
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-slate-800" />
            <button className="rounded bg-teal-600 px-2 text-[11px] font-bold text-white">저장</button>
            <button type="button" onClick={() => { setName(node.name); setEditing(false); }} className="px-1 text-[11px] text-slate-400">취소</button>
          </form>
        ) : (
          <>
            <span className={(node.level === "목" ? "" : "font-black ") + (node.active ? "" : "line-through")}>{node.name}</span>
            <span className={"rounded px-1 text-[10px] " + (node.level === "관" ? "bg-white/15 text-slate-200" : "bg-slate-100 text-slate-500")}>{node.level}</span>
            {node.level === "목" && u && (
              <span className="text-[10px] text-teal-700">
                {[u.plans && `학비 ${u.plans}`, u.cats && `분류 ${u.cats}`, u.items && `항목 ${u.items}`].filter(Boolean).join(" · ")}
              </span>
            )}
            <span className="ml-auto flex gap-1">
              <button disabled={busy} onClick={() => setEditing(true)} className={"text-[10px] " + (node.level === "관" ? "text-slate-300 hover:text-white" : "text-slate-400 hover:text-slate-700")}>
                ✎ 이름
              </button>
              <button disabled={busy} onClick={() => void onToggle(node)} className={"text-[10px] " + (node.level === "관" ? "text-slate-300 hover:text-white" : "text-slate-400 hover:text-slate-700")}>
                {node.active ? "끄기" : "켜기"}
              </button>
            </span>
          </>
        )}
      </div>
    );
  }

function AddRow({
  level,
  parent,
  accounts,
  busy,
  onAdd,
}: {
  level: "관" | "항" | "목";
  parent: AccountRow | null;
  accounts: AccountRow[];
  busy: boolean;
  onAdd: (level: "관" | "항" | "목", parent: AccountRow | null, name: string) => Promise<boolean>;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const code = nextAccountCode(accounts, level, parent);
    const label = level === "관" ? "+ 관 추가 (큰 묶음)" : level === "항" ? `+ ${parent?.name ?? ""} 아래 항 추가` : `+ ${parent?.name ?? ""} 아래 목 추가`;
    if (!open) {
      return (
        <button onClick={() => setOpen(true)} disabled={!code} className="w-full rounded px-2 py-1 text-left text-[11px] font-semibold text-teal-700 hover:bg-teal-50 disabled:text-slate-300">
          {code ? label : `${label} — 자리 없음`}
        </button>
      );
    }
    return (
      <form
        className="flex items-center gap-1 px-2 py-1 text-[12px]"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(level, parent, name).then((ok) => {
            if (ok) {
              setName("");
              setOpen(false);
            }
          });
        }}
      >
        <span className="w-11 tabular-nums font-bold text-teal-700" title="자동으로 붙는 코드">{code}</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={level === "목" ? "예: 체육복" : level === "항" ? "예: 기부금" : "예: 이전수입"} className="flex-1 rounded border border-slate-300 px-1.5 py-0.5" />
        <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{level}</span>
        <button disabled={busy} className="rounded bg-teal-600 px-2 py-0.5 text-[11px] font-bold text-white disabled:bg-slate-300">추가</button>
        <button type="button" onClick={() => setOpen(false)} className="px-1 text-[11px] text-slate-400">닫기</button>
      </form>
    );
  }

