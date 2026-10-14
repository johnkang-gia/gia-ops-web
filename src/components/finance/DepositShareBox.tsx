"use client";

import { useCallback, useEffect, useState } from "react";
import StudentSelect, { type SelectableStudent } from "@/components/common/StudentSelect";
import { won } from "@/lib/feeItems";

/**
 * **예치금 공유** — 학생 회계 창의 예치금 칸 위에 붙는 한 줄.
 *
 * 묶음이 있으면 «누구와 한 통인지·각자 맡긴 돈·합계»를, 없으면 형제 제안과 «다른 학생과 묶기»를 보여줍니다.
 * 사용내역서(인쇄·PDF)도 여기서 엽니다 - 학부모에게 «어디에 얼마 썼고 얼마 남았나»를 알릴 때 쓰는 종이입니다.
 */

type Member = { id: string; name: string; grade: string | null; className: string | null; deposit: number };
type Data = { share: { id: string; name: string } | null; members: Member[]; balance: number; siblings: { id: string; name: string }[]; students: SelectableStudent[] };

export default function DepositShareBox({
  studentId,
  onChanged,
  onBalance,
}: {
  studentId: string;
  onChanged?: () => void;
  /** 함께 쓸 수 있는 예치금(공유면 묶음 합계). 발행할 때 «예치금에서 뺄지 물을까»를 이 값으로 정합니다. */
  onBalance?: (n: number) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

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
  }, [load]);

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
  return (
    <div className="mb-1 rounded-lg border border-teal-200 bg-teal-50/50 px-2 py-1.5 text-[11px]">
      {err && <p className="mb-1 font-bold text-rose-700">{err}</p>}
      {!data && !err && <p className="text-slate-400">예치금 공유를 읽는 중…</p>}
      {data && (
        <div className="flex flex-wrap items-center gap-1.5">
          {shared ? (
            <>
              <span className="rounded bg-teal-600 px-1.5 py-0.5 font-bold text-white" title="묶음 안 학생들이 한 통의 예치금을 나눠 씁니다">
                공유 · {data.share!.name}
              </span>
              {data.members.map((m) => (
                <span key={m.id} className="rounded bg-white px-1 ring-1 ring-teal-200">
                  {m.name} <span className="tabular-nums text-teal-700">{won(m.deposit)}</span>
                </span>
              ))}
              <b className="tabular-nums text-teal-800">= 함께 쓸 수 있는 {won(data.balance)}</b>
              <button disabled={busy} onClick={() => void post({ action: "unlink" })} className="text-[10px] text-slate-500 underline hover:text-rose-700" title="이 학생만 묶음에서 뺍니다. 각자 맡긴 돈은 그대로 각자 앞으로 남습니다.">
                이 학생 공유 풀기
              </button>
            </>
          ) : (
            <>
              <span className="text-slate-600">예치금 공유 없음</span>
              {data.siblings.map((s) => (
                <button key={s.id} disabled={busy} onClick={() => void post({ action: "link", withStudentId: s.id })} className="rounded bg-white px-1.5 py-0.5 font-bold text-teal-800 ring-1 ring-teal-300 hover:bg-teal-100" title="명부의 형제입니다. 누르면 예치금을 한 통으로 묶습니다">
                  ＋ 형제 {s.name}와 공유
                </button>
              ))}
            </>
          )}
          {!picking ? (
            <button disabled={busy} onClick={() => setPicking(true)} className="rounded bg-white px-1.5 py-0.5 text-teal-800 ring-1 ring-teal-200 hover:bg-teal-100">
              ＋ 다른 학생과 공유
            </button>
          ) : (
            <span className="w-44">
              <StudentSelect students={data.students.filter((s) => !data.members.some((m) => m.id === s.id))} value={null} autoOpen placeholder="함께 쓸 학생…" onChange={(id) => (id ? void post({ action: "link", withStudentId: id }) : setPicking(false))} />
            </span>
          )}
          <a href={`/finance/deposits/${studentId}/print`} target="_blank" rel="noreferrer" className="ml-auto rounded bg-teal-700 px-2 py-0.5 font-bold text-white hover:bg-teal-800" title="입금·차감·남은 금액을 청구서와 같은 양식으로 인쇄하거나 PDF로 저장합니다">
            🖨 예치금 사용내역서
          </a>
        </div>
      )}
    </div>
  );
}
