"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildReport, GROUP_LABEL, GROUP_NOTE, levelMark, worstOf, type CheckResult, type InspectGroup } from "@/lib/inspect";

/**
 * 점검 결과 화면.
 *
 * **복사가 이 화면의 절반입니다.** 문제를 찾아도 옮겨 적는 데서 사라집니다 - 사진을 찍어
 * 보내면 표 이름을 다시 쳐야 하고, 그 과정에서 글자가 틀립니다. 여기서는 글자 그대로
 * 가져갑니다.
 *
 * 묶음 순서는 **보호 → 데이터 → 코드**입니다. 잘못됐을 때 되돌릴 수 없는 것이 먼저입니다.
 */

const ORDER: InspectGroup[] = ["보호", "데이터", "코드"];

export default function InspectClient({ rows, at, version }: { rows: CheckResult[]; at: string; version: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => buildReport(rows, { at, version }), [rows, at, version]);
  const bad = rows.filter((r) => r.level !== "정상");

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // 복사가 막히는 브라우저가 있습니다. 조용히 넘기면 붙여넣기가 안 되는 것을 나중에
      // 알게 되므로, 그 자리에서 아래 글상자를 직접 긁어가라고 말합니다(§5).
      alert("복사가 막혔습니다. 아래 글상자를 직접 긁어서 복사해주세요.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-black text-slate-800">🧪 점검</h1>
          <span className="text-[11px] text-slate-400">
            {at} · v{version}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            disabled={pending}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "다시 재는 중…" : "🔄 다시 점검"}
          </button>
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            {copied ? "✅ 복사했습니다" : "📋 결과 복사"}
          </button>
        </div>
      </div>

      <p
        className={
          "mb-3 rounded-lg px-3 py-2 text-xs font-bold " +
          (bad.length === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")
        }
      >
        {bad.length === 0 ? "모든 검사 정상입니다." : `손볼 것 ${bad.length}건 — 복사해서 보내주시면 그대로 고칩니다.`}
      </p>

      <div className="space-y-3">
        {ORDER.map((g) => {
          const mine = rows.filter((r) => r.group === g);
          if (mine.length === 0) return null;
          const w = worstOf(mine);
          return (
            <section key={g} className="g-panel-solid p-3">
              <h2 className="text-sm font-bold text-slate-800">
                {levelMark(w)} {GROUP_LABEL[g]}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">{GROUP_NOTE[g]}</p>
              <div className="mt-2">
                {mine.map((r) => (
                  <div key={r.name} className="flex items-start gap-2 border-b border-slate-100 py-1.5 last:border-0">
                    <span className="w-5 shrink-0 text-center text-sm">{levelMark(r.level)}</span>
                    <span className="w-44 shrink-0 text-xs font-semibold text-slate-700">{r.name}</span>
                    <span className="min-w-0 flex-1 text-xs">
                      <span className={r.level === "정상" ? "text-emerald-700" : r.level === "확인" ? "text-amber-700" : "text-red-600"}>
                        {r.detail}
                      </span>
                      {r.impact && <span className="block text-[11px] text-slate-500">{r.impact}</span>}
                      {/* 걸린 이름은 접어 둡니다. 스무 개가 펼쳐져 있으면 다음 검사가 안 보입니다. */}
                      {r.items && r.items.length > 0 && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-[11px] text-slate-400">{r.items.length}건 보기</summary>
                          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                            {r.items.slice(0, 50).map((it) => (
                              <li key={it} className="break-all">
                                · {it}
                              </li>
                            ))}
                            {r.items.length > 50 && <li>· 외 {r.items.length - 50}건</li>}
                          </ul>
                        </details>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* 복사가 막힌 브라우저를 위해 글 자체를 남겨 둡니다. 눌러서 긁어가면 됩니다. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-slate-400">보낼 글 보기</summary>
        <textarea
          readOnly
          value={report}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 h-64 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600"
        />
      </details>
    </div>
  );
}
