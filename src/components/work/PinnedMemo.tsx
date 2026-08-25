"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DepartmentMemo } from "@/lib/types";

// 부서메모 고정핀(커맨드센터 개편): 부서 공유 메모(department_memos.content)를 채팅 맨 위에
// 핀으로 고정합니다. 접으면 첫 줄만 보이고, 펼치면 바로 고쳐 쓸 수 있습니다(잠깐 멈추면 자동
// 저장). 실시간 로그 팝업 안에도 같은 메모가 있지만, 매일 봐야 하는 메모가 팝업 안에만 있으면
// 흘러가 버려서 눈에 띄는 자리에 상시로 둡니다. 채널 이름은 로그 팝업 쪽과 다르게 지어 중복
// 구독 문제를 피합니다.
const SAVE_DELAY = 800;

export default function PinnedMemo({ department, currentUserEmail }: { department: string; currentUserEmail: string }) {
  const [content, setContent] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRealtime = useRef(false);

  useEffect(() => {
    if (!department || department === "전체") return;
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("department_memos")
      .select("*")
      .eq("department", department)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setContent((data as DepartmentMemo | null)?.content ?? "");
      });
    const ch = supabase
      .channel(`department-memo-pin-${department}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "department_memos", filter: `department=eq.${department}` },
        (payload) => {
          if (skipRealtime.current) {
            skipRealtime.current = false;
            return;
          }
          const row = payload.new as DepartmentMemo | undefined;
          if (row) setContent(row.content ?? "");
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [department]);

  function onChange(v: string) {
    setContent(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      skipRealtime.current = true;
      const supabase = createClient();
      await supabase
        .from("department_memos")
        .upsert({ department, content: v, updated_by: currentUserEmail, updated_at: new Date().toISOString() }, { onConflict: "department" });
      setSaving(false);
    }, SAVE_DELAY);
  }

  const firstLine = content.split("\n").find((l) => l.trim()) ?? "";

  return (
    <div className="shrink-0 border-b border-amber-100 bg-amber-50/60">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-1 text-left">
        <span className="text-[11px]">📌</span>
        <span className="text-[10px] font-bold text-amber-700">부서메모</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-amber-800">{firstLine || "메모가 비어 있습니다 - 눌러서 적어두세요"}</span>
        )}
        {saving && <span className="text-[9px] text-amber-500">저장중…</span>}
        <span className="ml-auto shrink-0 text-[9px] text-amber-400">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder="부서에서 함께 보는 메모입니다. 잠깐 멈추면 자동 저장됩니다."
          className="w-full resize-y border-0 bg-transparent px-3 pb-2 text-xs text-amber-900 outline-none placeholder:text-amber-300"
        />
      )}
    </div>
  );
}
