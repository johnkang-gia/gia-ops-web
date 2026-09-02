"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import {
  COLUMNS,
  COLUMN_WIDTHS,
  DEFAULT_DUE_HOUR,
  ROLE_LABEL,
  ROLE_SHORT,
  SHEET_NAME,
  prettyPhone,
  toAoa,
  type BillPlan,
  type GuardianRole,
} from "@/lib/alltalkpay";

// 올톡페이 대량발송 엑셀 만들기.
//
// 올톡페이에는 공개 API가 없습니다. 자동으로 청구서를 쏘아 보낼 방법이 없다는 뜻입니다.
// 그래서 이 창이 하는 일은 **그대로 올릴 수 있는 파일을 만들어 주는 것**까지입니다. 올리는
// 것은 사람이 올톡페이 화면에서 합니다.
//
// 파일은 올톡페이가 준 '청구서등록' 양식과 열 이름·순서까지 같습니다. 손댈 것 없이 바로
// 올리시면 됩니다.
//
// 만들기 전에 네 가지를 먼저 보여줍니다. 올린 뒤에는 되돌릴 수 없기 때문입니다.
//   · 누구 앞으로 가는지 - 어머니/아버지/보호자. 집마다 결제하는 분이 다릅니다.
//   · 연락처가 없어서 빠지는 아이 - 빈 칸으로 섞이면 그 아이만 조용히 청구가 안 갑니다.
//   · 보호자 번호가 같은 아이들 - 합치지 않으면 그 집에 청구서가 두 번 갑니다.
//   · 이미 한 번 내보낸 청구서 - 다시 올리면 학부모에게 두 번 갑니다.

const HOUR_KEY = "gia.alltalkpay.dueHour";
const LOGIN_URL = "https://alltalkpay.co.kr/login.do";

/** 고를 수 있는 결제만료시간. 새벽 시간은 뺍니다 - 그 시각을 고르는 경우가 없습니다. */
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8); // 08시 ~ 23시

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
  const [dueHour, setDueHour] = useState<number>(DEFAULT_DUE_HOUR);
  /** 청구서마다 바꾼 대상. 서버로 함께 보내 명단을 다시 만듭니다. */
  const [roles, setRoles] = useState<Record<string, GuardianRole>>({});

  // 결제만료시간은 학교마다 정해두고 계속 쓰는 값이라 이 브라우저에 기억해 둡니다.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HOUR_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isInteger(n) && n >= 0 && n <= 23) setDueHour(n);
    } catch {
      // 저장된 값이 깨졌으면 기본값으로 갑니다. 창이 안 뜨는 것보다 낫습니다.
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
        body: JSON.stringify({ invoiceIds, mergeSiblings: merge, roleOverrides: roles }),
      });
      const json = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok) setErr(json?.error ?? "명단을 만들지 못했습니다.");
      else setPlan(json.plan as BillPlan);
    })();
    return () => {
      alive = false;
    };
  }, [invoiceIds, merge, roles]);

  const resent = useMemo(() => (plan?.rows ?? []).filter((r) => r.resent).length, [plan]);

  function pickHour(h: number) {
    setDueHour(h);
    try {
      localStorage.setItem(HOUR_KEY, String(h));
    } catch {
      // 기억해 두지 못해도 이번 파일에는 그대로 적용됩니다.
    }
  }

  /** 한 줄의 대상을 바꿉니다. 형제를 합친 줄이면 그 줄에 묶인 청구서 전부에 적용합니다. */
  function setRole(invoiceIds: string[], role: GuardianRole) {
    setRoles((prev) => {
      const next = { ...prev };
      for (const id of invoiceIds) next[id] = role;
      return next;
    });
  }

  async function download() {
    if (!plan || plan.rows.length === 0) return;
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(toAoa(plan.rows, { dueHour }));

      // 번호 칸(C열)은 글자로 굳힙니다. 숫자로 두면 엑셀이 앞의 0을 지워 01012345678이
      // 1012345678이 되고, 올톡페이는 그 번호로 못 보냅니다.
      for (let r = 1; r <= plan.rows.length; r++) {
        const phone = XLSX.utils.encode_cell({ c: 2, r });
        if (ws[phone]) {
          ws[phone].t = "s";
          ws[phone].z = "@";
        }
        // 금액은 양식과 같은 천단위 표시로 둡니다.
        const amount = XLSX.utils.encode_cell({ c: 3, r });
        if (ws[amount]) ws[amount].z = "#,##0";
      }

      ws["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new();
      // 시트 이름까지 양식과 같게 둡니다.
      XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      XLSX.writeFile(wb, `올톡페이_청구서등록_${today}_${plan.rows.length}건.xlsx`);

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
        notify(`${plan.rows.length}줄을 내려받았습니다. 올톡페이 대량발송에 그대로 올리세요.`, "success");
      }
    } catch (e) {
      notify("파일을 만들지 못했습니다: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <span className="text-base font-black text-slate-800">📤 올톡페이 발송 파일</span>
          <span className="text-[11px] text-slate-400">청구서 {invoiceIds.length}건</span>
          <button onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            올톡페이가 준 <b>청구서등록 양식</b>과 열 이름·순서가 같은 파일을 만듭니다. 내려받아
            올톡페이 화면의 <b>대량발송</b>에 <b>그대로 올리시면 됩니다</b> — 열을 고치거나 옮길
            필요가 없습니다.
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

                <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]">
                  <span className="text-slate-500">결제만료시간</span>
                  <select
                    value={dueHour}
                    onChange={(e) => pickHour(Number(e.target.value))}
                    className="rounded border border-slate-200 px-1.5 py-0.5 text-[12px]"
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}시
                      </option>
                    ))}
                  </select>
                </label>

                <span className="text-[11px] text-slate-400">
                  번호가 같은 묶음 {plan.sharedPhones.length}쌍 · 합치지 않으면 그 집에 청구서가 두 번 갑니다
                </span>
              </div>

              {plan.missing.length > 0 && (
                <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3">
                  <p className="mb-1 text-[12px] font-bold text-orange-900">
                    연락처가 없어 파일에서 빠지는 학생 {plan.missing.length}명
                  </p>
                  <p className="mb-2 text-[11px] text-orange-800">
                    빈 칸으로 올리면 그 아이만 청구서가 안 갑니다. 학생 명부의{" "}
                    <b>어머니·아버지·보호자</b> 칸 중 하나를 채운 뒤 다시 여세요.
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {plan.missing.map((m) => (
                      <li key={m.invoiceId} className="rounded border border-orange-200 bg-white px-1.5 py-0.5 text-[11px] text-orange-900">
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
                <span className="ml-auto text-[11px] text-slate-400">
                  대상을 눌러 어머니 ↔ 아버지 ↔ 보호자로 바꿀 수 있습니다
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-[11px] text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">{COLUMNS[1]}</th>
                      <th className="px-2 py-1 text-left">대상</th>
                      <th className="px-2 py-1 text-left">{COLUMNS[2]}</th>
                      <th className="px-2 py-1 text-right">{COLUMNS[3]}</th>
                      <th className="px-2 py-1 text-left">{COLUMNS[0]}</th>
                      <th className="px-2 py-1 text-left">{COLUMNS[4]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r) => (
                      <tr key={r.invoiceIds.join(",")} className={"border-t border-slate-100 " + (r.resent ? "bg-rose-50" : "")}>
                        <td className="px-2 py-1 font-semibold text-slate-800">
                          {r.name}
                          {r.resent && <span className="ml-1 text-[10px] font-bold text-rose-600">보낸 적 있음</span>}
                        </td>
                        <td className="px-2 py-1">
                          {/*
                            대상 바꾸기. 명부에 그 칸이 비어 있으면 골라도 소용이 없으므로,
                            고른 뒤 실제로 어느 번호가 쓰였는지는 옆의 번호가 말해 줍니다.
                          */}
                          <div className="flex gap-0.5">
                            {(["mother", "father", "guardian"] as GuardianRole[]).map((role) => {
                              const on = r.role === role;
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => setRole(r.invoiceIds, role)}
                                  title={ROLE_LABEL[role]}
                                  className={
                                    "rounded px-1.5 py-0.5 text-[10px] font-bold transition " +
                                    (on
                                      ? "bg-slate-800 text-white"
                                      : "bg-slate-100 text-slate-500 hover:bg-slate-200")
                                  }
                                >
                                  {ROLE_SHORT[role]}
                                </button>
                              );
                            })}
                            {r.role === "manual" && (
                              <span
                                className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                                title="명부에 없는 번호입니다 - 발행할 때 굳혀 둔 번호를 씁니다"
                              >
                                직접입력
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1 tabular-nums text-slate-600">{prettyPhone(r.phone)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-bold text-slate-800">{won(r.amount)}</td>
                        <td className="px-2 py-1 text-slate-500">{r.memo}</td>
                        <td className="px-2 py-1 tabular-nums text-slate-500">
                          {r.dueDate} {String(dueHour).padStart(2, "0")}시
                        </td>
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
