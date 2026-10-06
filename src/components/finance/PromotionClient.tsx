"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { useFinanceLive } from "@/lib/useFinanceLive";
import type { PromoLine, PromoStudent } from "@/lib/promotion";

type Term = { id: string; term_type: string; year: string; status: string; start_date: string | null };
type Counts = { move: number; changed: number; exists: number; skipped: number };

const TONE: Record<PromoLine["verdict"], string> = {
  옮김: "bg-emerald-100 text-emerald-800",
  바뀜: "bg-sky-100 text-sky-800",
  있음: "bg-slate-100 text-slate-500",
  "안 옮김": "bg-rose-100 text-rose-700",
};

const termName = (t: Term) => `${t.year} ${t.term_type}${t.status === "진행중" ? " (진행중)" : ""}`;

/**
 * 진급 화면.
 *
 * **미리보기 없이는 옮기지 않습니다.** 139명분 등록이 한 번에 들어가는 일이라, 무엇이 들어가고
 * 무엇이 빠지는지 숫자로 본 뒤에 누릅니다. 「안 옮김」과 「바뀜」을 먼저 보여줍니다 - 사람이 확인할
 * 것은 그쪽뿐이고, 「옮김」 백몇십 줄 사이에 섞이면 못 찾습니다.
 */
export default function PromotionClient({ terms, loadError }: { terms: Term[]; loadError: string | null }) {
  useFinanceLive(["terms"]);
  const notify = useToast();
  const current = terms.find((t) => t.status === "진행중");
  const [to, setTo] = useState(current?.id ?? "");
  const [from, setFrom] = useState(terms.find((t) => t.id !== current?.id)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ students: PromoStudent[]; counts: Counts } | null>(null);
  const [only, setOnly] = useState<"확인" | "전체">("확인");

  async function look() {
    if (!from || !to) return;
    setBusy(true);
    const res = await fetch(`/api/finance/promotion?from=${from}&to=${to}`, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as { students?: PromoStudent[]; counts?: Counts; error?: string } | null;
    setBusy(false);
    if (!res.ok || !json?.students || !json.counts) {
      notify(json?.error ?? "미리보기를 만들지 못했습니다.", "error");
      return;
    }
    setPreview({ students: json.students, counts: json.counts });
  }

  async function apply() {
    if (!preview) return;
    const n = preview.counts.move + preview.counts.changed;
    if (n === 0) return notify("옮길 것이 없습니다.", "error");
    if (!window.confirm(`${n}줄을 새 학기로 옮깁니다. 지난 학기 줄은 그대로 남습니다.\n\n옮길까요?`)) return;
    setBusy(true);
    const res = await fetch("/api/finance/promotion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
    const json = (await res.json().catch(() => null)) as { done?: Record<string, number>; error?: string } | null;
    setBusy(false);
    if (!res.ok) {
      notify(json?.error ?? "옮기지 못했습니다.", "error");
    } else {
      const d = json?.done ?? {};
      notify(`옮겼습니다 — 등록 ${d["등록"] ?? 0} · 할인 ${d["할인"] ?? 0} · 학비외 ${d["학비외"] ?? 0}`, "success");
    }
    void look();
  }

  const shown = useMemo(() => {
    if (!preview) return [];
    if (only === "전체") return preview.students;
    return preview.students
      .map((s) => ({ ...s, lines: s.lines.filter((l) => l.verdict === "안 옮김" || l.verdict === "바뀜" || l.flag) }))
      .filter((s) => s.lines.length > 0);
  }, [preview, only]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-[16px] font-black text-slate-800">🎓 진급 · 학기 넘기기</h1>
        <span className="text-[11px] text-slate-500">지난 학기의 학비 등록 · 할인 · 학비외 개별 선택을 새 학기로 옮깁니다. 퇴소생은 빠지고, 지난 학기 줄은 지우지 않습니다.</span>
      </div>
      {loadError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{loadError}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px]">
        <select value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} className="rounded border border-slate-200 px-2 py-1">
          <option value="">지난 학기…</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{termName(t)}</option>)}
        </select>
        <span className="font-bold">→</span>
        <select value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} className="rounded border border-slate-200 px-2 py-1">
          <option value="">새 학기…</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{termName(t)}</option>)}
        </select>
        <button disabled={busy || !from || !to || from === to} onClick={() => void look()} className="rounded-lg bg-slate-100 px-3 py-1 font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
          {busy && !preview ? "계산 중…" : "미리보기"}
        </button>
        {preview && (
          <>
            <span className="ml-2 text-slate-600">
              옮김 <b className="text-emerald-700">{preview.counts.move}</b> · 바뀜 <b className="text-sky-700">{preview.counts.changed}</b> · 이미 있음 {preview.counts.exists} · 안 옮김{" "}
              <b className="text-rose-600">{preview.counts.skipped}</b>
            </span>
            <button disabled={busy} onClick={() => void apply()} className="ml-auto rounded-lg bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300">
              {busy ? "옮기는 중…" : "새 학기로 옮기기"}
            </button>
          </>
        )}
      </div>

      {preview && (
        <div className="mb-2 flex gap-1 text-[12px]">
          {(["확인", "전체"] as const).map((k) => (
            <button key={k} onClick={() => setOnly(k)} className={"rounded-lg px-2.5 py-1 font-bold " + (only === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}>
              {k === "확인" ? "확인할 것만" : "전체"}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {preview && shown.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[12px] text-slate-400">확인할 것이 없습니다. 전부 그대로 옮겨집니다.</p>}
        {shown.map((s) => (
          <div key={s.studentId} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px]">
            <div className="font-bold text-slate-800">
              {s.name} <span className="text-[11px] font-normal text-slate-400">{s.grade ?? ""} · {s.dept ?? "부서 미정"}</span>
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {s.lines.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-10 text-[10px] text-slate-400">{l.kind}</span>
                  <span className={"rounded px-1 text-[10px] font-bold " + TONE[l.verdict]}>{l.verdict}</span>
                  <span>{l.label}</span>
                  {l.why && <span className="text-[11px] text-slate-500">— {l.why}</span>}
                  {l.flag && <span className="text-[11px] text-amber-700">⚠ {l.flag}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
