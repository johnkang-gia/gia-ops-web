"use client";

import { useState } from "react";
import type { Meeting, Task } from "@/lib/types";
import WorkReportClient from "@/components/work/WorkReportClient";
import MeetingReportClient from "@/components/meetings/MeetingReportClient";

type ReportTab = "work" | "meeting";

const TABS: { key: ReportTab; label: string; icon: string }[] = [
  { key: "work", label: "업무 보고서", icon: "🗂" },
  { key: "meeting", label: "회의 보고서", icon: "💬" },
];

export default function ReportsHubClient({
  tasks,
  nameByEmail,
  meetings,
}: {
  tasks: Task[];
  nameByEmail: Record<string, string>;
  meetings: Meeting[];
}) {
  const [tab, setTab] = useState<ReportTab>("work");

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="mb-3 flex shrink-0 gap-1 g-panel-solid p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition " +
              (tab === t.key ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-50")
            }
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "work" ? (
          <WorkReportClient tasks={tasks} nameByEmail={nameByEmail} />
        ) : (
          <MeetingReportClient meetings={meetings} />
        )}
      </div>
    </div>
  );
}
