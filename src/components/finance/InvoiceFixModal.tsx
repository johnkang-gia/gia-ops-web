"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { accountLabel, resolveLines, treeOrder, type AccountCtx, type AccountRow, type RevLine } from "@/lib/revenueAccounts";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export type FixTarget = {
  id: string;
  invoiceNo: string;
  studentName: string;
  stream: string;
  /** 학부모에게 보냈는가(올톡페이로 내보냄). 정정은 보낸 장에만 합니다. */
  sent: boolean;
  total: number;
  balance: number;
};

type Tab = "정정" | "결손" | "과목";

type Line = RevLine & { is_adjustment?: boolean | null; adjust_reason?: string | null };

/**
 * **청구서 한 장 손보기** — 정정 · 결손 · 과목경정.
 *
 *   · 정정: 보낸 청구서의 금액을 고칩니다. 원래 줄은 두고 차액 줄을 더합니다. 보내기 전이면
 *     ↩ 취소 후 다시 발행이 깔끔해서 정정은 막아 둡니다.
 *   · 결손: 받지 않기로 하는 돈. 결재를 올리고, 다른 관리자가 승인하면 잔액에서 빠집니다.
 *   · 과목: 금액은 그대로, 어느 세입과목으로 셀지만 바꿉니다.
 *
 * 셋을 한 창에 둔 이유: 셋 다 「이 장이 뭔가 틀렸다」에서 시작하고, 사람은 무엇이 틀렸는지
 * (금액인가·받을 수 없는가·분류인가)를 창을 연 뒤에야 가립니다.
 */
export default function InvoiceFixModal({
  target,
  onClose,
  onDone,
}: {
  target: FixTarget;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(target.sent ? "정정" : target.balance > 0 ? "결손" : "과목");
  const [lines, setLines] = useState<Line[]>([]);
  const [ctx, setCtx] = useState<AccountCtx | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const sb = createClient();
    void Promise.all([
      sb
        .from("invoice_lines")
        .select("id, invoice_id, seq, name, amount, item_id, plan_id, carried_from_invoice_id, revenue_account_id, is_adjustment, adjust_reason")
        .eq("invoice_id", target.id)
        .order("seq"),
      sb.from("revenue_accounts").select("id, code, name, level, parent_id, sort_order, active").order("code"),
      sb.from("fee_items").select("id, category, revenue_account_id"),
      sb.from("fee_categories").select("name, revenue_account_id"),
      sb.from("fee_plans").select("id, name, revenue_account_id"),
    ]).then(([l, a, i, c, p]) => {
      if (!alive) return;
      const e = l.error ?? a.error ?? i.error ?? c.error ?? p.error;
      // 조용히 빈 창을 띄우지 않습니다 - 「줄이 없다」로 읽혀 엉뚱한 정정을 하게 됩니다.
      if (e) {
        setLoadErr(e.message);
        return;
      }
      setLines((l.data as Line[]) ?? []);
      setCtx({
        accounts: (a.data as AccountRow[]) ?? [],
        items: new Map(((i.data ?? []) as { id: string; category: string | null; revenue_account_id: string | null }[]).map((x) => [x.id, { accountId: x.revenue_account_id, category: x.category }])),
        categories: new Map(((c.data ?? []) as { name: string; revenue_account_id: string | null }[]).map((x) => [x.name, x.revenue_account_id])),
        plans: new Map(((p.data ?? []) as { id: string; name: string; revenue_account_id: string | null }[]).map((x) => [x.id, { accountId: x.revenue_account_id, name: x.name }])),
      });
    });
    return () => {
      alive = false;
    };
  }, [target.id]);

  async function post(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> | null }> {
    setBusy(true);
    setErr(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    setBusy(false);
    if (!res.ok) setErr(String(json?.error ?? `실패했습니다(${res.status})`));
    return { ok: res.ok, json };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-bold text-slate-900">🛠 청구서 손보기</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {target.invoiceNo} · {target.studentName} · 합계 <b className="text-slate-700">{won(target.total)}</b> · 남은 돈{" "}
            <b className="text-slate-700">{won(target.balance)}</b> · {target.sent ? "학부모에게 보냄" : "아직 안 보냄"}
          </p>
          <div className="mt-2 flex gap-1">
            {(["정정", "결손", "과목"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setErr(null);
                }}
                className={"rounded-lg px-3 py-1 text-[12px] font-bold " + (tab === t ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
              >
                {t === "정정" ? "금액 정정" : t === "결손" ? "결손 요청" : "과목 경정"}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loadErr && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">자료를 읽지 못했습니다: {loadErr}</p>}
          {!loadErr && !ctx && <p className="text-[12px] text-slate-400">읽는 중…</p>}
          {!loadErr && ctx && tab === "정정" && (
            <AdjustTab target={target} lines={lines} busy={busy} onSubmit={async (changes, reason) => {
              const r = await post("/api/finance/invoices/adjust", { invoiceId: target.id, changes, reason });
              if (r.ok) onDone(`${target.invoiceNo} 정정: ${won(Number(r.json?.before ?? 0))} → ${won(Number(r.json?.after ?? 0))}`);
            }} />
          )}
          {!loadErr && ctx && tab === "결손" && (
            <WriteOffTab target={target} busy={busy} onSubmit={async (amount, reason) => {
              const r = await post("/api/finance/requests", { kind: "결손", invoiceId: target.id, amount, reason });
              if (r.ok) onDone(`${won(amount)} 결손 요청을 올렸습니다. 다른 관리자가 승인하면 잔액에서 빠집니다.`);
            }} />
          )}
          {!loadErr && ctx && tab === "과목" && (
            <ReclassTab target={target} lines={lines} ctx={ctx} busy={busy} onSubmit={async (lineIds, accountId, reason) => {
              const r = await post("/api/finance/invoices/reclass", { lineIds, accountId, reason });
              if (r.ok) onDone(`${Number(r.json?.changed ?? 0)}줄의 과목을 바꿨습니다.`);
            }} />
          )}
          {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{err}</p>}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-100">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

const num = (s: string) => {
  const t = s.replace(/[^0-9-]/g, "");
  return t === "" || t === "-" ? NaN : Math.round(Number(t));
};

function AdjustTab({
  target,
  lines,
  busy,
  onSubmit,
}: {
  target: FixTarget;
  lines: Line[];
  busy: boolean;
  onSubmit: (changes: { lineId?: string; name?: string; amount: number }[], reason: string) => void;
}) {
  // 줄마다 「고친 뒤 금액」. 비워 두면 그대로입니다.
  const [to, setTo] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<{ name: string; amount: string }[]>([]);
  const [reason, setReason] = useState("");

  // 정정 줄까지 더해 「지금 그 항목이 얼마인가」를 보여줍니다. 두 번째 정정이 첫 번째를 모르면 차액이 틀립니다.
  const current = useMemo(() => {
    const m = new Map<string, number>();
    const base = lines.filter((l) => !l.is_adjustment);
    for (const l of base) m.set(l.id, Math.round(Number(l.amount)));
    for (const l of lines.filter((x) => x.is_adjustment)) {
      const label = l.name.replace(/^정정 · /, "");
      const head = base.find((b) => b.name.replace(/^[\s　└]+/, "").trim() === label);
      if (head) m.set(head.id, (m.get(head.id) ?? 0) + Math.round(Number(l.amount)));
    }
    return m;
  }, [lines]);

  const changes = [
    ...lines
      .filter((l) => !l.is_adjustment && to[l.id] !== undefined && to[l.id] !== "")
      .map((l) => ({ lineId: l.id, amount: num(to[l.id]) - (current.get(l.id) ?? 0) }))
      .filter((c) => Number.isFinite(c.amount) && c.amount !== 0),
    ...extra.filter((e) => e.name.trim() && Number.isFinite(num(e.amount)) && num(e.amount) !== 0).map((e) => ({ name: e.name.trim(), amount: num(e.amount) })),
  ];
  const delta = changes.reduce((n, c) => n + c.amount, 0);

  if (!target.sent) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
        아직 학부모에게 보내지 않은 청구서입니다. <b>↩ 취소 후 다시 발행</b>하는 편이 깔끔합니다 — 종이에 정정 줄이 남지 않습니다.
        <br />
        정정은 올톡페이로 보낸 뒤(「올톡」 표시가 켜진 뒤)에 씁니다.
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
        원래 줄은 지우지 않습니다. 고친 금액과의 <b>차액</b>이 「정정 · 항목」 줄로 붙고, 청구서 번호는 그대로입니다 — 학부모가 가진
        종이와 같은 번호로 무엇이 왜 바뀌었는지 남습니다.
      </p>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] text-slate-400">
            <th className="py-1">항목</th>
            <th className="py-1 text-right">지금</th>
            <th className="py-1 text-right">고친 뒤</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className={"border-t border-slate-100 " + (l.is_adjustment ? "text-slate-400" : "")}>
              <td className="py-1">
                {l.name}
                {l.is_adjustment && l.adjust_reason ? <span className="ml-1 text-[10px]">({l.adjust_reason})</span> : null}
              </td>
              <td className="py-1 text-right tabular-nums">{won(l.is_adjustment ? Number(l.amount) : (current.get(l.id) ?? 0))}</td>
              <td className="py-1 text-right">
                {!l.is_adjustment && !l.carried_from_invoice_id && (
                  <input
                    value={to[l.id] ?? ""}
                    onChange={(e) => setTo({ ...to, [l.id]: e.target.value })}
                    inputMode="numeric"
                    placeholder="그대로"
                    className="w-28 rounded border border-slate-200 px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-teal-400"
                  />
                )}
              </td>
            </tr>
          ))}
          {extra.map((e, i) => (
            <tr key={`x${i}`} className="border-t border-slate-100">
              <td className="py-1" colSpan={2}>
                <input
                  value={e.name}
                  onChange={(ev) => setExtra(extra.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
                  placeholder="새 줄 이름 (예: 체험학습 추가분)"
                  className="w-full rounded border border-slate-200 px-1.5 py-0.5 outline-none focus:border-teal-400"
                />
              </td>
              <td className="py-1 text-right">
                <input
                  value={e.amount}
                  onChange={(ev) => setExtra(extra.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)))}
                  inputMode="numeric"
                  placeholder="± 금액"
                  className="w-28 rounded border border-slate-200 px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-teal-400"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setExtra([...extra, { name: "", amount: "" }])} className="mt-1 text-[11px] font-semibold text-teal-700 hover:underline">
        + 새 줄 더하기
      </button>

      <label className="mt-3 block text-[11px] font-semibold text-slate-600">
        정정 사유 <span className="text-rose-600">*</span>
      </label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="예: 방과후 요일 변경으로 금액 조정 / 교재 수량 오기"
        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-teal-400"
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-slate-600">
          {changes.length === 0 ? "바뀌는 금액이 없습니다." : <>합계 {won(target.total)} → <b>{won(target.total + delta)}</b> ({delta > 0 ? "+" : ""}{won(delta)})</>}
          {changes.length > 0 && target.total - target.balance > target.total + delta && (
            <span className="ml-1 font-semibold text-rose-600">· 이미 받은 돈보다 작아집니다 — 차액은 환불 요청이나 예치금으로 정리해 주세요.</span>
          )}
        </span>
        <button
          disabled={busy || changes.length === 0 || !reason.trim()}
          onClick={() => onSubmit(changes, reason.trim())}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-slate-900 disabled:bg-slate-300"
        >
          {busy ? "적는 중…" : "정정 줄 붙이기"}
        </button>
      </div>
    </div>
  );
}

function WriteOffTab({ target, busy, onSubmit }: { target: FixTarget; busy: boolean; onSubmit: (amount: number, reason: string) => void }) {
  const [amount, setAmount] = useState(String(Math.max(0, target.balance)));
  const [reason, setReason] = useState("");
  const asked = Math.round(Number(amount.replace(/[^0-9]/g, "")) || 0);
  const over = asked > target.balance;

  if (target.balance <= 0) {
    return <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">남은 돈이 없습니다. 결손으로 정리할 것이 없습니다.</p>;
  }
  return (
    <div>
      <p className="mb-2 rounded-lg bg-violet-50 px-3 py-2 text-[11px] leading-relaxed text-violet-900">
        <b>결손</b>은 받지 않기로 정하는 돈입니다(퇴소 후 연락 두절, 학교 사정으로 면제 등). 받은 돈이 아니므로 수납에는 안 들어가고,
        미수금에서만 빠집니다. <b>올린 사람이 아닌 관리자</b>가 [회계 → 결재]에서 승인해야 반영됩니다.
      </p>
      <label className="block text-[11px] font-semibold text-slate-600">결손 금액 (남은 돈 {won(target.balance)} 까지)</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="numeric"
        className={"mt-1 w-full rounded-lg border px-2 py-1.5 text-right text-[14px] font-bold tabular-nums outline-none " + (over ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 focus:border-violet-400")}
      />
      <label className="mt-3 block text-[11px] font-semibold text-slate-600">
        사유 <span className="text-rose-600">*</span>
      </label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="예: 2026-08 퇴소, 3회 연락 후 회신 없음"
        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-violet-400"
      />
      <div className="mt-3 flex justify-end">
        <button
          disabled={busy || asked <= 0 || over || !reason.trim()}
          onClick={() => onSubmit(asked, reason.trim())}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
        >
          {busy ? "올리는 중…" : "결손 요청 올리기"}
        </button>
      </div>
    </div>
  );
}

function ReclassTab({
  target,
  lines,
  ctx,
  busy,
  onSubmit,
}: {
  target: FixTarget;
  lines: Line[];
  ctx: AccountCtx;
  busy: boolean;
  onSubmit: (lineIds: string[], accountId: string, reason: string) => void;
}) {
  const resolved = useMemo(() => resolveLines(lines, target.stream, ctx), [lines, target.stream, ctx]);
  const byId = useMemo(() => new Map(ctx.accounts.map((a) => [a.id, a])), [ctx.accounts]);
  const leaves = useMemo(() => treeOrder(ctx.accounts).filter((a) => a.level === "목" && a.active), [ctx.accounts]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");
  const own = lines.filter((l) => !l.carried_from_invoice_id);

  return (
    <div>
      <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
        금액은 그대로이고 <b>어느 세입과목으로 셀지</b>만 바뀝니다. 학부모가 낼 돈은 같으니 청구서를 다시 보낼 필요가 없습니다. 이월 줄은
        원래 청구서의 과목을 따라가서 여기서 고르지 않습니다.
      </p>
      <table className="w-full text-[12px]">
        <tbody>
          {own.map((l) => {
            const r = resolved.get(l.id);
            return (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="w-6 py-1">
                  <input
                    type="checkbox"
                    checked={picked.has(l.id)}
                    onChange={() => {
                      const n = new Set(picked);
                      if (n.has(l.id)) n.delete(l.id);
                      else n.add(l.id);
                      setPicked(n);
                    }}
                  />
                </td>
                <td className="py-1">{l.name}</td>
                <td className="py-1 text-right tabular-nums">{won(Number(l.amount))}</td>
                <td className="py-1 pl-2 text-[11px]">
                  <span className={r?.how === "짐작" || r?.how === "모름" ? "text-amber-700" : "text-slate-600"}>
                    {accountLabel(r?.accountId ? byId.get(r.accountId) : null)}
                  </span>
                  <span className="ml-1 text-[10px] text-slate-400">{r?.how}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex gap-2">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-teal-400"
        >
          <option value="">옮길 과목…</option>
          {leaves.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a)}
            </option>
          ))}
        </select>
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="경정 사유 (예: 교재비로 잡았으나 체험학습 준비물)"
        className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-teal-400"
      />
      <div className="mt-3 flex justify-end">
        <button
          disabled={busy || picked.size === 0 || !accountId || !reason.trim()}
          onClick={() => onSubmit([...picked], accountId, reason.trim())}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-teal-700 disabled:bg-slate-300"
        >
          {busy ? "바꾸는 중…" : `${picked.size}줄 과목 바꾸기`}
        </button>
      </div>
    </div>
  );
}
