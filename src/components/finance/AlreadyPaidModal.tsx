"use client";

import { useState } from "react";
import {
  batchByDate,
  batchNote,
  mismatch,
  paidMemo,
  remaining,
  resolveAmount,
  sumPicked,
  won,
  type PaidBatch,
  type PayableLine,
} from "@/lib/alreadyPaid";
import { todayKst } from "@/lib/kst";
import { Who } from "@/components/common/HomonymProvider";

/**
 * **이미 받은 돈을 적는 팝업** — 학비·학비외가 함께 씁니다.
 *
 * ── 왜 항목 체크와 금액을 다 두나 ────────────────────────────────────
 *
 * 돈이 들어오는 모양이 두 가지입니다.
 *
 * **항목별로** — 올톡페이는 항목마다 결제 문자가 따로 나갑니다. 교복은 결제했는데 교재는
 * 안 한 집이 생깁니다. 금액만 적으면 「23만원 받음」으로만 남고 **무엇이 남았는지**를
 * 아무도 모릅니다.
 *
 * **금액만** — 미납이 쌓인 집은 「이번엔 30만원만」처럼 나눠 냅니다. 그 돈이 어느 항목의
 * 것인지는 학부모도 정하지 않았고, 우리가 임의로 나누면 틀린 장부가 됩니다.
 *
 * 하나만 받게 만들면 나머지 절반은 늘 손으로 메모하게 되고, **메모는 장부가 아닙니다.**
 *
 * ── 어긋나도 됩니다 ──────────────────────────────────────────────────
 *
 * 항목을 체크하면 금액이 저절로 채워지지만, 고치면 고친 값이 이깁니다. 둘이 다른 것은
 * 오류가 아니라 흔한 일입니다 - 두 항목을 체크했는데 반만 보낸 집이 있습니다. 다르면
 * **그 사실을 그대로 적어** 며칠 뒤 「왜 금액이 안 맞지」가 되지 않게 합니다.
 */

export type AlreadyPaidResult = {
  paidAt: string;
  amount: number;
  method: string;
  memo: string;
  /** 체크한 항목. 부르는 쪽이 「무엇이 남았는지」를 셀 때 씁니다. */
  pickedIds: string[];
  /**
   * **받은 날로 묶은 결과.** 교복은 8/24, 교재비는 8/28에 받은 경우 두 묶음이 됩니다.
   *
   * 부르는 쪽은 묶음마다 청구서를 한 장씩 만듭니다 - 청구서 날짜가 곧 그 돈이 잡히는
   * 달이라, 두 날짜를 한 장에 묶으면 월 마감 숫자가 어긋납니다.
   *
   * 항목을 안 고르고 금액만 적은 경우에는 빈 배열입니다.
   */
  batches: PaidBatch[];
};

const METHODS = ["계좌이체", "카드", "현금", "올톡페이"];

export default function AlreadyPaidModal({
  title,
  studentName,
  lines,
  busy,
  onSubmit,
  onUndoItem,
  onClose,
}: {
  title: string;
  studentName: string;
  /** 이 학생에게 청구되는 항목들. 비어 있으면 금액만 받습니다. */
  lines: PayableLine[];
  busy?: boolean;
  onSubmit: (r: AlreadyPaidResult) => void | Promise<void>;
  /**
   * **이 항목 하나만 되돌리기.** 「받았다」고 적은 것이 사실이 아니었을 때.
   *
   * 되돌리는 일은 부르는 쪽이 합니다 - 이 창은 무엇을 되돌릴지만 알려줍니다. 여기서 직접
   * 창구를 부르면 같은 규칙이 두 곳에 생깁니다.
   */
  onUndoItem?: (line: PayableLine) => void | Promise<void>;
  onClose: () => void;
}) {
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  /**
   * 항목마다 받은 날. **비어 있으면 아래 공통 날짜**를 씁니다.
   *
   * 기본을 공통 날짜로 두는 이유: 같은 날 다 받은 집이 대부분이라, 줄마다 날짜를 찍게
   * 하면 안 바꿔도 되는 것까지 손대게 됩니다. 다른 줄만 고치면 됩니다.
   */
  const [dateOf, setDateOf] = useState<Record<string, string>>({});
  const [typedAmount, setTypedAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayKst());
  const [method, setMethod] = useState(METHODS[0]);
  const [note, setNote] = useState("");

  const input = { pickedIds, typedAmount };
  const amount = resolveAmount(lines, input);
  const m = mismatch(lines, input);
  const left = remaining(lines, pickedIds);
  /** 받은 날로 묶은 결과. 날짜가 하나면 묶음도 하나입니다. */
  const batches = batchByDate(lines, pickedIds.map((id) => ({ id, paidAt: dateOf[id] ?? "" })), paidAt);
  const split = batches.length > 1;
  /**
   * **날짜를 나눠 적었으면 금액 칸은 쓰지 않습니다.**
   *
   * 「8/24에 10만, 8/28에 8만2천」인데 금액 칸에 18만2천을 적으면, 그 숫자가 어느 날의
   * 것인지 알 수 없습니다. 나눠 적는 순간 금액은 **각 묶음의 합**이 답입니다.
   */
  const total = split ? batches.reduce((n, b) => n + b.amount, 0) : amount;

  function toggle(id: string) {
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-8 w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-baseline gap-2">
          <b className="text-sm">💰 {title}</b>
          <span className="text-xs text-slate-500"><Who name={studentName} /></span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            닫기
          </button>
        </div>

        {/* ── 받은 항목 ────────────────────────────────────────────────── */}
        {lines.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-[11px] font-bold text-slate-600">
              받은 항목 <span className="font-normal text-slate-400">— 항목별로 따로 결제된 경우 체크하세요</span>
            </p>
            <div className="space-y-1">
              {lines.map((l) => {
                const on = pickedIds.includes(l.id);
                /**
                 * 이미 청구서에 담겨 있는 항목. **다시 고를 수 없습니다.**
                 *
                 * 고를 수 있게 두면 같은 항목이 두 장에 담기고, 학부모 화면에는 낼 돈이 두
                 * 배로 뜹니다 - 오류가 아니라 「청구된 금액」으로 보입니다.
                 */
                const locked = !!l.lockedNote;
                /**
                 * **잠그지는 않지만 확인이 필요한 줄.** 이름이 같은 항목이 여럿이라 옛
                 * 청구서 줄로는 어느 것이 나갔는지 가릴 수 없습니다. 잠그면 아직 안 받은
                 * 돈이 사라지고, 아무 표시 없이 두면 이미 받은 것을 또 적습니다.
                 */
                const warn = !locked && !!l.warnNote;
                return (
                  <div
                    key={l.id}
                    className={
                      "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition " +
                      (locked
                        ? "border-slate-200 bg-slate-100"
                        : on
                          ? "border-emerald-400 bg-emerald-50"
                          : warn
                            ? "border-amber-300 bg-amber-50/60"
                            : "border-slate-200 bg-white hover:border-slate-300")
                    }
                  >
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => toggle(l.id)}
                      title={locked ? (l.lockedNote ?? undefined) : warn ? (l.warnNote ?? undefined) : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                    >
                      <span className={"text-[13px] " + (locked ? "text-slate-300" : on ? "text-emerald-600" : "text-slate-300")}>
                        {locked ? "▪" : on ? "☑" : "☐"}
                      </span>
                      <span className={locked ? "text-slate-400 line-through" : on ? "font-bold text-emerald-900" : "text-slate-700"}>
                        {l.label}
                      </span>
                      {locked && (
                        <span className="shrink-0 rounded bg-slate-300 px-1 text-[9px] font-bold text-slate-700">
                          {l.lockedNote}
                        </span>
                      )}
                      {/* **항목마다 되돌리기.** 「교복 세트를 받았다」고 적었는데 알고 보니 안
                          받은 경우입니다. 장을 통째로 되돌리는 길만 두면 같은 날 함께 적어둔
                          교재 기록까지 사라집니다. 누르는 자리는 바깥 단추 안이 아니라
                          형제로 두어야 합니다 - 단추 안의 단추는 눌리지 않습니다. */}
                      {warn && (
                        <span className="shrink-0 rounded bg-amber-600 px-1 text-[9px] font-bold text-white" title={l.warnNote ?? undefined}>
                          확인 필요
                        </span>
                      )}
                    </button>
                    {locked && l.undoInvoiceId && onUndoItem && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onUndoItem(l)}
                        title="이 항목을 「받음」으로 적은 것을 적기 전으로 되돌립니다. 다시 미납으로 돌아갑니다."
                        className="shrink-0 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                      >
                        되돌리기 ↩
                      </button>
                    )}
                    {/* **줄마다 받은 날.** 교복은 8/24, 교재비는 8/28처럼 며칠 간격으로 나눠
                        들어오는 일이 흔합니다. 체크한 줄에만 뜹니다 - 안 고른 줄에 날짜 칸이
                        있으면 무엇을 적는 칸인지 헷갈립니다. */}
                    {on && !locked && (
                      <input
                        type="date"
                        value={dateOf[l.id] ?? paidAt}
                        onChange={(e) => setDateOf((v) => ({ ...v, [l.id]: e.target.value }))}
                        title="이 항목을 받은 날. 아래 「받은 날」과 다르면 그 날짜로 따로 만듭니다."
                        className={
                          "shrink-0 rounded border px-1 py-0.5 text-[11px] " +
                          ((dateOf[l.id] ?? paidAt) !== paidAt
                            ? "border-amber-400 bg-amber-50 font-bold text-amber-800"
                            : "border-slate-200 text-slate-500")
                        }
                      />
                    )}
                    <span className={"shrink-0 tabular-nums text-[11px] " + (locked ? "text-slate-400" : "text-slate-500")}>
                      {won(l.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* 아직 안 받은 것을 그 자리에서 보여줍니다. 「무엇이 남았나」가 이 화면을
                여는 이유의 절반입니다. */}
            {split && (
              <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold leading-relaxed text-amber-900">
                🗓 {batchNote(batches)}
              </p>
            )}
            {pickedIds.length > 0 && left.length > 0 && (
              <p className="mt-1 text-[10px] text-amber-700">
                아직 안 받음: {left.map((l) => l.label).join(" · ")} ({won(left.reduce((n, l) => n + l.amount, 0))})
              </p>
            )}
          </div>
        )}

        {/* ── 받은 금액 ────────────────────────────────────────────────── */}
        <div className="mb-2">
          <p className="mb-1 text-[11px] font-bold text-slate-600">
            받은 금액{" "}
            <span className="font-normal text-slate-400">
              {lines.length > 0 ? "— 비워두면 체크한 합. 나눠 받았으면 실제 금액을 적으세요" : "— 실제로 받은 금액"}
            </span>
          </p>
          <input
            value={split ? "" : typedAmount}
            disabled={split}
            onChange={(e) => setTypedAmount(e.target.value)}
            inputMode="numeric"
            placeholder={
              split
                ? "받은 날을 나눠 적었습니다 — 금액은 날짜별 합으로 들어갑니다"
                : pickedIds.length > 0
                  ? `${sumPicked(lines, pickedIds).toLocaleString()} (체크한 합)`
                  : "예: 300000"
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-blue-400 disabled:bg-slate-100 disabled:text-slate-400"
          />
          {/* 체크한 합과 다르면 **그대로 적습니다.** 막지 않습니다 - 실제로 흔한 일입니다. */}
          {m.differs && !split && (
            <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
              체크한 합 {won(m.picked)} 과 다릅니다. {won(m.actual)} 으로 기록하고, 차이는 미납으로 남습니다.
            </p>
          )}
        </div>

        <div className="mb-2 flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            받은 날
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            방법
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
            >
              {METHODS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모 (선택)"
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] outline-none focus:border-blue-400"
        />

        {/* 무엇으로 남는지 미리 보여줍니다. 누른 뒤에 확인하는 것보다 낫습니다. */}
        <p className="mb-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500">
          기록될 내용: <b className="text-slate-700">{won(total)}</b>
          {split ? (
            <>
              {" "}— 청구서 {batches.length}장
              <br />
              {batches.map((b) => `${b.paidAt} · ${b.labels.join(" · ")} ${won(b.amount)}`).join(" / ")}
            </>
          ) : (
            <> · {paidMemo(lines, input, note)}</>
          )}
        </p>

        <button
          type="button"
          disabled={busy || total <= 0}
          onClick={() =>
            void onSubmit({
              paidAt,
              amount: total,
              method,
              memo: paidMemo(lines, input, note),
              pickedIds,
              // 날짜가 하나뿐이어도 묶음을 함께 넘깁니다. 부르는 쪽이 「항목만 담기」를
              // 늘 같은 길로 하게 하려는 것입니다 - 갈래가 둘이면 한쪽만 고쳐집니다.
              batches,
            })
          }
          className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy
            ? "기록 중…"
            : total <= 0
              ? "금액을 적거나 항목을 골라주세요"
              : split
                ? `${won(total)} — 청구서 ${batches.length}장으로 기록`
                : `${won(total)} 받음으로 기록`}
        </button>

        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          청구서는 만들되 학부모에게는 안 나갑니다 — 이미 낸 분께 또 내라고 하는 셈이 되니까요.
        </p>
      </div>
    </div>
  );
}
