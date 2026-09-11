"use client";

import { useEffect, useState } from "react";
import { DATA_KINDS } from "@/lib/registry/dataKinds";
import { useDevReport } from "@/components/dev/DevReportProvider";

/**
 * **자료 등기소** — 적어 둔 규칙과, 그 규칙이 **실제 자료에서 지켜지는가**.
 *
 * 지금까지 이 자리는 적어 둔 것을 **보여주기만** 했습니다. 「중복은 (service_date,
 * assignment_id)로 막습니다」라고 적혀 있어도 그 표에 유일 색인이 없으면 실제로는 안 막히는데,
 * 화면에는 규칙이 멀쩡히 적혀 있으니 지켜지는 줄 압니다. 눌러서 자료에 대고 확인합니다.
 */

type Check = {
  ok: boolean;
  checkedAt: string;
  kinds: {
    kind: string;
    canonical: string;
    unreadable: { table: string; why: string }[];
    dedupe: { by: string[] | null; duplicates: { key: string; count: number }[]; rows: number | null; note: string | null };
    gap: string | null;
  }[];
  otherUnreadable: { table: string; why: string }[];
  gaps: { key: string; gap: string }[];
  summary: Record<string, number>;
};

export default function DataRegistryPanel({ gaps }: { gaps: { key: string; gap: string }[] }) {
  const report = useDevReport();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/registry-check", { cache: "no-store" });
      const json = (await res.json()) as Check & { error?: string };
      if (!res.ok) {
        // 조용히 빈 결과로 두지 않습니다. 「점검했는데 이상 없음」과 「점검을 못 함」은
        // 완전히 다른 이야기입니다.
        setError(json.error ?? `창구가 ${res.status} 로 답했습니다`);
        setResult(null);
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  /** 쪽지에 담을 글. 점검 전에도 **짝 없는 자리**는 코드에서 바로 알 수 있으니 담습니다. */
  useEffect(() => {
    const lines: string[] = ["## 자료 등기소"];
    if (!result) {
      lines.push("점검은 아직 안 돌렸습니다. [자료 점검하기]를 누른 뒤 다시 복사하면 결과가 함께 담깁니다.");
    } else {
      lines.push(
        `${new Date(result.checkedAt).toLocaleString("ko-KR")} 점검 · 갈래 ${result.summary.갈래} · 못 읽은 표 ${result.summary.못읽은표} · 중복 묶음 ${result.summary.중복묶음}`,
      );
      const badTables = [...result.kinds.flatMap((k) => k.unreadable.map((u) => `${k.kind}/${u.table}: ${u.why}`)), ...result.otherUnreadable.map((u) => `${u.table}: ${u.why}`)];
      if (badTables.length > 0) {
        lines.push("", "### 읽지 못한 표");
        for (const b of badTables) lines.push(`- ${b}`);
      }
      const dup = result.kinds.filter((k) => k.dedupe.duplicates.length > 0);
      if (dup.length > 0) {
        lines.push("", "### 중복 열쇠가 실제로는 안 막히고 있습니다");
        for (const k of dup) {
          lines.push(`- **${k.kind}** \`${k.canonical}\` (열쇠: ${k.dedupe.by?.join(" + ")}) — ${k.dedupe.duplicates.length}묶음`);
          for (const d of k.dedupe.duplicates.slice(0, 5)) lines.push(`  - \`${d.key}\` × ${d.count}`);
        }
      }
      const notes = result.kinds.filter((k) => k.dedupe.note && k.dedupe.by);
      if (notes.length > 0) {
        lines.push("", "### 세지 못한 것");
        for (const k of notes) lines.push(`- ${k.kind}: ${k.dedupe.note}`);
      }
    }
    if (gaps.length > 0) {
      lines.push("", "### 넣기와 내리기가 아직 짝이 아닌 자리 (코드)");
      for (const g of gaps) lines.push(`- **${g.key}** — ${g.gap}`);
    }
    report.put("registry", 20, lines.join("\n"));
  }, [result, gaps, report]);

  const byKind = new Map((result?.kinds ?? []).map((k) => [k.kind, k]));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-black text-slate-800">🗂 자료 등기소</h2>
        {/* 예전 문구는 「종류 6 · 표를 새로 만들면 빌드가 등록을 요구합니다」였습니다.
            숫자와 「요구합니다」가 붙어 있어, 등록된 갈래 수가 **해야 할 일 6건**으로
            읽혔습니다. 세어 보여주는 숫자와 남은 일은 다른 것입니다. */}
        <span className="text-[11px] text-slate-400">{DATA_KINDS.length}갈래가 등록되어 있습니다 · 할 일이 아니라 지금 상태입니다</span>
        <button
          onClick={() => void run()}
          disabled={running}
          className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
          title="적어 둔 중복 열쇠가 실제 자료에서도 지켜지는지, 등기소에 적힌 표를 읽을 수 있는지 확인합니다."
        >
          {running ? "점검 중…" : "자료 점검하기"}
        </button>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        적어 둔 규칙과 <b>실제 자료</b>를 맞대봅니다 — 등기소에 적힌 표를 읽을 수 있는지, 중복 열쇠가 정말 막히고 있는지.
        적혀 있다고 지켜지는 것은 아닙니다: 유일 색인이 없으면 두 사람이 동시에 눌렀을 때 두 줄이 생기고, 화면에는 오류가
        아니라 <b>같은 아이가 두 번</b> 뜹니다.
      </p>

      {error && (
        <p className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700">
          점검하지 못했습니다: {error}
        </p>
      )}

      {result && (
        <div
          className={
            "mb-2 rounded-lg px-3 py-2 text-[12px] font-bold " +
            (result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
          }
        >
          {result.ok
            ? `${new Date(result.checkedAt).toLocaleTimeString("ko-KR")} 점검 — 표도 다 읽히고 중복도 없습니다.`
            : `못 읽은 표 ${result.summary.못읽은표} · 중복 묶음 ${result.summary.중복묶음}`}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-100 text-[11px] text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold">종류</th>
              <th className="px-2 py-1.5 text-left font-bold">모이는 한 곳</th>
              <th className="w-12 px-2 py-1.5 font-bold">딸린 표</th>
              <th className="px-2 py-1.5 text-left font-bold">중복 열쇠</th>
              <th className="w-14 px-2 py-1.5 font-bold">내리기</th>
              <th className="px-2 py-1.5 text-left font-bold">점검</th>
            </tr>
          </thead>
          <tbody>
            {DATA_KINDS.map((k) => {
              const r = byKind.get(k.key);
              return (
                <tr key={k.key} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1.5 font-bold text-slate-700">{k.key}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">{k.canonical}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-slate-500">{k.satellites.length}</td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-500">
                    {"by" in k.dedupe ? k.dedupe.by.join(" + ") : <span className="text-amber-700">막지 않음</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {k.undo ? <span className="text-emerald-600">있음</span> : <span className="font-bold text-red-600">없음</span>}
                  </td>
                  <td className="px-2 py-1.5 text-[11px]">
                    {!r ? (
                      <span className="text-slate-300">-</span>
                    ) : r.unreadable.length > 0 ? (
                      <span className="font-bold text-red-600">
                        표 {r.unreadable.length}개를 못 읽었습니다: {r.unreadable.map((u) => u.table).join(", ")}
                      </span>
                    ) : r.dedupe.duplicates.length > 0 ? (
                      <span className="font-bold text-red-600" title={r.dedupe.duplicates.map((d) => `${d.key} × ${d.count}`).join("\n")}>
                        같은 열쇠 {r.dedupe.duplicates.length}묶음 — 규칙이 실제로는 안 막고 있습니다
                      </span>
                    ) : r.dedupe.note ? (
                      <span className="text-slate-500">{r.dedupe.note}</span>
                    ) : (
                      <span className="text-emerald-600">
                        이상 없음{r.dedupe.rows != null ? ` (${r.dedupe.rows.toLocaleString()}줄)` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {result && result.otherUnreadable.length > 0 && (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-[12px] font-bold text-red-700">기록·기준표 중 못 읽은 것 {result.otherUnreadable.length}</p>
          {result.otherUnreadable.map((u) => (
            <p key={u.table} className="mt-0.5 text-[11px] text-red-800">
              <span className="font-mono">{u.table}</span> — {u.why}
            </p>
          ))}
        </div>
      )}

      {gaps.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-[12px] font-bold text-amber-800">아직 짝이 안 맞는 자리 {gaps.length}</p>
          {/* 여기는 자료가 아니라 **코드의 상태**입니다. 화면에서 누를 것이 없다는 사실을
              적어두지 않으면, 보는 사람은 고칠 단추를 찾다가 못 찾고 넘깁니다. */}
          <p className="mt-0.5 mb-1 text-[11px] text-amber-700">
            화면에서 고칠 수 있는 것이 아닙니다 — 코드를 손봐야 합니다. 위 [개발자에게 보낼 쪽지 복사]에 이 목록이 함께 담깁니다.
          </p>
          {gaps.map((g) => (
            <p key={g.key} className="mt-0.5 text-[11px] leading-relaxed text-amber-900">
              <b>{g.key}</b> — {g.gap}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
