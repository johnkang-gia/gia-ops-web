"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ParentInquiryPanel from "./ParentInquiryPanel";
import type { DepartmentMemo } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";

// 저장 debounce 간격(ms) - 타이핑할 때마다 저장하면 부담스러우니 잠깐 멈췄을 때만 저장합니다.
const MEMO_SAVE_DELAY = 800;

// 부서 공유 메모장 - 실시간 로그 왼쪽 절반에 배치되는 자유 메모 영역입니다(요청: "실시간 로그
// 반으로 나눠서 오른쪽 실시간로그 왼쪽 메모 적을 수 있도록"). 부서당 한 장(department_memos에
// 1행)을 팀 전체가 함께 보고 고쳐 쓰는 화이트보드처럼 씁니다 - 누가 마지막으로 고쳤는지만
// 아래에 작게 표시하고, 별도 이력은 남기지 않습니다(가벼운 메모 용도).
function MemoPanel({ department, currentUserEmail }: { department: string; currentUserEmail: string }) {
  const notify = useToast();
  const [content, setContent] = useState("");
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRealtimeRef = useRef(false);

  useEffect(() => {
    if (department === "전체") return;
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("department_memos")
      .select("*")
      .eq("department", department)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as DepartmentMemo | null;
        setContent(row?.content ?? "");
        setUpdatedBy(row?.updated_by ?? null);
        setUpdatedAt(row?.updated_at ?? null);
      });

    const channel = supabase
      .channel(`department-memo-${department}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "department_memos", filter: `department=eq.${department}` },
        (payload) => {
          if (skipNextRealtimeRef.current) {
            // 내가 방금 저장해서 온 이벤트는 다시 반영할 필요가 없습니다(커서 위치가 튀는 것 방지).
            skipNextRealtimeRef.current = false;
            return;
          }
          const row = payload.new as DepartmentMemo | undefined;
          if (!row) return;
          setContent(row.content ?? "");
          setUpdatedBy(row.updated_by ?? null);
          setUpdatedAt(row.updated_at ?? null);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [department]);

  function handleChange(next: string) {
    setContent(next);
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const supabase = createClient();
      skipNextRealtimeRef.current = true;
      const { error } = await supabase
        .from("department_memos")
        .upsert(
          { department, content: next, updated_by: currentUserEmail, updated_at: new Date().toISOString() },
          { onConflict: "department" }
        );
      setSaving(false);
      if (error) {
        skipNextRealtimeRef.current = false;
        notify("메모 저장에 실패했습니다: " + error.message, "error");
      } else {
        setUpdatedBy(currentUserEmail);
        setUpdatedAt(new Date().toISOString());
      }
    }, MEMO_SAVE_DELAY);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center justify-between text-left text-xs font-bold text-slate-600">
        <span>📝 부서 메모</span>
        <span className="text-[10px] font-medium text-slate-400">{saving ? "저장 중…" : updatedBy ? `${updatedBy} 수정` : ""}</span>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="팀원 모두가 함께 보는 메모입니다. 자유롭게 적어두세요."
        className="min-h-[66px] w-full flex-1 resize-none rounded-lg border border-black/5 bg-white/60 px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-blue-300"
        style={{ maxHeight: ROW_HEIGHT * PAGE_SIZE }}
      />
      {updatedAt && !saving && (
        <p className="mt-0.5 text-[9px] text-slate-300">{timeAgo(updatedAt)}</p>
      )}
    </div>
  );
}

const PAGE_SIZE = 3; // 요청: "실시간로그는 세줄만"
// 한 줄의 대략적인 높이(px) - 3줄만 보이는 고정 높이 스크롤 영역을 만들기 위해 씁니다.
const ROW_HEIGHT = 22;

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

// GIA WorkFlatform 참조 구조의 "실시간 로그" 패널 - 별도 로그 테이블 없이 task_comments에
// is_system=true로 자동 기록되는 상태변경/업무확인/채팅 업무등록 이벤트만 모아서 부서별로
// 최근 순으로 보여줍니다. 평소엔 딱 5줄만(한 줄에 로그 하나) 보이는 고정 높이 영역이고, 위로
// 스크롤하면 그 이전 로그를 추가로 불러옵니다(캐시에 너무 많이 쌓이지 않도록 상한을 둡니다).
// 헤더를 클릭하면 전체 목록을 팝업으로 볼 수 있습니다. 잘못 남은 로그는 관리자이거나 그
// 행동을 한 본인이면 지울 수 있습니다(요청).
// 부서 공유 메모장 + 학부모 문의사항을 나란히 놓는 줄입니다.
//
// 요청: "지금 실시간 로그를 맨위에 초등부 부서 나오는칸 가운데로 로그를 옮기고 한줄만
// 표시되도록해서 누르면 전체로그가 뜨도록 바꾸고 지금 실시간 로그자리에 학부모 문의사항탭을
// 넣고"
//
// 예전에는 오른쪽 절반이 실시간 로그였습니다. 로그는 곁눈질로 확인하는 정보라 세 줄을 차지할
// 만큼 자주 보지 않는 반면, 학부모 문의는 놓치면 바로 문제가 됩니다. 그래서 자리를 맞바꿨고,
// 로그는 ActivityLogTicker로 옮겨가 상단 부서 줄에 한 줄로 흐릅니다.
export default function ActivityLog({
  department,
  currentUserEmail,
}: {
  department: string;
  isAdmin: boolean;
  currentUserEmail: string;
}) {
  if (department === "전체") return null;

  return (
    <div className="glass mb-2 px-3 py-2">
      <div className="flex gap-3 divide-x divide-black/5">
        <MemoPanel department={department} currentUserEmail={currentUserEmail} />
        <ParentInquiryPanel currentUserEmail={currentUserEmail} />
      </div>
    </div>
  );
}
