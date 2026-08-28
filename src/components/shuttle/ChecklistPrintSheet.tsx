"use client";

import { useMemo } from "react";
import type { ChecklistItem, ChecklistRoute } from "./ShuttleChecklistClient";
import { effectiveRouteId } from "./ShuttleChecklistTable";

// 인쇄 전용 하원 체크표.
//
// 담당자: "A4 한 장에 들어가게 만들어줘. 지금 하원체크표에 되어 있는 그대로 인쇄되게 하고,
//          위젯 그대로가 아니라 표로 깔끔하게, 오늘 타는 아이들만 보이도록."
//
// 예전 판은 **이름 칸을 9개로 고정**해 두었습니다. 이건 보기 문제가 아니라 사고입니다 -
// 열 명이 넘게 타는 노선에서 열 번째부터는 **아무 표시 없이 그냥 사라졌습니다.** 종이만
// 보고 태우는 분은 그 아이가 원래 없는 줄 압니다.
//
// 그래서 칸 수를 없앴습니다. 이름은 한 칸 안에 작은 상자로 죽 늘어놓습니다. 몇 명이든
// 다 나오고, 줄 높이만 늘어납니다.
//
// 오늘 안 타는 학생(다른 요일제·픽업·결석)은 아예 빼고, 대신 맨 위에 "픽업 2 · 결석 1"로
// 몇 명이 빠졌는지만 적습니다. 종이에서 빠진 이유를 알 수 없으면 "왜 얘가 없지"를 다시
// 물어보게 되기 때문입니다.

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}
const WD = ["일", "월", "화", "수", "목", "금", "토"];

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

  // 오늘 타는 아이만. 판단 기준은 화면과 같습니다.
  //   · 오늘 요일에 배정돼 있고
  //   · 픽업·결석으로 빠지지 않았고
  //   · (이미 탄 것으로 체크된 학생은 요일과 무관하게 태웁니다 - 실제로 탔으니까)
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
      // 화면이 이미 계산해 둔 ridingToday를 그대로 씁니다. 여기서 요일을 다시 계산하면
      // 화면과 종이가 서로 다른 답을 낼 수 있습니다 - 그게 가장 위험합니다.
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
    // 정류장 순서대로. 기사님이 도는 순서와 같아야 종이가 쓸모 있습니다.
    for (const [, list] of map) {
      list.sort((a, b) => a.stopSeq - b.stopSeq || a.studentName.localeCompare(b.studentName, "ko"));
    }
    return { byRoute: map, riding, pickedUp, absent };
  }, [items, routes, todayW]);

  // 오늘 아무도 안 타는 노선은 종이에서 뺍니다. 빈 줄이 A4 한 장을 잡아먹습니다.
  const sortedRoutes = useMemo(
    () => [...routes].filter((r) => (byRoute.get(r.id) ?? []).length > 0).sort((a, b) => natCompare(a.route_no, b.route_no)),
    [routes, byRoute]
  );

  // A4 한 장에 맞추기.
  //
  // 줄 수와 이름 수에 따라 글자를 단계적으로 줄입니다. 인쇄는 "넘치면 다음 장"이 되는데,
  // 두 장으로 갈라지면 한 장만 들고 나가서 뒷장 아이들을 놓칩니다. 넘치느니 작게 뽑습니다.
  const density = sortedRoutes.length * 2 + riding;
  const tier = density <= 90 ? 0 : density <= 130 ? 1 : density <= 180 ? 2 : 3;
  const baseFont = [8.5, 7.8, 7.1, 6.4][tier];
  const nameFont = [8.5, 7.8, 7.2, 6.6][tier];
  const cellPad = [2.2, 1.8, 1.4, 1.1][tier];

  return (
    <div className="hidden print:block">
      <style>{`
        @page { size: A4 portrait; margin: 7mm; }
        @media print {
          .gia-print-sheet { color: #000; }
          .gia-print-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .gia-print-sheet th, .gia-print-sheet td {
            border: 1px solid #000; padding: ${cellPad}px 3px; font-size: ${baseFont}pt;
            line-height: 1.15; color: #000; vertical-align: middle;
            word-break: keep-all; overflow-wrap: anywhere;
          }
          .gia-print-sheet thead th {
            background: #ececec !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;
            text-align: center; font-weight: 700;
          }
          /* 노선 줄이 페이지 경계에서 잘리면 명단 절반이 다음 장으로 넘어갑니다. */
          .gia-print-sheet tr { page-break-inside: avoid; break-inside: avoid; }
          .gia-print-sheet thead { display: table-header-group; }

          .gia-print-sheet .c-bus  { width: 9%;  text-align: center; font-weight: 700; }
          .gia-print-sheet .c-veh  { width: 13%; text-align: center; }
          .gia-print-sheet .c-drv  { width: 16%; text-align: center; }
          .gia-print-sheet .c-cnt  { width: 6%;  text-align: center; font-weight: 700; }
          .gia-print-sheet .c-kids { text-align: left; }

          /* 이름은 칸 수 제한 없이 한 칸 안에 늘어놓습니다. 몇 명이든 다 나옵니다. */
          .gia-print-sheet .kid {
            display: inline-block; border: 1px solid #000; border-radius: 2px;
            padding: 0 3px; margin: 1px 2px 1px 0; font-size: ${nameFont}pt; white-space: nowrap;
          }
          .gia-print-sheet .kid .wd { font-size: ${(nameFont - 1.4).toFixed(1)}pt; }
          .gia-print-sheet .head {
            display: flex; align-items: baseline; justify-content: space-between;
            margin: 0 0 3px; font-size: ${(baseFont + 1.5).toFixed(1)}pt;
          }
          .gia-print-sheet .head b { font-size: ${(baseFont + 3).toFixed(1)}pt; }
          .gia-print-sheet .sign { margin-top: 4px; font-size: ${(baseFont - 0.8).toFixed(1)}pt; text-align: right; }
        }
      `}</style>

      <div className="gia-print-sheet">
        <div className="head">
          <span>
            <b>하원 차량 체크표</b> &nbsp; {dateLabel}
          </span>
          <span>
            탑승 {riding}명 · 노선 {sortedRoutes.length}대
            {pickedUp > 0 && <> · 픽업 {pickedUp}</>}
            {absent > 0 && <> · 결석 {absent}</>}
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th className="c-bus">호차</th>
              <th className="c-veh">차량번호</th>
              <th className="c-drv">기사님</th>
              <th className="c-cnt">인원</th>
              <th className="c-kids">탑승 학생 (정류장 순서)</th>
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
                    {roster.map((it) => {
                      // 요일제 학생은 이름 앞에 (월수금)을 붙여 왜 어떤 날은 없는지 알 수 있게 합니다.
                      const partial = it.weekdays && it.weekdays.length > 0 && it.weekdays.length < 5;
                      return (
                        <span key={it.assignmentId} className="kid">
                          {partial && <span className="wd">({it.weekdays!.map((d) => WD[d]).join("")}) </span>}
                          {it.studentName}
                        </span>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="sign">인쇄 {new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })}</div>
      </div>
    </div>
  );
}
