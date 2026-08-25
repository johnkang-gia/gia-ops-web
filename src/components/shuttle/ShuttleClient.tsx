"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShuttleAssignment, ShuttleDirection, ShuttleRoute, ShuttleStop } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";
import { DIVISION_BADGE, divisionFromClassRaw, needsRosterAttention } from "@/lib/shuttleDivision";
import RouteMap from "@/components/shuttle/RouteMap";

const WEEKDAY_LABEL = ["", "월", "화", "수", "목", "금"];

// weekdays(1~5 배열)를 "매일" 또는 "월수금"처럼 사람이 읽는 형태로 바꿉니다.
export function weekdaysLabel(wd: number[]): string {
  const sorted = [...new Set(wd)].sort();
  if (sorted.length === 5) return "매일";
  return sorted.map((d) => WEEKDAY_LABEL[d]).join("");
}

export default function ShuttleClient({
  routes: initialRoutes,
  stops,
  assignments,
  canEdit,
}: {
  routes: ShuttleRoute[];
  stops: ShuttleStop[];
  assignments: ShuttleAssignment[];
  canEdit: boolean;
}) {
  const notify = useToast();
  const [routes, setRoutes] = useState(initialRoutes);
  const [direction, setDirection] = useState<ShuttleDirection>("등원");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<ShuttleRoute>>({});
  const [focusStopId, setFocusStopId] = useState<string | null>(null);

  const stopsByRoute = useMemo(() => {
    const m = new Map<string, ShuttleStop[]>();
    for (const s of stops) {
      const arr = m.get(s.route_id) ?? [];
      arr.push(s);
      m.set(s.route_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.seq - b.seq);
    return m;
  }, [stops]);

  const asgByStop = useMemo(() => {
    const m = new Map<string, ShuttleAssignment[]>();
    for (const a of assignments) {
      const arr = m.get(a.stop_id) ?? [];
      arr.push(a);
      m.set(a.stop_id, arr);
    }
    return m;
  }, [assignments]);

  // 학생 수를 노선별로 세어 목록에 함께 보여줍니다.
  const countByRoute = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stops) {
      const n = asgByStop.get(s.id)?.length ?? 0;
      m.set(s.route_id, (m.get(s.route_id) ?? 0) + n);
    }
    return m;
  }, [stops, asgByStop]);

  const visibleRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes
      .filter((r) => r.direction === direction)
      .filter((r) => {
        if (!q) return true;
        if (`${r.route_no} ${r.name ?? ""} ${r.driver_name ?? ""} ${r.teacher_name ?? ""}`.toLowerCase().includes(q)) return true;
        // 학생 이름으로도 찾을 수 있게 합니다(이 아이가 몇 호차인지 확인하는 게 가장 잦은 조회).
        return (stopsByRoute.get(r.id) ?? []).some((s) =>
          (asgByStop.get(s.id) ?? []).some((a) => a.student_name_raw.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [routes, direction, query, stopsByRoute, asgByStop]);

  const selected = routes.find((r) => r.id === selectedId) ?? visibleRoutes[0] ?? null;
  const selectedStops = selected ? stopsByRoute.get(selected.id) ?? [] : [];

  // 이 노선에서 "초등부인데 명부와 연결 안 된" 건수 - 유치부·중고등부는 아직 명부 등록 전이라
  // 정상이므로 세지 않습니다.
  const attentionCount = useMemo(
    () =>
      selectedStops.reduce(
        (sum, st) =>
          sum + (asgByStop.get(st.id) ?? []).filter((a) => needsRosterAttention(a.class_raw, a.student_id)).length,
        0
      ),
    [selectedStops, asgByStop]
  );

  function startEdit() {
    if (!selected) return;
    setDraft({
      driver_name: selected.driver_name ?? "",
      driver_phone: selected.driver_phone ?? "",
      vehicle_no: selected.vehicle_no ?? "",
      teacher_name: selected.teacher_name ?? "",
      teacher_phone: selected.teacher_phone ?? "",
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_routes").update(draft).eq("id", selected.id);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      return;
    }
    setRoutes((prev) => prev.map((r) => (r.id === selected.id ? { ...r, ...draft } as ShuttleRoute : r)));
    setEditing(false);
    notify("저장했습니다.", "success");
  }

  return (
    <div className="flex h-full gap-3 overflow-hidden">
      {/* 왼쪽: 노선 목록 */}
      <div className="flex w-64 shrink-0 flex-col overflow-hidden print:hidden">
        <div className="mb-2 flex shrink-0 gap-1">
          {(["등원", "하원"] as ShuttleDirection[]).map((d) => (
            <button
              key={d}
              onClick={() => {
                setDirection(d);
                setSelectedId(null);
              }}
              className={
                "flex-1 rounded-lg px-2 py-1.5 text-xs font-bold transition " +
                (direction === d ? "bg-gia-navy text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200")
              }
            >
              {d === "등원" ? "🌅 등원" : "🌇 하원"}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="노선·기사님·학생 이름 검색"
          className="mb-2 w-full shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        />
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {visibleRoutes.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-slate-400">
              노선이 없습니다. 먼저 셔틀 데이터 SQL을 실행해주세요.
            </p>
          )}
          {visibleRoutes.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={
                "w-full rounded-lg border px-2.5 py-2 text-left transition " +
                (selected?.id === r.id ? "border-gia-navy bg-gia-gold-soft/20" : "border-slate-200 bg-white hover:border-slate-300")
              }
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-slate-700">{r.route_no}호</span>
                <span
                  className={
                    "text-[10px] " +
                    (r.usable_capacity != null && (countByRoute.get(r.id) ?? 0) > r.usable_capacity
                      ? "font-semibold text-red-600"
                      : "text-slate-400")
                  }
                >
                  {countByRoute.get(r.id) ?? 0}명
                  {r.usable_capacity != null && (countByRoute.get(r.id) ?? 0) > r.usable_capacity && " ⚠️"}
                </span>
              </div>
              <div className="truncate text-[11px] text-slate-500">{r.name}</div>
              {r.driver_name && <div className="truncate text-[10px] text-slate-400">🚐 {r.driver_name}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* 오른쪽: 배차표 */}
      <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 print:border-0 print:p-0">
        {!selected ? (
          <p className="py-10 text-center text-sm text-slate-400">왼쪽에서 노선을 선택하세요.</p>
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  {selected.direction} {selected.route_no}호 {selected.name ? `- ${selected.name}` : ""}
                </h2>
                <p className="text-[11px] text-slate-400">
                  출발 기준 {selected.depart_time?.slice(0, 5)} · 총 {countByRoute.get(selected.id) ?? 0}명
                  {selected.usable_capacity != null && (
                    <span className={(countByRoute.get(selected.id) ?? 0) > selected.usable_capacity ? "ml-1 font-semibold text-red-600" : "ml-1"}>
                      {" "}
                      (탑승가능 {selected.usable_capacity}명{selected.seat_capacity ? ` · ${selected.seat_capacity}인승` : ""})
                      {(countByRoute.get(selected.id) ?? 0) > selected.usable_capacity && " ⚠️ 정원 초과"}
                    </span>
                  )}
                  {attentionCount > 0 && (
                    <span className="ml-1 text-amber-600">· ⚠️ 명부 확인 {attentionCount}명</span>
                  )}
                </p>
              </div>
              <div className="flex gap-1.5 print:hidden">
                {canEdit && !editing && (
                  <button onClick={startEdit} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
                    ✏️ 담당자 수정
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="rounded-lg bg-gia-navy px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2"
                >
                  🖨️ 배차표 인쇄
                </button>
              </div>
            </div>

            {/* 요청 ⑬: 노선 상단에 지도를 항상 띄우고, 아래 정류장 목록에서 정류장을 누르면 지도가
                그 정류장으로 이동합니다. */}
            {selectedStops.length > 0 && (
              <div className="mb-3 h-72 overflow-hidden rounded-xl border border-slate-200 print:hidden">
                <RouteMap
                  routeId={selected.id}
                  stops={selectedStops}
                  direction={selected.direction}
                  routeLabel={`${selected.direction} ${selected.route_no}호 ${selected.name ?? ""}`}
                  departTime={selected.depart_time}
                  canEdit={canEdit}
                  focusStopId={focusStopId}
                />
              </div>
            )}

            {(
              <>

            {editing ? (
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3 print:hidden">
                {(
                  [
                    ["driver_name", "기사님"],
                    ["driver_phone", "기사님 연락처"],
                    ["vehicle_no", "차량번호"],
                    ["teacher_name", "동승 선생님"],
                    ["teacher_phone", "선생님 연락처"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="mb-1 block text-[11px] text-slate-400">{label}</label>
                    <input
                      value={(draft[key] as string) ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                  </div>
                ))}
                <button onClick={saveEdit} className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white">
                  저장
                </button>
                <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500">
                  취소
                </button>
              </div>
            ) : (
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600 print:bg-transparent print:px-0">
                <span>🚐 기사님: <b>{selected.driver_name ?? "-"}</b> {selected.driver_phone ?? ""}</span>
                {selected.vehicle_no && <span>🔢 차량: <b>{selected.vehicle_no}</b></span>}
                <span>🧑‍🏫 동승: <b>{selected.teacher_name ?? "-"}</b> {selected.teacher_phone ?? ""}</span>
              </div>
            )}

            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-500 print:bg-transparent">
                  <th className="w-20 px-2 py-1.5">시간</th>
                  <th className="w-16 px-2 py-1.5">요일</th>
                  <th className="px-2 py-1.5">주소</th>
                  <th className="w-32 px-2 py-1.5">아동 이름</th>
                  <th className="w-28 px-2 py-1.5">반</th>
                  <th className="w-32 px-2 py-1.5">전화번호</th>
                </tr>
              </thead>
              <tbody>
                {selectedStops.map((s) => {
                  const list = asgByStop.get(s.id) ?? [];
                  if (list.length === 0) {
                    return (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="px-2 py-1.5 align-top">{s.stop_time ?? ""}</td>
                        <td className="px-2 py-1.5 align-top" />
                        <td
                          className="cursor-pointer px-2 py-1.5 align-top hover:bg-blue-50 print:cursor-auto"
                          onClick={() => setFocusStopId(s.id)}
                          title="눌러서 지도에서 이 정류장 보기"
                        >
                          <span className="mr-0.5 text-blue-400 print:hidden">📍</span>
                          {s.address}
                          {s.gate && <span className="ml-1 text-slate-400">({s.gate})</span>}
                        </td>
                        <td className="px-2 py-1.5 align-top text-slate-300" colSpan={3}>
                          (배정된 학생 없음)
                        </td>
                      </tr>
                    );
                  }
                  return list.map((a, i) => (
                    <tr key={a.id} className="border-b border-slate-100">
                      {i === 0 && (
                        <>
                          <td className="px-2 py-1.5 align-top" rowSpan={list.length}>
                            {s.stop_time ?? ""}
                          </td>
                          <td className="px-2 py-1.5 align-top" rowSpan={list.length}>
                            {weekdaysLabel(a.weekdays)}
                          </td>
                          <td
                            className="cursor-pointer px-2 py-1.5 align-top hover:bg-blue-50 print:cursor-auto"
                            rowSpan={list.length}
                            onClick={() => setFocusStopId(s.id)}
                            title="눌러서 지도에서 이 정류장 보기"
                          >
                            <span className="mr-0.5 text-blue-400 print:hidden">📍</span>
                            {s.address}
                            {s.gate && <span className="ml-1 text-slate-400">({s.gate})</span>}
                          </td>
                        </>
                      )}
                      <td className="px-2 py-1.5 font-semibold text-slate-700">
                        {a.student_name_raw}
                        {/* 유치부·중고등부는 아직 명부에 등록 전이라 연결이 안 되는 게 정상이라
                            경고를 띄우지 않습니다. 초등부(=반이 "학교")인데 연결이 안 된 경우만
                            표기 차이/누락일 수 있어 확인 대상으로 표시합니다. */}
                        {needsRosterAttention(a.class_raw, a.student_id) && (
                          <span title="초등부인데 학생 명부와 연결되지 않았습니다 - 이름 표기를 확인해주세요" className="ml-1 text-[9px] text-amber-500">
                            ⚠️
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">
                        {a.class_raw ?? ""}
                        <span className={"ml-1 rounded-full px-1 text-[9px] font-semibold " + DIVISION_BADGE[divisionFromClassRaw(a.class_raw)]}>
                          {divisionFromClassRaw(a.class_raw)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{a.guardian_phone ?? ""}</td>
                    </tr>
                  ));
                })}
                {selectedStops.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-slate-400">
                      등록된 정류장이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <p className="mt-3 hidden text-center text-[11px] text-slate-500 print:block">
              담당 기사님: {selected.driver_name} {selected.driver_phone} · 담당 선생님: {selected.teacher_name}{" "}
              {selected.teacher_phone}
            </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
