"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { useToast } from "@/components/common/ToastProvider";
import { Who } from "@/components/common/HomonymProvider";
import { APP_ORIGIN } from "@/lib/appUrl";
import { TERM_GROUPS } from "@/lib/termTypes";
import { campGroupOf, campLinkSuspect } from "@/lib/campMatch";
import CancelInvoiceModal from "./CancelInvoiceModal";
import type { Invoice } from "@/lib/types";
import {
  CAMP_DISCOUNTS,
  CAMP_SHUTTLES,
  DISCOUNT_RATE,
  campDiscountOf,
  campFee,
  readCampForm,
  type CampDiscount,
  type CampShuttle,
} from "@/lib/campFee";

export type CampTerm = { id: string; term_type: string; year: string; status: string; start_date: string | null; end_date: string | null };
export type CampApp = {
  id: string;
  term_id: string;
  source: string;
  submitted_at: string | null;
  raw: Record<string, string>;
  applicant_name: string;
  applicant_name_en: string | null;
  grade: string | null;
  birth_date: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  email: string | null;
  weeks: number | null;
  shuttle: CampShuttle | null;
  says_current: boolean;
  sibling: boolean;
  is_returning: boolean;
  discount_override: CampDiscount | null;
  amount_override: number | null;
  student_id: string | null;
  status: "접수" | "확정" | "취소";
  invoice_id: string | null;
  memo: string | null;
};
/** raw: 발행 취소 창(CancelInvoiceModal)이 받는 청구서 그대로. */
export type CampInvoice = { id: string; invoice_no: string; status: string; total: number; paid: number; raw: Invoice };
export type CampStudent = {
  id: string;
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  birth_date: string | null;
  status: string;
};
type SameHit = { name: string; grade: string | null; class_name: string | null; birth_date: string | null; status: string };

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;
const key = (s: string | null | undefined) => (s ?? "").replace(/[\s·.\-_]/g, "").toLowerCase();
const STATUS_LABEL: Record<string, string> = { active: "재학", inactive: "퇴소", 보류: "보류", 캠프: "캠프(외부)" };
const CAMP_TYPES = TERM_GROUPS.find((g) => g.label === "캠프")?.types ?? [];

export default function CampClient({
  terms,
  termId,
  apps,
  invoices,
  students,
  link,
  loadError,
}: {
  terms: CampTerm[];
  termId: string;
  apps: CampApp[];
  invoices: CampInvoice[];
  students: CampStudent[];
  link: { token: string; last_seen_at: string | null; last_result: string | null } | null;
  loadError: string | null;
}) {
  // 다른 사람이 신청을 고치거나 폼이 새 응답을 보내면 이 화면도 바로 바뀝니다.
  useFinanceLive(["camp_applications", "camp_intake_links"]);
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<{ invoice: Invoice; studentName: string } | null>(null);
  const [filter, setFilter] = useState<"전체" | "접수" | "확정" | "취소" | "미연결" | "재학생" | "외부">("전체");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!link);
  const [sameAsk, setSameAsk] = useState<{ appId: string; hits: SameHit[] } | null>(null);

  const term = terms.find((t) => t.id === termId) ?? null;
  const termLabel = term ? `${term.year} ${term.term_type}` : "";
  const studentOf = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const invoiceOf = useMemo(() => new Map(invoices.map((v) => [v.id, v])), [invoices]);

  async function act(payload: Record<string, unknown>, okText?: string): Promise<Record<string, unknown> | null> {
    setBusy(String(payload.id ?? payload.action));
    const res = await fetch("/api/finance/camp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(null);
    if (!res.ok && !json.needsConfirm) {
      notify(String(json.error ?? "처리하지 못했습니다."), "error");
      return null;
    }
    if (okText) notify(okText, "success");
    router.refresh();
    return json;
  }
  const patch = (id: string, p: Record<string, unknown>) => act({ action: "update", id, patch: p });

  function rowFee(a: CampApp) {
    const s = a.student_id ? studentOf.get(a.student_id) : null;
    const discount = campDiscountOf({
      isCurrent: s ? s.status === "active" : a.says_current,
      sibling: a.sibling,
      returning: a.is_returning,
      override: a.discount_override,
    });
    const fee = campFee(a.weeks, a.shuttle, discount);
    return { discount, fee, amount: a.amount_override ?? fee?.amount ?? null, student: s };
  }

  const liveInv = (a: CampApp) => {
    const v = a.invoice_id ? invoiceOf.get(a.invoice_id) : undefined;
    return v && v.status !== "취소" ? v : undefined;
  };

  /** 재학생/외부 — 이어진 학생의 상태가 먼저, 아직 안 이었으면 폼의 답. 청구서도 이 묶음별로 냅니다. */
  const groupOf = (a: CampApp) => campGroupOf(a.student_id ? studentOf.get(a.student_id)?.status ?? null : null, a.says_current);
  /** 「재학생」이라 답했는데 재학생이 아닌 학생(옛 중복 줄 등)에 이어진 줄 - 잘못 이었을 가능성이 큽니다. */
  const suspectOf = (a: CampApp) => campLinkSuspect(a.student_id ? studentOf.get(a.student_id)?.status ?? null : null, a.says_current);
  const shown = apps.filter((a) => {
    if (filter === "미연결" && a.student_id) return false;
    if ((filter === "재학생" || filter === "외부") && (a.status === "취소" || groupOf(a) !== filter)) return false;
    if (filter !== "전체" && filter !== "미연결" && filter !== "재학생" && filter !== "외부" && a.status !== filter) return false;
    if (filter === "전체" && a.status === "취소") return false;
    if (!q.trim()) return true;
    const k = key(q);
    return [a.applicant_name, a.applicant_name_en, a.guardian_name, a.guardian_phone].some((v) => key(v).includes(k));
  });

  const live = apps.filter((a) => a.status !== "취소");
  const billed = live.map(liveInv).filter((v): v is CampInvoice => !!v);
  // 바로 청구서를 낼 수 있는 줄(학생 연결 + 금액 계산 가능 + 아직 안 나감) — 묶음별 일괄 발행 단추의 숫자.
  const ready = (g: "재학생" | "외부") => live.filter((a) => a.student_id && !liveInv(a) && groupOf(a) === g && rowFee(a).amount != null).length;
  const externalUnlinked = live.filter((a) => !a.student_id && !a.says_current).length;
  async function bulk(payload: Record<string, unknown>, label: string) {
    const r = await act({ ...payload, termId });
    if (!r) return;
    const failed = (r.failed as string[] | undefined) ?? [];
    const ask = (r.ask as string[] | undefined) ?? [];
    const parts = [
      r.linked != null ? `${r.linked}명 연결${r.ambiguous ? ` · 같은 이름이 여럿이라 ${r.ambiguous}명은 직접 골라주세요` : ""}` : null,
      r.relinked ? `재학생이 아닌 줄에 붙어 있던 ${r.relinked}명을 재학생으로 다시 연결` : null,
      r.made != null ? `${r.made}건 완료` : null,
      ask.length ? `같은 이름이 명부에 있어 넣지 않음: ${ask.join(", ")} (표에서 직접 확인)` : null,
      failed.length ? `실패 ${failed.length}건: ${failed.slice(0, 3).join(" / ")}` : null,
    ].filter(Boolean);
    notify(`${label} — ${parts.join(" · ") || "할 것이 없었습니다"}`, failed.length ? "error" : "success");
  }
  const totals = {
    count: live.length,
    unlinked: live.filter((a) => !a.student_id).length,
    unbilled: live.filter((a) => !liveInv(a)).length,
    billed: billed.reduce((n, v) => n + v.total, 0),
    paid: billed.reduce((n, v) => n + v.paid, 0),
  };

  async function external(a: CampApp, homonymOk = false) {
    const r = await act({ action: "external", id: a.id, homonymOk }, homonymOk ? undefined : "외부 학생으로 명부에 넣고 연결했습니다.");
    if (r?.needsConfirm) {
      const nc = r.needsConfirm as { hits?: SameHit[] }[];
      setSameAsk({ appId: a.id, hits: nc.flatMap((x) => x.hits ?? []) });
    } else if (r && homonymOk) notify("다른 학생으로 확인하고 명부에 넣었습니다.", "success");
  }

  return (
    <div className="space-y-3 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[16px] font-extrabold text-slate-800">캠프 청구</h1>
        {terms.length > 0 && (
          <select
            value={termId}
            onChange={(e) => router.push(`/finance/camp?term=${e.target.value}`)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.year} {t.term_type}
                {t.status === "종료" ? " (끝남)" : ""}
              </option>
            ))}
          </select>
        )}
        {term && (
          <button
            disabled={!!busy}
            onClick={() => {
              const reopen = term.status === "종료";
              if (!window.confirm(reopen ? `${termLabel}을(를) 다시 엽니다. 구글폼 연결·신청·청구서를 쓸 수 있습니다.` : `${termLabel}을(를) 닫습니다(끝남). 신청·청구서는 그대로 남습니다.`)) return;
              void act({ action: "setStatus", termId, status: reopen ? "예정" : "종료" }, reopen ? "캠프를 다시 열었습니다." : "캠프를 닫았습니다.");
            }}
            className={`rounded-lg px-2 py-1 text-[11px] font-bold ${term.status === "종료" ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-500"}`}
          >
            {term.status === "종료" ? "다시 열기" : "캠프 닫기"}
          </button>
        )}
        <NewCamp onMake={(termType, year) => act({ action: "createTerm", termType, year }).then((r) => r?.termId && router.push(`/finance/camp?term=${r.termId}`))} />
        <span className="ml-auto text-[11px] text-slate-500">주당 90만원 · 셔틀 미이용 주당 −5만 · 편도 주당 −2.5만 · 할인은 하나만(재학생 30% / 외부 형제 10% / 외부 재수강 5%)</span>
      </div>

      {loadError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">자료를 다 읽지 못했습니다: {loadError}</div>}

      {!term ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">
          아직 캠프 학기가 없습니다. 위의 「+ 캠프 만들기」로 만드세요. 정규학기는 그대로 「지금」 학기로 남습니다.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="신청" value={`${totals.count}명`} />
            <Stat label="학생 연결 전" value={`${totals.unlinked}명`} warn={totals.unlinked > 0} />
            <Stat label="청구서 전" value={`${totals.unbilled}명`} warn={totals.unbilled > 0} />
            <Stat label="청구 합계" value={won(totals.billed)} />
            <Stat label="수납 · 잔액" value={`${won(totals.paid)} · ${won(totals.billed - totals.paid)}`} />
          </div>

          {term.status === "종료" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              끝난 캠프입니다. 이 캠프로 새 신청을 받으려면 위의 <b>다시 열기</b>를 누르세요.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-2 py-1.5 text-[12px]">
            <span className="font-bold text-indigo-900">한꺼번에</span>
            <button disabled={!!busy || totals.unlinked + live.filter(suspectOf).length === 0} onClick={() => void bulk({ action: "autoLink" }, "자동 연결")} className="rounded border border-indigo-200 bg-white px-2 py-0.5 font-bold text-indigo-800 disabled:opacity-40" title="명부에 같은 이름이 한 명뿐이면 잇고, 같은 이름이 여럿이면 보호자 전화번호 → 생일 → 재학 답 순으로 한 명이 될 때만 잇습니다. 재학생이 아닌 학생에 잘못 붙은 줄도 다시 봅니다.">
              ① 재학생 자동 연결 ({totals.unlinked})
            </button>
            <button
              disabled={!!busy || externalUnlinked === 0}
              onClick={() => window.confirm(`「재학생 아님」으로 답한 ${externalUnlinked}명을 외부 학생(캠프)으로 명부에 넣고 잇습니다. 같은 이름이 명부에 있는 아이는 넣지 않고 남깁니다.`) && void bulk({ action: "bulkExternal" }, "외부 학생 등록")}
              className="rounded border border-indigo-200 bg-white px-2 py-0.5 font-bold text-indigo-800 disabled:opacity-40"
            >
              ② 외부 학생 등록·연결 ({externalUnlinked})
            </button>
            <span className="mx-1 text-slate-300">|</span>
            {(["재학생", "외부"] as const).map((g) => (
              <button
                key={g}
                disabled={!!busy || ready(g) === 0}
                onClick={() => window.confirm(`${g === "외부" ? "외부 학생" : "재학생"} ${ready(g)}명의 ${termLabel} 청구서를 한꺼번에 만듭니다. 금액은 표의 할인·주·셔틀 그대로입니다.`) && void bulk({ action: "bulkIssue", group: g }, `${g} 청구서`)}
                className="rounded bg-indigo-600 px-2 py-0.5 font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
              >
                ③ {g === "외부" ? "외부 학생" : "재학생"} 청구서 {ready(g)}장 발행
              </button>
            ))}
            <span className="text-[10px] text-slate-500">주·셔틀이 비었거나 학생이 안 이어진 줄은 빠집니다.</span>
          </div>

          <FormLink termId={termId} termLabel={termLabel} link={link} open={showForm} setOpen={setShowForm} act={act} busy={busy} />

          <div className="flex flex-wrap items-center gap-1">
            {(["전체", "재학생", "외부", "미연결", "접수", "확정", "취소"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${filter === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {f === "미연결" ? "학생 연결 전" : f === "외부" ? `외부 (${live.filter((a) => groupOf(a) === "외부").length})` : f === "재학생" ? `재학생 (${live.filter((a) => groupOf(a) === "재학생").length})` : f}
              </button>
            ))}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름·보호자·연락처"
              className="ml-2 w-44 rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
            />
            <AddManual onAdd={(name) => act({ action: "add", termId, name }, `${name} 신청을 적었습니다.`)} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[1080px] text-[12px]">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">신청</th>
                  <th className="px-2 py-1.5 text-left">학생</th>
                  <th className="px-2 py-1.5 text-left">보호자</th>
                  <th className="px-2 py-1.5">참여</th>
                  <th className="px-2 py-1.5">셔틀</th>
                  <th className="px-2 py-1.5">할인</th>
                  <th className="px-2 py-1.5 text-right">수강료</th>
                  <th className="px-2 py-1.5 text-left">청구서</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                      {apps.length === 0 ? "아직 들어온 신청이 없습니다. 위의 구글폼 연결을 먼저 해 두세요." : "조건에 맞는 신청이 없습니다."}
                    </td>
                  </tr>
                )}
                {shown.map((a) => {
                  const { discount, fee, amount, student } = rowFee(a);
                  const inv = liveInv(a);
                  const locked = !!inv;
                  const cancelled = a.status === "취소";
                  return (
                    <FragmentRow key={a.id}>
                      <tr className={`border-t border-slate-100 align-top ${cancelled ? "opacity-50" : ""}`}>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                          {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }) : "—"}
                          <div className="text-[10px]">{a.source}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-bold text-slate-800">
                            <span className={`mr-1 rounded px-1 text-[10px] font-bold ${groupOf(a) === "재학생" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>{groupOf(a)}</span>
                            {suspectOf(a) && (
                              <span className="mr-1 rounded bg-red-100 px-1 text-[10px] font-bold text-red-700" title="폼에는 재학생이라 답했는데 이어진 학생이 재학생이 아닙니다. 「재학생 자동 연결」을 누르거나 학생을 다시 고르세요.">
                                연결 확인
                              </span>
                            )}
                            {a.applicant_name || <span className="text-red-600">이름 못 읽음</span>}
                            {a.applicant_name_en && <span className="ml-1 font-normal text-slate-500">{a.applicant_name_en}</span>}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {[a.grade && `${a.grade}`, a.birth_date && `생일 ${a.birth_date}`].filter(Boolean).join(" · ")}
                          </div>
                          {a.memo && (
                            <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap rounded bg-amber-50 px-1 text-[10px] text-amber-800" title={a.memo}>
                              {a.memo}
                            </div>
                          )}
                          {student ? (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                              <span className="text-slate-400">→</span>
                              <Who id={student.id} name={student.name} />
                              <span className={`rounded px-1 text-[10px] font-bold ${student.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>
                                {STATUS_LABEL[student.status] ?? student.status}
                              </span>
                              {!locked && (
                                <button className="text-slate-400 underline" onClick={() => patch(a.id, { student_id: null })}>
                                  풀기
                                </button>
                              )}
                            </div>
                          ) : (
                            !cancelled && (
                              <LinkStudent
                                app={a}
                                students={students}
                                busy={busy === a.id}
                                onPick={(sid) => patch(a.id, { student_id: sid })}
                                onExternal={() => external(a)}
                              />
                            )
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-slate-600">
                          {a.guardian_name}
                          <div className="tabular-nums">{a.guardian_phone}</div>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <select
                            disabled={locked}
                            value={a.weeks ?? ""}
                            onChange={(e) => patch(a.id, { weeks: e.target.value ? Number(e.target.value) : null })}
                            className={`rounded border px-1 py-0.5 ${a.weeks ? "border-slate-300" : "border-red-300 bg-red-50"}`}
                          >
                            <option value="">?</option>
                            <option value="3">3주(1~3)</option>
                            <option value="2">2주(2~3)</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <select
                            disabled={locked}
                            value={a.shuttle ?? ""}
                            onChange={(e) => patch(a.id, { shuttle: e.target.value || null })}
                            className={`rounded border px-1 py-0.5 ${a.shuttle ? "border-slate-300" : "border-red-300 bg-red-50"}`}
                          >
                            <option value="">?</option>
                            {CAMP_SHUTTLES.map((s) => (
                              <option key={s} value={s}>
                                {s === "왕복" ? "이용" : s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <select
                            disabled={locked}
                            value={a.discount_override ?? ""}
                            onChange={(e) => patch(a.id, { discount_override: e.target.value || null })}
                            className="rounded border border-slate-300 px-1 py-0.5"
                            title="비워 두면 규칙대로 정합니다"
                          >
                            <option value="">자동 · {discount === "없음" ? "할인 없음" : `${discount} ${Math.round(DISCOUNT_RATE[discount] * 100)}%`}</option>
                            {CAMP_DISCOUNTS.map((d) => (
                              <option key={d} value={d}>
                                {d === "없음" ? "할인 없음" : `${d} ${Math.round(DISCOUNT_RATE[d] * 100)}%`}
                              </option>
                            ))}
                          </select>
                          <div className="mt-0.5 flex justify-center gap-1.5 text-[10px] text-slate-500">
                            <label className="flex items-center gap-0.5">
                              <input type="checkbox" disabled={locked} checked={a.sibling} onChange={(e) => patch(a.id, { sibling: e.target.checked })} />
                              형제
                            </label>
                            <label className="flex items-center gap-0.5">
                              <input type="checkbox" disabled={locked} checked={a.is_returning} onChange={(e) => patch(a.id, { is_returning: e.target.checked })} />
                              재수강
                            </label>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {amount != null ? <b>{won(amount)}</b> : <span className="text-red-600">주·셔틀 필요</span>}
                          {fee && fee.discountAmount > 0 && a.amount_override == null && (
                            <div className="text-[10px] text-slate-400">
                              {won(fee.gross)} − {won(fee.discountAmount)}
                            </div>
                          )}
                          {a.amount_override != null && <div className="text-[10px] font-bold text-amber-700">직접 정한 금액</div>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {inv ? (
                            <div>
                              <span className="font-mono text-[11px]">{inv.invoice_no}</span>
                              <div className={`text-[10px] font-bold ${inv.paid >= inv.total ? "text-emerald-700" : inv.paid > 0 ? "text-amber-700" : "text-slate-500"}`}>
                                {inv.paid >= inv.total ? "완납" : inv.paid > 0 ? `일부수납 ${won(inv.paid)}` : "청구됨"}
                              </div>
                              <button
                                className="text-[10px] text-red-600 underline"
                                title="청구서를 취소하고 이 신청을 청구 전으로 돌립니다. 주·셔틀을 고쳐 다시 발행할 수 있습니다."
                                onClick={() => setCancelling({ invoice: inv.raw, studentName: student?.name ?? a.applicant_name ?? "" })}
                              >
                                발행 취소
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">미청구</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">
                          {!inv && !cancelled && (
                            <button
                              disabled={busy === a.id || !a.student_id || amount == null}
                              title={!a.student_id ? "먼저 학생을 연결하세요" : amount == null ? "참여 주와 셔틀을 정하세요" : ""}
                              onClick={() => {
                                if (!window.confirm(`${a.applicant_name} · ${termLabel} 수강료 ${won(amount ?? 0)} 청구서를 만듭니다. 캠프마다 한 장입니다.`)) return;
                                void act({ action: "issue", id: a.id }, "청구서를 만들었습니다. 올톡 보내기에서 보낼 수 있습니다.");
                              }}
                              className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
                            >
                              청구서 만들기
                            </button>
                          )}
                          <button onClick={() => setOpen(open === a.id ? null : a.id)} className="ml-1 rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
                            {open === a.id ? "접기" : "자세히"}
                          </button>
                        </td>
                      </tr>
                      {open === a.id && (
                        <tr className="border-t border-dashed border-slate-100 bg-slate-50/60">
                          <td colSpan={9} className="px-3 py-2">
                            <Detail app={a} locked={locked} patch={patch} />
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sameAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setSameAsk(null)}>
          <div className="w-[420px] rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-[14px] font-extrabold">같은 이름의 학생이 이미 명부에 있습니다</div>
            <ul className="mb-3 space-y-1 text-[12px]">
              {sameAsk.hits.map((h, i) => (
                <li key={i} className="rounded bg-slate-50 px-2 py-1">
                  {h.name} · {[h.grade, h.class_name, h.birth_date ? `생일 ${h.birth_date}` : "생일 없음", STATUS_LABEL[h.status] ?? h.status].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
            <p className="mb-3 text-[12px] text-slate-600">
              같은 아이면 닫고 표에서 <b>그 학생을 골라 연결</b>하세요. 정말 다른 아이일 때만 아래를 누릅니다 - 같은 아이가 두 줄이 되면
              나중에 합치는 것밖에 길이 없습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg bg-slate-100 px-3 py-1.5 font-bold" onClick={() => setSameAsk(null)}>
                닫기(넣지 않음)
              </button>
              <button
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white"
                onClick={() => {
                  const app = apps.find((x) => x.id === sameAsk.appId);
                  setSameAsk(null);
                  if (app) void external(app, true);
                }}
              >
                다른 학생 — 외부 학생으로 넣기
              </button>
            </div>
          </div>
        </div>
      )}
      {cancelling && (
        <CancelInvoiceModal
          invoice={cancelling.invoice}
          studentName={cancelling.studentName}
          onDone={() => {
            setCancelling(null);
            router.refresh();
          }}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${warn ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="whitespace-nowrap text-[15px] font-extrabold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function NewCamp({ onMake }: { onMake: (termType: string, year: string) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(CAMP_TYPES.find((t) => t.startsWith("겨울")) ?? CAMP_TYPES[0] ?? "");
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-[12px] font-bold text-slate-600">
        + 캠프 만들기
      </button>
    );
  return (
    <span className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
      <input value={year} onChange={(e) => setYear(e.target.value)} className="w-16 rounded border border-slate-300 px-1 py-0.5 text-[12px]" />
      <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5 text-[12px]">
        {CAMP_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <button
        onClick={() => {
          setOpen(false);
          onMake(type, year.trim());
        }}
        className="rounded bg-slate-800 px-2 py-0.5 text-[12px] font-bold text-white"
      >
        만들기
      </button>
      <button onClick={() => setOpen(false)} className="text-[12px] text-slate-400">
        취소
      </button>
    </span>
  );
}

function AddManual({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <span className="ml-auto flex items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="폼 밖 신청(전화 등) 이름"
        className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
      />
      <button
        disabled={!name.trim()}
        onClick={() => {
          onAdd(name.trim());
          setName("");
        }}
        className="rounded-lg bg-slate-700 px-2 py-1 text-[12px] font-bold text-white disabled:bg-slate-200"
      >
        직접 추가
      </button>
    </span>
  );
}

function LinkStudent({
  app,
  students,
  busy,
  onPick,
  onExternal,
}: {
  app: CampApp;
  students: CampStudent[];
  busy: boolean;
  onPick: (id: string) => void;
  onExternal: () => void;
}) {
  const [q, setQ] = useState("");
  const target = key(app.applicant_name);
  const targetEn = key(app.applicant_name_en);
  // 이름이 같은 학생을 «후보»로만 띄웁니다. 고르는 것은 사람입니다 - 같은 이름이 둘이면 생일·반을 보고 고릅니다.
  const same = students.filter((s) => (target && key(s.name) === target) || (targetEn && key(s.name_en) === targetEn));
  const found = q.trim()
    ? students.filter((s) => key(s.name).includes(key(q)) || key(s.name_en).includes(key(q))).slice(0, 8)
    : [];
  const row = (s: CampStudent) => (
    <button
      key={s.id}
      disabled={busy}
      onClick={() => onPick(s.id)}
      className="block w-full rounded px-1.5 py-0.5 text-left hover:bg-indigo-50"
    >
      <b>{s.name}</b> <span className="text-slate-500">{[s.class_name, s.birth_date && `생일 ${s.birth_date}`, STATUS_LABEL[s.status] ?? s.status].filter(Boolean).join(" · ")}</span>
    </button>
  );
  return (
    <div className="mt-1 space-y-0.5 text-[11px]">
      {same.length > 0 && (
        <div className="rounded border border-emerald-200 bg-emerald-50/60 p-1">
          <div className="text-[10px] font-bold text-emerald-800">명부에 같은 이름 — 같은 아이면 누르세요</div>
          {same.map(row)}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="다른 이름으로 찾기" className="w-28 rounded border border-slate-300 px-1.5 py-0.5" />
        <button disabled={busy || !app.applicant_name} onClick={onExternal} className="rounded bg-sky-600 px-1.5 py-0.5 font-bold text-white disabled:bg-slate-200">
          외부 학생으로 등록
        </button>
      </div>
      {found.length > 0 && <div className="rounded border border-slate-200 bg-white p-1 shadow-sm">{found.map(row)}</div>}
    </div>
  );
}

function Detail({ app, locked, patch }: { app: CampApp; locked: boolean; patch: (id: string, p: Record<string, unknown>) => Promise<unknown> }) {
  const used = readCampForm(app.raw ?? {}).used;
  const [amount, setAmount] = useState(app.amount_override != null ? String(app.amount_override) : "");
  const [memo, setMemo] = useState(app.memo ?? "");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <div className="mb-1 text-[11px] font-bold text-slate-500">폼 원문 (앱이 읽은 칸)</div>
        {Object.keys(app.raw ?? {}).length === 0 ? (
          <div className="text-[11px] text-slate-400">직접 적은 신청이라 원문이 없습니다.</div>
        ) : (
          <table className="w-full text-[11px]">
            <tbody>
              {Object.entries(app.raw).map(([h, v]) => (
                <tr key={h} className="border-t border-slate-100">
                  <td className="w-1/2 py-0.5 pr-2 text-slate-500">
                    {h}
                    {used[h] && <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-bold text-indigo-700">→ {used[h]}</span>}
                  </td>
                  <td className="py-0.5 text-slate-800">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="space-y-2 text-[12px]">
        <label className="flex items-center gap-2">
          <span className="w-24 text-slate-500">금액 직접 정하기</span>
          <input
            disabled={locked}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="비우면 규칙대로"
            className="w-32 rounded border border-slate-300 px-1.5 py-0.5 text-right tabular-nums"
          />
          <button
            disabled={locked}
            onClick={() => patch(app.id, { amount_override: amount ? Number(amount) : null })}
            className="rounded bg-slate-700 px-2 py-0.5 font-bold text-white disabled:bg-slate-200"
          >
            저장
          </button>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-24 text-slate-500">재학생이라고 답함</span>
          <input type="checkbox" disabled={locked} checked={app.says_current} onChange={(e) => patch(app.id, { says_current: e.target.checked })} />
          <span className="text-[11px] text-slate-400">학생을 연결하면 명부의 재학 여부가 이깁니다.</span>
        </label>
        <label className="flex items-start gap-2">
          <span className="w-24 pt-0.5 text-slate-500">메모</span>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="flex-1 rounded border border-slate-300 px-1.5 py-0.5" />
          <button onClick={() => patch(app.id, { memo })} className="rounded bg-slate-700 px-2 py-0.5 font-bold text-white">
            저장
          </button>
        </label>
        <div className="flex gap-2">
          {app.status !== "취소" ? (
            <button
              disabled={locked}
              title={locked ? "청구서가 나간 신청은 청구서를 먼저 취소하세요" : ""}
              onClick={() => window.confirm("이 신청을 취소로 둡니다(지우지 않습니다).") && patch(app.id, { status: "취소" })}
              className="rounded border border-red-200 px-2 py-0.5 text-red-700 disabled:opacity-40"
            >
              신청 취소
            </button>
          ) : (
            <button onClick={() => patch(app.id, { status: "접수" })} className="rounded border border-slate-300 px-2 py-0.5">
              취소 되돌리기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FormLink({
  termId,
  termLabel,
  link,
  open,
  setOpen,
  act,
  busy,
}: {
  termId: string;
  termLabel: string;
  link: { token: string; last_seen_at: string | null; last_result: string | null } | null;
  open: boolean;
  setOpen: (v: boolean) => void;
  act: (p: Record<string, unknown>, ok?: string) => Promise<Record<string, unknown> | null>;
  busy: string | null;
}) {
  const script = link ? appsScript(link.token) : "";
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="font-bold text-slate-700">구글폼 연결</span>
        {link ? (
          <span className={`rounded px-1.5 text-[11px] font-bold ${link.last_seen_at ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {link.last_seen_at
              ? `마지막 수신 ${new Date(link.last_seen_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${link.last_result ?? ""}`
              : "아직 한 번도 안 들어옴"}
          </span>
        ) : (
          <span className="rounded bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600">연결 안 됨</span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">{open ? "접기" : "펼치기"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-2 text-[12px]">
          <ol className="list-decimal space-y-0.5 pl-5 text-slate-600">
            <li>{termLabel} 신청 구글폼의 <b>응답 시트</b>를 엽니다 → 메뉴 «확장 프로그램 › Apps Script».</li>
            <li>가운데 칸을 모두 지우고 아래 스크립트를 붙여넣고 저장합니다.</li>
            <li>함수 고르개에서 <b>설치하기</b>를 골라 ▶ 실행 → 권한 허용. (새 응답이 오면 저절로 보내는 장치가 걸립니다)</li>
            <li>
              함수 고르개에서 <b>지금까지전부보내기</b>를 ▶ 실행 → 이미 들어온 응답이 이 표에 올라옵니다. 몇 번을 눌러도 같은 응답은 한 줄입니다.
            </li>
          </ol>
          <div className="flex items-center gap-2">
            <button
              disabled={busy === "makeLink"}
              onClick={() => {
                if (link && !window.confirm("새로 만들면 지금 스크립트의 토큰은 더 이상 통하지 않습니다. 시트의 스크립트도 새 것으로 바꿔야 합니다.")) return;
                void act({ action: "makeLink", termId }, "새 연결을 만들었습니다. 아래 스크립트를 시트에 붙여넣으세요.");
              }}
              className="rounded-lg bg-slate-800 px-2 py-1 font-bold text-white"
            >
              {link ? "토큰 새로 만들기" : "연결 만들기"}
            </button>
            {link && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(script).then(
                    () => window.alert("스크립트를 복사했습니다."),
                    () => window.alert("복사하지 못했습니다. 아래 칸을 직접 선택해 복사하세요."),
                  );
                }}
                className="rounded-lg border border-slate-300 px-2 py-1 font-bold"
              >
                스크립트 복사
              </button>
            )}
          </div>
          {link && <textarea readOnly value={script} rows={8} className="w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[10px]" />}
          <p className="text-[11px] text-slate-500">
            폼 질문 문구가 바뀌어도 낱말(이름·학년·주·셔틀·형제·재수강·재학 …)로 찾아 읽습니다. 잘못 읽은 줄은 표에서 고치면 되고, 「자세히」에서 어느
            질문을 어느 칸으로 읽었는지 볼 수 있습니다. 폼이 다시 보내도 사람이 고친 값은 덮지 않습니다.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 응답 시트에 붙일 앱스크립트. 리다이렉트를 따라가지 않고, 답이 JSON 이 아니면 실패로 던집니다 - 로그인 화면이
 * 200 으로 돌아와 «성공»으로 보이는 일을 막습니다(CLAUDE.md 2-3).
 */
function appsScript(token: string): string {
  return `// GIA 캠프 신청 → 운영앱 (재무 › 캠프 청구)
const ENDPOINT = '${APP_ORIGIN}/api/camp-intake';
const TOKEN    = '${token}';

function 설치하기() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === '새응답보내기') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('새응답보내기').forSpreadsheet(ss).onFormSubmit().create();
  보내기_({ token: TOKEN, test: true });
  SpreadsheetApp.getActive().toast('연결했습니다. 새 응답이 오면 저절로 보냅니다.');
}

function 새응답보내기(e) {
  const sh = e.range.getSheet();
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = e.range.getRow();
  const values = sh.getRange(row, 1, 1, header.length).getValues()[0];
  보내기_({ token: TOKEN, header: header.map(글자_), rows: [{ row: row, values: values.map(글자_) }] });
}

function 지금까지전부보내기() {
  const sh = 응답시트_();
  const all = sh.getDataRange().getValues();
  const header = all[0].map(글자_);
  const rows = [];
  for (var i = 1; i < all.length; i++) rows.push({ row: i + 1, values: all[i].map(글자_) });
  for (var k = 0; k < rows.length; k += 50) {
    const out = 보내기_({ token: TOKEN, header: header, rows: rows.slice(k, k + 50) });
    Logger.log(JSON.stringify(out));
  }
  SpreadsheetApp.getActive().toast(rows.length + '줄을 보냈습니다.');
}

function 응답시트_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const withForm = ss.getSheets().filter(function (s) { return s.getFormUrl && s.getFormUrl(); });
  return withForm[0] || ss.getActiveSheet();
}

function 글자_(v) {
  if (v instanceof Date) return v.toISOString();
  return v == null ? '' : String(v);
}

function 보내기_(payload) {
  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const code = res.getResponseCode();
  const out = res.getContentText();
  if (code >= 300 && code < 400) throw new Error('주소가 로그인 화면으로 넘깁니다. ENDPOINT 를 확인하세요: ' + ENDPOINT);
  if (out.indexOf('{') !== 0) throw new Error('창구가 아닌 화면이 답했습니다: ' + out.slice(0, 120));
  const json = JSON.parse(out);
  if (!json.ok) throw new Error(json.error || ('실패 ' + code));
  return json;
}
`;
}
