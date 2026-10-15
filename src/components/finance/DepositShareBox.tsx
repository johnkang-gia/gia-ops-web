"use client";

import { useCallback, useEffect, useState } from "react";
import StudentSelect, { type SelectableStudent } from "@/components/common/StudentSelect";
import { won } from "@/lib/feeItems";
import type { StatementEvent } from "@/lib/depositStatement";

/**
 * **예치금 공유** — 학생 회계 창의 예치금 칸 위에 붙는 상자.
 *
 * 단추는 「＋ 공유」 하나입니다. 누르면 학생을 검색해 고르고, 몇 명이든 계속 더합니다. 명부의 형제 관계로 미리 제안하지
 * 않습니다 - 함께 쓰는 돈은 형제가 아닌 학생 사이에도 있습니다. 학생은 언제나 **이름**으로 적습니다.
 *
 * 아래에는 예치금 흐름(누가 언제 얼마 넣고, 누구 청구서에 얼마 쓰였고, 그 뒤 얼마 남았나)을 최근 것부터 보여줍니다. 한 학생
 * 청구서에서 쓰고 나면 다른 학생 창을 열자마자 줄어든 잔액과 그 사용이 보여야, 같은 돈을 두 번 빼려 하지 않습니다.
 */

type Member = { id: string; name: string; grade: string | null; className: string | null; deposit: number };
type Data = { share: { id: string; name: string } | null; members: Member[]; balance: number; history: StatementEvent[]; students: SelectableStudent[] };

const md = (d: string) => (d ?? "").slice(5).replace("-", "/");

/** 흐름 한 줄. 「예치금에서 빼기」 창도 같은 모양으로 씁니다. */
export function DepositEventLine({ e }: { e: StatementEvent }) {
  return (
    <li className="flex items-baseline gap-1.5 tabular-nums">
      <span className="w-9 shrink-0 text-slate-400">{md(e.date)}</span>
      <b className="text-slate-700">{e.student}</b>
      {e.kind === "in" ? (
        <span className="text-teal-700">+{won(e.amount)} 입금</span>
      ) : e.kind === "use" ? (
        <span className="text-rose-700">
          −{won(e.amount)} 사용{e.invoiceNo ? <span className="text-slate-400"> ({e.invoiceNo})</span> : null}
        </span>
      ) : (
        <span className="text-slate-600">−{won(e.amount)} 환불</span>
      )}
      <span className="ml-auto shrink-0 text-slate-500">남음 {won(e.balanceAfter)}</span>
    </li>
  );
}

export default function DepositShareBox({
  studentId,
  onChanged,
  onBalance,
  refreshOn,
}: {
  studentId: string;
  /** 바뀌면 다시 읽습니다. 학생 창이 실시간으로 다시 그릴 때(다른 학생 청구서에서 예치금을 쓴 직후 등) 함께 따라옵니다. */
  refreshOn?: unknown;
  onChanged?: () => void;
  /** 함께 쓸 수 있는 예치금(공유면 묶음 합계). 발행할 때 «예치금에서 뺄지 물을까»를 이 값으로 정합니다. */
  onBalance?: (n: number) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [allHistory, setAllHistory] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/finance/deposit-share?studentId=${studentId}`);
    const body = (await res.json().catch(() => ({}))) as Data & { error?: string };
    if (!res.ok) return setErr(body.error ?? "예치금 공유를 읽지 못했습니다.");
    setErr(null);
    setData(body);
    onBalance?.(body.balance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);
  useEffect(() => {
    void load();
  }, [load, refreshOn]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch("/api/finance/deposit-share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId, ...payload }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "저장하지 못했습니다.");
    setPicking(false);
    await load();
    onChanged?.();
  }

  const shared = !!data?.share && (data?.members.length ?? 0) > 1;
  const recent = data ? [...data.history].reverse() : [];
  return (
    <div className="mb-1 rounded-lg border border-teal-200 bg-teal-50/50 px-2 py-1.5 text-[11px]">
      {err && <p className="mb-1 font-bold text-rose-700">{err}</p>}
      {!data && !err && <p className="text-slate-400">예치금을 읽는 중…</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-teal-800">{shared ? "공유 예치금" : "예치금"}</span>
            {shared &&
              data.members.map((m) => (
                <span key={m.id} className="flex items-center gap-0.5 rounded bg-white px-1 ring-1 ring-teal-200">
                  {m.name}
                  <button
                    disabled={busy}
                    onClick={() => void post({ action: "unlink", studentId: m.id })}
                    className="px-0.5 text-slate-400 hover:text-rose-700"
                    title={`${m.name} 학생을 공유에서 뺍니다. ${m.name} 학생 이름으로 들어온 돈은 ${m.name} 학생 앞으로 그대로 남습니다.`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            <b className="tabular-nums text-teal-800">남은 예치금 {won(data.balance)}</b>
            {!picking ? (
              <button disabled={busy} onClick={() => setPicking(true)} className="rounded bg-white px-1.5 py-0.5 font-bold text-teal-800 ring-1 ring-teal-300 hover:bg-teal-100" title="이 예치금을 함께 쓸 학생을 더합니다. 여러 명을 계속 더할 수 있습니다.">
                ＋ 공유
              </button>
            ) : (
              <span className="w-44">
                <StudentSelect
                  students={data.students.filter((s) => !data.members.some((m) => m.id === s.id))}
                  value={null}
                  autoOpen
                  placeholder="함께 쓸 학생 검색…"
                  onChange={(id) => (id ? void post({ action: "link", withStudentId: id }) : setPicking(false))}
                />
              </span>
            )}
            <a href={`/finance/deposits/${studentId}/print`} target="_blank" rel="noreferrer" className="ml-auto rounded bg-teal-700 px-2 py-0.5 font-bold text-white hover:bg-teal-800" title="예치금이 언제 얼마 들어와 누구 이름으로 얼마 쓰였는지 인쇄하거나 PDF로 저장합니다">
              🖨 예치금 내역
            </a>
          </div>
          {recent.length > 0 && (
            <ul className="mt-1 space-y-0.5 border-t border-teal-100 pt-1">
              {(allHistory ? recent : recent.slice(0, 4)).map((e, i) => (
                <DepositEventLine key={i} e={e} />
              ))}
              {recent.length > 4 && (
                <li>
                  <button onClick={() => setAllHistory((v) => !v)} className="text-[10px] text-teal-700 underline">
                    {allHistory ? "접기" : `전체 ${recent.length}줄 보기`}
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
