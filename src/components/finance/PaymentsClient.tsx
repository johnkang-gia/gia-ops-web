"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import { balanceOf, matchPayment, toAmount, toIsoDate, PAYMENT_METHOD_KINDS, needsCashReceipt, type ImportedPayment, type PaymentRow, type PaymentMethodKind } from "@/lib/payments";
import { agingBucket, type AgingBucket } from "@/lib/settlement";
import PayModal from "./PayModal";
import InlineTabs from "@/components/common/InlineTabs";
import type { Invoice } from "@/lib/types";

// 수납 — 들어온 돈을 인보이스에 붙입니다.
//
// 인보이스를 보내는 데서 끝나면 "누가 안 냈나"에 답할 수 없습니다. 그러면 결국 통장을 눈으로
// 훑게 되고, 눈으로 훑는 일은 매번 하지 않게 되고, 안 하면 미납이 쌓입니다.
//
// **자동으로 붙일 수 있는 것만 붙이고, 애매한 것은 애매하다고 말합니다.** 어림짐작으로
// 붙이면 틀린 곳을 아무도 못 찾습니다.

type Props = {
  invoices: Invoice[];
  payments: PaymentRow[];
  currentUserEmail: string;
  currentUserName: string;
  loadError: string | null;
  today: string;
};

type Staged = ImportedPayment & {
  invoiceId: string | null;
  reason: string;
  candidates: { id: string; label: string; why: string }[];
  skip: boolean;
};


/** 마감일에서 오늘까지 며칠 지났는가. 마감 전이면 0. */
function daysPast(due: string, today: string): number {
  const d = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${due}T00:00:00Z`).getTime()) / 86_400_000);
  return Math.max(0, d);
}

const BUCKET_TONE: Record<AgingBucket, string> = {
  "기한 전": "bg-slate-100 text-slate-500",
  "1~30일": "bg-amber-100 text-amber-800",
  "31~60일": "bg-orange-100 text-orange-800",
  "61일+": "bg-rose-100 text-rose-800",
};

export default function PaymentsClient({ invoices, payments: initial, currentUserEmail, currentUserName, loadError, today }: Props) {
  const notify = useToast();
  const [payments, setPayments] = useState(initial);
  const [staged, setStaged] = useState<Staged[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"미납" | "전체" | "입금">("미납");
  // 결제완료 체크 창. 청구서를 보는 그 자리에서 받은 돈을 넣습니다 - 화면을 옮기게 하면
  // 「나중에」가 되고, 나중에 한 것은 대개 안 한 것이 됩니다.
  const [payFor, setPayFor] = useState<{ id: string; label: string; balance: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 수기 입력
  const [manual, setManual] = useState({
    invoiceId: "",
    paidAt: today,
    amount: 0,
    payerName: "",
    memo: "",
    // 수납은 네 갈래로 들어옵니다. 예전에는 전부 «수기» 한 덩어리라 월말에 카드·현금을
    // 나눠 셀 수 없었고, 현금영수증을 발행해야 하는 건이 어느 것인지도 몰랐습니다.
    methodKind: "계좌이체" as PaymentMethodKind,
    // 현금·계좌이체는 현금영수증 요청이 따라옵니다. 그 자리에서 함께 적어두지 않으면
    // 나중에 «해주셨어요?»에 답할 방법이 없습니다.
    receipt: false,
    receiptPurpose: "소득공제" as "소득공제" | "지출증빙",
    receiptId: "",
  });

  const issued = useMemo(() => invoices.filter((v) => v.status === "발행"), [invoices]);
  const withBalance = useMemo(
    () =>
      issued
        .map((v) => ({ v, ...balanceOf(v, payments) }))
        .sort((a, b) => b.balance - a.balance || a.v.invoice_no.localeCompare(b.v.invoice_no)),
    [issued, payments],
  );
  const unpaid = withBalance.filter((x) => x.balance > 0);
  const totalBilled = issued.reduce((n, v) => n + Number(v.total_amount), 0);
  const totalPaid = payments.reduce((n, p) => n + Number(p.amount), 0);
  const unmatched = payments.filter((p) => !p.invoice_id);

  /** 엑셀·CSV를 읽어 화면에 세워둡니다. **바로 저장하지 않습니다** - 사람이 한 번 보고 넣습니다. */
  async function readFile(file: File) {
    setBusy(true);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (rows.length === 0) {
        notify("첫 시트에 읽을 줄이 없습니다.", "error");
        return;
      }
      // 칸 이름은 은행·서비스마다 다릅니다. **적어준 순서대로** 찾습니다 - 순서가 없으면
      // 올톡페이 파일에서 `등록일자`가 `수납일자`보다 먼저 걸려 돈 들어온 날이 아니라
      // 청구서 만든 날이 입금일로 들어갑니다.
      const pick = (r: Record<string, unknown>, names: string[]) => {
        const keys = Object.keys(r);
        for (const n of names) {
          const k = keys.find((k) => k.replace(/\s+/g, "").includes(n));
          if (k !== undefined && String(r[k] ?? "").trim() !== "" && String(r[k]).trim() !== "-") return r[k];
        }
        return "";
      };
      const list: Staged[] = [];
      let notPaid = 0;
      rows.forEach((r, i) => {
        // 올톡페이 파일에는 아직 안 낸 것(발송완료)과 중간에 멈춘 것(결제중단)이 함께 있습니다.
        // 그것까지 넣으면 **안 받은 돈을 받은 것으로** 기록하게 됩니다.
        const status = String(pick(r, ["상태", "결제상태"]) ?? "").trim();
        if (status && !/완료|성공|승인/.test(status)) {
          notPaid += 1;
          return;
        }
        if (status && /발송|전송/.test(status)) {
          notPaid += 1;
          return;
        }
        const paidAt = toIsoDate(pick(r, ["수납일자", "결제일", "입금일", "거래일", "승인일", "날짜", "일자", "date"]));
        const amount = toAmount(pick(r, ["청구금액", "결제금액", "입금액", "금액", "amount"]));
        const payerName = String(pick(r, ["고객명", "입금자", "성명", "이름", "보내는", "name"]) ?? "").trim();
        const memo = String(pick(r, ["청구사유", "내용", "적요", "메모", "비고", "memo"]) ?? "").trim();
        const phone = String(pick(r, ["청구핸드폰", "핸드폰", "휴대폰", "연락처", "phone"]) ?? "").trim();
        const approval = String(pick(r, ["승인번호", "거래번호", "승인"]) ?? "").trim();
        if (!amount) return; // 금액이 없는 줄은 합계행·머리글입니다.
        // 같은 파일을 다시 받아 올려도 겹치지 않도록, 있으면 **승인번호**를 열쇠로 씁니다.
        // 파일이름+줄번호로만 만들면 내일 받은 파일은 줄 위치가 밀려 전부 새 입금이 됩니다.
        const sourceKey = approval && approval !== "-"
          ? `승인|${approval}|${amount}`
          : `${file.name}|${i}|${paidAt}|${amount}|${payerName}`;
        const m = matchPayment({ amount, payerName, memo, phone }, issued, payments);
        list.push({
          rowNo: i + 2,
          paidAt: paidAt || today,
          amount,
          payerName,
          memo,
          sourceKey,
          invoiceId: m.picked?.id ?? null,
          reason: m.picked ? m.reason : m.reason,
          candidates: m.candidates.map((c) => ({
            id: c.invoice.id,
            label: `${c.invoice.invoice_no} ${c.invoice.student_name_ko ?? c.invoice.student_name} · ${won(balanceOf(c.invoice, payments).balance)}`,
            why: c.why,
          })),
          skip: false,
        });
      });
      if (list.length === 0) {
        notify(
          notPaid > 0
            ? `결제된 줄이 없습니다. ${notPaid}줄은 아직 안 낸 것(발송완료·결제중단)이라 넣지 않았습니다.`
            : "금액이 있는 줄을 찾지 못했습니다. 첫 시트에 금액 칸이 있는지 확인해주세요.",
          "error",
        );
        return;
      }
      if (notPaid > 0) notify(`${list.length}줄을 읽었습니다. 아직 안 낸 ${notPaid}줄은 넣지 않았습니다.`, "success");
      setStaged(list);
    } catch (e) {
      notify("파일을 읽지 못했습니다: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!staged) return;
    const rows = staged.filter((s) => !s.skip);
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("payments")
        .upsert(
          rows.map((s) => ({
            invoice_id: s.invoiceId,
            student_id: s.invoiceId ? (issued.find((v) => v.id === s.invoiceId)?.student_id ?? null) : null,
            paid_at: s.paidAt,
            amount: s.amount,
            method: "올톡페이",
            payer_name: s.payerName || null,
            memo: s.memo || null,
            source: "엑셀",
            source_key: s.sourceKey,
            matched_by: s.invoiceId ? "자동" : null,
            created_by: currentUserEmail,
          })),
          // 같은 파일을 두 번 올려도 같은 줄은 한 번만 들어갑니다.
          { onConflict: "source_key", ignoreDuplicates: true },
        )
        .select();
      if (error) {
        notify("저장하지 못했습니다: " + error.message, "error");
        return;
      }
      const made = (data as PaymentRow[] | null) ?? [];
      setPayments((p) => [...made, ...p]);
      const dup = rows.length - made.length;
      notify(`${made.length}건 넣었습니다.${dup > 0 ? ` (이미 있던 ${dup}건은 건너뜀)` : ""}`, "success");
      setStaged(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  /** 안 붙은 입금을 나중에 인보이스에 붙입니다. */
  async function attach(p: PaymentRow, invoiceId: string) {
    const inv = issued.find((v) => v.id === invoiceId);
    const prev = payments;
    setPayments((list) => list.map((x) => (x.id === p.id ? { ...x, invoice_id: invoiceId, student_id: inv?.student_id ?? null } : x)));
    const { error } = await createClient()
      .from("payments")
      .update({ invoice_id: invoiceId, student_id: inv?.student_id ?? null, matched_by: currentUserName || currentUserEmail })
      .eq("id", p.id);
    if (error) {
      notify("붙이지 못했습니다: " + error.message, "error");
      setPayments(prev);
    }
  }

  // 현금·계좌이체만 우리가 현금영수증을 발행합니다. 카드는 그 자체로 증빙이 남고,
  // 올톡페이는 결제사가 처리합니다.
  const needsReceipt = needsCashReceipt(manual.methodKind);

  async function addManual() {
    if (!manual.amount || !manual.invoiceId) {
      notify("인보이스와 금액을 골라주세요.", "error");
      return;
    }
    setBusy(true);
    try {
      const inv = issued.find((v) => v.id === manual.invoiceId);
      const { data, error } = await createClient()
        .from("payments")
        .insert({
          invoice_id: manual.invoiceId,
          student_id: inv?.student_id ?? null,
          paid_at: manual.paidAt,
          amount: manual.amount,
          method: manual.methodKind,
          method_kind: manual.methodKind,
          payer_name: manual.payerName || null,
          memo: manual.memo || null,
          source: "수기",
          matched_by: currentUserName || currentUserEmail,
          created_by: currentUserEmail,
        })
        .select()
        .single();
      if (error || !data) {
        notify("저장하지 못했습니다: " + (error?.message ?? ""), "error");
        return;
      }
      setPayments((p) => [data as PaymentRow, ...p]);

      // 현금영수증 신청을 함께 남깁니다. 실패해도 입금은 이미 들어갔으므로 되돌리지 않고
      // 소리만 냅니다 - 돈이 들어온 사실이 영수증 때문에 사라지면 안 됩니다.
      //
      // **번호가 없어도 접수합니다.** 예전에는 번호를 안 적으면 아무것도 남기지 않았는데,
      // 요청은 「해주세요」만 먼저 오고 번호는 나중에 오는 경우가 많습니다. 그 건이 통째로
      // 사라지면 어디에도 안 남고, 안 남은 것은 잊힙니다. 번호 없는 건은 [현금영수증]
      // 화면 맨 위에 「번호 없음」으로 섭니다.
      if (manual.receipt) {
        const { error: rErr } = await createClient().from("cash_receipts").insert({
          payment_id: (data as PaymentRow).id,
          invoice_id: manual.invoiceId,
          student_id: inv?.student_id ?? null,
          purpose: manual.receiptPurpose,
          identifier: manual.receiptId.replace(/[^0-9]/g, "") || null,
          amount: manual.amount,
          status: "신청",
          requested_by: currentUserName || currentUserEmail,
        });
        if (rErr) notify("입금은 넣었는데 현금영수증 신청은 못 적었습니다: " + rErr.message, "error");
      }

      setManual({
        invoiceId: "",
        paidAt: today,
        amount: 0,
        payerName: "",
        memo: "",
        methodKind: "계좌이체",
        receipt: false,
        receiptPurpose: "소득공제",
        receiptId: "",
      });
      notify("입금을 넣었습니다.", "success");
    } finally {
      setBusy(false);
    }
  }

  const autoCount = staged?.filter((s) => s.invoiceId && !s.skip).length ?? 0;
  const needHand = staged?.filter((s) => !s.invoiceId && !s.skip).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">💳 수납</h1>
        <span className="text-xs text-slate-400">올톡페이 엑셀을 올리면 인보이스에 붙습니다</span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        자동으로 붙일 수 있는 것만 붙이고, <b>애매한 것은 애매하다고 말합니다.</b> 어림짐작으로 붙이면 틀린 곳을 아무도
        못 찾습니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: "청구 합계", v: won(totalBilled), sub: `${issued.length}건 발행` },
          { label: "받은 금액", v: won(totalPaid), sub: `${payments.length}건 입금` },
          { label: "미납", v: won(totalBilled - totalPaid), sub: `${unpaid.length}명`, warn: unpaid.length > 0 },
          { label: "못 붙인 입금", v: `${unmatched.length}건`, sub: unmatched.length > 0 ? "사람이 골라야 합니다" : "없습니다", warn: unmatched.length > 0 },
        ].map((c) => (
          <div key={c.label} className="min-w-[150px] flex-1 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold text-slate-500">{c.label}</p>
            <p className={"mt-0.5 text-xl font-black tabular-nums " + (c.warn ? "text-amber-700" : "text-slate-800")}>{c.v}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* ── 엑셀 올리기 ─────────────────────────────────────────── */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[12px] font-bold text-slate-700">올톡페이 입금 내역 올리기</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
            }}
            className="text-sm"
          />
          {fileName && <span className="text-[11px] text-slate-400">{fileName}</span>}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          첫 시트를 읽습니다. 올톡페이 <b>청구서관리목록</b>을 그대로 올리시면 됩니다 — <b>고객명 · 청구핸드폰 ·
          청구사유 · 청구금액 · 상태 · 수납일자 · 승인번호</b>를 알아봅니다. <b>상태가 결제완료인 줄만</b> 넣습니다(발송완료·결제중단은
          아직 안 낸 돈입니다). 이름 칸에 붙은 메모(<code>조장훈(13,000잔돈차감)</code>)는 떼고 대조하며, 청구 연락처가 있으면
          그것을 먼저 씁니다. 같은 파일을 두 번
          올려도 같은 줄은 한 번만 들어갑니다.
        </p>
      </div>

      {/* ── 올린 것 확인 ────────────────────────────────────────── */}
      {staged && (
        <div className="mb-4 rounded-xl border-2 border-teal-300 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
            <span className="text-[12px] font-bold text-slate-700">읽은 {staged.length}줄</span>
            <span className="text-[12px] text-emerald-700">자동으로 붙음 {autoCount}</span>
            <span className={"text-[12px] " + (needHand > 0 ? "font-bold text-amber-700" : "text-slate-400")}>
              사람이 골라야 함 {needHand}
            </span>
            <button
              onClick={() => void commit()}
              disabled={busy}
              className="ml-auto rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "…" : "이대로 넣기"}
            </button>
            <button onClick={() => setStaged(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              취소
            </button>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">줄</th>
                  <th className="px-2 py-1.5">날짜</th>
                  <th className="px-2 py-1.5 text-right">금액</th>
                  <th className="px-2 py-1.5">입금자</th>
                  <th className="px-2 py-1.5">적요</th>
                  <th className="px-2 py-1.5">붙일 인보이스</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {staged.map((s, idx) => (
                  <tr key={s.sourceKey} className={"border-t border-slate-100 " + (s.skip ? "opacity-40" : s.invoiceId ? "" : "bg-amber-50/60")}>
                    <td className="px-2 py-1.5 text-slate-400">{s.rowNo}</td>
                    <td className="px-2 py-1.5">{s.paidAt}</td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">{won(s.amount)}</td>
                    <td className="px-2 py-1.5">{s.payerName || <span className="text-slate-300">—</span>}</td>
                    <td className="max-w-[200px] truncate px-2 py-1.5 text-slate-500">{s.memo}</td>
                    <td className="px-2 py-1.5">
                      <select
                        value={s.invoiceId ?? ""}
                        onChange={(e) =>
                          setStaged((p) => p!.map((x, i) => (i === idx ? { ...x, invoiceId: e.target.value || null } : x)))
                        }
                        className="w-64 rounded border border-slate-300 px-1 py-0.5 text-[12px]"
                      >
                        <option value="">— 아직 안 붙임 —</option>
                        {/* 후보를 위에 올려둡니다. 전체 목록에서 찾게 하면 결국 안 붙입니다. */}
                        {s.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            ⭐ {c.label} ({c.why})
                          </option>
                        ))}
                        {unpaid
                          .filter((u) => !s.candidates.some((c) => c.id === u.v.id))
                          .map((u) => (
                            <option key={u.v.id} value={u.v.id}>
                              {u.v.invoice_no} {u.v.student_name_ko ?? u.v.student_name} · {won(u.balance)}
                            </option>
                          ))}
                      </select>
                      <span className={"ml-1.5 text-[10px] " + (s.invoiceId ? "text-emerald-600" : "text-amber-700")}>{s.reason}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => setStaged((p) => p!.map((x, i) => (i === idx ? { ...x, skip: !x.skip } : x)))}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                      >
                        {s.skip ? "되돌리기" : "빼기"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 목록 ────────────────────────────────────────────────── */}
      <InlineTabs
        tabs={[
          { key: "미납", label: "미납", badge: unpaid.length, tone: unpaid.length > 0 ? "warn" : "default" },
          { key: "전체", label: "발행", badge: issued.length },
          { key: "입금", label: "입금", badge: payments.length },
        ]}
        active={tab}
        onPick={(k) => setTab(k as "미납" | "전체" | "입금")}
      />

      {tab !== "입금" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2">인보이스</th>
                <th className="px-3 py-2">학생</th>
                <th className="px-3 py-2">기한</th>
                <th className="px-3 py-2 text-right">청구</th>
                <th className="px-3 py-2 text-right">입금</th>
                <th className="px-3 py-2 text-right">잔액</th>
                <th className="px-3 py-2">밀린 기간</th>
                <th className="px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {(tab === "미납" ? unpaid : withBalance).map((x) => {
                const overdue = x.balance > 0 && x.v.due_date < today;
                return (
                  <tr key={x.v.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      <a href={`/finance/invoices/${x.v.id}/print`} target="_blank" rel="noopener noreferrer" className="font-bold text-teal-700 underline">
                        {x.v.invoice_no}
                      </a>
                    </td>
                    {/* 이름을 누르면 그 학생의 원장 한 장. 「우리가 뭘 얼마 냈죠」에 답하려면
                        청구서를 하나씩 열어 더해야 했습니다. */}
                    <td className="px-3 py-1.5 font-semibold text-slate-700">
                      {x.v.student_id ? (
                        <a href={`/finance/statement/${x.v.student_id}`} className="underline decoration-slate-300 hover:text-teal-700">
                          {x.v.student_name_ko ?? x.v.student_name}
                        </a>
                      ) : (
                        (x.v.student_name_ko ?? x.v.student_name)
                      )}
                    </td>
                    <td className={"px-3 py-1.5 " + (overdue ? "font-bold text-red-600" : "text-slate-500")}>
                      {x.v.due_date}
                      {overdue && " · 기한 지남"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{won(Number(x.v.total_amount))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{x.paid > 0 ? won(x.paid) : "—"}</td>
                    <td className={"px-3 py-1.5 text-right font-bold tabular-nums " + (x.balance > 0 ? "text-amber-700" : "text-slate-300")}>
                      {x.balance > 0 ? won(x.balance) : "완납"}
                    </td>
                    {/* 얼마보다 먼저 보는 것이 «얼마나 오래»입니다. 어제 밀린 10만원과 두 달
                        밀린 10만원은 같은 돈이 아닙니다 - 뒤엣것을 먼저 연락해야 합니다. */}
                    <td className="px-3 py-1.5">
                      {x.balance > 0 ? (
                        <span
                          className={
                            "rounded px-1.5 py-0.5 text-[10px] font-bold " +
                            (BUCKET_TONE[agingBucket(daysPast(x.v.due_date, today))] ?? "bg-slate-100 text-slate-500")
                          }
                        >
                          {agingBucket(daysPast(x.v.due_date, today))}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {x.balance > 0 && (
                        <button
                          onClick={() =>
                            setPayFor({
                              id: x.v.id,
                              label: `${x.v.invoice_no} ${x.v.student_name_ko ?? x.v.student_name}`,
                              balance: x.balance,
                            })
                          }
                          className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white"
                        >
                          결제완료
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(tab === "미납" ? unpaid : withBalance).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                    {tab === "미납" ? "미납이 없습니다." : "발행한 인보이스가 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2">날짜</th>
                <th className="px-3 py-2 text-right">금액</th>
                <th className="px-3 py-2">입금자</th>
                <th className="px-3 py-2">적요</th>
                <th className="px-3 py-2">붙은 인보이스</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const inv = invoices.find((v) => v.id === p.invoice_id) ?? null;
                return (
                  <tr key={p.id} className={"border-t border-slate-100 " + (inv ? "" : "bg-amber-50/60")}>
                    <td className="px-3 py-1.5">{p.paid_at}</td>
                    <td className="px-3 py-1.5 text-right font-bold tabular-nums">{won(Number(p.amount))}</td>
                    <td className="px-3 py-1.5">{p.payer_name ?? <span className="text-slate-300">—</span>}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5 text-slate-500">{p.memo}</td>
                    <td className="px-3 py-1.5">
                      {inv ? (
                        <span>
                          <b className="text-slate-700">{inv.invoice_no}</b>{" "}
                          <span className="text-slate-500">{inv.student_name_ko ?? inv.student_name}</span>
                          {p.matched_by && <span className="ml-1 text-[10px] text-slate-400">· {p.matched_by}</span>}
                        </span>
                      ) : (
                        <select
                          defaultValue=""
                          onChange={(e) => e.target.value && void attach(p, e.target.value)}
                          className="w-60 rounded border border-amber-300 px-1 py-0.5 text-[12px]"
                        >
                          <option value="">— 붙일 인보이스 고르기 —</option>
                          {unpaid.map((u) => (
                            <option key={u.v.id} value={u.v.id}>
                              {u.v.invoice_no} {u.v.student_name_ko ?? u.v.student_name} · {won(u.balance)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                    아직 들어온 입금이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 손으로 한 건 넣기 ───────────────────────────────────── */}
      <details className="mt-3 rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-slate-600">
          입금 한 건 손으로 넣기 (현금·계좌이체)
        </summary>
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-3">
          <label className="text-[11px] text-slate-500">
            인보이스
            <select
              value={manual.invoiceId}
              onChange={(e) => {
                const id = e.target.value;
                const u = unpaid.find((x) => x.v.id === id);
                // 잔액을 기본값으로 채웁니다 - 대개 잔액만큼 들어옵니다.
                setManual((m) => ({ ...m, invoiceId: id, amount: u ? u.balance : m.amount }));
              }}
              className="ml-1 w-72 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">고르기...</option>
              {unpaid.map((u) => (
                <option key={u.v.id} value={u.v.id}>
                  {u.v.invoice_no} {u.v.student_name_ko ?? u.v.student_name} · 잔액 {won(u.balance)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">
            날짜
            <input type="date" value={manual.paidAt} onChange={(e) => setManual((m) => ({ ...m, paidAt: e.target.value }))} className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-[11px] text-slate-500">
            금액
            <input type="number" value={manual.amount} onChange={(e) => setManual((m) => ({ ...m, amount: Number(e.target.value) || 0 }))} className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm" />
          </label>
          <label className="text-[11px] text-slate-500">
            입금자
            <input value={manual.payerName} onChange={(e) => setManual((m) => ({ ...m, payerName: e.target.value }))} className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          {/* 납부 수단. 고정값이라 월말에 «카드로 얼마, 현금으로 얼마»를 셀 수 있습니다. */}
          <label className="text-[11px] text-slate-500">
            수단
            <select
              value={manual.methodKind}
              onChange={(e) => setManual((m) => ({ ...m, methodKind: e.target.value as PaymentMethodKind }))}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {PAYMENT_METHOD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void addManual()} disabled={busy} className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            + 넣기
          </button>

          {/* 현금영수증.
              발행 자체는 **결제 단말기**에서 합니다. 여기서는 «누가 무엇으로 신청했는가»만
              남깁니다 - 기억에만 있으면 확인할 수 없고, 확인할 수 없으면 두 번 발행하거나
              아예 못 합니다. 남긴 건은 [현금영수증] 화면에서 종이로 뽑아 단말기로 갑니다. */}
          {needsReceipt && (
            <div className="mt-2 flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2">
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-900">
                <input
                  type="checkbox"
                  checked={manual.receipt}
                  onChange={(e) => setManual((m) => ({ ...m, receipt: e.target.checked }))}
                />
                🧾 현금영수증 신청
              </label>
              {manual.receipt && (
                <>
                  <select
                    value={manual.receiptPurpose}
                    onChange={(e) => setManual((m) => ({ ...m, receiptPurpose: e.target.value as "소득공제" | "지출증빙" }))}
                    className="rounded-lg border border-amber-300 px-2 py-1 text-[12px]"
                  >
                    <option value="소득공제">소득공제(개인)</option>
                    <option value="지출증빙">지출증빙(사업자)</option>
                  </select>
                  <input
                    value={manual.receiptId}
                    onChange={(e) => setManual((m) => ({ ...m, receiptId: e.target.value }))}
                    placeholder={(manual.receiptPurpose === "소득공제" ? "휴대폰번호" : "사업자등록번호") + " (나중에 받아도 됩니다)"}
                    inputMode="numeric"
                    className="w-52 rounded-lg border border-amber-300 px-2 py-1 text-[12px]"
                  />
                  <span className="text-[11px] text-amber-800">
                    {manual.receiptId.trim()
                      ? "[현금영수증] 화면에 «발행 대기»로 남습니다."
                      : "번호를 아직 못 받았어도 그대로 넣으세요 — «번호 없음»으로 맨 위에 섭니다."}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </details>
    {payFor && (
        <PayModal
          target={payFor}
          today={today}
          onClose={() => setPayFor(null)}
          onDone={async (msg) => {
            notify(msg, "success");
            const supabase = createClient();
            const { data } = await supabase.from("payments").select("*").order("paid_at", { ascending: false });
            if (data) setPayments(data as PaymentRow[]);
          }}
        />
      )}
    </div>
  );
}
