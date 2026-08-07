"use client";

import { useState } from "react";
import type { GoogleChatMirrorMessage, Task, TeamMember } from "@/lib/types";
import GoogleChatMirrorPanel from "./GoogleChatMirrorPanel";
import AttendanceDigestPanel from "./AttendanceDigestPanel";

// 출결내역(정리본)과 출결알림(구글챗 원문)을 좌우로 나란히 두는 대신 탭으로 전환합니다(요청:
// "출결알림창과, 출결 내력창을 탭으로 전환할 수 있게... 기본은 출결내역 탭이 먼저"). 필터링이
// 잘 되고 있어 평소에는 정리본만 보면 되고, 원문 확인이 필요할 때만 알림 탭으로 넘어갑니다.
// 좁은 자리를 반으로 쪼개지 않으니 각 패널이 폭을 온전히 다 쓸 수 있는 이점도 있습니다.
export default function AttendancePanels({
  messages,
  team,
  userEmail,
  department,
  rosterNames,
  onTaskCreated,
}: {
  messages: GoogleChatMirrorMessage[];
  team: TeamMember[];
  userEmail: string;
  department: string;
  rosterNames: string[];
  onTaskCreated?: (task: Task) => void;
}) {
  const [tab, setTab] = useState<"digest" | "chat">("digest");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 gap-1 px-2.5 pt-2">
        {(
          [
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
        {tab === "digest" ? (
          <AttendanceDigestPanel messages={messages} department={department} rosterNames={rosterNames} />
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
