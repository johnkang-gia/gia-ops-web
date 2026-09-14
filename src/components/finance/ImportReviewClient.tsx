"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { Who } from "@/components/common/HomonymProvider";
import { groupForReview, studentIdOf, type ReviewRow, type StudentBefore } from "@/lib/paymentImport";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

type StudentOption = { id: string; name: string; where: string };

type Filter = "봐야 할 것" | "전체" | "자동" | "확인필요" | "못찾음" | "승인" | "반영됨";

const MATCH_TONE: Record<string, string> = {
  자동: "bg-emerald-100 text-emerald-800",
  확인필요: "bg-amber-100 text-amber-800",
  못찾음: "bg-rose-100 text-rose-800",
};

/**
 * **올린 파일을 사람이 검수하는 화면.**
 *
 * ── 왜 학생별로 묶나 ───────────────────────────────────────────────────────
 *
 * 285줄을 한 줄씩 보면 아무도 끝까지 못 봅니다. 그리고 검수하는 사람이 실제로 판단하는
 * 단위는 줄이 아니라 **사람**입니다 - 「이 아이한테 지금 얼마가 잡혀 있고, 이걸 반영하면
 * 얼마가 되나」. 그래서 학생 하나가 카드 하나이고, 카드마다 **지금 → 반영 뒤**가 나란히
 * 있습니다.
 *
 * ── 손을 덜게 하는 것들 ────────────────────────────────────────────────────
 *
 *   · 결제중단·이미 있음은 **올릴 때 이미 「건너뜀」**입니다. 그것까지 누르게 하면 정작
 *     봐야 할 줄이 묻힙니다.
 *   · 「자동 전부 승인」 한 번 — 실측에서 249건(87%)이 여기 들어갑니다.
 *   · 확인필요는 앱이 **짐작한 학생을 미리 골라 둡니다.** 맞으면 승인만 누릅니다.
 *   · 기본 화면은 「봐야 할 것」입니다. 이미 정한 줄은 눈에서 치웁니다.
 */
export default function ImportReviewClient({
  batchId,
  fileName,
  status,
  rows: initial,
  students,
  beforeByStudent,
}: {
  batchId: string;
  fileName: string;
  status: string;
  rows: ReviewRow[];
  students: StudentOption[];
  beforeByStudent: Record<string, StudentBefore>;
}) {
  useFinanceLive(["payment_import_rows", "payment_imports"]);
  const notify = useToast();
  const confirmAction = useConfirm();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>("봐야 할 것");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const nameById = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);
  const whereById = useMemo(() => new Map(students.map((s) => [s.id, s.where])), [students]);

  const groups = useMemo(
    () =>
      groupForReview(rows, {
        nameOf: (id) => nameById.get(id) ?? null,
        whereOf: (id) => whereById.get(id) ?? null,
        beforeOf: (id) => beforeByStudent[id] ?? null,
      }),
    [rows, nameById, whereById, beforeByStudent],
  );

  const counts = useMemo(() => {
    const c = { 대기: 0, 승인: 0, 보류: 0, 건너뜀: 0, 자동: 0, 확인필요: 0, 못찾음: 0, 반영됨: 0, 실패: 0 };
    for (const r of rows) {
      c[r.decision] += 1;
      c[r.matchKind] += 1;
      if (r.appliedAt) c.반영됨 += 1;
      if (r.applyError) c.실패 += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => {
          if (filter === "봐야 할 것" && r.decision !== "대기") return false;
          if (filter === "자동" && r.matchKind !== "자동") return false;
          if (filter === "확인필요" && r.matchKind !== "확인필요") return false;
          if (filter === "못찾음" && r.matchKind !== "못찾음") return false;
          if (filter === "승인" && r.decision !== "승인") return false;
          if (filter === "반영됨" && !r.appliedAt) return false;
          return true;
        }),
      }))
      .filter((g) => g.rows.length > 0)
      .filter((g) => !needle || g.name.toLowerCase().includes(needle) || g.rows.some((r) => r.rawName.toLowerCase().includes(needle)));
  }, [groups, filter, q]);

  /** 검수 결과를 서버에 적습니다. **아직 아무것도 반영하지 않습니다.** */
  async function decide(ids: string[], decision: string, studentId?: string | null, setStudent = false) {
    if (ids.length === 0) return;
    setBusy(true);
    const res = await fetch("/api/finance/import/rows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, decision, studentId, setStudent }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; warn?: string; changed?: number } | null;
    setBusy(false);
    // 조용히 넘기면 정해진 줄 알고 반영을 누릅니다.
    if (!res.ok) {
      notify(json?.error ?? "바꾸지 못했습니다.", "error");
      return;
    }
    if (json?.warn) notify(json.warn, "error");
    // 화면을 바로 고칩니다. 서버 왕복을 기다리면 285줄을 누르는 동안 계속 멈춥니다.
    setRows((p) =>
      p.map((r) =>
        ids.includes(r.id)
          ? { ...r, decision: decision as ReviewRow["decision"], decidedStudentId: setStudent ? (studentId ?? null) : r.decidedStudentId }
          : r,
      ),
    );
  }

  /** 자동으로 붙은 줄을 한 번에 승인합니다. 실측에서 87% 가 여기 들어갑니다. */
  async function approveAllAuto() {
    const ids = rows.filter((r) => r.matchKind === "자동" && r.decision === "대기" && r.plan !== "건너뜀").map((r) => r.id);
    if (ids.length === 0) {
      notify("자동으로 붙은 대기 줄이 없습니다.", "error");
      return;
    }
    const sum = rows.filter((r) => ids.includes(r.id)).reduce((n, r) => n + r.amount, 0);
    const ok = await confirmAction(
      `번호와 이름이 모두 맞는 ${ids.length}줄(${won(sum)})을 승인합니다.\n` +
        `아직 반영되지는 않습니다 — 마지막에 「반영하기」를 눌러야 실제 청구서·입금이 만들어집니다.`,
    );
    if (!ok) return;
    await decide(ids, "승인");
    notify(`${ids.length}줄을 승인했습니다. 확인필요 ${counts.확인필요}줄이 남았습니다.`, "success");
  }

  /** 승인한 줄을 실제 청구서·입금으로 내보냅니다. **여기서부터 되돌리기 어렵습니다.** */
  async function apply() {
    const ready = rows.filter((r) => r.decision === "승인" && !r.appliedAt);
    if (ready.length === 0) {
      notify("반영할 승인 줄이 없습니다.", "error");
      return;
    }
    const noStudent = ready.filter((r) => !studentIdOf(r));
    if (noStudent.length > 0) {
      notify(`${noStudent.length}줄에 학생이 안 정해졌습니다. 먼저 골라주세요.`, "error");
      return;
    }
    const bill = ready.reduce((n, r) => n + r.amount, 0);
    const pay = ready.filter((r) => r.plan === "청구서 만들고 수납" || r.plan === "수납만 붙이기").reduce((n, r) => n + r.amount, 0);
    const ok = await confirmAction(
      `승인한 ${ready.length}줄을 실제 자료로 내보냅니다.\n\n` +
        `· 청구서 ${won(bill)}\n· 입금 ${won(pay)}\n· 미납으로 남는 금액 ${won(bill - pay)}\n\n` +
        `한 번 나가면 되돌리려면 그 청구서를 취소하거나 환불로 되돌려야 합니다.`,
      { danger: true },
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/finance/import/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId }),
    });
    const json = (await res.json().catch(() => null)) as
      | { error?: string; madeInvoices?: number; madePayments?: number; failed?: number; failures?: { seq: number; name: string; error: string }[] }
      | null;
    setBusy(false);
    if (!res.ok) {
      notify(json?.error ?? "반영하지 못했습니다.", "error");
      return;
    }
    // 실패한 줄은 **몇 줄이 왜** 실패했는지 말합니다. 조용히 넘기면 며칠 뒤에 그 학생만
    // 비어 있는 것을 발견하고, 그때는 이유를 알 수 없습니다.
    if ((json?.failed ?? 0) > 0) {
      notify(`청구서 ${json?.madeInvoices}장·입금 ${json?.madePayments}건을 만들었습니다. ${json?.failed}줄은 실패했습니다 — 아래 빨간 줄을 봐주세요.`, "error");
    } else {
      notify(`청구서 ${json?.madeInvoices}장·입금 ${json?.madePayments}건을 만들었습니다.`, "success");
    }
    router.refresh();
  }

  const readyCount = rows.filter((r) => r.decision === "승인" && !r.appliedAt).length;

  /** 잘못 올린 묶음을 버립니다. 버리는 길이 없으면 그 파일은 목록에 남고, 남으면 언젠가 눌립니다. */
  async function discard() {
    const reason = window.prompt("이 묶음을 버립니다. 왜 버리나요?\n(예: 잘못 올림 / 시험으로 올림)", "");
    if (reason === null) return;
    setBusy(true);
    const res = await fetch("/api/finance/import/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId, reason }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res.ok) {
      notify(json?.error ?? "버리지 못했습니다.", "error");
      return;
    }
    notify("버렸습니다.", "success");
    router.push("/finance/import");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 진행 ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="text-[12px] font-bold text-slate-700">{fileName}</span>
        <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (status === "반영됨" ? "bg-slate-800 text-white" : "bg-teal-100 text-teal-800")}>
          {status}
        </span>
        <span className="text-[11px] tabular-nums text-slate-500">
          전체 {rows.length} · <b className="text-amber-700">대기 {counts.대기}</b> · 승인 {counts.승인} · 건너뜀 {counts.건너뜀}
          {counts.반영됨 > 0 && <> · 반영됨 {counts.반영됨}</>}
          {counts.실패 > 0 && <> · <b className="text-rose-700">실패 {counts.실패}</b></>}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            disabled={busy || counts.대기 === 0}
            onClick={() => void approveAllAuto()}
            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
          >
            ✅ 자동 {counts.자동}줄 전부 승인
          </button>
          <button
            type="button"
            disabled={busy || readyCount === 0}
            onClick={() => void apply()}
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-900 disabled:bg-slate-300"
            title="승인한 줄만 실제 청구서·입금으로 나갑니다"
          >
            📥 승인한 {readyCount}줄 반영하기
          </button>
          {status !== "반영됨" && status !== "버림" && (
            <button
              type="button"
              disabled={busy || counts.반영됨 > 0}
              onClick={() => void discard()}
              className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
              title={counts.반영됨 > 0 ? "이미 나간 줄이 있어 버릴 수 없습니다" : "잘못 올린 묶음을 버립니다"}
            >
              🗑 버리기
            </button>
          )}
        </div>
      </div>

      <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
        여기 있는 줄은 <b>아직 어떤 집계에도 안 잡힙니다.</b> 「반영하기」를 눌러야 실제 청구서·입금이 만들어집니다.
        <br />
        학생 카드의 <b>지금 → 반영 뒤</b>가 그 사람에게 무엇이 어떻게 바뀌는지입니다. 결제중단·이미 들어온 줄은 미리 건너뜀으로 두었습니다.
      </p>

      {/* ── 고르개 ───────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["봐야 할 것", "확인필요", "못찾음", "자동", "승인", "반영됨", "전체"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "rounded-full px-2.5 py-1 text-[11px] font-bold " +
              (filter === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            {f}
            {f === "봐야 할 것" && counts.대기 > 0 && <span className="ml-1 text-amber-300">{counts.대기}</span>}
            {f === "확인필요" && <span className="ml-1 opacity-60">{counts.확인필요}</span>}
            {f === "못찾음" && counts.못찾음 > 0 && <span className="ml-1 opacity-60">{counts.못찾음}</span>}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="학생 이름"
          className="ml-auto w-40 rounded-lg border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-teal-400"
        />
      </div>

      {/* 가둔 화면 안쪽에서 굴립니다(CLAUDE.md 2-10). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-slate-400">
            {filter === "봐야 할 것" ? "봐야 할 줄이 없습니다. 「반영하기」를 누르세요." : "고른 조건에 맞는 줄이 없습니다."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((g) => {
              const waitingIds = g.rows.filter((r) => r.decision === "대기" && r.plan !== "건너뜀").map((r) => r.id);
              const changed = g.after.billed !== g.before.billed || g.after.received !== g.before.received;
              return (
                <div
                  key={g.studentId ?? "unknown"}
                  className={"rounded-xl border bg-white " + (g.studentId ? "border-slate-200" : "border-rose-300")}
                >
                  {/* ── 사람 한 명 ─────────────────────────────────────── */}
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                    <b className="text-[13px] text-slate-800">
                      {g.studentId ? <Who id={g.studentId} name={g.name} /> : <span className="text-rose-700">⚠️ 누구인지 모름</span>}
                    </b>
                    {g.where && <span className="text-[10px] text-slate-400">{g.where}</span>}
                    <span className="text-[10px] text-slate-400">{g.rows.length}줄</span>

                    {/* **지금 → 반영 뒤.** 이 한 줄을 보려고 이 화면을 엽니다. */}
                    {g.studentId && (
                      <span className="flex items-center gap-1.5 text-[11px] tabular-nums">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                          지금 청구 {won(g.before.billed)} · 수납 {won(g.before.received)} · 미납 {won(g.before.balance)}
                        </span>
                        {changed && (
                          <>
                            <span className="text-slate-400">→</span>
                            <span className="rounded bg-teal-50 px-1.5 py-0.5 font-bold text-teal-800 ring-1 ring-teal-200">
                              청구 {won(g.after.billed)} · 수납 {won(g.after.received)} ·{" "}
                              <span className={g.after.balance > 0 ? "text-rose-700" : "text-emerald-700"}>미납 {won(g.after.balance)}</span>
                            </span>
                          </>
                        )}
                      </span>
                    )}

                    <div className="ml-auto flex gap-1">
                      {waitingIds.length > 0 && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(waitingIds, "승인")}
                            className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                          >
                            이 사람 {waitingIds.length}줄 승인
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(waitingIds, "건너뜀")}
                            className="rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-50"
                          >
                            전부 건너뜀
                          </button>
                        </>
                      )}
                      {g.studentId && (
                        <Link
                          href={`/finance/statement/${g.studentId}`}
                          target="_blank"
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 underline"
                        >
                          명세서
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* ── 그 사람의 줄들 ──────────────────────────────────── */}
                  <table className="w-full text-left text-[11px]">
                    <tbody>
                      {g.rows.map((r) => (
                        <Fragment key={r.id}>
                          <tr className={"border-b border-slate-50 last:border-b-0 " + (r.applyError ? "bg-rose-50" : "")}>
                            <td className="w-10 px-3 py-1.5 text-[10px] tabular-nums text-slate-300">#{r.seq}</td>
                            <td className="px-1 py-1.5">
                              <span className={"rounded px-1 py-0.5 text-[9px] font-bold " + (MATCH_TONE[r.matchKind] ?? "")}>{r.matchKind}</span>
                            </td>
                            <td className="px-1 py-1.5 text-slate-700">
                              {/* 파일에 적힌 이름을 **그대로** 보여줍니다 - 명부 이름만 보이면
                                  「강하라/치과진료비 포함」 같은 줄을 그냥 넘기게 됩니다. */}
                              <span className="text-slate-500">{r.rawName}</span>
                              {r.rawWhy && <span className="ml-1 text-[10px] text-slate-400">· {r.rawWhy}</span>}
                            </td>
                            <td className="px-1 py-1.5 text-right font-bold tabular-nums text-slate-800">{won(r.amount)}</td>
                            <td className="px-1 py-1.5 text-[10px] text-slate-500">
                              {r.plan === "청구서 만들고 수납" ? (
                                <span className="text-emerald-700">청구 + 수납</span>
                              ) : r.plan === "청구서만 만들기(미납)" ? (
                                <span className="text-amber-700">청구만 → 미납</span>
                              ) : r.plan === "수납만 붙이기" ? (
                                "수납만"
                              ) : (
                                <span className="text-slate-300">건너뜀</span>
                              )}
                            </td>
                            <td className="px-1 py-1.5 text-[10px] tabular-nums text-slate-400">
                              {r.issuedAt}
                              {r.paidAt && r.paidAt !== r.issuedAt && <span className="ml-1 text-emerald-600">→ {r.paidAt}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {r.appliedAt ? (
                                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-white">반영됨</span>
                              ) : (
                                <span className="flex items-center justify-end gap-1">
                                  {/* 확인필요·못찾음이면 **누구인지 고르는 자리**를 바로 옆에
                                      둡니다. 다른 화면으로 보내면 돌아오지 않습니다. */}
                                  {r.matchKind !== "자동" && (
                                    <select
                                      value={studentIdOf(r) ?? ""}
                                      disabled={busy}
                                      onChange={(e) => void decide([r.id], r.decision, e.target.value || null, true)}
                                      className="w-36 rounded border border-amber-300 px-1 py-0.5 text-[10px]"
                                    >
                                      <option value="">— 누구인가요? —</option>
                                      {students.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.name} {s.where}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  {(["승인", "보류", "건너뜀"] as const).map((d) => (
                                    <button
                                      key={d}
                                      type="button"
                                      disabled={busy || r.plan === "건너뜀"}
                                      onClick={() => void decide([r.id], r.decision === d ? "대기" : d)}
                                      className={
                                        "rounded px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-40 " +
                                        (r.decision === d
                                          ? d === "승인"
                                            ? "bg-emerald-600 text-white"
                                            : d === "보류"
                                              ? "bg-amber-500 text-white"
                                              : "bg-slate-500 text-white"
                                          : "bg-slate-100 text-slate-500 hover:bg-slate-200")
                                      }
                                    >
                                      {d}
                                    </button>
                                  ))}
                                </span>
                              )}
                            </td>
                          </tr>
                          {/* 판정 이유와 실패 이유는 **줄 바로 아래**에 둡니다. 따로 열게 하면
                              아무도 안 엽니다. */}
                          {(r.matchKind !== "자동" || r.applyError) && (
                            <tr className="border-b border-slate-50 last:border-b-0">
                              <td />
                              <td colSpan={6} className="px-1 pb-1.5 text-[10px]">
                                {r.applyError ? (
                                  <span className="font-semibold text-rose-700">⚠️ {r.applyError}</span>
                                ) : (
                                  <span className="text-slate-400">{r.matchWhy}</span>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
