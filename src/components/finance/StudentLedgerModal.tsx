"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { Who } from "@/components/common/HomonymProvider";
import { won } from "@/lib/feeItems";
import { todayKst } from "@/lib/kst";
import { PAYMENT_METHOD_KINDS } from "@/lib/payments";
import type { Ledger, LedgerCharge, LedgerInvoice } from "@/lib/studentLedger";
import type { Invoice } from "@/lib/types";
import type { AlreadyPaidResult } from "@/components/finance/AlreadyPaidModal";
import AlreadyPaidModal from "@/components/finance/AlreadyPaidModal";
import { FINANCE_TABLES } from "@/lib/useFinanceLive";
import { createClient } from "@/lib/supabase/client";
import PayModal from "@/components/finance/PayModal";
import DepositApplyModal from "@/components/finance/DepositApplyModal";
import { isFromDeposit } from "@/lib/depositLines";
import CancelInvoiceModal from "@/components/finance/CancelInvoiceModal";
import InvoiceFixModal from "@/components/finance/InvoiceFixModal";
import InvoicePreviewModal from "@/components/finance/InvoicePreviewModal";
import AlltalkpayExport from "@/components/finance/AlltalkpayExport";
import InvoiceSheet, { type SheetPart } from "@/components/finance/InvoiceSheet";
import { addDays, DUE_DAYS } from "@/lib/financePeriod";
import type { InvoiceLine } from "@/lib/types";

/**
 * **학생 금전 창** — 학생 한 명의 돈을 한 창에서 봅니다. 그리고 그 창에서 다 합니다.
 *
 * ── 왜 창 하나인가 ──────────────────────────────────────────────────────────
 *
 * 돈을 적는 창이 넷(이미받음 · 결제체크 · 환불 · 선입금)이었고 저마다 다른 질문을 했습니다.
 * 사람은 「이 아이한테 얼마 받아야 하지」 하나를 묻는데, 답을 보려면 학비 표·학비외 표·수납·
 * 예치금 네 화면을 돌아야 했습니다. 돌다 보면 하나를 빠뜨리고, 빠뜨린 돈은 조용히 미납이
 * 되거나 두 번 청구됩니다.
 *
 * 이 창은 **원장을 보여주고, 원장에 줄을 더하는 단추만** 둡니다.
 *
 *   받을 돈   — 요금표에서 이 아이에게 붙은 학비·학비외 항목. 아직 안 담긴 것이 「청구할 금액」
 *   청구서    — 살아 있는 장과 상태. 인쇄 · 영수증 · 올톡페이 보냄 · 입금 · 취소
 *   입금·예치금 — 들어온 돈 전부. 어느 장에 붙었는지, 안 붙었으면 예치금
 *
 * **숫자는 전부 서버가 셉니다**(`studentLedger.ts`). 창은 무엇을 했든 다시 읽어 다시 그립니다.
 * 창 안에서 숫자를 손으로 고치면 두 사람이 같은 창을 열었을 때 다른 숫자를 봅니다.
 *
 * 발행·입금·취소·올톡페이 내보내기는 **이미 있는 창구와 창**을 그대로 씁니다. 같은 일을 하는
 * 코드를 두 벌 두지 않습니다 - 규칙이 바뀌면 한 쪽만 고쳐지는 날이 옵니다.
 */

type LedgerResponse = {
  ledger: Ledger;
  addableItems: { id: string; label: string; category: string; unitPrice: number; isDefault: boolean }[];
  termId: string | null;
  terms: { id: string; name: string; status: string }[];
  warnings: string[];
};

const STATE_STYLE: Record<string, string> = {
  완납: "bg-emerald-100 text-emerald-800",
  부분납부: "bg-amber-100 text-amber-800",
  결손: "bg-violet-100 text-violet-700",
  연체: "bg-rose-100 text-rose-700",
  미납: "bg-slate-100 text-slate-600",
  취소: "bg-slate-100 text-slate-400 line-through",
  이월됨: "bg-slate-100 text-slate-400",
};

export default function StudentLedgerModal({
  studentId,
  termId: initialTermId,
  onClose,
  onChanged,
  embedded = false,
}: {
  studentId: string;
  termId?: string | null;
  onClose: () => void;
  /** 발행·입금 등으로 자료가 바뀌면 부르는 쪽이 자기 목록을 다시 읽게 합니다. */
  onChanged?: () => void;
  /** 학생 창(StudentPanel)의 회계 탭 안에 끼울 때. 덮개·닫기 단추 없이 본문만 그립니다. */
  embedded?: boolean;
}) {
  const notify = useToast();
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null>(initialTermId ?? null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedInv, setPickedInv] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);

  // 하위 창들
  const [already, setAlready] = useState(false);
  // 발행 전에 보는 초안. 먼저 보고 그대로 발행합니다 - 눌러봐야 아는 단추는 아무도 안 누릅니다.
  const [draft, setDraft] = useState<{ combine: boolean } | null>(null);
  const [paying, setPaying] = useState<LedgerInvoice | null>(null);
  /** 예치금에서 뺄 항목을 고르는 청구서. 발행 직후에도 열립니다. */
  const [depositFor, setDepositFor] = useState<{ id: string; label: string } | null>(null);
  const [cancelling, setCancelling] = useState<LedgerInvoice | null>(null);
  const [fixing, setFixing] = useState<LedgerInvoice | null>(null);
  const [preview, setPreview] = useState<{ id: string; label: string; receipt: boolean } | null>(null);
  const [exporting, setExporting] = useState<string[] | null>(null);
  const [addItemId, setAddItemId] = useState("");
  const [depositOpen, setDepositOpen] = useState(false);
  const [dep, setDep] = useState({ amount: "", paidAt: todayKst(), method: PAYMENT_METHOD_KINDS[0] as string, memo: "" });

  const load = useCallback(async () => {
    setLoadErr(null);
    const res = await fetch(`/api/finance/ledger/${studentId}${termId ? `?term=${termId}` : ""}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as LedgerResponse & { error?: string };
    if (!res.ok) {
      setLoadErr(body.error ?? `읽지 못했습니다 (${res.status})`);
      return;
    }
    setData(body);
    if (!termId && body.termId) setTermId(body.termId);
  }, [studentId, termId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 열린 창도 실시간입니다. 옆자리에서 이 아이의 입금을 넣거나 항목을 고치면 이 창이 옛 숫자를
   * 들고 있게 되고, 그 숫자로 청구서를 만들면 두 번 청구됩니다. 재무 표가 바뀌면 다시 읽습니다 -
   * 자기 손으로 바꾼 것도 한 번 더 읽게 되지만, 틀린 숫자를 드는 것보다 낫습니다.
   */
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    };
    const channel = supabase.channel(`student-ledger-${studentId}`);
    for (const table of [...FINANCE_TABLES, "wr_students"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, reload);
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [studentId, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => !embedded && e.key === "Escape" && !already && !paying && !cancelling && !preview && !exporting && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, already, paying, cancelling, preview, exporting, embedded]);

  /** 무엇이든 바꾼 뒤에는 다시 읽습니다. 그리고 닫을 때 바깥에도 알립니다. */
  async function changed() {
    setTouched(true);
    setPicked(new Set());
    setPickedInv(new Set());
    await load();
  }
  function close() {
    if (touched) onChanged?.();
    onClose();
  }

  const ledger = data?.ledger ?? null;
  const unbilled = useMemo(() => (ledger?.charges ?? []).filter((c) => !c.billed && c.amount > 0), [ledger]);
  const pickedCharges = unbilled.filter((c) => picked.has(`${c.kind}:${c.id}`));
  const targetCharges = pickedCharges.length > 0 ? pickedCharges : unbilled;

  async function post(url: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, body: b };
  }

  /**
   * **청구서 만들기.** 체크한 항목만, 안 체크했으면 아직 안 담긴 것 전부.
   *
   * 학비와 학비외는 **두 장**입니다(원칙). 둘 다 있으면 둘 다 보내고, 어느 쪽이 실패했는지
   * 그대로 말합니다. 한쪽만 나갔는데 「발행했습니다」라고 하면 나머지 돈이 조용히 남습니다.
   */
  async function issue(combine: boolean) {
    if (!ledger) return;
    if (targetCharges.length === 0) return notify("보낼 항목이 없습니다. 옵션을 고르거나 항목을 넣어주세요.", "error");
    const tuition = targetCharges.filter((c) => c.kind === "학비").map((c) => c.id);
    let extra = targetCharges.filter((c) => c.kind === "학비외").map((c) => c.id);
    // 한 장으로 묶으면 학비 장에 학비외 줄이 항목 번호와 함께 들어가 「이미 나갔는가」 판정은 그대로 됩니다.
    const merged = combine && tuition.length > 0 && extra.length > 0;
    setBusy(true);
    const failed: string[] = [];
    const made: string[] = [];
    const madeIds: { id: string; no: string }[] = [];
    // 예치금이 있으면 저절로 빼지 않고, 발행한 뒤 **뺄 항목을 고르는 창**을 엽니다. 사람이 이 자리에
    // 있으니 무엇을 예치금에서 낼지는 사람이 정합니다.
    const skipPrepaid = (ledger.totals.deposit ?? 0) > 0;
    const keep = (r: { body: Record<string, unknown> }, fallback: string) => {
      const v = r.body.invoice as { id?: string; invoice_no?: string } | undefined;
      made.push(String(v?.invoice_no ?? fallback));
      if (v?.id) madeIds.push({ id: v.id, no: String(v.invoice_no ?? fallback) });
    };
    try {
      if (tuition.length > 0) {
        const r = await post("/api/finance/invoices/tuition", { studentId, termId, planIds: tuition, skipPrepaid, ...(merged ? { itemIds: extra } : {}) });
        if (r.ok) keep(r, "학비");
        else failed.push(`학비${merged ? "+학비외" : ""}(${String(r.body.error ?? "")})`);
        if (merged) extra = [];
      }
      if (extra.length > 0) {
        let r = await post("/api/finance/invoices", { studentId, feeTermId: termId, itemIds: extra, skipPrepaid });
        // 서버가 「이미 담긴 항목」을 잡으면 사람에게 묻습니다. 한 학기에 같은 교재를 두 번 사는
        // 일은 있지만 드물고, 두 번 청구되는 사고는 흔합니다 - 기본은 막고 확인한 때만 넘깁니다.
        if (!r.ok && Array.isArray(r.body.duplicates)) {
          const dups = r.body.duplicates as { name: string; invoiceNo: string }[];
          const again = confirm(`이미 청구서에 담긴 항목입니다:\n${dups.map((d) => `· ${d.name} — ${d.invoiceNo}`).join("\n")}\n\n정말 한 번 더 청구할까요? (아니면 그 장을 먼저 취소하세요)`);
          if (again) r = await post("/api/finance/invoices", { studentId, feeTermId: termId, itemIds: extra, allowDuplicate: true, skipPrepaid });
        }
        if (r.ok) keep(r, "학비외");
        else failed.push(`학비외(${String(r.body.error ?? "")})`);
      }
    } finally {
      setBusy(false);
    }
    setDraft(null);
    if (failed.length) notify(`${made.length ? `${made.join(", ")} 발행 · ` : ""}실패: ${failed.join(" / ")}`, "error");
    else notify(`${made.join(", ")} 발행했습니다.`, "success");
    await changed();
    if (skipPrepaid && madeIds.length > 0) setDepositFor({ id: madeIds[0].id, label: `${ledger.student.name} · ${madeIds[0].no}` });
  }

  /**
   * **발행 전 초안.** 고른 항목(없으면 미청구 전부)으로 종이에 찍힐 그대로 만듭니다. 금액은 서버와
   * 같은 함수(`studentLedger`)가 이미 셌으므로 발행본과 같습니다 - 할인은 줄 안에 반영된 금액입니다.
   */
  function draftParts(combine: boolean): SheetPart[] {
    if (!ledger) return [];
    const today = todayKst();
    const mk = (stream: "학비" | "학비외", charges: LedgerCharge[]): SheetPart => {
      const inv: Invoice & { stream: string; plan_scope?: string | null } = {
        id: `draft-${stream}`,
        invoice_no: "(발행 전 미리보기)",
        student_id: ledger.student.id,
        student_name: ledger.student.name_en?.trim() || ledger.student.name,
        student_name_ko: ledger.student.name,
        grade_label: [ledger.student.grade ? `${ledger.student.grade}학년` : null, ledger.student.class_name].filter(Boolean).join(" ") || null,
        issue_date: today,
        due_date: addDays(today, DUE_DAYS),
        total_amount: charges.reduce((n, c) => n + c.amount, 0),
        status: "발행",
        note: null,
        issued_by: null,
        created_at: new Date().toISOString(),
        term_id: termId,
        category: stream,
        guardian_phone: null,
        exported_at: null,
        export_batch: null,
        stream,
      };
      const lines: InvoiceLine[] = charges.map((c, i) => ({
        id: `draft-line-${c.kind}-${c.id}`,
        invoice_id: inv.id,
        seq: i + 1,
        name: c.kind === "학비" ? `${c.label}${c.optionName ? ` · ${c.optionName}` : ""}` : c.label,
        qty: c.extra?.qty ?? 1,
        unit_price: c.extra && c.extra.qty > 1 ? Math.round(c.amount / c.extra.qty) : c.amount,
        amount: c.amount,
      }));
      return { invoice: inv, lines };
    };
    const t = targetCharges.filter((c) => c.kind === "학비");
    const e = targetCharges.filter((c) => c.kind === "학비외");
    if (combine && t.length > 0 && e.length > 0) return [mk("학비", t), mk("학비외", e)];
    const parts: SheetPart[] = [];
    if (t.length > 0) parts.push(mk("학비", t));
    if (e.length > 0) parts.push(mk("학비외", e));
    return parts;
  }

  /** 「이미 받음」. 받은 날로 묶어 장을 만들고 입금을 붙입니다 - 학비·학비외 창구를 각각 부릅니다. */
  async function recordAlready(r: AlreadyPaidResult) {
    setBusy(true);
    const failed: string[] = [];
    let count = 0;
    try {
      const batches =
        r.batches.length > 0
          ? r.batches
          : [{ paidAt: r.paidAt, itemIds: targetCharges.map((c) => `${c.kind}:${c.id}`), amount: r.amount, labels: targetCharges.map((c) => c.label) }];
      for (const b of batches) {
        const tuition = b.itemIds.filter((k) => k.startsWith("학비:")).map((k) => k.slice(3));
        const extra = b.itemIds.filter((k) => k.startsWith("학비외:")).map((k) => k.slice(4));
        const tAmount = targetCharges.filter((c) => c.kind === "학비" && tuition.includes(c.id)).reduce((n, c) => n + c.amount, 0);
        const eAmount = targetCharges.filter((c) => c.kind === "학비외" && extra.includes(c.id)).reduce((n, c) => n + c.amount, 0);
        // 금액을 손으로 고친 경우(항목 합과 다름)는 한 갈래만 있을 때 그 갈래에 그대로 둡니다.
        const single = tuition.length > 0 && extra.length === 0 ? "학비" : extra.length > 0 && tuition.length === 0 ? "학비외" : null;
        if (tuition.length > 0) {
          const res = await post("/api/finance/invoices/tuition", {
            studentId, termId, planIds: tuition, dueDate: b.paidAt, billingMonth: b.paidAt.slice(0, 7),
            alreadyPaid: { paidAt: b.paidAt, amount: single === "학비" ? b.amount : tAmount, method: r.method, memo: `기수납 항목: ${b.labels.join(" · ")}` },
          });
          if (res.ok) count++; else failed.push(`학비 ${b.paidAt}(${String(res.body.error ?? "")})`);
        }
        if (extra.length > 0) {
          const res = await post("/api/finance/invoices", {
            studentId, feeTermId: termId, itemIds: extra, dueDate: b.paidAt, billingMonth: b.paidAt.slice(0, 7),
            alreadyPaid: { paidAt: b.paidAt, amount: single === "학비외" ? b.amount : eAmount, method: r.method, memo: `기수납 항목: ${b.labels.join(" · ")}` },
          });
          if (res.ok) count++; else failed.push(`학비외 ${b.paidAt}(${String(res.body.error ?? "")})`);
        }
      }
    } finally {
      setBusy(false);
    }
    setAlready(false);
    if (failed.length) notify(`${count}장 기록 · 실패: ${failed.join(" / ")}`, "error");
    else notify(`${count}장을 이미 받은 것으로 넣었습니다.`, "success");
    await changed();
  }

  /** 학비 옵션 고르기 / 빼기. 표의 pickOption 과 같은 창구. */
  async function setOption(c: LedgerCharge, optionId: string) {
    setBusy(true);
    const r = await post("/api/finance/ledger/enroll", { studentId, planId: c.id, optionId: optionId || null, termId });
    setBusy(false);
    if (!r.ok) return notify(String(r.body.error ?? "바꾸지 못했습니다."), "error");
    await changed();
  }

  /** 학비 금액을 손으로 정하기 / 요금표대로 되돌리기. 이유 없이는 저장되지 않습니다(서버). */
  async function setOverride(c: LedgerCharge) {
    if (!c.tuition?.optionId) return notify("먼저 납부 옵션을 고르세요.", "error");
    const raw = prompt(`${c.label} — 이 학생만 다른 금액으로 청구하려면 금액을 적으세요.\n비우면 요금표대로 돌아갑니다.`, c.amount > 0 ? String(c.amount) : "");
    if (raw === null) return;
    const amount = raw.trim() === "" ? null : Math.round(Number(raw.replace(/[^\d]/g, "")));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return notify("금액이 올바르지 않습니다.", "error");
    let note: string | null = null;
    if (amount !== null) {
      note = prompt("왜 다른지 한 줄로 적어주세요. (예: 형제 할인 별도 협의)", c.note?.replace(/^직접 정한 금액 · /, "") ?? "");
      if (note === null) return;
      if (!note.trim()) return notify("이유를 적어야 저장됩니다.", "error");
    }
    setBusy(true);
    const r = await post("/api/finance/ledger/enroll", { studentId, planId: c.id, optionId: c.tuition.optionId, termId, overrideAmount: amount, overrideNote: note });
    setBusy(false);
    if (!r.ok) return notify(String(r.body.error ?? "바꾸지 못했습니다."), "error");
    await changed();
  }

  /** 학비 항목에 할인 붙이기 / 떼기. 학비 일괄 표와 같은 창구·같은 규칙. */
  async function setDiscount(c: LedgerCharge, discountId: string, on: boolean) {
    setBusy(true);
    const r = await post("/api/finance/ledger/discount", { studentId, planId: c.id, discountId, on, termId });
    setBusy(false);
    if (!r.ok) return notify(String(r.body.error ?? "바꾸지 못했습니다."), "error");
    await changed();
  }

  /** 학비외 항목 넣기 / 빼기. */
  async function setItem(itemId: string, include: boolean, isDefault: boolean, qty = 1) {
    setBusy(true);
    const r = await post("/api/finance/ledger/item", { studentId, itemId, include, isDefault, qty, termId });
    setBusy(false);
    if (!r.ok) return notify(String(r.body.error ?? "바꾸지 못했습니다."), "error");
    setAddItemId("");
    await changed();
  }

  async function toggleExported(inv: LedgerInvoice) {
    setBusy(true);
    const r = await post("/api/finance/ledger/exported", { invoiceIds: [inv.id], exported: !inv.exported });
    setBusy(false);
    if (!r.ok) return notify(String(r.body.error ?? "표시하지 못했습니다."), "error");
    await changed();
  }

  async function addDeposit() {
    const amount = Math.round(Number(dep.amount));
    if (!Number.isFinite(amount) || amount <= 0) return notify("금액을 적어주세요.", "error");
    setBusy(true);
    const r = await post("/api/finance/prepaid", { studentId, amount, paidAt: dep.paidAt, method: dep.method, memo: dep.memo });
    setBusy(false);
    if (!r.ok) return notify(String(r.body.error ?? "넣지 못했습니다."), "error");
    notify(`${won(amount)}을 예치금으로 넣었습니다. 다음 청구서에서 깎입니다.`, "success");
    setDepositOpen(false);
    setDep({ amount: "", paidAt: todayKst(), method: PAYMENT_METHOD_KINDS[0], memo: "" });
    await changed();
  }

  const togglePick = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const togglePickInv = (id: string) =>
    setPickedInv((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const student = ledger?.student;
  const invoicesAlive = (ledger?.invoices ?? []).filter((v) => v.settled.state !== "취소");
  const invoicesCancelled = (ledger?.invoices ?? []).filter((v) => v.settled.state === "취소");

  return (
    <div className={embedded ? "contents" : "fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3"} onClick={embedded ? undefined : close}>
      <div className={embedded ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"} onClick={(e) => e.stopPropagation()}>
        {/* ── 머리 ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900">
              {student ? <Who id={student.id} name={student.name} plain /> : "…"}
              {student && (
                <span className="ml-1.5 text-[12px] font-semibold text-slate-500">
                  {[student.grade ? `${student.grade}학년` : null, student.class_name].filter(Boolean).join(" ")}
                  {student.name_en ? ` · ${student.name_en}` : ""}
                </span>
              )}
            </div>
            {data && data.terms.length > 1 && (
              <select
                value={termId ?? ""}
                onChange={(e) => setTermId(e.target.value || null)}
                className="mt-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
              >
                {data.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.status === "진행중" ? " (지금)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          {ledger && (
            <div className="ml-auto flex flex-wrap items-stretch gap-2 text-right">
              <Stat label="청구 예정액" value={ledger.totals.toBill} tone={ledger.totals.toBill > 0 ? "amber" : "slate"} />
              <Stat label="미수금" value={ledger.totals.unpaid} tone={ledger.totals.unpaid > 0 ? "rose" : "slate"} />
              <Stat label="예치금" value={ledger.totals.deposit} tone={ledger.totals.deposit > 0 ? "teal" : "slate"} />
              <Stat label="학기 수납 예정액" value={ledger.totals.expected} tone="slate" />
            </div>
          )}
          {!embedded && (
            <button onClick={close} className="ml-1 px-1 text-lg font-bold text-slate-400 hover:text-slate-700" title="닫기 (Esc)">
              ✕
            </button>
          )}
        </div>

        {loadErr && <p className="m-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">읽지 못했습니다: {loadErr}</p>}
        {data?.warnings?.length ? (
          <p className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
            일부 자료를 못 읽었습니다 — 아래 숫자가 모자랄 수 있습니다: {data.warnings.join(" · ")}
          </p>
        ) : null}

        {!ledger && !loadErr && <p className="p-8 text-center text-sm text-slate-400">읽는 중…</p>}

        {ledger && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto md:grid-cols-5">
            {/* ── 받을 돈 ─────────────────────────────────────────────── */}
            <section className="border-b border-slate-200 p-3 md:col-span-2 md:border-b-0 md:border-r">
              <h3 className="mb-1 flex items-center justify-between text-[12px] font-black text-slate-700">
                <span>수납 대상 항목 — 요금표 기준</span>
                <span className="text-[10px] font-semibold text-slate-400">선택한 항목만 발행 · 미선택 시 미청구 항목 전체</span>
              </h3>
              {(["학비", "학비외"] as const).map((kind) => {
                const rows = ledger.charges.filter((c) => c.kind === kind);
                return (
                  <div key={kind} className="mb-2">
                    <div className="mb-0.5 text-[11px] font-bold text-slate-500">{kind}</div>
                    {rows.length === 0 && <p className="px-1 py-1 text-[11px] text-slate-400">{kind === "학비" ? "해당 학생에게 적용되는 학비 항목이 없습니다." : "등록된 학비외 항목이 없습니다."}</p>}
                    {rows.map((c) => {
                      const key = `${c.kind}:${c.id}`;
                      const canPick = !c.billed && c.amount > 0;
                      return (
                        <div
                          key={key}
                          className={
                            "flex items-center gap-2 rounded-lg border px-2 py-1 text-[12px] " +
                            (c.billed ? "border-slate-100 bg-slate-50 text-slate-400" : "border-slate-200 bg-white")
                          }
                        >
                          <input type="checkbox" disabled={!canPick} checked={picked.has(key)} onChange={() => togglePick(key)} className="h-3.5 w-3.5" />
                          <div className="min-w-0 flex-1">
                            <div className={"truncate " + (c.billed ? "" : "font-semibold text-slate-800")} title={c.label}>
                              {c.label}
                              {c.extra && !c.extra.fromDefault && <span className="ml-1 text-[10px] text-sky-600">개별 추가</span>}
                            </div>
                            {c.tuition ? (
                              <select
                                value={c.tuition.optionId ?? ""}
                                disabled={busy || !!c.billed}
                                onChange={(e) => void setOption(c, e.target.value)}
                                className="mt-0.5 max-w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] disabled:bg-transparent"
                                title={c.billed ? "이미 청구서에 담긴 항목은 옵션을 바꿀 수 없습니다. 그 장을 취소한 뒤 바꿔주세요." : "납부 옵션"}
                              >
                                <option value="">미신청</option>
                                {c.tuition.options.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              c.optionName && <div className="text-[10px] text-slate-500">{c.optionName}</div>
                            )}
                            {/* 할인 - 누르면 붙고 다시 누르면 떨어집니다. 담긴 항목은 잠깁니다(금액이 이미 나갔습니다). */}
                            {c.tuition && c.tuition.discounts.length > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {c.tuition.discounts.map((d) => (
                                  <button
                                    key={d.id}
                                    type="button"
                                    disabled={busy || !!c.billed}
                                    onClick={() => void setDiscount(c, d.id, !d.on)}
                                    className={"rounded px-1 text-[10px] font-semibold " + (d.on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400 hover:bg-slate-200")}
                                    title={d.on ? "붙어 있는 할인 - 누르면 뗍니다" : "누르면 이 할인을 붙입니다"}
                                  >
                                    {d.on ? "✓ " : ""}{d.name}
                                  </button>
                                ))}
                              </div>
                            )}
                            {c.note && <div className="text-[10px] text-slate-400">{c.note}</div>}
                          </div>
                          {c.extra && !c.billed && (
                            <label className="flex shrink-0 items-center gap-0.5 text-[10px] text-slate-500" title="수량">
                              ×
                              <input
                                type="number"
                                min={1}
                                defaultValue={c.extra.qty}
                                disabled={busy}
                                onBlur={(e) => {
                                  const q = Math.max(1, Math.round(Number(e.target.value)) || 1);
                                  if (q !== c.extra!.qty) void setItem(c.extra!.itemId, true, c.extra!.fromDefault, q);
                                }}
                                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                                className="w-10 rounded border border-slate-200 px-1 py-0.5 text-right text-[11px]"
                              />
                            </label>
                          )}
                          <div className="shrink-0 text-right">
                            <div className="tabular-nums font-bold">
                              {c.amount > 0 ? won(c.amount) : "—"}
                              {c.tuition && !c.billed && c.tuition.optionId && (
                                <button onClick={() => void setOverride(c)} disabled={busy} className="ml-1 text-[10px] font-normal text-slate-400 hover:text-slate-700" title="이 학생만 다른 금액으로">
                                  ✎
                                </button>
                              )}
                            </div>
                            {c.billed ? (
                              <button
                                onClick={() => setPreview({ id: c.billed!.invoiceId, label: `${student?.name} · ${c.billed!.invoiceNo ?? ""}`, receipt: false })}
                                className={"text-[10px] font-bold underline " + (c.billed.state === "완납" ? "text-emerald-700" : c.billed.state === "일부" ? "text-amber-700" : "text-slate-500")}
                                title="그 청구서 보기"
                              >
                                {c.billed.state === "완납" ? "수납 완료" : c.billed.state === "일부" ? "일부 수납" : "청구 완료"} {c.billed.invoiceNo ?? ""}
                                {c.billed.unsure ? " ?" : ""}
                              </button>
                            ) : c.amount > 0 ? (
                              <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">미청구</span>
                            ) : null}
                          </div>
                          {c.extra && !c.billed && (
                            <button
                              onClick={() => void setItem(c.extra!.itemId, false, c.extra!.fromDefault)}
                              disabled={busy}
                              className="shrink-0 text-[11px] text-slate-300 hover:text-rose-600"
                              title="이 학생에게서 이 항목을 뺍니다"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {kind === "학비외" && data && data.addableItems.length > 0 && (
                      <div className="mt-1 flex items-center gap-1">
                        <select value={addItemId} onChange={(e) => setAddItemId(e.target.value)} className="min-w-0 flex-1 rounded border border-dashed border-slate-300 px-1 py-0.5 text-[11px]">
                          <option value="">＋ 항목 넣기…</option>
                          {data.addableItems.map((i) => (
                            <option key={i.id} value={i.id}>
                              [{i.category}] {i.label} · {won(i.unitPrice)}
                            </option>
                          ))}
                        </select>
                        {addItemId && (
                          <button
                            onClick={() => {
                              const it = data.addableItems.find((i) => i.id === addItemId);
                              if (it) void setItem(it.id, true, it.isDefault);
                            }}
                            disabled={busy}
                            className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-white"
                          >
                            넣기
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => setDraft({ combine: true })}
                  disabled={busy || unbilled.length === 0}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
                  title="선택한 항목(미선택 시 미청구 항목 전체)으로 청구서가 어떻게 나갈지 먼저 보고, 그대로 발행합니다"
                >
                  🧾 청구서 보기{targetCharges.length > 0 ? ` (${won(targetCharges.reduce((n, c) => n + c.amount, 0))})` : ""}
                </button>
                <button
                  onClick={() => setAlready(true)}
                  disabled={busy || unbilled.length === 0}
                  className="rounded-lg bg-sky-100 px-3 py-1.5 text-[12px] font-bold text-sky-800 hover:bg-sky-200 disabled:opacity-40"
                  title="이미 수납된 항목을 수납일 기준으로 등록합니다(청구서 + 입금)"
                >
                  💰 기수납 등록
                </button>
              </div>
            </section>

            {/* ── 청구서 · 입금 ──────────────────────────────────────────── */}
            <section className="p-3 md:col-span-3">
              <h3 className="mb-1 flex items-center justify-between text-[12px] font-black text-slate-700">
                <span>청구서</span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => setExporting(pickedInv.size > 0 ? [...pickedInv] : invoicesAlive.filter((v) => v.settled.state !== "완납" && !v.issued_offline).map((v) => v.id))}
                    disabled={busy || invoicesAlive.length === 0}
                    className="rounded bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800 hover:bg-violet-200 disabled:opacity-40"
                    title="올톡페이 등록 파일을 만듭니다(체크한 장, 없으면 아직 안 걷힌 장 전부)"
                  >
                    📤 올톡페이로 청구{pickedInv.size > 0 ? ` (${pickedInv.size})` : ""}
                  </button>
                </span>
              </h3>
              {invoicesAlive.length === 0 && <p className="px-1 py-2 text-[11px] text-slate-400">이 학기 청구서가 없습니다.</p>}
              <div className="space-y-1">
                {invoicesAlive.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-[12px]">
                    <input type="checkbox" checked={pickedInv.has(v.id)} onChange={() => togglePickInv(v.id)} className="h-3.5 w-3.5" />
                    <button onClick={() => setPreview({ id: v.id, label: `${student?.name} · ${v.invoice_no}`, receipt: false })} className="font-bold text-slate-800 underline" title="청구서 보기 · 인쇄">
                      {v.invoice_no}
                    </button>
                    <span className={"rounded px-1 text-[10px] font-bold " + (v.stream === "학비" ? "bg-indigo-50 text-indigo-700" : "bg-orange-50 text-orange-700")}>{v.stream}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-600" title={(v as { plan_scope?: string | null }).plan_scope ?? ""}>
                      {(v as { plan_scope?: string | null }).plan_scope ?? (v.stream === "학비" ? "학비 전부" : v.category ?? "")} · {v.issue_date}
                      {v.issued_offline ? <span className="ml-1 text-[10px] text-sky-600">기수납</span> : null}
                    </span>
                    <span className="tabular-nums font-bold">{won(Number(v.total_amount))}</span>
                    <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (STATE_STYLE[v.settled.state] ?? "")} title={v.settled.balance > 0 ? `남은 ${won(v.settled.balance)}` : ""}>
                      {v.settled.state}
                      {v.settled.balance > 0 && v.settled.state !== "미납" ? ` ${won(v.settled.balance)}` : ""}
                    </span>
                    <label className="flex items-center gap-0.5 text-[10px] text-slate-500" title="올톡페이에 올렸는가">
                      <input type="checkbox" checked={v.exported} disabled={busy} onChange={() => void toggleExported(v)} className="h-3 w-3" />
                      올톡
                    </label>
                    <span className="flex items-center gap-0.5">
                      {(v.settled.balance > 0 && ledger.totals.deposit > 0) || ledger.payments.some((p) => p.invoice_id === v.id && isFromDeposit(p.matched_by)) ? (
                        <button
                          onClick={() => setDepositFor({ id: v.id, label: `${student?.name ?? ""} · ${v.invoice_no}` })}
                          className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 hover:bg-teal-200"
                          title="예치금에서 낼 항목을 고릅니다"
                        >
                          예치금
                        </button>
                      ) : null}
                      {v.settled.balance > 0 && (
                        <button onClick={() => setPaying(v)} className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 hover:bg-emerald-200" title="입금 기록">
                          입금
                        </button>
                      )}
                      {v.settled.state === "완납" && (
                        <button onClick={() => setPreview({ id: v.id, label: `${student?.name} · ${v.invoice_no} 영수증`, receipt: true })} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 hover:bg-slate-200" title="영수증 (청구서와 같은 양식)">
                          📄
                        </button>
                      )}
                      {/* 보낸 장은 정정, 안 보낸 장은 취소 후 재발행이 기본입니다. 둘 다 열어두되 기본 쪽을 눈에 띄게 둡니다. */}
                      <button
                        onClick={() => setFixing(v)}
                        className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (v.exported ? "bg-slate-800 text-white hover:bg-slate-900" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}
                        title={v.exported ? "보낸 청구서 정정 · 결손 요청 · 과목 경정" : "결손 요청 · 과목 경정 (금액은 ↩ 취소 후 다시 발행)"}
                      >
                        {v.exported ? "정정" : "🛠"}
                      </button>
                      <button
                        onClick={() => setCancelling(v)}
                        className={"px-1 text-[11px] hover:text-rose-600 " + (v.exported ? "text-slate-200" : "text-slate-400")}
                        title={v.exported ? "발행 취소 — 이미 보낸 장입니다. 금액이 틀렸다면 [정정]이 번호를 지킵니다" : "발행 취소 (지우지 않고 취소로 남깁니다) — 고쳐서 다시 발행"}
                      >
                        ↩
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              {invoicesCancelled.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] text-slate-400">취소된 장 {invoicesCancelled.length}</summary>
                  <ul className="mt-0.5 space-y-0.5 text-[10px] text-slate-400">
                    {invoicesCancelled.map((v) => (
                      <li key={v.id}>
                        {v.invoice_no} · {won(Number(v.total_amount))} · {v.cancel_reason ?? ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <h3 className="mb-1 mt-3 flex items-center justify-between text-[12px] font-black text-slate-700">
                <span>수납 · 예치금</span>
                <button onClick={() => setDepositOpen((v) => !v)} className="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800 hover:bg-teal-200" title="청구서 없이 미리 받은 돈">
                  ＋ 예치금 등록
                </button>
              </h3>
              {depositOpen && (
                <div className="mb-2 flex flex-wrap items-end gap-1.5 rounded-lg border border-teal-200 bg-teal-50/40 p-2 text-[11px]">
                  <label>
                    <span className="block text-[10px] text-slate-500">금액</span>
                    <input type="number" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-right tabular-nums" />
                  </label>
                  <label>
                    <span className="block text-[10px] text-slate-500">수납일</span>
                    <input type="date" value={dep.paidAt} onChange={(e) => setDep({ ...dep, paidAt: e.target.value })} className="rounded border border-slate-300 px-1.5 py-0.5" />
                  </label>
                  <label>
                    <span className="block text-[10px] text-slate-500">결제 수단</span>
                    <select value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })} className="rounded border border-slate-300 px-1.5 py-0.5">
                      {PAYMENT_METHOD_KINDS.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-[160px] flex-1">
                    <span className="block text-[10px] text-slate-500">사유</span>
                    <input value={dep.memo} onChange={(e) => setDep({ ...dep, memo: e.target.value })} placeholder="학기 전액 선납 · 중복 결제분 익월 차감 …" className="w-full rounded border border-slate-300 px-1.5 py-0.5" />
                  </label>
                  <button onClick={() => void addDeposit()} disabled={busy} className="rounded bg-slate-900 px-2.5 py-1 font-bold text-white disabled:opacity-40">
                    넣기
                  </button>
                </div>
              )}
              {ledger.payments.length === 0 && <p className="px-1 py-1 text-[11px] text-slate-400">들어온 돈이 없습니다.</p>}
              <div className="space-y-0.5">
                {ledger.payments.map((p) => {
                  const inv = ledger.invoices.find((v) => v.id === p.invoice_id);
                  const refund = (p.kind ?? "") === "refund";
                  return (
                    <div key={p.id} className="flex items-center gap-2 rounded px-2 py-0.5 text-[11px] odd:bg-slate-50">
                      <span className="w-20 shrink-0 tabular-nums text-slate-500">{p.paid_at}</span>
                      <span className="w-14 shrink-0 text-slate-600">{p.method ?? ""}</span>
                      <span className={"w-24 shrink-0 text-right tabular-nums font-bold " + (refund ? "text-rose-600" : "text-slate-800")}>
                        {refund ? "−" : ""}
                        {won(Number(p.amount))}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-500" title={p.memo ?? ""}>
                        {inv ? (
                          <>
                            → <button onClick={() => setPreview({ id: inv.id, label: `${student?.name} · ${inv.invoice_no}`, receipt: false })} className="underline">{inv.invoice_no}</button>
                            {isFromDeposit(p.matched_by) && <span className="ml-1 rounded bg-teal-50 px-1 font-bold text-teal-700">예치금에서</span>}
                          </>
                        ) : refund ? (
                          <span className="font-bold text-rose-600">돌려줌</span>
                        ) : (
                          <span className="rounded bg-teal-100 px-1 font-bold text-teal-800">예치금{p.origin ? ` · ${p.origin}` : ""}</span>
                        )}
                        {p.memo ? ` · ${p.memo}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ── 하위 창 — 전부 이미 있는 것들입니다 ──────────────────────────── */}
      {draft && ledger && (() => {
        const hasBoth = targetCharges.some((c) => c.kind === "학비") && targetCharges.some((c) => c.kind === "학비외");
        const parts = draftParts(draft.combine);
        const total = targetCharges.reduce((n, c) => n + c.amount, 0);
        return (
          <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-3" onClick={() => !busy && setDraft(null)}>
            <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
                <b className="text-sm">발행 전 미리보기 · {ledger.student.name} · {won(total)}</b>
                {hasBoth && (
                  <span className="ml-2 flex overflow-hidden rounded-lg border border-slate-300 text-[11px] font-bold">
                    <button onClick={() => setDraft({ combine: true })} className={"px-2.5 py-1 " + (draft.combine ? "bg-slate-800 text-white" : "bg-white text-slate-500")}>학비+학비외 한 장</button>
                    <button onClick={() => setDraft({ combine: false })} className={"px-2.5 py-1 " + (!draft.combine ? "bg-slate-800 text-white" : "bg-white text-slate-500")}>두 장으로</button>
                  </span>
                )}
                <span className="ml-auto text-[11px] text-slate-500">번호·납기는 발행할 때 정해집니다(납기 = 발행일 + {DUE_DAYS}일)</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-3">
                {draft.combine || !hasBoth ? (
                  <div className="mx-auto max-w-[720px] bg-white shadow"><InvoiceSheet parts={parts} embed /></div>
                ) : (
                  parts.map((p) => (
                    <div key={p.invoice.id} className="mx-auto mb-3 max-w-[720px] bg-white shadow"><InvoiceSheet parts={[p]} embed /></div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-2">
                <button onClick={() => setDraft(null)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-600">닫기</button>
                <button
                  onClick={() => void issue(draft.combine)}
                  disabled={busy}
                  className="ml-auto rounded-lg bg-slate-900 px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
                >
                  {busy ? "발행 중…" : hasBoth && !draft.combine ? "이대로 두 장 발행" : "이대로 발행"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {already && ledger && (
        <AlreadyPaidModal
          title="기수납 등록"
          studentName={ledger.student.name}
          lines={targetCharges.map((c) => ({ id: `${c.kind}:${c.id}`, label: `[${c.kind}] ${c.label}`, amount: c.amount }))}
          busy={busy}
          onClose={() => setAlready(false)}
          onSubmit={(r) => void recordAlready(r)}
        />
      )}
      {paying && (
        <PayModal
          target={{ id: paying.id, label: `${student?.name ?? ""} · ${paying.invoice_no}`, balance: paying.settled.balance }}
          today={todayKst()}
          onClose={() => setPaying(null)}
          onDone={(msg) => {
            notify(msg, "success");
            setPaying(null);
            void changed();
          }}
        />
      )}
      {depositFor && (
        <DepositApplyModal
          invoiceId={depositFor.id}
          label={depositFor.label}
          onClose={() => setDepositFor(null)}
          onDone={(msg) => {
            notify(msg, "success");
            setDepositFor(null);
            void changed();
          }}
        />
      )}
      {cancelling && (
        <CancelInvoiceModal
          invoice={cancelling as unknown as Invoice}
          studentName={student?.name ?? ""}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            void changed();
          }}
        />
      )}
      {fixing && (
        <InvoiceFixModal
          target={{
            id: fixing.id,
            invoiceNo: fixing.invoice_no,
            studentName: student?.name ?? "",
            stream: fixing.stream,
            sent: fixing.exported,
            total: Number(fixing.total_amount),
            balance: fixing.settled.balance,
          }}
          onClose={() => setFixing(null)}
          onDone={(msg) => {
            notify(msg, "success");
            setFixing(null);
            void changed();
          }}
        />
      )}
      {preview && (
        <InvoicePreviewModal invoiceId={preview.id} label={preview.label} receipt={preview.receipt} studentId={preview.receipt ? undefined : studentId} termId={termId} onClose={() => setPreview(null)} />
      )}
      {exporting && (
        <AlltalkpayExport
          invoiceIds={exporting}
          onClose={() => setExporting(null)}
          onMarked={() => {
            void changed();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "amber" | "rose" | "teal" | "slate" }) {
  const cls =
    tone === "amber" ? "bg-amber-50 text-amber-800" : tone === "rose" ? "bg-rose-50 text-rose-700" : tone === "teal" ? "bg-teal-50 text-teal-800" : "bg-white text-slate-600";
  return (
    <div className={"rounded-lg border border-slate-200 px-2.5 py-1 " + cls}>
      <div className="text-[9px] font-bold tracking-wide opacity-70">{label}</div>
      <div className="text-[13px] font-black tabular-nums">{won(value)}</div>
    </div>
  );
}
