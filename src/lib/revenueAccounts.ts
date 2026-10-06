/**
 * **세입과목 — 「무슨 돈으로 얼마가 들어왔나」.**
 *
 * 항목 이름은 학기마다 바뀝니다(「정규과정 2026-1」·「교재 G3 중국어」). 이름으로 모으면 해마다
 * 다른 표가 나오고, 작년과 견줄 수가 없습니다. 그래서 항목·분류를 **바뀌지 않는 번호**(관·항·목)에
 * 매달고, 보고서는 번호로 모읍니다. 공립학교 회계(에듀파인)의 세입과목과 같은 생각입니다.
 *
 * 한 줄이 어느 과목인가는 **여기 한 곳에서만** 정합니다. 화면마다 정하면 같은 줄이 화면에 따라
 * 다른 과목으로 셉니다.
 *
 *   ① 사람이 과목경정으로 정한 것(`invoice_lines.revenue_account_id`)
 *   ② 학비외 항목 → 항목에 정한 과목 → 없으면 그 분류의 과목
 *   ③ 학비 항목(plan) → 그 항목의 과목
 *   ④ 할인 줄(음수) → 바로 위 줄과 같은 과목. 할인은 그 수입을 깎는 것이지 따로 있는 돈이 아닙니다
 *   ⑤ 그래도 모르면 이름으로 짐작 — 그리고 「짐작」이라고 표시합니다
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  level: "관" | "항" | "목";
  parent_id: string | null;
  sort_order: number;
  active: boolean;
};

export type AccountCtx = {
  accounts: AccountRow[];
  /** 학비외 항목 번호 → { 항목 과목, 분류 이름 } */
  items: Map<string, { accountId: string | null; category: string | null }>;
  /** 분류 이름 → 과목 */
  categories: Map<string, string | null>;
  /** 학비 항목(plan) 번호 → { 과목, 이름 } */
  plans: Map<string, { accountId: string | null; name: string }>;
};

export type RevLine = {
  id: string;
  invoice_id: string;
  seq: number;
  name: string;
  amount: number | string;
  item_id?: string | null;
  plan_id?: string | null;
  carried_from_invoice_id?: string | null;
  revenue_account_id?: string | null;
};

export type Resolved = { accountId: string | null; how: "경정" | "항목" | "분류" | "학비항목" | "할인" | "짐작" | "모름" };

/** 이름으로 짐작하는 규칙. 데이터베이스의 `guess_revenue_code` 와 같은 규칙입니다. */
export function guessCode(text: string, tuition: boolean): string {
  const t = text ?? "";
  if (tuition && /방과후|after/i.test(t)) return "1120";
  if (tuition) return "1110";
  if (/교재|book|text/i.test(t)) return "1210";
  if (/교복|의류|체육복|uniform/i.test(t)) return "1220";
  if (/급식|식비|간식|meal|lunch/i.test(t)) return "1230";
  if (/셔틀|차량|버스|bus|shuttle/i.test(t)) return "1240";
  if (/체험|행사|캠프|현장|소풍|trip|camp/i.test(t)) return "1250";
  if (/악기/.test(t)) return "1260";
  if (/방과후/.test(t)) return "1120";
  return "1290";
}

/** 학비 항목 이름이 줄 이름 앞에 붙어 있는가(「정규과정 (1학기)」 같은 꼴). */
function planByName(ctx: AccountCtx, name: string): string | null {
  const n = name.replace(/^[\s　└]+/, "").trim();
  let best: { len: number; id: string | null } | null = null;
  for (const p of ctx.plans.values()) {
    if (p.name && n.startsWith(p.name) && (!best || p.name.length > best.len)) best = { len: p.name.length, id: p.accountId };
  }
  return best?.id ?? null;
}

/**
 * 한 장의 줄들에 과목을 붙입니다. 줄 순서(seq)대로 넘겨야 ④(할인은 위 줄을 따름)가 맞습니다.
 * 이월 줄은 여기서 정하지 않습니다 - 원래 청구서의 과목을 따라가야 하므로 보고서가 따로 풉니다.
 */
export function resolveLines(lines: readonly RevLine[], stream: string, ctx: AccountCtx): Map<string, Resolved> {
  const byCode = new Map(ctx.accounts.map((a) => [a.code, a.id]));
  const out = new Map<string, Resolved>();
  let prev: Resolved | null = null;
  for (const l of [...lines].sort((a, b) => a.seq - b.seq)) {
    if (l.carried_from_invoice_id) continue;
    let r: Resolved;
    const amount = Number(l.amount);
    const item = l.item_id ? ctx.items.get(l.item_id) : undefined;
    const plan = l.plan_id ? ctx.plans.get(l.plan_id) : undefined;
    if (l.revenue_account_id) r = { accountId: l.revenue_account_id, how: "경정" };
    else if (item?.accountId) r = { accountId: item.accountId, how: "항목" };
    else if (item && item.category && ctx.categories.get(item.category)) r = { accountId: ctx.categories.get(item.category) ?? null, how: "분류" };
    else if (plan?.accountId) r = { accountId: plan.accountId, how: "학비항목" };
    else if (amount < 0 && prev) r = { accountId: prev.accountId, how: "할인" };
    else if (stream === "학비" && planByName(ctx, l.name)) r = { accountId: planByName(ctx, l.name), how: "학비항목" };
    else {
      const id = byCode.get(guessCode(`${item?.category ?? ""} ${l.name}`, stream === "학비")) ?? null;
      r = { accountId: id, how: id ? "짐작" : "모름" };
    }
    out.set(l.id, r);
    if (amount >= 0) prev = r;
  }
  return out;
}

// ── 과목별 수입현황 ───────────────────────────────────────────────────────

export type RevInvoice = {
  id: string;
  status: string;
  stream?: string | null;
  category?: string | null;
  billing_month?: string | null;
  issue_date: string;
  carried_to_invoice_id?: string | null;
  written_off_amount?: number | string | null;
};
export type RevPayment = { invoice_id: string | null; amount: number | string };

export type AccountTotals = {
  accountId: string | null;
  /** 부과(청구한 금액). 할인은 빼고, 이월로 옮겨간 돈은 원래 청구서에서 한 번만 셉니다. */
  billed: number;
  /** 수납(받은 돈 − 돌려준 돈). 청구서 안에서 줄 금액 비율로 나눕니다. */
  received: number;
  /** 결손. 같은 비율로 나눕니다. */
  writtenOff: number;
  /** 미수 = 부과 − 수납 − 결손. */
  due: number;
  /** 이름으로 짐작해서 붙인 금액. 0이 아니면 과목을 정해 줄 항목이 남아 있다는 뜻입니다. */
  guessed: number;
};

type Share = Map<string | null, number>;

const streamOf = (v: RevInvoice) => (v.stream === "학비" || v.stream === "학비외" ? v.stream : v.category === "학비" ? "학비" : "학비외");
export const monthOf = (v: RevInvoice) => v.billing_month || v.issue_date.slice(0, 7);

/**
 * 과목별 부과·수납·결손·미수.
 *
 * **수납은 줄 비율로 나눕니다.** 입금은 청구서 한 장에 붙지 줄에 붙지 않습니다(예치금 차감만
 * 예외). 300만원짜리 청구서(수업료 280 + 교재 20)에 150만원이 들어오면 수업료 140 · 교재 10 으로
 * 셉니다. 「수업료부터 채운다」 같은 규칙을 정하면 그 규칙이 학교마다·사람마다 달라집니다.
 *
 * **이월 줄은 원래 청구서의 과목으로 풉니다.** 9월 미납이 10월 청구서에 「이전 미납」 한 줄로
 * 실려 오면, 그 줄로 들어온 돈은 9월 청구서의 과목(수업료·교재…)으로 갑니다. 「이월」이라는 과목은
 * 없습니다 - 그 돈은 원래 무엇이었는지가 남아야 합니다.
 */
export function buildRevenueReport(
  invoices: readonly RevInvoice[],
  lines: readonly RevLine[],
  payments: readonly RevPayment[],
  ctx: AccountCtx,
  inScope: (v: RevInvoice) => boolean,
): { rows: AccountTotals[]; unresolved: number } {
  const invById = new Map(invoices.map((v) => [v.id, v]));
  const linesBy = new Map<string, RevLine[]>();
  for (const l of lines) {
    const arr = linesBy.get(l.invoice_id) ?? [];
    arr.push(l);
    linesBy.set(l.invoice_id, arr);
  }

  // 장마다 「자기 줄」의 과목별 금액(부과)과, 이월 줄까지 풀어낸 비율(수납 나누기용).
  const own = new Map<string, Share>();
  const guessedOwn = new Map<string, number>();
  for (const v of invoices) {
    const ls = linesBy.get(v.id) ?? [];
    const res = resolveLines(ls, streamOf(v), ctx);
    const s: Share = new Map();
    let g = 0;
    for (const l of ls) {
      if (l.carried_from_invoice_id) continue;
      const r = res.get(l.id);
      const k = r?.accountId ?? null;
      const a = Math.round(Number(l.amount));
      s.set(k, (s.get(k) ?? 0) + a);
      if (r && (r.how === "짐작" || r.how === "모름")) g += a;
    }
    own.set(v.id, s);
    guessedOwn.set(v.id, g);
  }

  const expanded = new Map<string, Share>();
  const expand = (id: string, depth: number): Share => {
    const hit = expanded.get(id);
    if (hit) return hit;
    const s: Share = new Map(own.get(id) ?? []);
    if (depth < 12) {
      for (const l of linesBy.get(id) ?? []) {
        if (!l.carried_from_invoice_id) continue;
        const amt = Math.round(Number(l.amount));
        const src = expand(l.carried_from_invoice_id, depth + 1);
        const tot = [...src.values()].reduce((n, x) => n + Math.max(0, x), 0);
        if (tot <= 0) {
          s.set(null, (s.get(null) ?? 0) + amt);
          continue;
        }
        for (const [k, x] of src) if (x > 0) s.set(k, (s.get(k) ?? 0) + (amt * x) / tot);
      }
    }
    expanded.set(id, s);
    return s;
  };

  const acc = new Map<string | null, AccountTotals>();
  const row = (k: string | null) => {
    let r = acc.get(k);
    if (!r) {
      r = { accountId: k, billed: 0, received: 0, writtenOff: 0, due: 0, guessed: 0 };
      acc.set(k, r);
    }
    return r;
  };
  const spread = (id: string, amount: number, field: "received" | "writtenOff") => {
    if (amount === 0) return;
    const s = expand(id, 0);
    const tot = [...s.values()].reduce((n, x) => n + Math.max(0, x), 0);
    if (tot <= 0) {
      row(null)[field] += amount;
      return;
    }
    for (const [k, x] of s) if (x > 0) row(k)[field] += (amount * x) / tot;
  };

  let unresolved = 0;
  for (const v of invoices) {
    if (v.status === "취소" || !inScope(v)) continue;
    for (const [k, x] of own.get(v.id) ?? []) row(k).billed += x;
    const g = guessedOwn.get(v.id) ?? 0;
    if (g) unresolved += g;
    spread(v.id, Math.round(Number(v.written_off_amount ?? 0)), "writtenOff");
  }
  for (const p of payments) {
    if (!p.invoice_id) continue;
    const v = invById.get(p.invoice_id);
    if (!v || v.status === "취소" || !inScope(v)) continue;
    spread(v.id, Math.round(Number(p.amount)), "received");
  }

  // 짐작으로 붙인 부과액을 과목별로 다시 셉니다(화면이 「이 과목 중 얼마가 짐작인가」를 보여줍니다).
  for (const v of invoices) {
    if (v.status === "취소" || !inScope(v)) continue;
    const ls = linesBy.get(v.id) ?? [];
    const res = resolveLines(ls, streamOf(v), ctx);
    for (const l of ls) {
      const r = res.get(l.id);
      if (r && (r.how === "짐작" || r.how === "모름")) row(r.accountId).guessed += Math.round(Number(l.amount));
    }
  }

  const rows = [...acc.values()].map((r) => ({
    ...r,
    billed: Math.round(r.billed),
    received: Math.round(r.received),
    writtenOff: Math.round(r.writtenOff),
    due: Math.round(r.billed - r.received - r.writtenOff),
  }));
  return { rows, unresolved };
}

/** 목 → 항 → 관으로 더해 올립니다. 화면은 관·항 줄에 합계를, 목 줄에 그 값을 그립니다. */
export function rollUp(accounts: readonly AccountRow[], rows: readonly AccountTotals[]): Map<string, AccountTotals> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<string, AccountTotals>();
  const add = (id: string, r: AccountTotals) => {
    const t = out.get(id) ?? { accountId: id, billed: 0, received: 0, writtenOff: 0, due: 0, guessed: 0 };
    t.billed += r.billed;
    t.received += r.received;
    t.writtenOff += r.writtenOff;
    t.due += r.due;
    t.guessed += r.guessed;
    out.set(id, t);
  };
  for (const r of rows) {
    let cur = r.accountId ? byId.get(r.accountId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      add(cur.id, r);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  }
  return out;
}

/** 관·항·목을 나무 순서(부모 바로 밑에 자식)로 늘어놓습니다. */
export function treeOrder(accounts: readonly AccountRow[]): (AccountRow & { depth: number })[] {
  const kids = new Map<string | null, AccountRow[]>();
  for (const a of accounts) {
    const arr = kids.get(a.parent_id) ?? [];
    arr.push(a);
    kids.set(a.parent_id, arr);
  }
  for (const arr of kids.values()) arr.sort((x, y) => x.sort_order - y.sort_order || x.code.localeCompare(y.code));
  const ids = new Set(accounts.map((a) => a.id));
  const out: (AccountRow & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of kids.get(parent) ?? []) {
      out.push({ ...a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  // 부모를 잃은 과목(부모가 지워졌거나 잘못 걸린 것)도 빠뜨리지 않습니다.
  for (const a of accounts) if (a.parent_id && !ids.has(a.parent_id)) out.push({ ...a, depth: 0 });
  return out;
}

export const accountLabel = (a: { code: string; name: string } | undefined | null) => (a ? `${a.code} ${a.name}` : "미분류");

/**
 * **다음 코드를 자동으로 정합니다.** 사람이 번호를 고르면 겹치거나, 자리 규칙(관 1000 · 항 1100 ·
 * 목 1110)이 흐트러져 위아래가 번호만 보고는 안 읽힙니다.
 *
 *   · 관: 1000 단위 — 1000, 2000 … (빈 자리 중 가장 앞)
 *   · 항: 그 관 안의 100 단위 — 1100, 1200 …
 *   · 목: 그 항 안의 10 단위 — 1210, 1220 …
 *
 * **빈 자리 중 가장 앞**을 씁니다. 「1290 기타」가 이미 있으면 새 목은 1270 처럼 그 앞에 들어가,
 * 「기타」가 늘 맨 끝에 남습니다. 열 칸이 다 차면 1 단위로 내려가 빈 번호를 찾습니다.
 * 자리가 하나도 없으면 null - 화면이 「더 넣을 자리가 없다」고 말합니다.
 */
export function nextAccountCode(
  accounts: readonly { code: string; level: string; parent_id: string | null; id: string }[],
  level: "관" | "항" | "목",
  parent: { code: string } | null,
): string | null {
  const used = new Set(accounts.map((a) => a.code));
  const base = parent ? Number(parent.code) : 0;
  const tries: number[] = [];
  if (level === "관") for (let n = 1000; n <= 9000; n += 1000) tries.push(n);
  else if (level === "항") for (let n = base + 100; n < base + 1000; n += 100) tries.push(n);
  else {
    for (let n = base + 10; n < base + 100; n += 10) tries.push(n);
    for (let n = base + 1; n < base + 100; n++) if (n % 10 !== 0) tries.push(n);
  }
  if (level !== "관" && (!parent || !Number.isFinite(base))) return null;
  const hit = tries.find((n) => !used.has(String(n)));
  return hit === undefined ? null : String(hit);
}

/** 이 과목에 바로 아래로 둘 수 있는 구분. 목 아래로는 더 내려가지 않습니다. */
export const childLevel = (level: "관" | "항" | "목"): "항" | "목" | null => (level === "관" ? "항" : level === "항" ? "목" : null);
