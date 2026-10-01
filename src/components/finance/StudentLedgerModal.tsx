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
import PayModal from "@/components/finance/PayModal";
import CancelInvoiceModal from "@/components/finance/CancelInvoiceModal";
import InvoicePreviewModal from "@/components/finance/InvoicePreviewModal";
import AlltalkpayExport from "@/components/finance/AlltalkpayExport";

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
}: {
  studentId: string;
  termId?: string | null;
  onClose: () => void;
  /** 발행·입금 등으로 자료가 바뀌면 부르는 쪽이 자기 목록을 다시 읽게 합니다. */
  onChanged?: () => void;
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
  const [paying, setPaying] = useState<LedgerInvoice | null>(null);
  const [cancelling, setCancelling] = useState<LedgerInvoice | null>(null);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !already && !paying && !cancelling && !preview && !exporting && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, already, paying, cancelling, preview, exporting]);

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
  async function issue() {
    if (!ledger) return;
    if (targetCharges.length === 0) return notify("보낼 항목이 없습니다. 옵션을 고르거나 항목을 넣어주세요.", "error");
    const tuition = targetCharges.filter((c) => c.kind === "학비").map((c) => c.id);
    const extra = targetCharges.filter((c) => c.kind === "학비외").map((c) => c.id);
    const labels = targetCharges.map((c) => c.label).join(" · ");
    if (!confirm(`${ledger.student.name} — 「${labels}」 ${won(targetCharges.reduce((n, c) => n + c.amount, 0))} 청구서를 만듭니다.${tuition.length && extra.length ? "\n학비와 학비외는 두 장으로 나갑니다." : ""}`)) return;
    setBusy(true);
    const failed: string[] = [];
    const made: string[] = [];
    try {
      if (tuition.length > 0) {
        const r = await post("/api/finance/invoices/tuition", { studentId, termId, planIds: tuition });
        if (r.ok) made.push(String((r.body.invoice as { invoice_no?: string } | undefined)?.invoice_no ?? "학비"));
        else failed.push(`학비(${String(r.body.error ?? "")})`);
      }
      if (extra.length > 0) {
        const r = await post("/api/finance/invoices", { studentId, feeTermId: termId, itemIds: extra });
        if (r.ok) made.push(String((r.body.invoice as { invoice_no?: string } | undefined)?.invoice_no ?? "학비외"));
        else failed.push(`학비외(${String(r.body.error ?? "")})`);
      }
    } finally {
      setBusy(false);
    }
    if (failed.length) notify(`${made.length ? `${made.join(", ")} 발행 · ` : ""}실패: ${failed.join(" / ")}`, "error");
    else notify(`${made.join(", ")} 발행했습니다.`, "success");
    await changed();
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
            alreadyPaid: { paidAt: b.paidAt, amount: single === "학비" ? b.amount : tAmount, method: r.method, memo: `받은 항목: ${b.labels.join(" · ")}` },
          });
          if (res.ok) count++; else failed.push(`학비 ${b.paidAt}(${String(res.body.error ?? "")})`);
        }
        if (extra.length > 0) {
          const res = await post("/api/finance/invoices", {
            studentId, feeTermId: termId, itemIds: extra, dueDate: b.paidAt, billingMonth: b.paidAt.slice(0, 7),
            alreadyPaid: { paidAt: b.paidAt, amount: single === "학비외" ? b.amount : eAmount, method: r.method, memo: `받은 항목: ${b.labels.join(" · ")}` },
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3" onClick={close}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* ── 머리 ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900">
              {student ? <Who id={student.id} name={student.name} /> : "…"}
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
              <Stat label="청구할 금액" value={ledger.totals.toBill} tone={ledger.totals.toBill > 0 ? "amber" : "slate"} />
              <Stat label="미납" value={ledger.totals.unpaid} tone={ledger.totals.unpaid > 0 ? "rose" : "slate"} />
              <Stat label="예치금" value={ledger.totals.deposit} tone={ledger.totals.deposit > 0 ? "teal" : "slate"} />
              <Stat label="이 학기 받을 돈" value={ledger.totals.expected} tone="slate" />
            </div>
          )}
          <button onClick={close} className="ml-1 px-1 text-lg font-bold text-slate-400 hover:text-slate-700" title="닫기 (Esc)">
            ✕
          </button>
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
                <span>받을 돈 — 요금표에서</span>
                <span className="text-[10px] font-semibold text-slate-400">체크한 것만 보내고, 안 체크하면 남은 것 전부</span>
              </h3>
              {(["학비", "학비외"] as const).map((kind) => {
                const rows = ledger.charges.filter((c) => c.kind === kind);
                return (
                  <div key={kind} className="mb-2">
                    <div className="mb-0.5 text-[11px] font-bold text-slate-500">{kind}</div>
                    {rows.length === 0 && <p className="px-1 py-1 text-[11px] text-slate-400">{kind === "학비" ? "이 학생에게 열린 학비 항목이 없습니다." : "붙은 항목이 없습니다."}</p>}
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
                              {c.extra && !c.extra.fromDefault && <span className="ml-1 text-[10px] text-sky-600">따로 넣음</span>}
                            </div>
                            {c.tuition ? (
                              <select
                                value={c.tuition.optionId ?? ""}
                                disabled={busy || !!c.billed}
                                onChange={(e) => void setOption(c, e.target.value)}
                                className="mt-0.5 max-w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] disabled:bg-transparent"
                                title={c.billed ? "이미 청구서에 담긴 항목은 옵션을 바꿀 수 없습니다. 그 장을 취소한 뒤 바꿔주세요." : "납부 옵션"}
                              >
                                <option value="">신청 안 함</option>
                                {c.tuition.options.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              c.optionName && <div className="text-[10px] text-slate-500">{c.optionName}</div>
                            )}
                            {c.note && <div className="text-[10px] text-slate-400">{c.note}</div>}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="tabular-nums font-bold">{c.amount > 0 ? won(c.amount) : "—"}</div>
                            {c.billed ? (
                              <button
                                onClick={() => setPreview({ id: c.billed!.invoiceId, label: `${student?.name} · ${c.billed!.invoiceNo ?? ""}`, receipt: false })}
                                className={"text-[10px] font-bold underline " + (c.billed.state === "완납" ? "text-emerald-700" : c.billed.state === "일부" ? "text-amber-700" : "text-slate-500")}
                                title="그 청구서 보기"
                              >
                                {c.billed.state === "완납" ? "납부완료" : c.billed.state === "일부" ? "일부받음" : "청구됨"} {c.billed.invoiceNo ?? ""}
                                {c.billed.unsure ? " ?" : ""}
                              </button>
                            ) : c.amount > 0 ? (
                              <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">남음</span>
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
                  onClick={() => void issue()}
                  disabled={busy || unbilled.length === 0}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
                  title="체크한 항목(없으면 남은 것 전부)으로 청구서를 만듭니다"
                >
                  🧾 청구서 만들기{targetCharges.length > 0 ? ` (${won(targetCharges.reduce((n, c) => n + c.amount, 0))})` : ""}
                </button>
                <button
                  onClick={() => setAlready(true)}
                  disabled={busy || unbilled.length === 0}
                  className="rounded-lg bg-sky-100 px-3 py-1.5 text-[12px] font-bold text-sky-800 hover:bg-sky-200 disabled:opacity-40"
                  title="이미 받은 항목을 받은 날짜로 적습니다(청구서 + 입금)"
                >
                  💰 이미 받음
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
                      {v.issued_offline ? <span className="ml-1 text-[10px] text-sky-600">이미받음</span> : null}
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
                      <button onClick={() => setCancelling(v)} className="px-1 text-[11px] text-slate-300 hover:text-rose-600" title="발행 취소 (지우지 않고 취소로 남깁니다)">
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
                <span>입금 · 예치금</span>
                <button onClick={() => setDepositOpen((v) => !v)} className="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800 hover:bg-teal-200" title="청구서 없이 미리 받은 돈">
                  ＋ 예치금 넣기
                </button>
              </h3>
              {depositOpen && (
                <div className="mb-2 flex flex-wrap items-end gap-1.5 rounded-lg border border-teal-200 bg-teal-50/40 p-2 text-[11px]">
                  <label>
                    <span className="block text-[10px] text-slate-500">금액</span>
                    <input type="number" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-right tabular-nums" />
                  </label>
                  <label>
                    <span className="block text-[10px] text-slate-500">받은 날</span>
                    <input type="date" value={dep.paidAt} onChange={(e) => setDep({ ...dep, paidAt: e.target.value })} className="rounded border border-slate-300 px-1.5 py-0.5" />
                  </label>
                  <label>
                    <span className="block text-[10px] text-slate-500">수단</span>
                    <select value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })} className="rounded border border-slate-300 px-1.5 py-0.5">
                      {PAYMENT_METHOD_KINDS.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-[160px] flex-1">
                    <span className="block text-[10px] text-slate-500">왜</span>
                    <input value={dep.memo} onChange={(e) => setDep({ ...dep, memo: e.target.value })} placeholder="학기 전체 선납 · 두 번 결제돼 다음 달에서 빼기로 …" className="w-full rounded border border-slate-300 px-1.5 py-0.5" />
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
      {already && ledger && (
        <AlreadyPaidModal
          title="이미 받은 것 넣기"
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
