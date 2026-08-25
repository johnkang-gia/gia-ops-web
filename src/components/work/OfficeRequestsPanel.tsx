"use client";

import { useEffect, useState } from "react";
import { createTaskFromInbox } from "@/lib/taskFromInbox";
import { useToast } from "@/components/common/ToastProvider";

// 통합 인박스의 "선생님요청" 탭(커맨드센터 개편). 담임/과목 선생님이 행정실 문의 창구에 남긴
// 도움요청·문의를 실시간(20초 폴링)으로 보여주고, 확인/완료 처리를 바로 합니다. 예전에는 업무
// 화면 상단 배너였는데, 들어오는 소식(문의·출결·요청)을 인박스 한 곳으로 모으면서 탭이 됐습니다.
export type OfficeReq = {
  id: string;
  teacher_name: string | null;
  class_label: string | null;
  category: string;
  message: string;
  status: string;
  created_at: string;
};

export default function OfficeRequestsPanel({
  onOpenCountChange,
  department,
  userEmail,
}: {
  onOpenCountChange?: (n: number) => void;
  department?: string;
  userEmail?: string;
}) {
  const notify = useToast();
  const [reqs, setReqs] = useState<OfficeReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskedIds, setTaskedIds] = useState<Set<string>>(new Set());

  // 인박스 항목을 클릭 한 번으로 업무 카드로(커맨드센터 개편 ⓑ).
  async function toTask(r: OfficeReq) {
    if (!department || !userEmail) return;
    const { error } = await createTaskFromInbox({
      title: `[${r.class_label || "선생님"} 요청] ${r.message.slice(0, 50)}`,
      description: `${r.teacher_name ?? ""} 선생님 행정실 요청(${r.category})\n\n${r.message}`,
      department,
      userEmail,
    });
    if (error) notify("업무 등록 실패: " + error, "error");
    else {
      notify("업무로 등록했습니다.", "success");
      setTaskedIds((prev) => new Set(prev).add(r.id));
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/office-request?scope=all");
      if (res.ok) {
        const json = (await res.json()) as { requests: OfficeReq[] };
        setReqs(json.requests ?? []);
        onOpenCountChange?.((json.requests ?? []).filter((r) => r.status !== "완료").length);
      }
    } catch {
      /* 잠시 후 재시도 */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const i = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") void load(); }, 20000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const open = reqs.filter((r) => r.status !== "완료");
  const done = reqs.filter((r) => r.status === "완료").slice(0, 10);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading ? (
          <p className="py-6 text-center text-[11px] text-slate-400">불러오는 중…</p>
        ) : open.length === 0 && done.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-slate-400">선생님이 남긴 요청이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {open.map((r) => (
              <div key={r.id} className="rounded-lg border border-red-100 bg-red-50/40 px-2.5 py-1.5 text-xs">
                <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">❗ {r.class_label || "반 미상"}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{r.category}</span>
                  {r.teacher_name && <span className="text-[11px] font-semibold text-slate-600">{r.teacher_name}</span>}
                  <span className="ml-auto text-[9px] text-slate-400">
                    {new Date(r.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-slate-700">{r.message}</p>
                <div className="mt-1 flex gap-1.5">
                  {r.status === "접수" ? (
                    <button onClick={() => setStatus(r.id, "확인")} className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 hover:bg-blue-100">확인</button>
                  ) : (
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">확인됨</span>
                  )}
                  <button onClick={() => setStatus(r.id, "완료")} className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 hover:bg-emerald-100">완료</button>
                  {department && userEmail && (
                    taskedIds.has(r.id) ? (
                      <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-400">✓ 업무 등록됨</span>
                    ) : (
                      <button onClick={() => toTask(r)} className="rounded-md bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-blue-700">→업무등록</button>
                    )
                  )}
                </div>
              </div>
            ))}
            {done.length > 0 && (
              <>
                <p className="mt-1 text-[10px] font-semibold text-slate-300">완료됨</p>
                {done.map((r) => (
                  <div key={r.id} className="rounded-lg bg-black/[0.02] px-2.5 py-1 text-[11px] text-slate-400">
                    <span className="font-semibold">{r.class_label || ""} {r.teacher_name || ""}</span> · {r.message.slice(0, 40)}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
