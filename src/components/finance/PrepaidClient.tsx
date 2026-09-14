"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { Who } from "@/components/common/HomonymProvider";
import { groupPrepaid, summarize, ORIGIN_NOTE, type PrepaidRow, type PrepaidItem } from "@/lib/prepaidLedger";
import type { Invoice } from "@/lib/types";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

type Student = { id: string; name: string; grade: string | null; class_name: string | null };

/**
 * **선입금 대장.**
 *
 * 여기서 할 수 있어야 하는 일은 넷입니다 - 이 넷이 없으면 화면이 있어도 보기만 하게 됩니다.
 *
 *   ① **누구 것인지 잇기** — 주인 없는 돈은 영영 안 쓰입니다.
 *   ② **고치기** — 금액·날짜·수단을 잘못 적었을 때. 지금은 고칠 자리가 없어 지우고 다시
 *      넣게 되는데, 그러면 그날 수납 집계가 두 번 움직입니다.
 *   ③ **청구서에 붙이기** — 미납 청구서가 있으면 그 자리에서 충당합니다.
 *   ④ **내리기** — 잘못 들어온 줄이거나 돌려드린 돈. **이유 없이는 못 내립니다.**
 */
export default function PrepaidClient({
  rows,
  students,
  invoices,
  currentUserEmail,
  loadError,
}: {
  rows: PrepaidRow[];
  students: Student[];
  invoices: Invoice[];
  currentUserEmail: string;
  loadError: string | null;
}) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const nameById = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);
  const whereById = useMemo(
    () => new Map(students.map((s) => [s.id, [s.grade, s.class_name].filter(Boolean).join(" ")])),
    [students],
  );
  const groups = useMemo(() => groupPrepaid(rows, (id) => nameById.get(id) ?? null), [rows, nameById]);
  const sum = useMemo(() => summarize(rows), [rows]);

  /** 그 학생 앞으로 살아 있는 청구서. 붙일 곳을 고를 때 씁니다. */
  const openInvoicesOf = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const v of invoices) {
      if (!v.student_id) continue;
      const list = map.get(v.student_id) ?? [];
      list.push(v);
      map.set(v.student_id, list);
    }
    return map;
  }, [invoices]);

  async function patch(id: string, values: Record<string, unknown>, ok: string) {
    setBusy(id);
    const { error } = await createClient().from("payments").update(values).eq("id", id);
    setBusy(null);
    // 조용히 넘기면 고쳐진 줄 알고 넘어갑니다. 돈은 그대로 남아 다음 청구서를 깎습니다.
    if (error) {
      notify(`저장하지 못했습니다: ${error.message}`, "error");
      return false;
    }
    notify(ok, "success");
    setEditing(null);
    router.refresh();
    return true;
  }

  /** 주인을 찾아 잇습니다. **이것이 이 화면의 첫 번째 일입니다.** */
  async function link(r: PrepaidItem, studentId: string) {
    const s = students.find((x) => x.id === studentId);
    if (!s) return;
    await patch(r.id, { student_id: studentId }, `${s.name} 학생 앞으로 이었습니다. 다음 청구서에 저절로 충당됩니다.`);
  }

  /** 살아 있는 청구서에 붙입니다. 붙는 순간 그 청구서의 미납이 줄어듭니다. */
  async function attach(r: PrepaidItem, invoiceId: string) {
    const inv = invoices.find((v) => v.id === invoiceId);
    if (!inv) return;
    const rest = Number(inv.total_amount) - r.won;
    const label = rest > 0 ? `아직 ${won(rest)}이 남습니다.` : rest < 0 ? `${won(-rest)}이 더 들어갑니다.` : "딱 맞습니다.";
    if (!(await confirmAction(`${won(r.won)}을 ${inv.invoice_no} 에 붙일까요?\n\n청구액 ${won(Number(inv.total_amount))} · ${label}`))) return;
    await patch(r.id, { invoice_id: invoiceId, matched_by: `선입금 수동충당(${currentUserEmail})` }, `${inv.invoice_no} 에 붙였습니다.`);
  }

  /**
   * 내립니다. **이유를 반드시 받습니다.**
   *
   * 돈 한 줄이 사라지는 일이라, 왜 사라졌는지가 안 남으면 나중에 장부가 안 맞을 때 되짚을
   * 곳이 없습니다. 지우지 않고 메모에 이유를 적은 뒤 지웁니다 - 지우기 전 기록은 남습니다.
   */
  async function drop(r: PrepaidItem) {
    const reason = window.prompt(
      `${won(r.won)}을 내립니다. 왜 내리나요?\n(예: 학부모께 환불 / 잘못 들어온 줄 / 중복 입금)`,
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      notify("이유를 적어야 내릴 수 있습니다.", "error");
      return;
    }
    setBusy(r.id);
    const supabase = createClient();
    // 지우기 전에 이유를 먼저 적습니다. 지우고 나면 적을 곳이 없습니다.
    const { error: memoErr } = await supabase
      .from("payments")
      .update({ memo: `${(r.memo ?? "").trim()} | 내림: ${reason.trim()} (${currentUserEmail})`.trim() })
      .eq("id", r.id);
    if (memoErr) {
      setBusy(null);
      notify(`이유를 남기지 못해 내리지 않았습니다: ${memoErr.message}`, "error");
      return;
    }
    const { error } = await supabase.from("payments").delete().eq("id", r.id);
    setBusy(null);
    if (error) {
      notify(`내리지 못했습니다: ${error.message}`, "error");
      return;
    }
    notify(`${won(r.won)}을 내렸습니다.`, "success");
    router.refresh();
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">💰 선입금</h1>
        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">
          {sum.count}줄 · {won(sum.total)}
        </span>
        {sum.unknownCount > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
            주인 미상 {sum.unknownCount}줄 · {won(sum.unknown)}
          </span>
        )}
        <Link href="/finance/payments" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          수납 화면 →
        </Link>
      </div>

      <p className="mb-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] leading-relaxed text-teal-900">
        <b>어느 청구서에도 안 붙은 돈</b>입니다. 그대로 두면 다음 청구서에 저절로 충당되지만,
        <b> 주인이 안 이어진 줄은 영영 안 쓰입니다</b> — 빨간 줄부터 학생을 이어주세요.
        <br />
        청구서를 취소하면 그때 붙어 있던 돈이 여기로 옵니다. 다시 붙이거나 돌려드린 뒤 내리면 됩니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}

      {/* 가둔 화면 안쪽에서 굴립니다(CLAUDE.md 2-10). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">떠 있는 선입금이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <div
                key={g.studentId ?? g.rows[0].id}
                className={
                  "rounded-xl border p-3 " +
                  (g.worst === "주인 미상" ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white")
                }
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <b className="text-[13px] text-slate-800">
                    {g.studentId ? <Who id={g.studentId} name={g.label} /> : `${g.label} (입금자명)`}
                  </b>
                  {g.studentId && (
                    <span className="text-[10px] text-slate-400">{whereById.get(g.studentId) || ""}</span>
                  )}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-700">
                    {won(g.total)}
                  </span>
                  {g.studentId && (
                    <Link
                      href={`/finance/statement/${g.studentId}`}
                      className="text-[10px] font-semibold text-teal-700 underline"
                    >
                      거래명세서
                    </Link>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  {g.rows.map((r) => {
                    const open = g.studentId ? openInvoicesOf.get(g.studentId) ?? [] : [];
                    return (
                      <div key={r.id} className="rounded-lg bg-slate-50 px-2 py-1.5 text-[12px]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="tabular-nums text-slate-500">{r.paid_at}</span>
                          <b className="tabular-nums text-slate-800">{won(r.won)}</b>
                          <span className="text-[10px] text-slate-400">
                            {r.method_kind || r.method || "수단 미상"}
                            {r.payer_name ? ` · ${r.payer_name}` : ""}
                          </span>
                          <span
                            className={
                              "rounded px-1 py-0.5 text-[9px] font-bold " +
                              (r.origin === "주인 미상"
                                ? "bg-rose-100 text-rose-700"
                                : r.origin === "청구 취소"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-200 text-slate-600")
                            }
                            title={ORIGIN_NOTE[r.origin]}
                          >
                            {r.origin}
                          </span>

                          <div className="ml-auto flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => setEditing(editing === r.id ? null : r.id)}
                              className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                            >
                              ✎ 고치기
                            </button>
                            <button
                              type="button"
                              disabled={busy === r.id}
                              onClick={() => void drop(r)}
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-400 hover:bg-rose-50 hover:text-rose-700 disabled:text-slate-300"
                            >
                              내리기
                            </button>
                          </div>
                        </div>

                        {r.memo && <p className="mt-0.5 text-[10px] text-slate-400">💬 {r.memo}</p>}

                        {/* 주인이 없으면 **잇는 것이 첫 번째 일**입니다. 그래서 늘 펴 둡니다. */}
                        {!r.student_id && (
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-[10px] font-semibold text-rose-700">누구 것인가요?</span>
                            <select
                              defaultValue=""
                              disabled={busy === r.id}
                              onChange={(e) => e.target.value && void link(r, e.target.value)}
                              className="rounded border border-rose-300 bg-white px-1 py-0.5 text-[11px]"
                            >
                              <option value="">명부에서 고르기…</option>
                              {students.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} {[s.grade, s.class_name].filter(Boolean).join(" ")}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* 붙일 곳이 있으면 그 자리에서 붙입니다. 수납 화면으로 건너가면 잊습니다. */}
                        {r.student_id && open.length > 0 && (
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-[10px] text-slate-500">청구서에 붙이기</span>
                            <select
                              defaultValue=""
                              disabled={busy === r.id}
                              onChange={(e) => e.target.value && void attach(r, e.target.value)}
                              className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px]"
                            >
                              <option value="">고르기…</option>
                              {open.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.invoice_no} · {won(Number(v.total_amount))} · {v.issue_date}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {editing === r.id && (
                          <form
                            className="mt-1.5 flex flex-wrap items-end gap-1.5 rounded-lg bg-white p-2 ring-1 ring-slate-200"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              const amount = Number(f.get("amount"));
                              if (!(amount > 0)) {
                                notify("금액은 0보다 커야 합니다.", "error");
                                return;
                              }
                              void patch(
                                r.id,
                                {
                                  amount,
                                  paid_at: String(f.get("paid_at") || r.paid_at),
                                  method_kind: String(f.get("method_kind") || "") || null,
                                  payer_name: String(f.get("payer_name") || "") || null,
                                  memo: String(f.get("memo") || "") || null,
                                },
                                "고쳤습니다.",
                              );
                            }}
                          >
                            <label className="text-[10px] text-slate-500">
                              금액
                              <input name="amount" type="number" defaultValue={r.won} className="block w-24 rounded border border-slate-300 px-1 py-0.5 text-[11px] tabular-nums" />
                            </label>
                            <label className="text-[10px] text-slate-500">
                              받은 날
                              <input name="paid_at" type="date" defaultValue={r.paid_at} className="block rounded border border-slate-300 px-1 py-0.5 text-[11px]" />
                            </label>
                            <label className="text-[10px] text-slate-500">
                              수단
                              <select name="method_kind" defaultValue={r.method_kind ?? ""} className="block rounded border border-slate-300 px-1 py-0.5 text-[11px]">
                                <option value="">미상</option>
                                {["올톡페이", "방문카드", "계좌이체", "현금", "기타"].map((k) => (
                                  <option key={k} value={k}>{k}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-[10px] text-slate-500">
                              입금자명
                              <input name="payer_name" defaultValue={r.payer_name ?? ""} className="block w-24 rounded border border-slate-300 px-1 py-0.5 text-[11px]" />
                            </label>
                            <label className="min-w-[120px] flex-1 text-[10px] text-slate-500">
                              메모
                              <input name="memo" defaultValue={r.memo ?? ""} className="block w-full rounded border border-slate-300 px-1 py-0.5 text-[11px]" />
                            </label>
                            <button type="submit" disabled={busy === r.id} className="rounded bg-teal-600 px-2 py-1 text-[11px] font-bold text-white disabled:bg-slate-300">
                              저장
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                              취소
                            </button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
