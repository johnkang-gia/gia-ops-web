"use client";

import { useEffect, useState } from "react";

// 업무 대시보드 상단: 담임/과목 선생님이 행정실에 남긴 문의·도움요청을 실시간으로 보여줍니다
// (요청 4). 미완료 요청은 해당 반과 함께 빨간 느낌표로 뜨고, 확인/완료로 상태를 바꿀 수 있습니다.
type Req = {
  id: string;
  teacher_name: string | null;
  class_label: string | null;
  category: string;
  message: string;
  status: string;
  created_at: string;
};

export default function OfficeRequestsBanner() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [open, setOpen] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/office-request?scope=all");
      if (res.ok) {
        const json = (await res.json()) as { requests: Req[] };
        setReqs(json.requests ?? []);
      }
    } catch {
      /* 잠시 후 다시 시도 */
    }
  }
  useEffect(() => {
    load();
    const i = setInterval(load, 20000);
    return () => clearInterval(i);
  }, []);

  async function setStatus(id: string, status: string) {
    setReqs((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    await fetch("/api/office-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  const openReqs = reqs.filter((r) => r.status !== "완료");
  if (openReqs.length === 0) return null;

  return (
    <div className="mb-1 shrink-0 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="text-red-600">❗</span>
        <b className="text-xs font-bold text-red-700">선생님 문의·도움요청 {openReqs.length}건</b>
        <span className="ml-auto text-[11px] text-red-400">{open ? "접기 ▾" : "펼치기 ▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {openReqs.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs shadow-sm">
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                ❗ {r.class_label || "반 미상"}
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{r.category}</span>
              {r.teacher_name && <span className="text-[11px] font-semibold text-slate-600">{r.teacher_name}</span>}
              <span className="min-w-0 flex-1 truncate text-slate-700">{r.message}</span>
              {r.status === "접수" ? (
                <button onClick={() => setStatus(r.id, "확인")} className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 hover:bg-blue-100">확인</button>
              ) : (
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">확인됨</span>
              )}
              <button onClick={() => setStatus(r.id, "완료")} className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 hover:bg-emerald-100">완료</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
