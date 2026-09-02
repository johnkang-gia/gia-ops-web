"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import type { Term } from "@/lib/types";

// 새 학기 시작.
//
// 학기가 바뀌면 **지난 학기 것을 지우지 않습니다.** 그때 누가 몇 호차를 탔는지, 무슨 교재를
// 샀는지, 무슨 관찰기록을 썼는지가 전부 그 학기에 매달려 있습니다. 새 학기를 하나 더 만들고,
// 이어서 쓸 것만 복사합니다.
//
// 이 학교 기준으로 이어지는 것은 **셔틀뿐**입니다 - 노선과 정류장을 조금씩 고쳐 씁니다.
// 반·명단·업무·관찰기록은 학기마다 새로 시작합니다.

export default function StartTermPanel({ current, isAdmin }: { current: Term | null; isAdmin: boolean }) {
  const notify = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const thisYear = String(new Date().getFullYear());
  const [form, setForm] = useState({
    termType: "겨울캠프",
    year: thisYear,
    startDate: "",
    endDate: "",
    shuttleLabel: "겨울캠프",
    copyShuttle: true,
    copyFeeItems: false,
  });

  async function start() {
    if (!window.confirm(`"${form.year} ${form.termType}"으로 넘어갑니다.\n\n${current ? `지금 학기(${current.year} ${current.term_type})는 종료로 바뀌고, 그 기록은 그대로 남습니다.` : ""}\n계속할까요?`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/terms/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(json?.error ?? "학기를 시작하지 못했습니다.", "error");
        return;
      }
      const c = json.copied as { routes: number; stops: number; feeItems: number };
      const w = (json.warnings as string[]) ?? [];
      notify(
        `새 학기를 시작했습니다. 노선 ${c.routes}개 · 정류장 ${c.stops}곳${c.feeItems ? ` · 학비외 항목 ${c.feeItems}개` : ""} 복사${w.length ? ` (문제 ${w.length}건)` : ""}`,
        w.length ? "error" : "success",
      );
      // 한 건이라도 실패했으면 조용히 넘기지 않습니다. 무엇이 안 넘어갔는지 알아야 합니다.
      if (w.length > 0) console.error("[학기 시작] 넘어가지 못한 것:", w);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-[12px] font-bold text-slate-700">
          지금 학기
          <span className="ml-1.5 rounded bg-teal-50 px-1.5 py-0.5 text-teal-800">
            {current ? `${current.year} ${current.term_type}` : "없음"}
          </span>
        </span>
        {current?.shuttle_label && (
          <span className="text-[11px] text-slate-400">셔틀 자료: {current.shuttle_label}</span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white"
        >
          {open ? "닫기" : "새 학기 시작"}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 p-3">
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            지난 학기 기록은 <b>지워지지 않습니다.</b> 셔틀·학비외 항목·업무·관찰기록·회의는 그 학기에 매달린 채로 남고,
            화면에서 학기를 바꿔 언제든 다시 볼 수 있습니다. 여기서 정하는 것은 <b>새 학기를 무엇으로 시작할지</b>뿐입니다.
          </p>

          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-slate-500">
              학기 이름
              <input
                value={form.termType}
                onChange={(e) => setForm((f) => ({ ...f, termType: e.target.value, shuttleLabel: e.target.value }))}
                placeholder="겨울캠프"
                className="ml-1 w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              연도
              <input
                value={form.year}
                onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
                className="ml-1 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              시작
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              끝
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <div className="mb-3 flex flex-col gap-1.5">
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.copyShuttle}
                onChange={(e) => setForm((f) => ({ ...f, copyShuttle: e.target.checked }))}
              />
              <span className="text-[12px]">
                <b>셔틀 노선·정류장을 복사해서 시작</b>
                <span className="ml-1 text-[11px] text-slate-500">
                  — 정규학기 노선을 그대로 가져와 조금씩 고쳐 씁니다. <b>탑승 배정(아이들)은 복사하지 않습니다</b> — 캠프는 타는
                  아이가 달라집니다.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.copyFeeItems}
                onChange={(e) => setForm((f) => ({ ...f, copyFeeItems: e.target.checked }))}
              />
              <span className="text-[12px]">
                <b>학비외 항목을 복사해서 시작</b>
                <span className="ml-1 text-[11px] text-slate-500">— 교재·교복 목록을 가져와 값만 고칩니다. 캠프라면 대개 새로 만듭니다.</span>
              </span>
            </label>
            <p className="px-1 text-[11px] text-slate-400">
              반 편성 · 학생 명단 · 업무 · 관찰기록 · 회의는 복사하지 않습니다. 새 학기에 새로 만들고, 지난 학기 것은 그대로
              남아 학기를 바꿔 볼 수 있습니다.
            </p>
          </div>

          <button
            onClick={() => void start()}
            disabled={busy || !form.termType.trim() || !form.year.trim()}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? "옮기는 중…" : `"${form.year} ${form.termType}" 시작하기`}
          </button>
        </div>
      )}
    </div>
  );
}
