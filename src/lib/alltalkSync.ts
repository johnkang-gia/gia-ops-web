/**
 * **올톡 대조** — 올톡페이 「청구서관리목록」 한 벌과 운영앱 회계를 학생별로 맞춰 봅니다.
 *
 * 여기서는 **판정만** 합니다. 수납·올톡 표시는 화면이 사람의 확인을 받고 기존 창구
 * (`/api/finance/invoices/pay` · `/api/finance/ledger/exported`)로 넣습니다. 순수 함수입니다.
 *
 * ── 왜 「결제내역 올리기」와 따로인가 ──────────────────────────────────────
 *
 * 올리기는 「올톡에 있는 건 = 앱에 없는 건」으로 보고 청구서를 새로 만듭니다. 그런데 지금은
 * 청구서를 **앱에서 먼저 발행하고** 올톡에는 사람이 금액을 옮겨 적어 보냅니다. 청구사유는
 * 「초등 10월 인보이스」 같은 글자라 번호가 없고, 올리기로는 이미 있는 청구서를 못 찾습니다.
 * 여기서는 반대로 **앱에 있는 청구서를 찾아 붙입니다** - 같은 학생, 같은 달, 금액이 맞는 장
 * (학비+학비외 두 장의 합이 한 건으로 나간 경우가 대부분입니다).
 *
 * ── 올톡 파일의 모양 ────────────────────────────────────────────────────
 *
 * 한 청구가 여러 줄입니다. 금액을 고치거나 번호를 바꿔 **다시 보내면 줄이 하나 더 생기고**
 * 앞의 줄은 「결제중단」이 되거나 「발송완료」로 남습니다. 9~10월 파일 273줄이 실제 청구로는
 * 195건이었습니다. 그래서 같은 학생·같은 청구사유의 줄을 묶고, 결제된 줄이 있으면 그것이,
 * 없으면 마지막으로 보낸 줄이 지금 유효한 청구입니다.
 */

import { invoiceNosOf, matchImportRow, type Candidate, type RawImportRow, type StudentLite } from "./paymentImport";

export type SyncStudent = StudentLite & { department: string | null };

export type SyncInvoice = {
  id: string;
  invoiceNo: string;
  studentId: string | null;
  total: number;
  /** 붙은 입금 합(환불 제외). */
  paid: number;
  writtenOff: number;
  status: string;
  billingMonth: string | null;
  stream: string;
  offline: boolean;
  exported: boolean;
  carried: boolean;
};

export type SyncMark = {
  key: string;
  kind: "link" | "decision";
  studentId: string | null;
  decision: string | null;
  memo: string | null;
  updatedBy: string;
  updatedAt: string;
};

export const DECISIONS = ["앱에 넣음", "앱에 안 넣음", "해당없음", "확인필요", "학생 아님"] as const;

/**
 * 줄마다 할 일. 화면의 탭이 이 순서입니다 - 손이 가는 것부터.
 *
 *   수납      올톡에서 결제됨, 앱 청구서는 아직 미납 → 입금 넣기
 *   올톡표시  올톡으로 보냄(미결제), 앱 청구서와 금액 일치 → 「올톡」 표시만
 *   학생확인  올톡 이름이 누구인지 못 정함 → 학생 고르기(다음부터 자동)
 *   확인      금액이 다르거나 같은 금액이 두 번 결제됨
 *   앱에없음  올톡에는 있는데 앱에 같은 금액 청구서가 없음 → 판단 표시
 *   앱에만    앱 청구서인데 올톡으로 나간 기록이 없음
 *   참고      결제중단·발송실패만 남은 건
 *   일치      이미 맞음
 */
export const SYNC_CODES = ["수납", "올톡표시", "학생확인", "확인", "앱에없음", "앱에만", "참고", "일치"] as const;
export type SyncCode = (typeof SYNC_CODES)[number];

export type SyncPay = { invoiceId: string; invoiceNo: string; amount: number };

export type SyncHistory = { issuedAt: string | null; amount: number; status: string; paidAt: string | null; name: string };

export type SyncRow = {
  /** 판단을 저장하는 열쇠. 같은 청구는 다음 파일에서도 같은 열쇠가 됩니다. */
  key: string;
  code: SyncCode;
  studentId: string | null;
  studentName: string;
  where: string;
  department: string | null;
  /** 학생 연결이 확정이 아니라 짐작인가(번호와 이름 중 하나만 맞음). */
  tentative: boolean;
  matchWhy: string;
  candidates: Candidate[];
  /** 학생 연결을 저장할 열쇠(link|이름|번호). 올톡 줄이 없는 「앱에만」은 null. */
  linkKey: string | null;
  why: string;
  history: SyncHistory[];
  /** 올톡에서 결제된 합. */
  paidAmount: number;
  /** 아직 안 낸 유효 청구 금액. */
  openAmount: number;
  paidAt: string | null;
  approvals: string[];
  /** 앱 쪽 청구서. 대조에 쓰인 장, 없으면 그 학생의 같은 달 장. */
  invoices: { id: string; invoiceNo: string; billingMonth: string | null; stream: string; total: number; balance: number; offline: boolean; exported: boolean }[];
  /** 「수납」일 때 넣을 입금. */
  pays: SyncPay[];
  /** 승인번호로 만든 입금 열쇠. 같은 결제가 두 번 들어가지 않게 합니다. */
  sourceKey: string | null;
  /** 「올톡」 표시를 켤 청구서. */
  markExported: string[];
  note: string;
  mark: SyncMark | null;
  /**
   * 앱 청구서와 **번호로** 맞았는가(청구사유 앞 `[2026-0123]`). 아니면 금액으로 짐작한 짝입니다 -
   * 금액이 같은 형제·정산 건에서 엇갈릴 수 있어, 화면이 비율을 보여주고 앱에서 만든 파일로
   * 보내기를 권합니다.
   */
  byNumber: boolean;
};

export type SyncSummary = Record<SyncCode, { count: number; amount: number; decided: number }>;

const won = (n: number) => n.toLocaleString("ko-KR");

export function linkKeyOf(r: Pick<RawImportRow, "name" | "phone">): string {
  return `link|${String(r.name).trim()}|${String(r.phone ?? "").replace(/\D/g, "")}`;
}

/** 결제 한 건의 입금 열쇠. 결제내역 올리기(`sourceKeyOf`)와 같은 모양이라 두 창구가 서로를 알아봅니다. */
export function approvalKey(approvalNo: string): string {
  return `올톡|승인|${approvalNo}`;
}

const isPaid = (st: string) => /완료/.test(st) && /결제|수납/.test(st);
const isSent = (st: string) => /발송|전송/.test(st) && !/실패/.test(st);

/** 청구사유의 「10월」 → 그 청구가 가리키는 달(YYYY-MM). 연도는 등록일에서 가져옵니다. */
export function monthHintOf(why: string, issuedAt: string | null): string | null {
  const m = String(why).match(/(\d{1,2})\s*월/);
  if (!m) return null;
  const mm = Number(m[1]);
  if (mm < 1 || mm > 12) return null;
  const base = issuedAt && /^\d{4}-\d{2}/.test(issuedAt) ? issuedAt : null;
  if (!base) return null;
  let y = Number(base.slice(0, 4));
  const im = Number(base.slice(5, 7));
  // 12월에 「1월 학비」를 보내면 다음 해 1월입니다.
  if (mm < im - 6) y += 1;
  if (mm > im + 6) y -= 1;
  return `${y}-${String(mm).padStart(2, "0")}`;
}

const balanceOf = (v: SyncInvoice) => Math.max(0, v.total - v.paid - v.writtenOff);

/**
 * 금액이 `amount` 가 되는 청구서 조합. 올톡으로는 학비+학비외를 한 건으로 보내는 일이 많아
 * 한 장이 아니라 **몇 장의 합**을 찾습니다. 장이 적은 조합부터 봅니다.
 */
function subsetMatch(pool: readonly SyncInvoice[], amount: number, by: (v: SyncInvoice) => number): SyncInvoice[] | null {
  const list = pool.slice(0, 10);
  const n = list.length;
  for (let size = 1; size <= Math.min(4, n); size++) {
    const idx = Array.from({ length: size }, (_, i) => i);
    for (;;) {
      const sum = idx.reduce((s, i) => s + by(list[i]), 0);
      if (sum === amount) return idx.map((i) => list[i]);
      let k = size - 1;
      while (k >= 0 && idx[k] === n - size + k) k--;
      if (k < 0) break;
      idx[k]++;
      for (let j = k + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
    }
  }
  return null;
}

function whereOf(s: SyncStudent | undefined): string {
  if (!s) return "";
  return s.className || (s.grade ? `${s.grade}학년` : "");
}

export function reconcile(input: {
  raws: readonly RawImportRow[];
  students: readonly SyncStudent[];
  invoices: readonly SyncInvoice[];
  /** 이미 앱에 있는 입금 열쇠(payments.source_key, `#` 뒤는 떼고). */
  paidKeys: ReadonlySet<string>;
  marks: readonly SyncMark[];
}): { rows: SyncRow[]; summary: SyncSummary } {
  const { raws, students, invoices, paidKeys, marks } = input;
  const byId = new Map(students.map((s) => [s.id, s]));
  const markBy = new Map(marks.map((m) => [m.key, m]));
  const used = new Set<string>();

  // ── ① 줄마다 학생 ─────────────────────────────────────────────────────
  type Resolved = { raw: RawImportRow; studentId: string | null; tentative: boolean; why: string; candidates: Candidate[] };
  const resolved: Resolved[] = raws.map((raw) => {
    const link = markBy.get(linkKeyOf(raw));
    if (link?.kind === "link") {
      if (link.decision === "학생 아님") return { raw, studentId: null, tentative: false, why: "사람이 「학생 아님」으로 정함", candidates: [] };
      if (link.studentId && byId.has(link.studentId)) {
        return { raw, studentId: link.studentId, tentative: false, why: `사람이 정한 연결(${link.updatedBy})`, candidates: [] };
      }
    }
    const m = matchImportRow(raw, students);
    if (m.match === "자동") return { raw, studentId: m.suggestedStudentId, tentative: false, why: m.why, candidates: m.candidates };
    return { raw, studentId: m.suggestedStudentId, tentative: m.suggestedStudentId != null, why: m.why, candidates: m.candidates };
  });

  // ── ② 같은 학생·같은 청구사유의 줄을 한 청구로 ─────────────────────────
  //
  // 학생을 못 정한 줄은 올톡 이름 그대로 묶습니다. 「정하담이건이엘9월미납분2」·「…3」처럼 이름
  // 뒤 번호로 따로 보낸 청구는 금액이 같아도 별개라, 이름이 다르면 다른 묶음이 됩니다.
  const groups = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const who = r.studentId ?? `?${r.raw.name.trim()}`;
    const k = `${who}|${r.raw.why.trim()}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  const rows: SyncRow[] = [];
  const fileMonths = new Set<string>();

  // 달이 적힌 청구(「10월 인보이스」)부터 맞춥니다. 달이 없는 「미납 정산」이 먼저 돌면 금액이
  // 우연히 같은 10월 청구서를 가져가 버립니다.
  const ordered = [...groups.entries()].sort((a, b) => {
    const ha = monthHintOf(a[1][0].raw.why, a[1][0].raw.issuedAt) ? 0 : 1;
    const hb = monthHintOf(b[1][0].raw.why, b[1][0].raw.issuedAt) ? 0 : 1;
    return ha - hb;
  });

  for (const [gk, list] of ordered) {
    list.sort((a, b) => String(a.raw.issuedAt ?? "").localeCompare(String(b.raw.issuedAt ?? "")) || a.raw.seq - b.raw.seq);
    const first = list[0];
    const sid = first.studentId;
    const stu = sid ? byId.get(sid) : undefined;
    const why = first.raw.why.trim();
    const paid = list.filter((r) => isPaid(r.raw.status));
    const sent = list.filter((r) => isSent(r.raw.status));
    const current = paid.length === 0 ? sent[sent.length - 1] ?? null : null;
    const paidAmount = paid.reduce((s, r) => s + Math.round(Number(r.raw.amount)), 0);
    const openAmount = current ? Math.round(Number(current.raw.amount)) : 0;
    const approvals = paid.map((r) => r.raw.approvalNo ?? "").filter((v) => v && v !== "-");
    const paidAt = paid.length > 0 ? paid[paid.length - 1].raw.paidAt : null;
    for (const r of list) if (r.raw.issuedAt) fileMonths.add(r.raw.issuedAt.slice(0, 7));
    const key = `g|${gk}|${first.raw.issuedAt ?? ""}`;
    const tentative = list.some((r) => r.tentative);

    const base = {
      key,
      studentId: sid,
      studentName: stu?.name ?? first.raw.name.trim(),
      where: whereOf(stu),
      department: stu?.department ?? null,
      tentative,
      matchWhy: first.why,
      candidates: first.candidates,
      linkKey: linkKeyOf(first.raw),
      why,
      history: list.map((r) => ({ issuedAt: r.raw.issuedAt, amount: Math.round(Number(r.raw.amount)), status: r.raw.status, paidAt: r.raw.paidAt, name: r.raw.name })),
      paidAmount,
      openAmount,
      paidAt,
      approvals,
      pays: [] as SyncPay[],
      sourceKey: approvals.length === 1 ? approvalKey(approvals[0]) : null,
      markExported: [] as string[],
      mark: markBy.get(key) ?? null,
      byNumber: false,
    };
    const invView = (vs: readonly SyncInvoice[]) =>
      vs.map((v) => ({ id: v.id, invoiceNo: v.invoiceNo, billingMonth: v.billingMonth, stream: v.stream, total: v.total, balance: balanceOf(v), offline: v.offline, exported: v.exported }));

    if (!sid) {
      rows.push({ ...base, code: "학생확인", invoices: [], note: "올톡 이름이 누구인지 정해 주세요. 한 번 정하면 다음 파일부터 자동으로 붙습니다." });
      continue;
    }
    if (paid.length === 0 && !current) {
      rows.push({ ...base, code: "참고", invoices: [], note: "결제중단·발송실패만 남았습니다. 운영앱은 그대로 둡니다 — 다시 보낼지만 판단하세요." });
      continue;
    }

    // ── ③ 앱 청구서 찾기 ────────────────────────────────────────────────
    const alive = invoices.filter((v) => v.studentId === sid && v.status === "발행" && !v.carried && !used.has(v.id));
    const target = paidAmount > 0 ? paidAmount : openAmount;
    let match: SyncInvoice[] | null = null;
    let matchNote = "";
    let byNumber = false;

    // 앱에서 내보낸 파일로 보낸 건은 청구사유 앞에 번호가 있습니다. 번호가 곧 답입니다.
    const nos = invoiceNosOf(why);
    if (nos.length > 0) {
      const hit = alive.filter((v) => nos.includes(v.invoiceNo));
      if (hit.length === nos.length) {
        match = hit;
        byNumber = true;
      }
    }
    const hint = monthHintOf(why, first.raw.issuedAt);
    if (!match) {
      const sameMonth = hint ? alive.filter((v) => v.billingMonth === hint) : [];
      match = sameMonth.length > 0 ? subsetMatch(sameMonth, target, (v) => v.total) : null;
      if (!match && paidAmount > 0) {
        // 이미 일부 받은 장이면 남은 금액으로도 맞춰 봅니다.
        match = sameMonth.length > 0 ? subsetMatch(sameMonth, target, balanceOf) : null;
      }
      if (!match) {
        // 달이 안 적힌 청구는 **보낸 달까지의** 청구서만 봅니다 - 9월에 보낸 정산이 10월 청구서일 수는 없습니다.
        const sentMonth = (first.raw.issuedAt ?? "").slice(0, 7);
        const open = alive.filter(
          (v) => balanceOf(v) > 0 && !(hint && v.billingMonth === hint) && (hint || !sentMonth || !v.billingMonth || v.billingMonth <= sentMonth),
        );
        match = subsetMatch(open, target, (v) => v.total) ?? subsetMatch(open, target, balanceOf);
        if (match && hint) matchNote = ` 앱에는 ${[...new Set(match.map((v) => v.billingMonth ?? "?"))].join("·")} 청구로 되어 있습니다(금액 일치).`;
      }
      if (!match && paidAmount > 0) {
        // 이미 받은 장과 금액이 맞으면 「일치」입니다.
        const done = alive.filter((v) => balanceOf(v) === 0);
        match = subsetMatch(done, target, (v) => v.total);
      }
    }

    base.byNumber = byNumber;

    // 승인번호가 이미 앱에 들어가 있으면 그 결제는 끝난 것입니다.
    const alreadyIn = approvals.length > 0 && approvals.every((a) => paidKeys.has(approvalKey(a)));

    if (paid.length > 1 && new Set(paid.map((r) => r.raw.amount)).size === 1 && !match) {
      rows.push({
        ...base,
        code: "확인",
        invoices: invView(alive.filter((v) => v.total === Math.round(Number(paid[0].raw.amount)))),
        note: `같은 금액 ${won(Math.round(Number(paid[0].raw.amount)))}원이 ${paid.length}번 결제됐습니다. 중복 결제인지 먼저 확인하세요 — 중복이면 금전 창에서 환불 또는 예치금으로.`,
      });
      continue;
    }

    if (match) {
      for (const v of match) used.add(v.id);
      if (paidAmount > 0) {
        const need = match.filter((v) => balanceOf(v) > 0);
        if (need.length === 0 || alreadyIn) {
          rows.push({ ...base, code: "일치", invoices: invView(match), markExported: match.filter((v) => !v.exported && !v.offline).map((v) => v.id), note: "이미 맞습니다." + matchNote });
        } else {
          rows.push({
            ...base,
            code: "수납",
            invoices: invView(match),
            pays: need.map((v) => ({ invoiceId: v.id, invoiceNo: v.invoiceNo, amount: balanceOf(v) })),
            markExported: match.filter((v) => !v.exported).map((v) => v.id),
            note: `올톡 결제 ${won(paidAmount)}원을 ${need.map((v) => `${v.invoiceNo}에 ${won(balanceOf(v))}`).join(" / ")}원 넣습니다.` + matchNote,
          });
        }
      } else {
        const notMarked = match.filter((v) => !v.exported);
        rows.push({
          ...base,
          code: notMarked.length > 0 ? "올톡표시" : "일치",
          invoices: invView(match),
          markExported: notMarked.map((v) => v.id),
          note: notMarked.length > 0 ? "금액이 맞고 올톡으로 나간 상태입니다. 「올톡」 표시만 켭니다(미납은 그대로)." + matchNote : "올톡 표시까지 되어 있습니다." + matchNote,
        });
      }
      continue;
    }

    const sameMonth = hint ? alive.filter((v) => v.billingMonth === hint) : [];
    if (sameMonth.length > 0) {
      for (const v of sameMonth) used.add(v.id);
      rows.push({
        ...base,
        code: "확인",
        invoices: invView(sameMonth),
        note: `금액이 다릅니다 — 올톡 ${won(target)}원 / 앱 ${won(sameMonth.reduce((s, v) => s + v.total, 0))}원. 어느 쪽이 맞는지 확인한 뒤 고치세요(앱이 틀렸으면 금전 창에서 ↩ 취소 후 재발행).`,
      });
      continue;
    }
    rows.push({
      ...base,
      code: "앱에없음",
      invoices: [],
      note:
        paidAmount > 0
          ? `올톡에서 ${won(paidAmount)}원 결제됐는데 앱에 같은 금액 청구서가 없습니다. 무엇에 대한 돈인지 확인하고 판단을 표시하세요.`
          : `올톡으로 ${won(openAmount)}원 청구가 나갔는데 앱에 같은 금액 청구서가 없어 앱 미납금에 안 잡힙니다.`,
    });
  }

  // ── ④ 앱에만 있는 청구서 ──────────────────────────────────────────────
  //
  // 파일이 덮는 달(등록일의 달)에 발행된 장만 봅니다. 파일 밖의 달까지 보면 지난 학기 장이
  // 전부 「앱에만」으로 쏟아집니다.
  const months = [...fileMonths].sort();
  const lo = months[0] ?? null;
  const hi = months[months.length - 1] ?? null;
  for (const v of invoices) {
    if (v.status !== "발행" || v.carried || v.offline || used.has(v.id) || balanceOf(v) === 0 || !v.studentId) continue;
    const bm = v.billingMonth;
    if (!lo || !hi || !bm || bm < lo || bm > hi) continue;
    const stu = byId.get(v.studentId);
    const key = `inv|${v.invoiceNo}`;
    rows.push({
      key,
      code: "앱에만",
      studentId: v.studentId,
      studentName: stu?.name ?? "",
      where: whereOf(stu),
      department: stu?.department ?? null,
      tentative: false,
      matchWhy: "",
      candidates: [],
      linkKey: null,
      why: `${bm.slice(5)}월 ${v.stream}`,
      history: [],
      paidAmount: 0,
      openAmount: balanceOf(v),
      paidAt: null,
      approvals: [],
      invoices: [{ id: v.id, invoiceNo: v.invoiceNo, billingMonth: v.billingMonth, stream: v.stream, total: v.total, balance: balanceOf(v), offline: v.offline, exported: v.exported }],
      pays: [],
      sourceKey: null,
      markExported: [],
      note: v.exported
        ? "앱에서 올톡 파일로 내보냈는데 이 파일에는 없습니다. 올톡에 실제로 등록됐는지 확인하세요."
        : "앱에서 발행했는데 올톡으로 나간 기록이 없습니다. 직접 받았으면 수납, 보내야 하면 올톡페이로 청구, 잘못 만든 장이면 취소.",
      mark: markBy.get(key) ?? null,
      byNumber: false,
    });
  }

  const order = new Map(SYNC_CODES.map((c, i) => [c, i]));
  rows.sort(
    (a, b) =>
      (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0) ||
      a.where.localeCompare(b.where) ||
      a.studentName.localeCompare(b.studentName, "ko"),
  );

  const summary = Object.fromEntries(SYNC_CODES.map((c) => [c, { count: 0, amount: 0, decided: 0 }])) as SyncSummary;
  for (const r of rows) {
    const s = summary[r.code];
    s.count += 1;
    s.amount += r.code === "수납" ? r.pays.reduce((n, p) => n + p.amount, 0) : r.paidAmount || r.openAmount;
    if (r.mark?.kind === "decision" && r.mark.decision) s.decided += 1;
  }
  return { rows, summary };
}
