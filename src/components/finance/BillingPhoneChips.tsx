"use client";

import { useCallback, useEffect, useState } from "react";
import { prettyPhone, type GuardianRole } from "@/lib/alltalkpay";

/**
 * **청구 번호 고르기·바꾸기** — 올톡으로 청구서가 실제로 나가는 번호.
 *
 * 역할 이름(M·F)만 보여주면 사람이 그게 맞는 번호인지 판단할 수 없어서, 번호 자체를 칩으로
 * 늘어놓고 누르면 고릅니다. 명부에 없는 번호는 [+ 번호]로 바로 적습니다. 번호를 바꾸려고
 * 학생 명부 화면까지 가야 하면 담당자는 올톡페이 화면에서 따로 보내 버리고, 그러면 앱에는
 * 「안 보냄」으로 남습니다.
 *
 * 저장은 `/api/finance/billing-phone` 한 곳입니다(재무 권한 확인 후 서비스 키로 씀).
 */

export const ROLE_NAME: Record<GuardianRole, string> = { direct: "결제", mother: "어머니", father: "아버지", guardian: "보호자" };

export async function saveBillingPhone(studentId: string, role: GuardianRole | null, phone?: string): Promise<string | null> {
  const res = await fetch("/api/finance/billing-phone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, role, phone: phone ?? "" }),
  });
  if (res.ok) return null;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? "결제번호를 저장하지 못했습니다.";
}

export default function BillingPhoneChips({
  options,
  current,
  busy,
  onPick,
  onNew,
  compact = false,
}: {
  /** 명부에 실제로 있는 번호. */
  options: { role: GuardianRole; phone: string }[];
  /** 지금 나가는 번호의 역할. */
  current: GuardianRole | "manual" | null;
  busy?: boolean;
  onPick: (role: GuardianRole) => void;
  /** 새 번호를 적었을 때. 저장은 부르는 쪽이 합니다(학생이 여럿일 수 있음). */
  onNew: (phone: string) => void;
  compact?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const submit = () => {
    const d = val.replace(/\D/g, "");
    if (d.length < 10) return;
    onNew(d);
    setVal("");
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((o) => {
        const on = current === o.role;
        return (
          <button
            key={o.role}
            type="button"
            disabled={busy}
            onClick={() => onPick(o.role)}
            title={`${ROLE_NAME[o.role]} 번호로 보냅니다`}
            className={
              "rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition disabled:opacity-40 " +
              (on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")
            }
          >
            {ROLE_NAME[o.role]}
            {!compact && <span className="ml-1 font-normal">{prettyPhone(o.phone)}</span>}
          </button>
        );
      })}
      {current === "manual" && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800" title="청구서를 만들 때 굳혀 둔 번호입니다">
          청구서에 적힌 번호
        </span>
      )}
      {adding ? (
        <span className="flex items-center gap-0.5">
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="010-0000-0000"
            inputMode="tel"
            className="w-28 rounded border border-slate-300 px-1 py-0.5 text-[11px] tabular-nums"
          />
          <button type="button" onClick={submit} disabled={busy || val.replace(/\D/g, "").length < 10} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-40">
            저장
          </button>
        </span>
      ) : (
        <button type="button" disabled={busy} onClick={() => setAdding(true)} className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:border-slate-500" title="명부에 없는 번호(결제 담당자 등)를 이 학생의 청구 번호로 저장합니다">
          + 번호
        </button>
      )}
    </div>
  );
}

/**
 * 학생 한 명의 청구 번호를 스스로 읽어 보여주고 바꾸는 줄. 학생 회계 창 머리에 둡니다 -
 * 청구서를 만들고 보내는 그 창에서 「누구 번호로 가는지」가 보여야 보내기 전에 고칩니다.
 */
export function StudentBillingPhone({ studentId }: { studentId: string }) {
  const [data, setData] = useState<{ current: GuardianRole | null; options: { role: GuardianRole; phone: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/finance/billing-phone?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as { error?: string; current: GuardianRole | null; options: { role: GuardianRole; phone: string }[] } | null;
    if (!res.ok || !json) setErr(json?.error ?? "청구 번호를 읽지 못했습니다.");
    else {
      setErr(null);
      setData(json);
    }
  }, [studentId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(role: GuardianRole, phone?: string) {
    setBusy(true);
    try {
      const e = await saveBillingPhone(studentId, role, phone);
      if (e) setErr(e);
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      <span className="font-bold text-slate-500">청구 번호</span>
      {err && <span className="font-bold text-rose-600">{err}</span>}
      {data && data.options.length === 0 && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-800">번호 없음 — 올톡으로 못 보냅니다</span>}
      {data && (
        <BillingPhoneChips options={data.options} current={data.current} busy={busy} onPick={(r) => void save(r)} onNew={(p) => void save("direct", p)} />
      )}
    </div>
  );
}
