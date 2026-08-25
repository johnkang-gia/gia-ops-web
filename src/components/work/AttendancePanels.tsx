"use client";

import { useState } from "react";
import type { GoogleChatMirrorMessage, Task, TeamMember } from "@/lib/types";
import type { RosterStudent } from "@/lib/attendanceDigest";
import GoogleChatMirrorPanel from "./GoogleChatMirrorPanel";
import AttendanceDigestPanel from "./AttendanceDigestPanel";
import ParentInquiryPanel from "./ParentInquiryPanel";
import OfficeRequestsPanel from "./OfficeRequestsPanel";

// 통합 인박스(커맨드센터 개편): 학부모 문의·출결내역·출결알림·선생님요청 등 "들어오는 소식"을
// 필터 탭 하나의 패널로 모았습니다. 예전에는 학부모 문의/픽업/선생님요청 배너가 화면 곳곳에
// 흩어져 있어 "지금 뭘 확인해야 하지?"가 한눈에 안 됐습니다. 미처리 건수는 탭에 배지로 뜹니다.
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
  // 학부모 문의가 가장 자주 보는 것이므로 기본 탭입니다(기존 유지).
  const [tab, setTab] = useState<"inquiry" | "digest" | "chat" | "office">("inquiry");
  const [officeOpen, setOfficeOpen] = useState(0);

  const tabs = [
    { key: "inquiry", label: "💬 학부모 문의", badge: 0 },
    { key: "digest", label: "📊 출결내역", badge: 0 },
    { key: "chat", label: "🚸 출결알림", badge: 0 },
    { key: "office", label: "❗ 선생님요청", badge: officeOpen },
  ] as const;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 px-2.5 pt-2">
        <span className="mr-0.5 text-[11px] font-extrabold text-slate-400">📥 인박스</span>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
              (tab === t.key ? "bg-emerald-500 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
            }
          >
            {t.label}
            {t.badge > 0 && (
              <span className={"rounded-full px-1 text-[9px] font-black " + (tab === t.key ? "bg-white text-emerald-600" : "bg-red-500 text-white")}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* 선생님요청 탭은 배지 숫자(미완료 건수)를 유지하기 위해 항상 마운트해두고 표시만
            전환합니다 - 다른 탭을 보고 있어도 새 요청이 오면 배지가 올라갑니다. */}
        <div className={tab === "office" ? "h-full" : "hidden"}>
          <OfficeRequestsPanel onOpenCountChange={setOfficeOpen} />
        </div>
        {tab === "inquiry" && <ParentInquiryPanel currentUserEmail={userEmail} full />}
        {tab === "digest" && (
          <AttendanceDigestPanel messages={messages} department={department} roster={roster} currentUserEmail={userEmail} />
        )}
        {tab === "chat" && (
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
