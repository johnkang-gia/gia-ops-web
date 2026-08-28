"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ChecklistItem, ChecklistRoute } from "./ShuttleChecklistClient";

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

// 학생 하나의 "오늘 실제로 뜨는 노선"입니다. 오늘 하루만 옮긴 게 있으면 그게 우선이고,
// 없으면 영구로 옮긴 노선, 그것도 없으면 평소 정류장 기준 원래 노선입니다.
export function effectiveRouteId(item: ChecklistItem): string {
  return item.overrideRouteId ?? item.permanentRouteId ?? item.homeRouteId;
}

// PDF(하원차량 체크표)와 같은 형태의 노선별 학생 명단 표입니다(순수 표시 담당 - 상태와
// 실시간 동기화는 부모인 ShuttleChecklistClient가 갖고 있습니다). 이름을 드래그해서 다른
// 노선 칸에 놓으면 부모에게 "이동 요청"만 전달하고, 계속 유지할지 오늘만 적용할지는 부모가
// 띄우는 확인창에서 결정됩니다(요청: "차량을 수정하면 계속 수정된채로 있을건지, 오늘만
// 차량이 바뀌는 건지 물어보고"). 뱃지 코너의 메모 아이콘은 특이사항 편집을 부모에게 요청만
// 하고, searchTerm이 있으면 이름이 맞는 뱃지를 노란색으로 강조하고 첫 번째로 맞은 뱃지로
// 스크롤합니다(요청: "이름을 치면 그 학생 이름뱃지 바로 찾을 수 있게... 색이 변해서 어디있는지
// 바로 알 수 있게끔").
export default function ShuttleChecklistTable({
  routes,
  items,
  busyId,
  searchTerm,
  onSetStatus,
  onRequestMove,
  onRequestEditNote,
  onShowSource,
}: {
  routes: ChecklistRoute[];
  items: ChecklistItem[];
  busyId: string | null;
  searchTerm: string;
  onSetStatus: (item: ChecklistItem, nextStatus: ChecklistItem["status"]) => void;
  onRequestMove: (assignmentId: string, targetRouteId: string) => void;
  onRequestEditNote: (assignmentId: string) => void;
  /** 자동 분류 근거(?)를 눌렀을 때. 근거가 있는 항목에만 표시됩니다. */
  onShowSource?: (item: ChecklistItem) => void;
}) {
  const [dragOverRoute, setDragOverRoute] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const badgeRefs = useRef(new Map<string, HTMLDivElement>());

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const sortedRoutes = useMemo(() => [...routes].sort((a, b) => natCompare(a.route_no, b.route_no)), [routes]);

  const itemsByRoute = useMemo(() => {
    const map: Record<string, ChecklistItem[]> = {};
    for (const it of items) {
      const routeId = routeById.has(effectiveRouteId(it)) ? effectiveRouteId(it) : it.homeRouteId;
      (map[routeId] ??= []).push(it);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));
    }
    return map;
  }, [items, routeById]);

  // 요일별로 여러 차에 등록된 학생(예: 곽호율 19호·20호)을 "스위치"처럼 다룹니다(요청: 20호
  // 곽호율을 탑승으로 체크하면 19호 곽호율이 자동으로 옅어지게). 같은 학생이 오늘 다른 차에서
  // 이미 탑승 체크됐으면 나머지 차의 뱃지는 안 타는 것처럼 흐려집니다. 동명이인 구분표기
  // (김재이(G2A) 등)는 괄호 앞부분이 같아도 표기가 다르면 다른 학생이므로 전체 표기로 비교합니다.
  const boardedElsewhere = useMemo(() => {
    const boardedNames = new Map<string, string>(); // studentName -> 탑승 체크된 assignmentId
    for (const it of items) if (it.status === "탑승") boardedNames.set(it.studentName, it.assignmentId);
    const set = new Set<string>();
    for (const it of items) {
      const b = boardedNames.get(it.studentName);
      if (b && b !== it.assignmentId) set.add(it.assignmentId);
    }
    return set;
  }, [items]);

  const trimmedSearch = searchTerm.trim();
  const matchedIds = useMemo(() => {
    if (!trimmedSearch) return new Set<string>();
    return new Set(items.filter((it) => it.studentName.includes(trimmedSearch)).map((it) => it.assignmentId));
  }, [items, trimmedSearch]);

  // 검색어가 바뀔 때만 스크롤합니다(items가 실시간으로 계속 갱신되어도 검색 중에 화면이
  // 제멋대로 다시 스크롤되지 않도록).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (matchedIds.size === 0) return;
    const firstId = [...matchedIds][0];
    const el = badgeRefs.current.get(firstId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedSearch]);

  if (sortedRoutes.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">노선이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:overflow-visible print:rounded-none print:border-black">
      <table className="w-full min-w-[760px] border-collapse text-sm print:min-w-0 print:text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 print:border-black print:bg-white">
            <th className="w-24 px-3 py-2 font-semibold">호차</th>
            <th className="w-32 px-3 py-2 font-semibold">지역</th>
            <th className="w-24 px-3 py-2 font-semibold">기사님</th>
            <th className="px-3 py-2 font-semibold print:hidden">
              학생 (드래그로 노선 이동 · 🚗픽업 · 🚫결석 · <span className="text-blue-600">더블클릭 = 표시 지우기</span>)
            </th>
            <th className="hidden px-3 py-2 font-semibold print:table-cell">학생</th>
          </tr>
        </thead>
        <tbody>
          {sortedRoutes.map((route) => {
            const roster = itemsByRoute[route.id] ?? [];
            const isDragOver = dragOverRoute === route.id;
            return (
              <tr key={route.id} className="border-b border-slate-100 align-top last:border-b-0 print:border-black">
                <td className="px-3 py-2.5 font-bold text-slate-700">{route.route_no}호</td>
                <td className="px-3 py-2.5 text-xs text-slate-600">{route.name ?? ""}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{route.driver_name ?? ""}</td>
                <td
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverRoute(route.id);
                  }}
                  onDragLeave={() => setDragOverRoute((prev) => (prev === route.id ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverRoute(null);
                    const assignmentId = draggingIdRef.current ?? e.dataTransfer.getData("text/plain");
                    if (assignmentId) onRequestMove(assignmentId, route.id);
                  }}
                  className={"px-3 py-2.5 transition-colors " + (isDragOver ? "bg-blue-50 outline outline-2 outline-blue-300 -outline-offset-2" : "")}
                >
                  {roster.length === 0 ? (
                    <span className="text-xs text-slate-300">{isDragOver ? "여기로 놓으면 이 노선으로 이동" : "배정된 학생 없음"}</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {roster.map((item) => {
                        const isPickup = item.status === "픽업";
                        const isAbsent = item.status === "결석";
                        const isBoarded = item.status === "탑승";
                        // 다른 차에서 이미 탑승 체크된 학생(요일별 복수 등록) - 스위치처럼 이쪽을 흐리게(요청).
                        const isSwitchedOff = boardedElsewhere.has(item.assignmentId) && !isPickup && !isAbsent;
                        // 오늘 안 타는 학생(요청: 옅은 회색). 단, 눌러서 탑승으로 바꾼 경우는 정상 표시.
                        const isNonRiding = (item.ridingToday === false && !isBoarded) || isSwitchedOff;
                        const isMovedToday = !!item.overrideRouteId && item.overrideRouteId !== (item.permanentRouteId ?? item.homeRouteId);
                        const isMovedPermanently = !!item.permanentRouteId && item.permanentRouteId !== item.homeRouteId;
                        const isMoved = isMovedToday || isMovedPermanently;
                        const hasNote = !!item.note && item.note.trim().length > 0;
                        const isHighlighted = matchedIds.has(item.assignmentId);
                        const homeRoute = routeById.get(item.homeRouteId);
                        // 요일마다 다른 셔틀을 타는 학생은 같은 색 테두리로 묶고(요청), 오늘 타는
                        // 셔틀은 선명하게(진한 배경+링), 안 타는 날 셔틀은 옅게 보여줍니다(모두
                        // 보이도록 - 갑자기 다른 날 셔틀을 태워달라는 요청에 대비).
                        const gc = item.groupColor ?? null;
                        const isSpecial = isHighlighted || isAbsent || isPickup || isBoarded || isMoved || isSwitchedOff;
                        const useGroup = !!gc && !isSpecial;
                        const ridesToday = item.ridingToday !== false;
                        const groupStyle: CSSProperties | undefined = useGroup
                          ? {
                              borderColor: gc as string,
                              backgroundColor: ridesToday ? `${gc}14` : "#ffffff",
                              color: ridesToday ? undefined : (gc as string),
                              opacity: ridesToday ? 1 : 0.55,
                              boxShadow: ridesToday ? `0 0 0 2px ${gc}33` : undefined,
                            }
                          : undefined;
                        // 잘못 붙은 픽업·결석을 되돌리는 자리.
                        //
                        // 담당자: "아까 멘션까지 읽어서 김요한·이준서·임예나 세 명으로 골라서
                        //          김요한이랑 이준서가 결석으로 됐어 - 더블클릭하면 돌아오게 해줘."
                        //
                        // 작은 🚗/🚫 단추를 정확히 다시 누르는 것보다, 이름을 두 번 치는 쪽이
                        // 빠릅니다. 잘못된 표시는 급할 때 눈에 띄므로 손이 가는 자리에 있어야 합니다.
                        const canReset = isPickup || isAbsent || isBoarded;
                        const tooltip = isSwitchedOff
                          ? "다른 차에서 탑승 체크됨(스위치 전환)"
                          : canReset
                          ? `더블클릭하면 '${item.status}' 표시를 지우고 원래대로 돌립니다`
                          : isMovedToday
                          ? `오늘만 이동됨 (평소 노선: ${homeRoute?.route_no ?? "?"}호) - 드래그해서 되돌릴 수 있어요`
                          : isMovedPermanently
                            ? `계속 이동됨 (평소 노선: ${homeRoute?.route_no ?? "?"}호) - 드래그해서 되돌릴 수 있어요`
                            : "드래그해서 다른 노선으로 이동";
                        return (
                          <div
                            key={item.assignmentId}
                            ref={(el) => {
                              if (el) badgeRefs.current.set(item.assignmentId, el);
                              else badgeRefs.current.delete(item.assignmentId);
                            }}
                            draggable
                            onDragStart={(e) => {
                              draggingIdRef.current = item.assignmentId;
                              e.dataTransfer.setData("text/plain", item.assignmentId);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              draggingIdRef.current = null;
                              setDragOverRoute(null);
                            }}
                            // 같은 상태를 다시 보내면 setStatus가 '예정'으로 되돌립니다(토글).
                            onDoubleClick={() => {
                              if (canReset) onSetStatus(item, item.status);
                            }}
                            title={useGroup && !ridesToday ? `${tooltip} · 오늘은 이 차를 안 타는 날(다른 요일 셔틀)` : tooltip}
                            style={groupStyle}
                            className={
                              "relative flex cursor-grab select-none flex-col items-center gap-0.5 rounded-lg border px-2 py-1 text-xs font-semibold transition-all active:cursor-grabbing print:border-black print:px-1 print:py-0.5 " +
                              (isHighlighted
                                ? "border-yellow-500 bg-yellow-300 text-yellow-950 ring-4 ring-yellow-300"
                                : isAbsent
                                  ? "border-red-300 bg-red-50 text-red-500 line-through"
                                  : isPickup
                                    ? "border-pink-400 bg-pink-100 text-pink-700"
                                    : isBoarded
                                      ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                      : useGroup
                                        ? "border-2"
                                        : isNonRiding
                                          ? "border-slate-100 bg-white text-slate-200 opacity-40 grayscale"
                                          : isMovedToday
                                            ? "border-amber-400 bg-amber-50 text-amber-700"
                                            : isMovedPermanently
                                              ? "border-purple-400 bg-purple-50 text-purple-700"
                                              : "border-slate-300 bg-white text-slate-700")
                            }
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRequestEditNote(item.assignmentId);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              title={hasNote ? `특이사항: ${item.note}` : "특이사항 메모 추가"}
                              className={
                                "absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border text-[8px] font-bold leading-none print:hidden " +
                                (hasNote ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-300 hover:text-slate-500")
                              }
                            >
                              {hasNote ? "!" : "+"}
                            </button>
                            {/* 자동 분류 근거.
                                담당자: "픽업 처리된 애들 어떤 토들이나 구글챗으로 분류되었는지
                                         (...) 자동으로 분류되는 거 이유가 뭔지 보고 싶어."
                                오른쪽 위 특이사항(!)과 헷갈리지 않도록 **왼쪽 아래**에 둡니다.
                                사람이 직접 누른 경우에는 근거가 없으니 이 표시도 없습니다 -
                                표시가 있다는 것 자체가 "이건 기계가 붙였다"는 뜻입니다. */}
                            {(isPickup || isAbsent) && (
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onShowSource?.(item);
                                }}
                                onMouseDown={(ev) => ev.stopPropagation()}
                                onDoubleClick={(ev) => ev.stopPropagation()}
                                title={
                                  item.autoSource
                                    ? `${item.autoSource.source} · 눌러서 근거 보기`
                                    : "왜 이렇게 표시됐는지 눌러서 확인하세요"
                                }
                                className={
                                  "absolute -bottom-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full border text-[8px] font-bold leading-none text-white print:hidden " +
                                  // 근거를 못 찾은 것은 회색이 아니라 **주황**입니다. 사선이 그어져
                                  // 있는데 이유를 모른다는 건 그냥 정보가 없는 게 아니라
                                  // 확인해야 할 일이라서, 눈에 띄어야 합니다.
                                  (item.autoSource ? "border-sky-500 bg-sky-500" : "border-orange-500 bg-orange-500")
                                }
                              >
                                ?
                              </button>
                            )}
                            {/* 픽업·결석은 뱃지 전체에 사선 실선을 그어 "오늘 이 차를 안 탄다"를
                                시각적으로 확실하게 보여줍니다(요청 3). 결석=빨간 사선, 픽업=분홍 사선. */}
                            {(isPickup || isAbsent) && (
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-0 rounded-lg"
                                style={{
                                  backgroundImage: `linear-gradient(to top right, transparent 46.5%, ${isAbsent ? "rgba(220,38,38,0.75)" : "rgba(219,39,119,0.65)"} 46.5%, ${isAbsent ? "rgba(220,38,38,0.75)" : "rgba(219,39,119,0.65)"} 53.5%, transparent 53.5%)`,
                                }}
                              />
                            )}
                            <span>
                              {isMoved && (isMovedToday ? "↔ " : "⇄ ")}
                              {item.studentName}
                              {item.individualPickup && (
                                <span className="ml-1 rounded-full bg-orange-100 px-1 text-[8px] font-bold text-orange-700 print:hidden">개별하원</span>
                              )}
                            </span>
                            <span className="flex gap-1 print:hidden">
                              {item.ridingToday === false ? (
                                // 오늘 안 타는 학생 - 눌러서 오늘 탑승으로(요청). 다시 누르면 취소.
                                <button
                                  type="button"
                                  onClick={() => onSetStatus(item, "탑승")}
                                  disabled={busyId === item.assignmentId}
                                  title={isBoarded ? "오늘 탑승 취소" : "오늘 갑자기 탑승"}
                                  className={
                                    "rounded px-1.5 text-[10px] font-bold disabled:opacity-40 " +
                                    (isBoarded ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-emerald-100")
                                  }
                                >
                                  🚌 탑승
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onSetStatus(item, "픽업")}
                                    disabled={busyId === item.assignmentId}
                                    title="픽업(부모님이 직접 데려가심)"
                                    className={
                                      "rounded px-1 text-[10px] disabled:opacity-40 " +
                                      (isPickup ? "bg-pink-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-pink-100")
                                    }
                                  >
                                    🚗
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onSetStatus(item, "결석")}
                                    disabled={busyId === item.assignmentId}
                                    title="결석"
                                    className={
                                      "rounded px-1 text-[10px] disabled:opacity-40 " +
                                      (isAbsent ? "bg-red-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-red-100")
                                    }
                                  >
                                    🚫
                                  </button>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
