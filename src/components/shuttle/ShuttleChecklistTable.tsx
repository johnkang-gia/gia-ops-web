"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { normName } from "@/lib/studentLabel";
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
  enByAssignment,
  onSetStatus,
  onRequestMove,
  onRequestEditNote,
  onShowSource,
  whereByName,
}: {
  routes: ChecklistRoute[];
  items: ChecklistItem[];
  /**
   * 동명이인 이름 → "3학년 Brown A".
   *
   * **겹치는 이름만** 들어 있습니다. 한 명뿐인 이름에까지 학년·반을 붙이면 표가 글자로
   * 가득 차고, 정작 구분이 필요한 이름이 묻힙니다.
   */
  whereByName?: Map<string, string>;
  busyId: string | null;
  searchTerm: string;
  /**
   * 배정 id → 그 학생의 영어 이름. 검색에만 씁니다(표에는 한글 이름만 나옵니다).
   *
   * 명부와의 대조는 부모(ShuttleChecklistClient)에서 이미 끝냈습니다 - 여기서는 결과만
   * 받습니다. 못 찾은 학생은 아예 들어 있지 않습니다.
   */
  enByAssignment?: Map<string, string>;
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


  // 배정된 학생이 하나도 없는 호차는 표에서 뺍니다.
  //
  // 담당자: "하원체크표에 배정된 학생 없는 호차는 안 나오게 해줘."
  //
  // 빈 줄은 화면만 늘리는 게 아니라, 급할 때 **옆 줄을 잘못 짚게** 만듭니다.
  // 이름을 끌어 옮길 자리가 필요할 수 있어 드래그 중에는 그대로 둡니다.
  const sortedRoutes = useMemo(
    () =>
      [...routes]
        .filter((r) => (itemsByRoute[r.id]?.length ?? 0) > 0 || dragOverRoute === r.id || draggingIdRef.current !== null)
        .sort((a, b) => natCompare(a.route_no, b.route_no)),
    [routes, itemsByRoute, dragOverRoute]
  );
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
  // 한글 이름과 영어 이름 **둘 다** 봅니다.
  //
  // 담당자: "하원 체크표에서 아이들 영어이름으로도 검색할 수 있게 해줘."
  //
  // 영어 이름은 대소문자를 가리지 않고, 공백도 무시합니다 - "Ella Kim"을 "ellakim"으로도,
  // 성만 쳐도 찾히게 하기 위해서입니다. 표에 보이는 글자는 그대로 한글 이름입니다.
  const matchedIds = useMemo(() => {
    if (!trimmedSearch) return new Set<string>();
    const q = trimmedSearch.toLowerCase();
    const qNoSpace = normName(q);
    return new Set(
      items
        .filter((it) => {
          if (it.studentName.includes(trimmedSearch)) return true;
          const en = enByAssignment?.get(it.assignmentId);
          if (!en) return false;
          const lower = en.toLowerCase();
          return lower.includes(q) || normName(lower).includes(qNoSpace);
        })
        .map((it) => it.assignmentId),
    );
  }, [items, trimmedSearch, enByAssignment]);

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
    <div className="overflow-x-auto g-panel-solid print:overflow-visible print:rounded-none print:border-black">
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
                {/* 호차 + 차량번호(담당자 요청).
                    차량번호는 이미 노선에 저장돼 있었는데 **인쇄본에만** 쓰고 화면에서는
                    안 보여주고 있었습니다. 정작 차를 찾는 건 화면 보면서 하는 일입니다.
                    호차 아래 한 줄로 두는 이유: 옆에 붙이면 이 칸이 넓어져 학생 이름이
                    들어갈 자리를 뺏습니다. */}
                <td className="px-3 py-2.5 font-bold text-slate-700">
                  <div>{route.route_no}호</div>
                  {route.vehicle_no ? (
                    // 뒤 네 자리를 크고 진하게.
                    //
                    // 담당자: "호차보다도 차량번호로 호차를 구별하는 경우가 많아서."
                    // 사람이 외우고 부르는 건 뒤 네 자리입니다 - "77수"는 거의 모든 차가
                    // 비슷해서 구별에 쓸모가 없습니다. 종이(인쇄본)와 같은 규칙으로 둡니다.
                    (() => {
                      const m = route.vehicle_no.trim().match(/^(.*?)(\d{4})$/);
                      const head = m ? m[1].trim() : route.vehicle_no.trim();
                      const tail = m ? m[2] : "";
                      return (
                        <div className="mt-0.5 leading-tight">
                          {head && <div className="font-mono text-[9px] font-medium text-slate-400">{head}</div>}
                          {tail && <div className="font-mono text-[13px] font-bold tracking-wide text-slate-600">{tail}</div>}
                        </div>
                      );
                    })()
                  ) : (
                    // 비어 있으면 비었다고 말해줍니다 - 아무것도 없으면 "안 적었나 없나"를
                    // 매번 다시 확인하게 됩니다. 눌러서 바로 채울 수 있게 노선 관리로 보냅니다.
                    <a
                      href="/shuttle/routes"
                      className="mt-0.5 block text-[10px] font-medium text-slate-300 hover:text-blue-500 print:hidden"
                      title="노선 관리에서 차량번호를 채울 수 있습니다"
                    >
                      차번호 없음
                    </a>
                  )}
                </td>
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
                        // **오늘만 옮긴 아이만 표시합니다.**
                        //
                        // 예전에는 "계속 유지"로 옮긴 아이에게도 보라색 ⇄ 딱지를 붙였습니다.
                        // 그런데 계속 옮겨진 아이에게는 그게 평소 상태입니다 - 송우진·송윤진은
                        // 28호에서 27호로 옮긴 뒤로 쭉 27호를 타는데, 매일 표에 "옮겨진 아이"로
                        // 표시돼 있었습니다. 매일 켜져 있는 표시는 며칠이면 배경이 되고, 정작
                        // 오늘 진짜 옮긴 아이가 그 옆에 있어도 묻힙니다.
                        //
                        // 계속 옮긴 아이는 다른 아이들과 똑같이 보입니다. 표시가 필요한 것은
                        // "오늘 평소와 다른" 경우뿐입니다.
                        const isMovedToday = !!item.overrideRouteId && item.overrideRouteId !== (item.permanentRouteId ?? item.homeRouteId);
                        const isMovedPermanently = !!item.permanentRouteId && item.permanentRouteId !== item.homeRouteId;
                        const isMoved = isMovedToday;
                        const hasNote = !!item.note && item.note.trim().length > 0;
                        const isHighlighted = matchedIds.has(item.assignmentId);
                        // 영어 이름으로 찾았을 때 **찾은 결과가 맞는지 확인할 수 있어야** 합니다.
                        // 표는 한글 이름만 보여주므로, "Ella"로 찾았는데 노란 뱃지에 한글만
                        // 떠 있으면 같은 아이인지 확신할 수 없습니다. 강조된 동안만 밑에
                        // 영어 이름을 붙입니다 - 평소에는 표가 두 줄로 늘어나지 않습니다.
                        const enName = isHighlighted ? enByAssignment?.get(item.assignmentId) : undefined;
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
                            // 화면에는 표시하지 않지만(이 아이에겐 이게 평소입니다), 마우스를
                            // 올리면 원래 배정이 어디였는지는 알 수 있어야 합니다.
                            ? `${homeRoute?.route_no ?? "?"}호에서 옮겨져 계속 이 차를 탑니다 - 드래그해서 되돌릴 수 있어요`
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
                              {isMovedToday && "↔ "}
                              {item.studentName}
                              {/* 동명이인일 때만 학년·반(담당자 요청: "김재이" 같은 경우).
                                  인쇄본에도 남깁니다 - 종이에서 헷갈리는 게 더 위험합니다. */}
                              {whereByName?.get(normName(item.studentName)) && (
                                <span
                                  className="ml-0.5 align-baseline text-[8px] font-semibold text-slate-400"
                                  title={`같은 이름이 여러 명이라 학년·반을 함께 적습니다`}
                                >
                                  {whereByName.get(normName(item.studentName))}
                                </span>
                              )}
                              {item.individualPickup && (
                                <span className="ml-1 rounded-full bg-orange-100 px-1 text-[8px] font-bold text-orange-700 print:hidden">개별하원</span>
                              )}
                              {/* 오늘 요일의 하원수단이 셔틀이 아닌 아이. **인쇄본에도 남깁니다** -
                                  종이를 들고 있는 동승 선생님이 "이 아이는 어디로 가는가"를
                                  물어볼 곳이 종이뿐입니다. */}
                              {item.dismissalPlan && (
                                <span
                                  className="ml-1 rounded-full bg-violet-100 px-1 text-[8px] font-bold text-violet-700"
                                  title={`오늘 하원수단: ${item.dismissalPlan.kind}${item.dismissalPlan.label ? " " + item.dismissalPlan.label : ""}${item.dismissalPlan.departTime ? " " + item.dismissalPlan.departTime : ""} — 학생 프로필에서 고칩니다`}
                                >
                                  {item.dismissalPlan.departTime ? item.dismissalPlan.departTime + " " : ""}
                                  {item.dismissalPlan.label ?? item.dismissalPlan.kind}
                                </span>
                              )}
                            </span>
                            {enName && (
                              <span className="max-w-[9rem] truncate text-[9px] font-medium leading-none text-yellow-800/70 print:hidden">
                                {enName}
                              </span>
                            )}
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
