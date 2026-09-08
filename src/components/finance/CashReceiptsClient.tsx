"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst } from "@/lib/kst";
import {
  IDENTIFIER_LABEL,
  digitsOnly,
  formatIdentifier,
  identifierProblem,
  pendingSortKey,
  type ReceiptPurpose,
} from "@/lib/cashReceipt";
import CashReceiptPrintSheet, { type PrintRow } from "./CashReceiptPrintSheet";

/**
 * 현금영수증 — **발행은 결제 단말기에서 합니다.** 이 화면은 그 앞뒤를 붙잡습니다.
 *
 * 앱에서 국세청으로 바로 쏘는 길(대행사 API)은 두지 않기로 했습니다. 창구에서 그 자리에
 * 바로 끊어야 하는 건이 있고, 휴대폰번호와 사업자등록번호가 섞여 들어와서, 단말기에서
 * 그때그때 누르는 편이 실제로 빠릅니다.
 *
 * 그래서 자동화할 자리는 발행이 아니라 **그 주변**입니다.
 *
 *   ① 누가 달라고 했는지 한 곳에 모읍니다 - 지금은 카톡·구두로 흩어져 있습니다.
 *   ② 번호를 미리 받아둡니다 - 번호 없는 건은 맨 위에 빨갛게 세웁니다.
 *   ③ 종이 한 장으로 뽑아 단말기 앞에 들고 갑니다.
 *   ④ 끊고 와서 체크합니다 - 체크가 없으면 다음에 또 뽑혀 **두 번 발행**됩니다.
 *
 * ④가 이 화면의 핵심입니다. 뽑기만 하고 체크를 잊는 것이 가장 흔하고 가장 비쌉니다.
 * 그래서 「뽑았는데 아직 체크 안 됨」을 눈에 띄게 표시합니다.
 */

export type CashReceiptRow = {
  id: string;
  invoice_id: string | null;
  student_id: string | null;
  person_name: string | null;
  purpose: ReceiptPurpose;
  identifier: string | null;
  amount: number;
  status: "신청" | "발행" | "취소";
  issued_at: string | null;
  approval_no: string | null;
  note: string | null;
  requested_by: string | null;
  issued_by: string | null;
  printed_at: string | null;
  printed_by: string | null;
  created_at: string;
};

export type StudentLite = { id: string; name: string; grade: string | null; class_name: string | null };

const btn =
  "rounded-lg px-2.5 py-1 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40";

export default function CashReceiptsClient({
  initialRows,
  students,
  invoiceLabel,
  currentUserName,
}: {
  initialRows: CashReceiptRow[];
  students: StudentLite[];
  /** 청구서 id → 「INV-0031 · 교복」. 어느 청구서 건인지 보여야 금액을 확인할 수 있습니다. */
  invoiceLabel: Record<string, string>;
  currentUserName: string;
}) {
  const notify = useToast();
  const [rows, setRows] = useState(initialRows);
  const [tab, setTab] = useState<"신청" | "발행" | "취소">("신청");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [printRows, setPrintRows] = useState<PrintRow[] | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map(students.map((s) => [s.id, s.name] as const));
    return (r: CashReceiptRow) =>
      (r.student_id ? m.get(r.student_id) : null) ?? r.person_name?.trim() ?? "이름 미확인";
  }, [students]);

  const pending = useMemo(
    () =>
      rows
        .filter((r) => r.status === "신청")
        .sort((a, b) => {
          const [ra, ca] = pendingSortKey(a);
          const [rb, cb] = pendingSortKey(b);
          return ra - rb || ca.localeCompare(cb);
        }),
    [rows],
  );
  const shown = useMemo(() => (tab === "신청" ? pending : rows.filter((r) => r.status === tab)), [tab, pending, rows]);

  const counts = useMemo(
    () => ({
      신청: rows.filter((r) => r.status === "신청").length,
      발행: rows.filter((r) => r.status === "발행").length,
      취소: rows.filter((r) => r.status === "취소").length,
    }),
    [rows],
  );

  const noIdCount = pending.filter((r) => !digitsOnly(r.identifier)).length;
  const badIdCount = pending.filter((r) => digitsOnly(r.identifier) && identifierProblem(r.purpose, r.identifier)).length;
  // 뽑아갔는데 아직 발행 표시가 없는 건. 이것이 곧 이중발행 후보입니다.
  const printedUnchecked = pending.filter((r) => r.printed_at).length;
  const todayIssued = rows.filter((r) => r.status === "발행" && r.issued_at === todayKst()).length;

  const pickedRows = shown.filter((r) => picked.has(r.id));

  async function patch(ids: string[], p: Partial<CashReceiptRow>, failMsg: string): Promise<boolean> {
    setBusy(true);
    const { error } = await createClient().from("cash_receipts").update(p).in("id", ids);
    setBusy(false);
    if (error) {
      // 조용히 넘기면 화면에는 바뀐 것처럼 보이는데 기록은 그대로입니다.
      notify(`${failMsg}: ${error.message}`, "error");
      return false;
    }
    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? ({ ...r, ...p } as CashReceiptRow) : r)));
    return true;
  }

  async function markIssued(ids: string[], approvalNo?: string) {
    const ok = await patch(
      ids,
      {
        status: "발행",
        issued_at: todayKst(),
        issued_by: currentUserName,
        ...(approvalNo?.trim() ? { approval_no: approvalNo.trim() } : {}),
      },
      "발행 표시를 하지 못했습니다",
    );
    if (ok) {
      setPicked((p) => {
        const n = new Set(p);
        for (const id of ids) n.delete(id);
        return n;
      });
      notify(`${ids.length}건 발행함으로 표시했습니다.`, "success");
    }
  }

  async function doPrint() {
    const target = pickedRows.length > 0 ? pickedRows : pending;
    if (target.length === 0) {
      notify("뽑을 건이 없습니다.", "error");
      return;
    }
    setPrintRows(
      target.map((r) => ({
        id: r.id,
        name: nameOf(r),
        purpose: r.purpose,
        identifier: r.identifier,
        amount: Number(r.amount),
        note: r.note,
      })),
    );
    // 뽑았다는 사실을 남깁니다. 실패해도 인쇄는 진행합니다 - 종이가 더 급합니다.
    const at = new Date().toISOString();
    await patch(target.map((r) => r.id), { printed_at: at, printed_by: currentUserName }, "인쇄 기록을 남기지 못했습니다");
    // 종이가 그려질 틈을 준 뒤 인쇄창을 엽니다.
    setTimeout(() => window.print(), 120);
  }

  // 종이에 찍히는 날짜. 한국 날짜여야 합니다 - 세계표준시로 내면 오전 9시 이전에 어제가 찍힙니다.
  const dateLabel = todayKst();

  return (
    <div>
      {printRows && <CashReceiptPrintSheet rows={printRows} dateLabel={dateLabel} />}

      {/* ── 지금 상태 한 줄 ─────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="번호 없음" value={noIdCount} tone={noIdCount > 0 ? "red" : "gray"} hint="받아야 끊을 수 있습니다" />
        <Stat label="번호 이상" value={badIdCount} tone={badIdCount > 0 ? "amber" : "gray"} hint="자릿수가 안 맞습니다" />
        <Stat
          label="뽑았는데 미체크"
          value={printedUnchecked}
          tone={printedUnchecked > 0 ? "amber" : "gray"}
          hint="끊었으면 체크해주세요"
        />
        <Stat label="오늘 발행" value={todayIssued} tone="emerald" hint="오늘 끊은 건" />
      </div>

      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
        <b>발행은 결제 단말기에서 합니다.</b> 이 화면은 요청을 모으고, 번호를 미리 받아두고, 종이 한 장으로 뽑아
        단말기 앞에 들고 갈 수 있게 하는 자리입니다. 끊고 오시면 <b>[발행함]</b>을 눌러주세요 — 누르지 않으면 다음에
        또 뽑혀서 <b>두 번 발행</b>됩니다.
      </div>

      {/* ── 탭 + 도구 ───────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {(["신청", "발행", "취소"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPicked(new Set());
            }}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-semibold " +
              (tab === t ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
            }
          >
            {t === "신청" ? "발행 대기" : t} {counts[t]}
          </button>
        ))}

        <span className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className={btn + " border border-slate-300 text-slate-700 hover:bg-slate-50"}
          >
            {adding ? "닫기" : "＋ 요청 추가"}
          </button>
          <button
            type="button"
            disabled={busy || pending.length === 0}
            onClick={() => void doPrint()}
            className={btn + " bg-slate-800 text-white hover:bg-slate-700"}
            title="고른 것이 없으면 발행 대기 전체를 뽑습니다"
          >
            🖨 {pickedRows.length > 0 ? `고른 ${pickedRows.length}건` : `전체 ${pending.length}건`} 인쇄
          </button>
        </span>
      </div>

      {adding && (
        <AddForm
          students={students}
          currentUserName={currentUserName}
          onDone={(row) => {
            setRows((p) => [row, ...p]);
            setAdding(false);
            setTab("신청");
          }}
        />
      )}

      {/* ── 목록 ────────────────────────────────────────────────────── */}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-center text-[12px] text-slate-400">
          {tab === "신청" ? "발행을 기다리는 건이 없습니다." : `${tab}된 건이 없습니다.`}
        </p>
      ) : (
        <>
          {tab === "신청" && (
            <label className="mb-1 flex items-center gap-2 px-1 text-[11px] font-semibold text-slate-500">
              <input
                type="checkbox"
                checked={pickedRows.length === shown.length && shown.length > 0}
                onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())}
              />
              전부 고르기
            </label>
          )}
          <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {shown.map((r) => (
              <Row
                key={r.id}
                r={r}
                name={nameOf(r)}
                invoice={r.invoice_id ? invoiceLabel[r.invoice_id] : undefined}
                picked={picked.has(r.id)}
                busy={busy}
                onPick={(on) =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (on) n.add(r.id);
                    else n.delete(r.id);
                    return n;
                  })
                }
                onSaveId={(purpose, identifier) =>
                  patch([r.id], { purpose, identifier: identifier || null }, "번호를 저장하지 못했습니다")
                }
                onIssued={(approval) => void markIssued([r.id], approval)}
                onCancel={() => void patch([r.id], { status: "취소" }, "취소하지 못했습니다")}
                onReopen={() =>
                  void patch(
                    [r.id],
                    { status: "신청", issued_at: null, issued_by: null, printed_at: null },
                    "되돌리지 못했습니다",
                  )
                }
              />
            ))}
          </ul>
        </>
      )}

      {/* ── 고른 것 일괄 처리 ───────────────────────────────────────── */}
      {tab === "신청" && pickedRows.length > 0 && (
        <div className="sticky bottom-2 z-10 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
          <b className="text-[12px] text-slate-700">{pickedRows.length}건 고름</b>
          <button
            type="button"
            disabled={busy}
            onClick={() => void markIssued(pickedRows.map((r) => r.id))}
            className={btn + " bg-emerald-600 text-white hover:bg-emerald-700"}
          >
            ✓ 고른 것 발행함
          </button>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className={btn + " border border-slate-200 text-slate-500 hover:bg-slate-50"}
          >
            선택 해제
          </button>
          {/* 승인번호는 개별 줄에서만 적습니다. 여러 건을 한 번호로 덮으면 전부 틀린 값이 됩니다. */}
          <span className="text-[11px] text-slate-400">승인번호는 한 건씩 적습니다</span>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "emerald" | "gray";
  hint: string;
}) {
  const cls = {
    red: "border-rose-200 bg-rose-50 text-rose-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    gray: "border-slate-200 bg-slate-50 text-slate-400",
  }[tone];
  return (
    <div className={"rounded-xl border p-2.5 " + cls} title={hint}>
      <div className="text-[11px] font-semibold opacity-80">{label}</div>
      <div className="text-xl font-black tabular-nums">{value}</div>
    </div>
  );
}

/**
 * 한 줄.
 *
 * 번호를 **이 자리에서 바로** 고칩니다. 학부모가 전화로 불러주시는 번호를 받아 적는 동안
 * 다른 화면으로 건너가야 하면, 그 사이에 끊기고 나중에 하자가 됩니다.
 */
function Row({
  r,
  name,
  invoice,
  picked,
  busy,
  onPick,
  onSaveId,
  onIssued,
  onCancel,
  onReopen,
}: {
  r: CashReceiptRow;
  name: string;
  invoice?: string;
  picked: boolean;
  busy: boolean;
  onPick: (on: boolean) => void;
  onSaveId: (purpose: ReceiptPurpose, identifier: string) => Promise<boolean>;
  onIssued: (approvalNo?: string) => void;
  onCancel: () => void;
  onReopen: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [purpose, setPurpose] = useState<ReceiptPurpose>(r.purpose);
  const [idText, setIdText] = useState(r.identifier ?? "");
  const [approval, setApproval] = useState("");

  const problem = identifierProblem(r.purpose, r.identifier);
  const missing = !digitsOnly(r.identifier);
  const draftProblem = identifierProblem(purpose, idText);

  return (
    <li
      className={
        "border-b border-slate-100 px-3 py-2 last:border-0 " +
        (r.status === "신청" && missing ? "bg-rose-50/60" : picked ? "bg-teal-50/50" : "")
      }
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {r.status === "신청" && (
          <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} className="shrink-0" />
        )}
        <span className="w-16 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-center text-[11px] font-bold text-slate-600">
          {r.purpose}
        </span>
        <b className="text-[13px] text-slate-800">{name}</b>
        {/* 어느 청구서 건인가. 「이 사람 얼마짜리였지」를 확인하러 인보이스 명단으로 건너가야
            하면 그 왕복이 곧 안 하게 되는 이유가 됩니다. */}
        {invoice ? (
          <a
            href="/finance/invoices"
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 underline decoration-dotted"
            title="학비외 청구에서 이 청구서를 봅니다"
          >
            {invoice}
          </a>
        ) : (
          <span className="text-[10px] text-slate-300" title="청구서 없이 접수된 건입니다">
            청구서 없음
          </span>
        )}
        <span className="tabular-nums text-[13px] font-semibold text-slate-700">
          {Number(r.amount).toLocaleString()}원
        </span>

        {/* 번호. 화면에서도 이것이 제일 커야 합니다 - 사람이 이걸 보고 단말기에 칩니다. */}
        {missing ? (
          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">
            번호 없음 — 받아야 합니다
          </span>
        ) : problem ? (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800" title={problem}>
            ⚠ {formatIdentifier(r.purpose, r.identifier)} · {problem}
          </span>
        ) : (
          <span className="font-mono text-[14px] font-bold tracking-wide text-slate-800">
            {formatIdentifier(r.purpose, r.identifier)}
          </span>
        )}

        {r.note && <span className="text-[11px] text-slate-400">{r.note}</span>}
        <span className="text-[11px] text-slate-300">{r.created_at.slice(0, 10)}</span>

        {r.status === "신청" && r.printed_at && (
          <span
            className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
            title="종이로 뽑아 단말기로 내려보낸 건입니다. 끊었으면 [발행함]을 눌러주세요."
          >
            🖨 뽑아감 · 미체크
          </span>
        )}

        {r.status === "신청" ? (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setEditing((v) => !v)} className={btn + " border border-slate-300 text-slate-600 hover:bg-slate-50"}>
              {editing ? "닫기" : missing ? "번호 넣기" : "번호 고치기"}
            </button>
            {/* 승인번호는 **선택**입니다. 적으면 「정말 나갔다」가 증명되고, 안 적어도 발행
                표시는 됩니다 - 필수로 막으면 바쁜 날 아예 표시를 안 하게 됩니다. */}
            <input
              value={approval}
              onChange={(e) => setApproval(e.target.value)}
              placeholder="승인번호(선택)"
              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-[11px]"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => onIssued(approval)}
              className={btn + " bg-emerald-600 text-white hover:bg-emerald-700"}
            >
              발행함
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className={btn + " border border-slate-200 text-slate-500 hover:bg-slate-50"}
            >
              취소
            </button>
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-slate-400">
              {r.status === "발행"
                ? [r.issued_at, r.issued_by, r.approval_no].filter(Boolean).join(" · ") || "발행함"
                : "취소됨"}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={onReopen}
              className={btn + " border border-slate-200 text-slate-500 hover:bg-slate-50"}
              title="잘못 눌렀다면 발행 대기로 되돌립니다"
            >
              되돌리기
            </button>
          </span>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-2">
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as ReceiptPurpose)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
          >
            <option value="소득공제">소득공제 (개인)</option>
            <option value="지출증빙">지출증빙 (사업자)</option>
          </select>
          <input
            value={idText}
            onChange={(e) => setIdText(e.target.value)}
            placeholder={IDENTIFIER_LABEL[purpose]}
            inputMode="numeric"
            className="w-48 rounded-lg border border-slate-300 px-2 py-1 font-mono text-[13px]"
          />
          <span className="text-[11px] text-slate-500">
            {draftProblem ? <span className="font-bold text-rose-600">{draftProblem}</span> : formatIdentifier(purpose, idText)}
          </span>
          <button
            type="button"
            disabled={busy || !!draftProblem}
            onClick={async () => {
              if (await onSaveId(purpose, digitsOnly(idText))) setEditing(false);
            }}
            className={btn + " bg-slate-800 text-white hover:bg-slate-700"}
          >
            저장
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * 요청을 여기서 바로 받습니다.
 *
 * 수납을 넣을 때 체크하는 길은 이미 있지만, 요청이 **나중에** 오는 경우가 더 많습니다.
 * 그때 수납 화면을 다시 찾아 들어가야 하면 결국 안 적고 기억에 둡니다.
 */
function AddForm({
  students,
  currentUserName,
  onDone,
}: {
  students: StudentLite[];
  currentUserName: string;
  onDone: (row: CashReceiptRow) => void;
}) {
  const notify = useToast();
  const [who, setWho] = useState("");
  const [purpose, setPurpose] = useState<ReceiptPurpose>("소득공제");
  const [idText, setIdText] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // 명부에 있는 이름이면 학생에 붙이고, 아니면 이름 그대로 남깁니다. 못 붙인다고 접수를
  // 막지 않습니다 - 사업자 명의처럼 학생과 안 이어지는 건이 실제로 있습니다.
  const matched = useMemo(() => {
    const q = who.trim().toLowerCase();
    if (!q) return null;
    return students.find((s) => s.name.toLowerCase() === q) ?? null;
  }, [who, students]);

  const amountNum = Number(amount.replace(/[^0-9]/g, ""));
  const draftProblem = identifierProblem(purpose, idText);

  async function submit() {
    if (!who.trim()) return notify("누구인지 적어주세요.", "error");
    if (!(amountNum > 0)) return notify("금액을 적어주세요. 단말기에 칠 금액입니다.", "error");
    setBusy(true);
    const payload = {
      student_id: matched?.id ?? null,
      person_name: matched ? null : who.trim(),
      purpose,
      // 번호는 **비워도 됩니다.** 「해달라」는 말만 먼저 오는 경우가 있고, 그 요청을 못 적으면
      // 어디에도 안 남습니다. 대신 화면에서 「번호 없음」으로 맨 위에 섭니다.
      identifier: digitsOnly(idText) || null,
      amount: amountNum,
      status: "신청" as const,
      note: note.trim() || null,
      requested_by: currentUserName,
    };
    const { data, error } = await createClient().from("cash_receipts").insert(payload).select("*").single();
    setBusy(false);
    if (error || !data) {
      notify("접수하지 못했습니다: " + (error?.message ?? "알 수 없는 이유"), "error");
      return;
    }
    onDone(data as CashReceiptRow);
    notify("접수했습니다.", "success");
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-300 bg-white p-3">
      <p className="mb-2 text-[12px] font-bold text-slate-700">현금영수증 요청 접수</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1">
          <input
            list="cr-students"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="이름 (학생 또는 요청자)"
            className="w-44 rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
          />
          <datalist id="cr-students">
            {students.map((s) => (
              <option key={s.id} value={s.name}>
                {[s.grade, s.class_name].filter(Boolean).join(" ")}
              </option>
            ))}
          </datalist>
          {/* 명부와 이어졌는지 **말해줍니다.** 조용히 안 이어지면 나중에 학생별 조회에서 빠집니다. */}
          <span className={"text-[10px] font-bold " + (matched ? "text-emerald-600" : "text-slate-400")}>
            {who.trim() ? (matched ? "명부 연결됨" : "명부에 없음 · 이름으로만 남습니다") : ""}
          </span>
        </span>

        <select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as ReceiptPurpose)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
        >
          <option value="소득공제">소득공제 (개인)</option>
          <option value="지출증빙">지출증빙 (사업자)</option>
        </select>

        <input
          value={idText}
          onChange={(e) => setIdText(e.target.value)}
          placeholder={`${IDENTIFIER_LABEL[purpose]} (나중에 받아도 됩니다)`}
          inputMode="numeric"
          className="w-52 rounded-lg border border-slate-300 px-2 py-1 font-mono text-[12px]"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="금액"
          inputMode="numeric"
          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right text-[12px] tabular-nums"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모 (선택)"
          className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className={btn + " bg-slate-800 text-white hover:bg-slate-700"}
        >
          접수
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {idText.trim()
          ? draftProblem
            ? <span className="font-bold text-rose-600">{draftProblem}</span>
            : <>단말기에 칠 번호: <b className="font-mono text-slate-800">{formatIdentifier(purpose, idText)}</b></>
          : "번호를 아직 못 받았으면 비워두세요. 목록 맨 위에 「번호 없음」으로 세워둡니다."}
      </p>
    </div>
  );
}
