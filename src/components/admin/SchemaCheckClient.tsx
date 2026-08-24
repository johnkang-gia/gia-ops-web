"use client";

import { useCallback, useEffect, useState } from "react";

type Result = {
  feature: string;
  table: string;
  migration: string;
  impact: string;
  ok: boolean;
  tableMissing: boolean;
  missing: string[];
  note: string | null;
};

export default function SchemaCheckClient() {
  const [rows, setRows] = useState<Result[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/schema-check", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "점검하지 못했습니다.");
      setRows(json.results as Result[]);
      setCheckedAt(json.checkedAt as string);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // 들어오자마자 한 번 봅니다. 버튼을 또 눌러야 결과가 나오면 확인하러 온 보람이 없습니다.
  useEffect(() => {
    run();
  }, [run]);

  const bad = (rows ?? []).filter((r) => !r.ok);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? "확인하는 중…" : "다시 확인"}
        </button>
        {checkedAt && (
          <span className="text-[11px] text-slate-400">{new Date(checkedAt).toLocaleString("ko-KR")} 확인</span>
        )}
      </div>

      {err && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-600">{err}</p>}

      {rows && (
        <div
          className={
            "rounded-xl p-3 text-sm font-bold " +
            (bad.length === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
          }
        >
          {bad.length === 0 ? (
            <>✅ 모두 정상입니다. 마이그레이션이 빠짐없이 적용되어 있습니다.</>
          ) : (
            <>
              ⚠️ {bad.length}가지가 아직 반영되지 않았습니다.
              <div className="mt-1 text-xs font-normal leading-relaxed">
                아래 <b>실행할 것</b>에 적힌 파일이 아직 안 걸린 것입니다. 배포가 도는 중이면 몇 분 뒤 다시
                눌러보시고, 그래도 그대로면 마이그레이션을 직접 적용해야 합니다.
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {(rows ?? []).map((r) => (
          <div
            key={r.feature + r.migration}
            className={
              "rounded-xl border p-3 " + (r.ok ? "border-slate-200 bg-white" : "border-red-200 bg-red-50/60")
            }
          >
            <div className="flex items-center gap-2">
              <span className={r.ok ? "text-emerald-500" : "text-red-500"}>{r.ok ? "✓" : "✕"}</span>
              <b className="text-sm text-slate-800">{r.feature}</b>
              <span className="text-[11px] text-slate-400">{r.table}</span>
            </div>

            {!r.ok && (
              <div className="mt-1.5 flex flex-col gap-1 text-xs">
                <div className="text-red-600">
                  {r.tableMissing ? (
                    <>
                      표 <code className="rounded bg-red-100 px-1">{r.table}</code> 자체가 없습니다.
                    </>
                  ) : (
                    <>
                      없는 칸: <code className="rounded bg-red-100 px-1">{r.missing.join(", ")}</code>
                    </>
                  )}
                </div>
                <div className="text-slate-600">→ {r.impact}</div>
                <div className="text-slate-500">
                  실행할 것: <code className="rounded bg-slate-100 px-1">{r.migration}</code>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {rows && bad.length > 0 && (
        <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <b className="text-slate-700">적용하는 방법</b>
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-slate-900 p-2.5 text-[11px] text-slate-100">
            git pull{"\n"}supabase db push
          </pre>
          <p className="mt-1.5">
            자동 적용(GitHub Actions)이 걸려 있다면 대개 배포와 함께 처리됩니다. 계속 빨간 줄이 남아 있으면
            자동 적용이 실패한 것이니 실행 기록을 확인해야 합니다.
          </p>
        </div>
      )}
    </div>
  );
}
