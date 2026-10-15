"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import BillingPhoneChips, { saveBillingPhone } from "@/components/finance/BillingPhoneChips";
import { COLUMNS, COLUMN_WIDTHS, DEFAULT_DUE_HOUR, SHEET_NAME, PAY_WINDOW_DAYS, payExpiryDate, prettyPhone, toAoa, type BillPlan, type GuardianRole } from "@/lib/alltalkpay";

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
  /**
   * **결제만료일자** — 이 파일을 만드는 날 기준 이레 뒤.
   *
   * 예전에는 청구서의 납부 기한을 그대로 넣었습니다. 그 기한은 발행한 날 정해진 것이라,
   * 며칠 지나 다시 보내거나 밀린 건을 모아 보내면 **이미 지난 날짜**가 파일에 들어갑니다.
   * 학부모는 결제창을 열자마자 만료라 아무것도 못 내는데, 우리 화면에는 「보냈음」으로
   * 남아서 아무도 못 찾습니다.
   *
   * 화면에서 열 때 한 번 정합니다 - 창을 열어둔 채 자정을 넘기는 일은 드물고, 파일 안의
   * 모든 줄이 같은 날짜여야 어느 줄이 먼저 닫히는지 셀 수 있습니다.
   */
  const expiryDate = useMemo(
    // kst-ok: 브라우저에서 도는 화면이고, 담당자가 보는 「오늘」이 한국 날짜입니다.
    () => payExpiryDate(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })),
    [],
  );
  /** 청구서마다 바꾼 대상. 서버로 함께 보내 명단을 다시 만듭니다. */
  const [roles, setRoles] = useState<Record<string, GuardianRole>>({});
  /**
   * 고른 번호를 **학생의 청구 번호로도 저장**할지. 기본은 켜 둡니다 - 이번 파일에서만 바꾸고
   * 저장하지 않으면 다음 달에 또 같은 번호를 고쳐야 하고, 그러다 올톡페이 화면에서 따로 보내게 됩니다.
   */
  const [saveDefault, setSaveDefault] = useState(true);
  /** 번호를 새로 저장했을 때 명단을 다시 읽게 하는 번호. */
  const [reloadKey, setReloadKey] = useState(0);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [missingInput, setMissingInput] = useState<Record<string, string>>({});

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
  }, [invoiceIds, merge, roles, reloadKey]);

  const resent = useMemo(() => (plan?.rows ?? []).filter((r) => r.resent).length, [plan]);

  function pickHour(h: number) {
    setDueHour(h);
    try {
      localStorage.setItem(HOUR_KEY, String(h));
    } catch {
      // 기억해 두지 못해도 이번 파일에는 그대로 적용됩니다.
    }
  }

  /** 번호 칩을 눌렀을 때. 이번 파일에 적용하고, 켜져 있으면 학생 청구 번호로도 저장합니다. */
  async function pickRole(invoiceIds: string[], studentIds: string[], role: GuardianRole) {
    setRole(invoiceIds, role);
    if (!saveDefault || studentIds.length === 0) return;
    setPhoneBusy(true);
    try {
      const errs = (await Promise.all(studentIds.map((id) => saveBillingPhone(id, role)))).filter(Boolean);
      if (errs.length) notify(`이번 파일에는 적용했지만 청구 번호로 저장하지 못했습니다: ${errs[0]}`, "error");
    } finally {
      setPhoneBusy(false);
    }
  }

  /** 새 번호를 적었을 때. 학생의 「결제」 번호로 저장하고 그 번호로 보냅니다. */
  async function addPhone(invoiceIds: string[], studentIds: string[], phone: string) {
    if (studentIds.length === 0) {
      notify("학생이 연결되지 않은 청구서라 번호를 저장할 곳이 없습니다.", "error");
      return;
    }
    setPhoneBusy(true);
    try {
      const errs = (await Promise.all(studentIds.map((id) => saveBillingPhone(id, "direct", phone)))).filter(Boolean);
      if (errs.length) {
        notify(`번호를 저장하지 못했습니다: ${errs[0]}`, "error");
        return;
      }
      setRole(invoiceIds, "direct");
      setReloadKey((k) => k + 1);
      notify("청구 번호로 저장했습니다. 다음 청구부터도 이 번호로 나갑니다.", "success");
    } finally {
      setPhoneBusy(false);
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
      const ws = XLSX.utils.aoa_to_sheet(toAoa(plan.rows, { dueHour, expiryDate }));

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
          <span className="text-base font-black text-slate-800">📤 올톡 보내기</span>
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

                {/* **만료일자는 고르는 값이 아닙니다.** 보내는 날 기준 이레로 고정합니다 -
                    고를 수 있게 두면 지난 날짜를 그대로 두고 보내는 날이 옵니다. */}
                <span
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[12px] text-slate-600"
                  title={`오늘부터 ${PAY_WINDOW_DAYS}일 동안 결제할 수 있습니다. 청구서의 납부 기한과 따로입니다 - 지난 건을 다시 보내도 결제창이 열려 있어야 합니다.`}
                >
                  결제만료일자 <b className="tabular-nums text-slate-800">{expiryDate}</b>
                  <span className="ml-1 text-slate-400">(오늘+{PAY_WINDOW_DAYS}일)</span>
                </span>

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
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-[12px] text-sky-900" title="끄면 이번 파일에서만 바뀝니다">
                  <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
                  고른 번호를 학생 청구 번호로 저장
                </label>
              </div>

              {plan.missing.length > 0 && (
                <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3">
                  <p className="mb-1 text-[12px] font-bold text-orange-900">
                    연락처가 없어 파일에서 빠지는 학생 {plan.missing.length}명
                  </p>
                  <p className="mb-2 text-[11px] text-orange-800">
                    빈 칸으로 올리면 그 아이만 청구서가 안 갑니다. 여기서 번호를 적으면 그 학생의 청구 번호로 저장되고 바로 명단에 들어갑니다.
                  </p>
                  <ul className="flex flex-col gap-1">
                    {plan.missing.map((m) => (
                      <li key={m.invoiceId} className="flex flex-wrap items-center gap-1.5 rounded border border-orange-200 bg-white px-2 py-1 text-[11px] text-orange-900">
                        <b>{m.name}</b> <span className="opacity-60">{m.reason}</span>
                        {m.studentId && (
                          <span className="ml-auto flex items-center gap-1">
                            <input
                              value={missingInput[m.invoiceId] ?? ""}
                              onChange={(e) => setMissingInput((p) => ({ ...p, [m.invoiceId]: e.target.value }))}
                              placeholder="010-0000-0000"
                              inputMode="tel"
                              className="w-28 rounded border border-orange-300 px-1 py-0.5 tabular-nums"
                            />
                            <button
                              type="button"
                              disabled={phoneBusy || (missingInput[m.invoiceId] ?? "").replace(/\D/g, "").length < 10}
                              onClick={() => void addPhone([m.invoiceId], [m.studentId!], (missingInput[m.invoiceId] ?? "").replace(/\D/g, ""))}
                              className="rounded bg-orange-600 px-2 py-0.5 font-bold text-white disabled:opacity-40"
                            >
                              번호 저장
                            </button>
                          </span>
                        )}
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
                  누구 번호로 보낼지 눌러 바꾸고, 없는 번호는 「+ 번호」로 바로 적으세요
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
                          {/*
                            **합친 줄에는 합본 청구서로 가는 길을 둡니다.**

                            금액은 한 줄로 합쳐져 나가는데 종이 청구서는 아이마다 따로여서, 그 집은
                            어느 아이 몫이 얼마인지 알 수 없었습니다. 합본은 한 장 안에서 아이별
                            내역과 소계를 보여줍니다. 합친 줄에만 답니다 - 한 명짜리는 원래 청구서가
                            그대로 그 아이 것입니다.
                          */}
                          {r.invoiceIds.length > 1 && (
                            <a
                              href={`/finance/invoices/${r.invoiceIds[0]}/print?also=${r.invoiceIds.slice(1).join(",")}`}
                              target="_blank"
                              rel="noreferrer"
                              title="한 장 안에 아이별 내역과 소계를 나눠 담은 청구서입니다."
                              className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-200"
                            >
                              합본 청구서
                            </a>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {/*
                            대상 바꾸기. 명부에 그 칸이 비어 있으면 골라도 소용이 없으므로,
                            고른 뒤 실제로 어느 번호가 쓰였는지는 옆의 번호가 말해 줍니다.
                          */}
                          <BillingPhoneChips
                            options={r.options}
                            current={r.role}
                            busy={phoneBusy}
                            compact
                            onPick={(role) => void pickRole(r.invoiceIds, r.studentIds, role)}
                            onNew={(phone) => void addPhone(r.invoiceIds, r.studentIds, phone)}
                          />
                        </td>
                        <td className="px-2 py-1 tabular-nums text-slate-600">{prettyPhone(r.phone)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-bold text-slate-800">{won(r.amount)}</td>
                        <td className="px-2 py-1 text-slate-500">{r.memo}</td>
                        <td className="px-2 py-1 tabular-nums text-slate-500">
                          {expiryDate} {String(dueHour).padStart(2, "0")}시
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
