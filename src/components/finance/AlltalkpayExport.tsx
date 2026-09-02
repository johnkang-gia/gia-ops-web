"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import { DEFAULT_HEADERS, prettyPhone, toAoa, type BillPlan, type HeaderMap } from "@/lib/alltalkpay";

// 올톡페이 대량발송 엑셀 만들기.
//
// 올톡페이에는 공개 API가 없습니다. 자동으로 청구서를 쏘아 보낼 방법이 없다는 뜻입니다.
// 그래서 이 창이 하는 일은 **올려도 되는 파일을 만들어 주는 것**까지입니다. 올리는 것은
// 사람이 올톡페이 화면에서 합니다.
//
// 파일을 만들기 전에 세 가지를 먼저 보여줍니다. 올린 뒤에는 되돌릴 수 없기 때문입니다.
//   · 연락처가 없어서 빠지는 아이 - 빈 칸으로 섞여 올라가면 그 아이만 조용히 청구가 안 갑니다.
//   · 보호자 번호가 같은 아이들 - 합치지 않으면 그 집에 청구서가 두 번 갑니다.
//   · 이미 한 번 내보낸 청구서 - 다시 올리면 학부모에게 두 번 갑니다.

const HEADER_KEY = "gia.alltalkpay.headers";
const LOGIN_URL = "https://alltalkpay.co.kr/login.do";

type Props = {
  invoiceIds: string[];
  /** 창을 닫을 때. 부모가 상태를 지웁니다. */
  onClose: () => void;
  /** 내보낸 표시가 남은 뒤 명단을 새로 읽도록. */
  onMarked?: (ids: string[]) => void;
};

export default function AlltalkpayExport({ invoiceIds, onClose, onMarked }: Props) {
  const notify = useToast();
  const [merge, setMerge] = useState(false);
  const [plan, setPlan] = useState<BillPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [headOpen, setHeadOpen] = useState(false);
  const [headers, setHeaders] = useState<HeaderMap>({ ...DEFAULT_HEADERS });

  // 올톡페이 업로드 양식의 머리글이 가맹점마다 다를 수 있습니다. 한 번 맞춰두면 이 브라우저에
  // 남습니다 - 매번 고쳐 쓰게 두면 결국 안 맞는 파일을 올리게 됩니다.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HEADER_KEY);
      if (raw) setHeaders({ ...DEFAULT_HEADERS, ...(JSON.parse(raw) as Partial<HeaderMap>) });
    } catch {
      // 저장된 값이 깨졌으면 기본값으로 갑니다. 화면이 안 뜨는 것보다 낫습니다.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    setErr(null);
    void (async () => {
      const res = await fetch("/api/finance/export/alltalkpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds, mergeSiblings: merge }),
      });
      const json = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok) setErr(json?.error ?? "명단을 만들지 못했습니다.");
      else setPlan(json.plan as BillPlan);
    })();
    return () => {
      alive = false;
    };
  }, [invoiceIds, merge]);

  const resent = useMemo(() => (plan?.rows ?? []).filter((r) => r.resent).length, [plan]);

  function saveHeaders(next: HeaderMap) {
    setHeaders(next);
    try {
      localStorage.setItem(HEADER_KEY, JSON.stringify(next));
    } catch {
      notify("머리글을 이 브라우저에 저장하지 못했습니다. 이번만 적용됩니다.", "error");
    }
  }

  async function download() {
    if (!plan || plan.rows.length === 0) return;
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(toAoa(plan.rows, headers));
      // 번호 칸은 글자로 굳힙니다. 숫자로 두면 엑셀이 앞의 0을 지워 01012345678이 1012345678이 됩니다.
      for (let r = 1; r <= plan.rows.length; r++) {
        const ref = XLSX.utils.encode_cell({ c: 1, r });
        if (ws[ref]) ws[ref].t = "s";
      }
      ws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 34 }, { wch: 12 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "청구");
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      XLSX.writeFile(wb, `올톡페이_청구_${today}_${plan.rows.length}건.xlsx`);

      // 파일이 내려간 뒤에 표시를 남깁니다. 먼저 남기면, 파일 만들기가 실패했을 때
      // 보내지도 않은 것이 '보냄'으로 굳습니다.
      const ids = plan.rows.flatMap((r) => r.invoiceIds);
      const res = await fetch("/api/finance/export/alltalkpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: ids, mark: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) notify(json?.error ?? "내보낸 표시를 남기지 못했습니다.", "error");
      else {
        onMarked?.(ids);
        notify(`${plan.rows.length}줄을 내려받았습니다. 올톡페이에서 올려주세요.`, "success");
      }
    } catch (e) {
      notify("파일을 만들지 못했습니다: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <span className="text-base font-black text-slate-800">📤 올톡페이 발송 파일</span>
          <span className="text-[11px] text-slate-400">청구서 {invoiceIds.length}건</span>
          <button onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            올톡페이는 <b>엑셀을 올려서</b> 청구서를 보냅니다(외부에서 자동으로 쏘아 보낼 방법이 없습니다).
            여기서 파일을 만들어 내려받은 뒤, 올톡페이 화면의 <b>대량발송</b>에서 그 파일을 올리시면 됩니다.
          </p>

          {err && <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">{err}</p>}
          {!plan && !err && <p className="py-10 text-center text-[12px] text-slate-400">명단을 만드는 중…</p>}

          {plan && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]">
                  <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
                  <span>
                    형제 <b>한 장으로</b> 합치기
                  </span>
                </label>
                <span className="text-[11px] text-slate-400">
                  보호자 번호가 같은 묶음 {plan.sharedPhones.length}쌍 · 합치지 않으면 그 집에 청구서가 두 번 갑니다
                </span>
              </div>

              {plan.missing.length > 0 && (
                <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3">
                  <p className="mb-1 text-[12px] font-bold text-orange-900">
                    연락처가 없어 파일에서 빠지는 학생 {plan.missing.length}명
                  </p>
                  <p className="mb-2 text-[11px] text-orange-800">
                    빈 칸으로 올리면 그 아이만 청구서가 안 갑니다. 학생 명부의 <b>보호자 연락처</b>를 채운 뒤 다시 여세요.
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {plan.missing.map((m) => (
                      <li key={m.invoiceNo} className="rounded border border-orange-200 bg-white px-1.5 py-0.5 text-[11px] text-orange-900">
                        {m.name} <span className="opacity-60">{m.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {resent > 0 && (
                <p className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
                  이미 한 번 내보낸 청구서가 <b>{resent}건</b> 섞여 있습니다. 그대로 올리면 학부모에게 두 번 갑니다.
                </p>
              )}

              <div className="mb-2 flex items-center gap-2">
                <span className="text-[12px] font-bold text-slate-700">보낼 줄 {plan.rows.length}개</span>
                <span className="text-[13px] font-black tabular-nums text-slate-800">{won(plan.total)}</span>
                <button onClick={() => setHeadOpen((v) => !v)} className="ml-auto text-[11px] font-semibold text-slate-500 underline">
                  머리글 바꾸기
                </button>
              </div>

              {headOpen && (
                <div className="mb-3 rounded-lg border border-slate-200 p-2">
                  <p className="mb-1.5 text-[11px] text-slate-500">
                    올톡페이 업로드 양식의 열 이름과 다르면 여기서 맞춰주세요. 이 브라우저에 기억됩니다.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {(Object.keys(DEFAULT_HEADERS) as (keyof HeaderMap)[]).map((k) => (
                      <input
                        key={k}
                        value={headers[k]}
                        onChange={(e) => saveHeaders({ ...headers, [k]: e.target.value })}
                        className="rounded border border-slate-200 px-2 py-1 text-[12px]"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-[11px] text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">{headers.name}</th>
                      <th className="px-2 py-1 text-left">{headers.phone}</th>
                      <th className="px-2 py-1 text-right">{headers.amount}</th>
                      <th className="px-2 py-1 text-left">{headers.memo}</th>
                      <th className="px-2 py-1 text-left">{headers.due}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r) => (
                      <tr key={r.invoiceNos.join(",")} className={"border-t border-slate-100 " + (r.resent ? "bg-rose-50" : "")}>
                        <td className="px-2 py-1 font-semibold text-slate-800">
                          {r.name}
                          {r.resent && <span className="ml-1 text-[10px] font-bold text-rose-600">보낸 적 있음</span>}
                        </td>
                        <td className="px-2 py-1 tabular-nums text-slate-600">{prettyPhone(r.phone)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-bold text-slate-800">{won(r.amount)}</td>
                        <td className="px-2 py-1 text-slate-500">{r.memo}</td>
                        <td className="px-2 py-1 tabular-nums text-slate-500">{r.dueDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 p-3">
          <a
            href={LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold text-slate-700"
          >
            올톡페이 열기 ↗
          </a>
          <button
            onClick={() => void download()}
            disabled={busy || !plan || plan.rows.length === 0}
            className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? "만드는 중…" : `엑셀 내려받기 (${plan?.rows.length ?? 0}줄)`}
          </button>
        </div>
      </div>
    </div>
  );
}
