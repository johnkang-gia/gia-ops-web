"use client";

import { useState } from "react";
import type { Incident, Meeting } from "@/lib/types";
import IncidentsClient from "@/components/incidents/IncidentsClient";
import MeetingsClient from "@/components/meetings/MeetingsClient";

type Tab = "incidents" | "meetings";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "incidents", label: "사건", icon: "📋" },
  { key: "meetings", label: "회의", icon: "💬" },
];

export default function RecordsClient({
  initialIncidents,
  initialMeetings,
}: {
  initialIncidents: Incident[];
  initialMeetings: Meeting[];
}) {
  const [tab, setTab] = useState<Tab>("incidents");

  const counts: Record<Tab, number> = {
    incidents: initialIncidents.length,
    meetings: initialMeetings.length,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">기록함</h1>
      <p className="mb-4 text-xs text-slate-500">
        사건·회의 기록은 AI 매뉴얼과 함께 실무자매뉴얼/운영계획안을 만드는 재료입니다. 반복되는
        행사 기록은 별도의 &quot;행사기록&quot; 메뉴에서 관리합니다.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-xl border p-3 text-center shadow-sm transition sm:p-4 " +
              (tab === t.key
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white hover:border-slate-300")
            }
          >
            <div className="text-xl font-bold sm:text-2xl">{counts[t.key]}</div>
            <div
              className={
                "mt-1 text-xs " + (tab === t.key ? "text-slate-200" : "text-slate-500")
              }
            >
              {t.icon} {t.label}
            </div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "border-b-2 px-3 py-2 text-sm font-semibold transition " +
              (tab === t.key
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-600")
            }
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "incidents" && <IncidentsClient initialItems={initialIncidents} />}
      {tab === "meetings" && <MeetingsClient initialItems={initialMeetings} />}
    </div>
  );
}
