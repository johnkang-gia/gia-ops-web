"use client";

import { useState } from "react";
import type { Incident, EventRecord, Meeting } from "@/lib/types";
import IncidentsClient from "@/components/incidents/IncidentsClient";
import EventsClient from "@/components/events/EventsClient";
import MeetingsClient from "@/components/meetings/MeetingsClient";

type Tab = "incidents" | "events" | "meetings";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "incidents", label: "사건", icon: "📋" },
  { key: "events", label: "행사", icon: "🎉" },
  { key: "meetings", label: "회의", icon: "💬" },
];

export default function RecordsClient({
  initialIncidents,
  initialEvents,
  initialMeetings,
}: {
  initialIncidents: Incident[];
  initialEvents: EventRecord[];
  initialMeetings: Meeting[];
}) {
  const [tab, setTab] = useState<Tab>("incidents");

  const counts: Record<Tab, number> = {
    incidents: initialIncidents.length,
    events: initialEvents.length,
    meetings: initialMeetings.length,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-bold">기록함</h1>

      <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
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
      {tab === "events" && <EventsClient initialItems={initialEvents} />}
      {tab === "meetings" && <MeetingsClient initialItems={initialMeetings} />}
    </div>
  );
}
