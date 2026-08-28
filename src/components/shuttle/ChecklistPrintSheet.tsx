"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ChecklistItem, ChecklistRoute } from "./ShuttleChecklistClient";
import { effectiveRouteId } from "./ShuttleChecklistTable";

// 인쇄 전용 하원 체크표 - A4 세로 한 장.
//
// 담당자: "아직도 차량 짤려."
//
// 글자 크기를 단계로 줄이는 방식으로는 못 맞춥니다. 노선 수도 인원도 날마다 달라서, 어떤
// 단계를 골라도 어떤 날은 넘칩니다. 그리고 넘치면 **다음 장으로 밀린 노선이 통째로 사라진
// 것처럼 보입니다** - 한 장만 들고 나간 분은 그 차 아이들을 놓칩니다.
//
// 그래서 짐작을 그만두고 **실제로 재서 맞춥니다.** 화면 밖에 A4 폭(741px = 196mm)으로
// 똑같이 그려두고 높이를 잰 뒤, 한 장 높이를 넘으면 그만큼 축소해서 인쇄합니다.
// 몇 명이 타든 반드시 한 장입니다.

// A4 세로에서 여백(7mm)을 뺀 실제 인쇄 영역. 1mm = 96/25.4 px.
const MM = 96 / 25.4;
const PAGE_W = Math.floor((210 - 14) * MM); // 741px
const PAGE_H = Math.floor((297 - 14) * MM); // 1069px

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

// 전화번호는 뒤 8자리만. 010은 다 같으니 종이에서는 자리만 차지합니다.
function shortPhone(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 8) return phone ?? "";
  const tail = d.slice(-8);
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
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
  const todayW = new Date().getDay();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // 오늘 타는 아이만. 판단은 화면이 이미 해둔 ridingToday를 그대로 씁니다 - 여기서 다시
  // 계산하면 화면과 종이가 서로 다른 답을 낼 수 있고, 그게 가장 위험합니다.
  const { byRoute, riding, pickedUp, absent } = useMemo(() => {
    const ids = new Set(routes.map((r) => r.id));
    const map = new Map<string, ChecklistItem[]>();
    let riding = 0;
    let pickedUp = 0;
    let absent = 0;

    for (const it of items) {
      if (it.status === "픽업") {
        pickedUp += 1;
        continue;
      }
      if (it.status === "결석") {
        absent += 1;
        continue;
      }
      const ridesToday =
        it.status === "탑승" ||
        (it.ridingToday ?? (!it.weekdays || it.weekdays.length === 0 || it.weekdays.includes(todayW)));
      if (!ridesToday) continue;

      const rid = ids.has(effectiveRouteId(it)) ? effectiveRouteId(it) : it.homeRouteId;
      const list = map.get(rid) ?? [];
      list.push(it);
      map.set(rid, list);
      riding += 1;
    }
    // 기사님이 도는 순서(정류장 순서)와 같아야 종이가 쓸모 있습니다.
    for (const [, list] of map) {
      list.sort((a, b) => a.stopSeq - b.stopSeq || a.studentName.localeCompare(b.studentName, "ko"));
    }
    return { byRoute: map, riding, pickedUp, absent };
  }, [items, routes, todayW]);

  // 오늘 아무도 안 타는 노선은 뺍니다. 빈 줄이 자리를 잡아먹습니다.
  const sortedRoutes = useMemo(
    () => [...routes].filter((r) => (byRoute.get(r.id) ?? []).length > 0).sort((a, b) => natCompare(a.route_no, b.route_no)),
    [routes, byRoute]
  );

  // 실제 높이를 재서 한 장에 맞춥니다.
  //
  // 화면 밖에 인쇄와 똑같은 폭으로 그려두었으므로, 여기서 잰 높이가 곧 종이에서의 높이입니다.
  // 내용이 바뀔 때마다(픽업 체크 등) 다시 잽니다.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;

    const measure = (sync: boolean) => {
      const h = el.scrollHeight;
      if (h <= 0) return;
      // 여유 6px를 뺍니다. 딱 맞추면 반올림 하나에 다음 장이 생깁니다.
      const next = h > PAGE_H - 6 ? Math.max(0.25, (PAGE_H - 6) / h) : 1;
      const apply = () => setScale(next);
      // 인쇄 직전에는 **화면에 즉시 반영**되어야 합니다. 평소처럼 다음 렌더를 기다리면
      // 브라우저가 그 전 상태를 그대로 종이에 찍습니다 - 계산은 맞는데 종이만 틀린 상황.
      if (sync) flushSync(apply);
      else apply();
    };

    measure(false);
    // 한글 글꼴이 늦게 붙으면 줄 높이가 달라집니다. 붙고 나서 한 번 더 잽니다.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => measure(false));
    }
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(el);
    const onBefore = () => measure(true);
    window.addEventListener("beforeprint", onBefore);
    return () => {
      ro.disconnect();
      window.removeEventListener("beforeprint", onBefore);
    };
  }, [sortedRoutes, byRoute]);

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 7mm; }
        /* 화면에서는 자리를 차지하지 않게 밖으로 밀어둡니다(높이를 재려면 그려져 있어야 합니다). */
        .gia-print-wrap { position: absolute; left: -99999px; top: 0; }
        @media print {
          .gia-print-wrap { position: static; left: auto; }
          /* 화면용 요소는 인쇄에서 모두 감춥니다(체크표 화면 자체는 별도 print:hidden 처리). */
        }
        .gia-print-sheet { width: ${PAGE_W}px; color: #000; transform-origin: top left; }
        .gia-print-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .gia-print-sheet th, .gia-print-sheet td {
          border: 1px solid #000; padding: 2px 3px; font-size: 9pt; line-height: 1.2;
          color: #000; vertical-align: middle; word-break: keep-all; overflow-wrap: anywhere;
        }
        .gia-print-sheet thead th {
          background: #ececec !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;
          text-align: center; font-weight: 700;
        }
        .gia-print-sheet .c-bus  { width: 9%;  text-align: center; font-weight: 700; }
        .gia-print-sheet .c-veh  { width: 14%; text-align: center; }
        .gia-print-sheet .c-drv  { width: 17%; text-align: center; }
        .gia-print-sheet .c-cnt  { width: 6%;  text-align: center; font-weight: 700; }
        .gia-print-sheet .c-kids { text-align: left; }
        /* 이름은 칸 수 제한 없이 한 칸 안에 늘어놓습니다. 몇 명이든 다 나옵니다. */
        .gia-print-sheet .kid {
          display: inline-block; border: 1px solid #000; border-radius: 2px;
          padding: 0 3px; margin: 1px 2px 1px 0; font-size: 9pt; white-space: nowrap;
        }
        .gia-print-sheet .head { margin: 0 0 4px; font-size: 11pt; font-weight: 700; }
      `}</style>

      <div className="gia-print-wrap" aria-hidden>
        {/* 축소는 바깥 상자에 겁니다. 안쪽은 항상 A4 폭 그대로 그려서 높이를 잽니다. */}
        {/* 축소는 겉보기만 줄일 뿐 자리(높이)는 그대로라, 그 상태로는 브라우저가 여전히
            "넘친다"고 보고 다음 장을 만듭니다. 그래서 줄어든 만큼 상자 높이도 같이 줄입니다. */}
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: PAGE_W,
            // 상자 높이는 **한 장 그대로**입니다.
            //
            // 앞 판은 "잰 높이 × 축소비"로 잡았는데, 그 잰 값이 조금이라도 작으면 상자가
            // 내용보다 짧아지고 overflow:hidden이 **나머지를 잘라 없앴습니다.** 담당자가
            // 본 "26-2호까지밖에 안 나온다"가 정확히 그것입니다 - 다음 장으로 넘어간 게
            // 아니라 그냥 사라진 겁니다.
            //
            // 한 장 높이로 두면, 재기가 틀려도 잘리는 일이 없습니다(축소가 조금 모자라면
            // 한 장을 꽉 채울 뿐입니다).
            height: PAGE_H,
            overflow: "hidden",
          }}
        >
          <div className="gia-print-sheet" ref={sheetRef}>
            {/* 담당자: "맨 위에 하원체크표는 필요 없고, 몇 년 몇 월 몇 일 몇 요일인지,
                탑승 인원 몇인지만." */}
            <div className="head">
              {dateLabel} · 탑승 {riding}명
              {pickedUp > 0 && <> · 픽업 {pickedUp}</>}
              {absent > 0 && <> · 결석 {absent}</>}
            </div>

            <table>
              <thead>
                <tr>
                  <th className="c-bus">호차</th>
                  <th className="c-veh">차량번호</th>
                  <th className="c-drv">기사님</th>
                  <th className="c-cnt">인원</th>
                  <th className="c-kids">탑승 학생</th>
                </tr>
              </thead>
              <tbody>
                {sortedRoutes.map((r) => {
                  const roster = byRoute.get(r.id) ?? [];
                  const tel = shortPhone(r.driver_phone);
                  return (
                    <tr key={r.id}>
                      <td className="c-bus">{r.route_no}호</td>
                      <td className="c-veh">{r.vehicle_no ?? ""}</td>
                      <td className="c-drv">
                        {r.driver_name ?? ""}
                        {tel && (
                          <>
                            <br />
                            {tel}
                          </>
                        )}
                      </td>
                      <td className="c-cnt">{roster.length}</td>
                      <td className="c-kids">
                        {/* 담당자: "인쇄지에 요일은 빼고 이름만 깔끔하게. 화면에서는 어차피
                            요일 계산되어서 다 나오니까." - 종이에는 오늘 타는 아이만 있으므로
                            요일은 알려주는 것이 없고 줄만 길어집니다. */}
                        {roster.map((it) => (
                          <span key={it.assignmentId} className="kid">
                            {it.studentName}
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
