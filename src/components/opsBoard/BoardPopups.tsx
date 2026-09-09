"use client";

import { useEffect, useState } from "react";
import type { BoardScale } from "@/lib/useBoardDensity";

/**
 * 눌렀을 때 화면 위에 뜨는 작은 창들 — 문의 원문, 반별 주간 시간표.
 *
 * 평소에는 안 보이는 것들이라 본체와 섞여 있을 이유가 없습니다.
 */

// 학부모 문의 원문 - 작은 창.
export function InquiryPopup({
  view,
  onClose,
}: {
  view: { student: string; channel: string | null; raw: string | null; at: string };
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 16, maxWidth: 560, width: "100%", maxHeight: "80vh", overflow: "auto", padding: 22 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
          <b style={{ fontSize: 22, color: "#fff" }}>{view.student}</b>
          <span style={{ fontSize: 13, color: "#64748b" }}>{new Date(view.at).toLocaleString("ko-KR")}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#94a3b8", fontSize: 26, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>
        {view.channel && <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>{view.channel}</div>}
        <div style={{ fontSize: 18, color: "#e2e8f0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {view.raw || "원문이 저장되어 있지 않습니다."}
        </div>
      </div>
    </div>
  );
}

type WeekGrid = {
  className: string;
  weekdays: string[];
  grid: {
    period: { id: string; label: string; startTime: string; endTime: string };
    days: ({ subject: string; teacher: string | null; room: string | null } | null)[];
  }[];
};

// 반 일주일 시간표 - 팝업.
export function WeekTimetablePopup({ token, classId, title, onClose }: { token: string; classId: string; title: string; onClose: () => void }) {
  const [grid, setGrid] = useState<WeekGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/ops-board/${token}/timetable?classId=${encodeURIComponent(classId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "불러오지 못했습니다.");
        setGrid(json as WeekGrid);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token, classId]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 16, maxWidth: 900, width: "100%", maxHeight: "88vh", overflow: "auto", padding: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <b style={{ fontSize: 24, color: "#fff" }}>📅 {title} 시간표</b>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#94a3b8", fontSize: 28, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        {err ? (
          <div style={{ color: "#fca5a5", fontSize: 15 }}>{err}</div>
        ) : !grid ? (
          <div style={{ color: "#64748b", fontSize: 15 }}>불러오는 중…</div>
        ) : grid.grid.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 15 }}>등록된 시간표가 없습니다.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ padding: 8, fontSize: 14, color: "#64748b", width: 90 }}>교시</th>
                {grid.weekdays.map((d) => (
                  <th key={d} style={{ padding: 8, fontSize: 16, color: "#93c5fd", fontWeight: 800 }}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.grid.map((row) => (
                <tr key={row.period.id}>
                  <td style={{ padding: 8, textAlign: "center", verticalAlign: "middle", background: "#1e293b", borderRadius: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#cbd5e1" }}>{row.period.label}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {row.period.startTime}~{row.period.endTime}
                    </div>
                  </td>
                  {row.days.map((cell, i) => (
                    <td key={i} style={{ padding: 4 }}>
                      <div
                        style={{
                          minHeight: 44,
                          background: cell ? "#172033" : "transparent",
                          border: cell ? "1px solid #334155" : "1px dashed #1e293b",
                          borderRadius: 8,
                          padding: "6px 8px",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                        }}
                      >
                        <div style={{ fontSize: 16, fontWeight: 700, color: cell ? "#fff" : "#334155" }}>{cell?.subject ?? "—"}</div>
                        {cell?.room && <div style={{ fontSize: 11, color: "#64748b" }}>{cell.room}</div>}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
