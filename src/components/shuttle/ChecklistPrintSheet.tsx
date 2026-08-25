"use client";

import { useMemo } from "react";
import type { ChecklistItem, ChecklistRoute } from "./ShuttleChecklistClient";
import { effectiveRouteId } from "./ShuttleChecklistTable";

// 인쇄 전용 체크표(요청: 보내주신 "하원차량 체크" PDF와 같은 모양으로 나오게).
// PDF 서식: [차번호 | 번호(연락처) | 차량번호(호차) | 아동이름 …가로로 여러 칸]
// 화면용 표(드래그·버튼·색상)는 인쇄에서 감추고, 이 표만 흑백 실선으로 나갑니다.
const NAME_COLS = 9; // 이름 칸 수(PDF와 동일하게 넉넉히)

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}
const WD = ["일", "월", "화", "수", "목", "금", "토"];

// 전화번호를 PDF처럼 두 덩이(가운데+뒤)로 나눠 두 줄로 보여줍니다. 010은 생략합니다.
function phoneLines(phone: string | null | undefined): string[] {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 8) return phone ? [phone] : [];
  const tail = d.slice(-8);
  return [tail.slice(0, 4), tail.slice(4)];
}

export default function ChecklistPrintSheet({
  routes,
  items,
  dateLabel,
}: {
  routes: ChecklistRoute[];
  items: ChecklistItem[];
  dateLabel: string;
}) {
  const sortedRoutes = useMemo(() => [...routes].sort((a, b) => natCompare(a.route_no, b.route_no)), [routes]);
  const todayW = new Date().getDay();

  const byRoute = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    const ids = new Set(routes.map((r) => r.id));
    for (const it of items) {
      const rid = ids.has(effectiveRouteId(it)) ? effectiveRouteId(it) : it.homeRouteId;
      (map.get(rid) ?? map.set(rid, []).get(rid)!).push(it);
    }
    for (const [, list] of map) list.sort((a, b) => a.stopSeq - b.stopSeq || a.studentName.localeCompare(b.studentName, "ko"));
    return map;
  }, [items, routes]);

  return (
    <div className="hidden print:block">
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          .gia-print-sheet { font-family: inherit; }
          .gia-print-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .gia-print-sheet th, .gia-print-sheet td {
            border: 1px solid #000; padding: 2px 3px; font-size: 8.5pt; line-height: 1.15;
            color: #000; vertical-align: middle; word-break: keep-all; overflow-wrap: anywhere;
          }
          .gia-print-sheet thead th { background: #f1f1f1 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; text-align: center; font-weight: 700; }
          .gia-print-sheet tr { page-break-inside: avoid; }
          .gia-print-sheet .c-num { width: 8%; text-align: center; }
          .gia-print-sheet .c-tel { width: 9%; text-align: center; font-size: 7.5pt; }
          .gia-print-sheet .c-bus { width: 8%; text-align: center; font-weight: 700; }
          .gia-print-sheet .c-name { width: 8.3%; text-align: center; }
          /* 픽업·결석은 이름 위에 사선 실선(화면과 같은 표시). */
          .gia-print-sheet .out { position: relative; }
          .gia-print-sheet .out::after {
            content: ""; position: absolute; left: 4%; right: 4%; top: 50%;
            border-top: 1.2px solid #000; transform: rotate(-14deg);
          }
        }
      `}</style>

      <div className="gia-print-sheet">
        <table>
          <thead>
            <tr>
              <th className="c-num">{dateLabel}</th>
              <th className="c-tel">번호</th>
              <th className="c-bus">차량번호</th>
              <th colSpan={NAME_COLS}>아동이름</th>
            </tr>
            <tr>
              <th className="c-num">차번호</th>
              <th className="c-tel">기사님</th>
              <th className="c-bus">호차</th>
              {Array.from({ length: NAME_COLS }).map((_, i) => (
                <th key={i} className="c-name">
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRoutes.map((r) => {
              const roster = byRoute.get(r.id) ?? [];
              const tel = phoneLines(r.driver_phone);
              return (
                <tr key={r.id}>
                  <td className="c-num">{r.vehicle_no ?? ""}</td>
                  <td className="c-tel">
                    {r.driver_name ?? ""}
                    {tel.length > 0 && (
                      <>
                        <br />
                        {tel[0]}
                        {tel[1] ? <><br />{tel[1]}</> : null}
                      </>
                    )}
                  </td>
                  <td className="c-bus">{r.route_no}호</td>
                  {Array.from({ length: NAME_COLS }).map((_, i) => {
                    const it = roster[i];
                    if (!it) return <td key={i} className="c-name" />;
                    // 요일제 학생은 PDF처럼 이름 앞에 (월수금) 표기.
                    const partial = it.weekdays && it.weekdays.length > 0 && it.weekdays.length < 5;
                    const dayPrefix = partial ? `(${it.weekdays!.map((d) => WD[d]).join("")})` : "";
                    const isOut = it.status === "픽업" || it.status === "결석";
                    const notToday = it.weekdays ? !it.weekdays.includes(todayW) && it.status !== "탑승" : false;
                    return (
                      <td key={i} className={"c-name " + (isOut ? "out" : "")} style={notToday ? { color: "#888" } : undefined}>
                        {dayPrefix}
                        {it.studentName}
                        {it.status === "픽업" ? " (픽업)" : it.status === "결석" ? " (결석)" : ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
