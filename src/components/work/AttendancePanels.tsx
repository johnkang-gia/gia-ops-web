"use client";

import { useState } from "react";
import type { GoogleChatMirrorMessage, Task, TeamMember } from "@/lib/types";
import type { RosterStudent } from "@/lib/attendanceDigest";
import GoogleChatMirrorPanel from "./GoogleChatMirrorPanel";
import AttendanceDigestPanel from "./AttendanceDigestPanel";
import ParentInquiryPanel from "./ParentInquiryPanel";

// 출결내역(정리본)과 출결알림(구글챗 원문)을 좌우로 나란히 두는 대신 탭으로 전환합니다(요청:
// "출결알림창과, 출결 내력창을 탭으로 전환할 수 있게... 기본은 출결내역 탭이 먼저"). 필터링이
// 잘 되고 있어 평소에는 정리본만 보면 되고, 원문 확인이 필요할 때만 알림 탭으로 넘어갑니다.
// 좁은 자리를 반으로 쪼개지 않으니 각 패널이 폭을 온전히 다 쓸 수 있는 이점도 있습니다.
export default function AttendancePanels({
  messages,
  team,
  userEmail,
  department,
  roster,
  onTaskCreated,
}: {
  messages: GoogleChatMirrorMessage[];
  team: TeamMember[];
  userEmail: string;
  department: string;
  roster: RosterStudent[];
  onTaskCreated?: (task: Task) => void;
}) {
  // 요청: "업무메뉴에서 출결내역을 지금 학부모 문의사항으로 넣고, 출결내역쪽에 학부모
  // 문의사항을 넣어서 더 크게 보게 해주고"
  //
  // 학부모 문의가 이 자리에서 가장 자주 보는 것이 되었으므로 기본 탭으로 둡니다. 출결내역은
  // 옆 탭으로 그대로 남습니다 - 없애는 게 아니라 자리를 바꾸는 것입니다.
  const [tab, setTab] = useState<"inquiry" | "digest" | "chat">("inquiry");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 gap-1 px-2.5 pt-2">
        {(
          [
            { key: "inquiry", label: "💬 학부모 문의" },
            { key: "digest", label: "📊 출결내역" },
            { key: "chat", label: "🚸 출결알림" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              "rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
              (tab === t.key ? "bg-emerald-500 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "inquiry" ? (
          <ParentInquiryPanel currentUserEmail={userEmail} full />
        ) : tab === "digest" ? (
          <AttendanceDigestPanel messages={messages} department={department} roster={roster} currentUserEmail={userEmail} />
        ) : (
          <GoogleChatMirrorPanel
            sourceKey="attendance"
            title="출결알림"
            icon="🚸"
            messages={messages}
            team={team}
            userEmail={userEmail}
            department={department}
            onTaskCreated={onTaskCreated}
          />
        )}
      </div>
    </div>
  );
}
