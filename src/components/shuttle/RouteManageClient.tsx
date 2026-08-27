"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShuttleDirection, ShuttleRoute, ShuttleStop } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { geocodeAddress } from "@/lib/kakaoMap";
import { byRouteNo } from "@/lib/routeSort";

type StopDraft = { stop_time: string; address: string; gate: string };

// 정류장에 배정된 학생 한 명. 이름과 요일까지 들고 옵니다.
export type RouteAssignment = {
  id: string;
  stop_id: string;
  student_name_raw: string;
  weekdays: number[] | null;
};

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

// 요일이 월~금 전부면 굳이 적지 않습니다(대부분이 그렇습니다). 빠지는 요일이 있을 때만
// "(월수금)"처럼 붙여, 눈에 띄어야 할 것만 눈에 띄게 합니다.
function weekdayTag(days: number[] | null): string {
  const d = (days ?? []).filter((n) => n >= 1 && n <= 5).sort();
  if (d.length === 0 || d.length === 5) return "";
  return `(${d.map((n) => WEEKDAY_LABEL[n]).join("")})`;
}

export default function RouteManageClient({
  initialRoutes,
  initialStops,
  assignmentCounts,
}: {
  initialRoutes: ShuttleRoute[];
  initialStops: ShuttleStop[];
  assignmentCounts: RouteAssignment[];
}) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const [routes, setRoutes] = useState(initialRoutes);
  const [stops, setStops] = useState(initialStops);
  const [direction, setDirection] = useState<ShuttleDirection>("등원");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // 정류장별 배정 학생.
  //
  // 담당자: "노선관리에 인원만 뜨고 누가 타는지 안 나와 - 같이 기록되게 해줘."
  //
  // 맞는 지적입니다. "3명"만으로는 정류장을 지울 때 무엇을 잃는지도, 명단이 맞는지도
  // 알 수 없어서 매번 다른 화면(탑승 배정·하원 체크표)으로 넘어가 대조해야 했습니다.
  const asgByStop = useMemo(() => {
    const m = new Map<string, RouteAssignment[]>();
    for (const a of assignmentCounts) {
      const list = m.get(a.stop_id) ?? [];
      list.push(a);
      m.set(a.stop_id, list);
    }
    for (const list of m.values()) {
      list.sort((x, y) => (x.student_name_raw ?? "").localeCompare(y.student_name_raw ?? "", "ko"));
    }
    return m;
  }, [assignmentCounts]);
  const asgCountByStop = useMemo(() => {
    const m = new Map<string, number>();
    for (const [stopId, list] of asgByStop) m.set(stopId, list.length);
    return m;
  }, [asgByStop]);

  const visibleRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes
      .filter((r) => r.direction === direction)
      .filter((r) => !q || `${r.route_no} ${r.name ?? ""} ${r.driver_name ?? ""} ${r.teacher_name ?? ""}`.toLowerCase().includes(q))
      // 호수 오름차순(담당자 요청). sort_order는 엑셀에 적힌 지역별 순서라 화면에서 튑니다.
      .sort(byRouteNo((r) => r.route_no));
  }, [routes, direction, query]);

  const selected = routes.find((r) => r.id === selectedId) ?? visibleRoutes[0] ?? null;
  const selectedStops = useMemo(
    () => (selected ? stops.filter((s) => s.route_id === selected.id).sort((a, b) => a.seq - b.seq) : []),
    [stops, selected]
  );
  const selectedRiderCount = useMemo(
    () => selectedStops.reduce((sum, s) => sum + (asgCountByStop.get(s.id) ?? 0), 0),
    [selectedStops, asgCountByStop]
  );

  // ── 노선 ──────────────────────────────────────────────────────────
  async function addRoute() {
    setBusy(true);
    const supabase = createClient();
    const maxOrder = Math.max(0, ...routes.filter((r) => r.direction === direction).map((r) => r.sort_order));
    const { data, error } = await supabase
      .from("shuttle_routes")
      .insert({
        direction,
        route_no: "새 노선",
        name: "",
        depart_time: direction === "등원" ? "08:00" : "16:00",
        sort_order: maxOrder + 1,
      })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("노선을 추가하지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setRoutes((prev) => [...prev, data as ShuttleRoute]);
    setSelectedId((data as ShuttleRoute).id);
  }

  async function updateRoute(id: string, patch: Partial<ShuttleRoute>) {
    setRoutes((prev) => prev.map((r) => (r.id === id ? ({ ...r, ...patch } as ShuttleRoute) : r)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_routes").update(patch).eq("id", id);
    if (error) notify("저장하지 못했습니다: " + error.message, "error");
  }

  async function deleteRoute(r: ShuttleRoute) {
    const n = stops.filter((s) => s.route_id === r.id).reduce((sum, s) => sum + (asgCountByStop.get(s.id) ?? 0), 0);
    if (
      !(await confirmAction(
        `"${r.direction} ${r.route_no}호"를 삭제할까요? 정류장과 학생 배정 ${n}건도 함께 삭제됩니다.`,
        { danger: true }
      ))
    )
      return;
    setRoutes((prev) => prev.filter((x) => x.id !== r.id));
    setStops((prev) => prev.filter((s) => s.route_id !== r.id));
    setSelectedId(null);
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_routes").delete().eq("id", r.id);
    if (error) notify("삭제하지 못했습니다: " + error.message, "error");
  }

  // ── 정류장 ────────────────────────────────────────────────────────
  async function addStop() {
    if (!selected) return;
    setBusy(true);
    const supabase = createClient();
    const maxSeq = Math.max(-1, ...selectedStops.map((s) => s.seq));
    const { data, error } = await supabase
      .from("shuttle_stops")
      .insert({ route_id: selected.id, seq: maxSeq + 1, stop_time: "", address: "", gate: null })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("정류장을 추가하지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setStops((prev) => [...prev, data as ShuttleStop]);
  }

  async function updateStop(id: string, patch: Partial<StopDraft>) {
    setStops((prev) => prev.map((s) => (s.id === id ? ({ ...s, ...patch } as ShuttleStop) : s)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_stops").update(patch).eq("id", id);
    if (error) notify("저장하지 못했습니다: " + error.message, "error");
    if (patch.address !== undefined) await regeocodeStop(id, patch.address);
  }

  // 주소가 새로 생기거나 바뀌면, 지도 탭을 열어야만 채워지던 구/동/좌표를 그 자리에서 바로
  // 갱신합니다(주소를 지운 경우엔 옛 위치가 남지 않도록 좌표/구·동도 함께 비웁니다).
  async function regeocodeStop(id: string, address: string) {
    const supabase = createClient();
    const trimmed = address.trim();
    if (!trimmed) {
      const cleared = { lat: null, lng: null, gu: null, dong: null, geocoded_at: null };
      setStops((prev) => prev.map((s) => (s.id === id ? ({ ...s, ...cleared } as ShuttleStop) : s)));
      await supabase.from("shuttle_stops").update(cleared).eq("id", id);
      return;
    }
    const geo = await geocodeAddress(trimmed).catch(() => null);
    if (!geo) {
      notify("주소를 좌표로 변환하지 못했습니다 - 지도에서 직접 위치를 지정해주세요.", "error");
      return;
    }
    const upd = { lat: geo.lat, lng: geo.lng, gu: geo.gu, dong: geo.dong, geocoded_at: new Date().toISOString() };
    setStops((prev) => prev.map((s) => (s.id === id ? ({ ...s, ...upd } as ShuttleStop) : s)));
    await supabase.from("shuttle_stops").update(upd).eq("id", id);
  }

  async function deleteStop(s: ShuttleStop) {
    const n = asgCountByStop.get(s.id) ?? 0;
    const msg = n > 0
      ? `이 정류장을 삭제할까요? 배정된 학생 ${n}명의 배정도 함께 사라집니다.`
      : "이 정류장을 삭제할까요?";
    if (!(await confirmAction(msg, { danger: true }))) return;
    setStops((prev) => prev.filter((x) => x.id !== s.id));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_stops").delete().eq("id", s.id);
    if (error) notify("삭제하지 못했습니다: " + error.message, "error");
  }

  // 순서 바꾸기 - 두 정류장의 seq를 맞바꿉니다.
  async function moveStop(index: number, dir: -1 | 1) {
    const a = selectedStops[index];
    const b = selectedStops[index + dir];
    if (!a || !b) return;
    setStops((prev) =>
      prev.map((s) => (s.id === a.id ? { ...s, seq: b.seq } : s.id === b.id ? { ...s, seq: a.seq } : s))
    );
    const supabase = createClient();
    await Promise.all([
      supabase.from("shuttle_stops").update({ seq: b.seq }).eq("id", a.id),
      supabase.from("shuttle_stops").update({ seq: a.seq }).eq("id", b.id),
    ]);
  }

  return (
    <div className="flex h-full gap-3 overflow-hidden">
      {/* 왼쪽: 노선 목록 */}
      <div className="flex w-60 shrink-0 flex-col overflow-hidden">
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
        <div className="mb-2 flex shrink-0 gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="노선 검색"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
          <button
            onClick={addRoute}
            disabled={busy}
            className="shrink-0 rounded-lg bg-gia-navy px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            + 노선
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {visibleRoutes.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={
                "w-full rounded-lg border px-2.5 py-2 text-left transition " +
                (selected?.id === r.id ? "border-gia-navy bg-gia-gold-soft/20" : "border-slate-200 bg-white hover:border-slate-300")
              }
            >
              <div className="text-xs font-bold text-slate-700">{r.route_no}호</div>
              <div className="truncate text-[11px] text-slate-500">{r.name || "(권역명 없음)"}</div>
            </button>
          ))}
          {visibleRoutes.length === 0 && <p className="px-1 py-4 text-center text-xs text-slate-400">노선이 없습니다.</p>}
        </div>
      </div>

      {/* 오른쪽: 노선 상세 + 정류장 */}
      <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
        {!selected ? (
          <p className="py-10 text-center text-sm text-slate-400">왼쪽에서 노선을 선택하거나 새로 추가하세요.</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-800">
                {selected.direction} {selected.route_no}호
              </h2>
              <button
                onClick={() => deleteRoute(selected)}
                className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50"
              >
                노선 삭제
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["route_no", "호차", "예: 1, 1-1"],
                  ["name", "권역명", "예: 잠원"],
                  ["driver_name", "기사님", ""],
                  ["driver_phone", "기사님 연락처", ""],
                  ["vehicle_no", "차량번호", "예: 12가 3456"],
                  ["teacher_name", "동승 선생님", ""],
                  ["teacher_phone", "선생님 연락처", ""],
                ] as const
              ).map(([key, label, ph]) => (
                <div key={key}>
                  <label className="mb-1 block text-[11px] text-slate-400">{label}</label>
                  <input
                    // key에 노선 id를 넣어 **노선이 바뀌면 입력칸을 새로 만들게** 합니다.
                    //
                    // 담당자: "노선관리 탭 기사님 정보가 안 들어가 있어. 하원 쪽 아무나 눌러도
                    // 전부 박찬원 기사님으로 나와."
                    //
                    // 원인: defaultValue는 **처음 그려질 때 한 번만** 읽힙니다. 노선을 바꿔도
                    // React가 보기엔 같은 자리의 같은 입력칸이라 다시 만들지 않고, 그래서 처음
                    // 열었던 노선의 값이 계속 남아 있었습니다. 실제 데이터는 멀쩡한데 화면만
                    // 낡은 값을 붙들고 있던 것이라, 저장하면 다른 노선 정보를 덮어쓸 뻔했습니다.
                    key={`${selected.id}-${key}`}
                    defaultValue={(selected[key] as string) ?? ""}
                    placeholder={ph}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== ((selected[key] as string) ?? "")) updateRoute(selected.id, { [key]: v || null });
                    }}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">출발 기준시각</label>
                <input
                  type="time"
                  key={`${selected.id}-depart_time`}
                  defaultValue={selected.depart_time?.slice(0, 5)}
                  onBlur={(e) => updateRoute(selected.id, { depart_time: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">차량 정원(인승)</label>
                <input
                  type="number"
                  min={0}
                  key={`${selected.id}-seat_capacity`}
                  defaultValue={selected.seat_capacity ?? ""}
                  placeholder="예: 15"
                  onBlur={(e) => {
                    const n = e.target.value.trim() ? parseInt(e.target.value, 10) : null;
                    if (n !== selected.seat_capacity) updateRoute(selected.id, { seat_capacity: n });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">실제 탑승 가능 인원</label>
                <input
                  type="number"
                  min={0}
                  key={`${selected.id}-usable_capacity`}
                  defaultValue={selected.usable_capacity ?? ""}
                  placeholder="예: 12"
                  onBlur={(e) => {
                    const n = e.target.value.trim() ? parseInt(e.target.value, 10) : null;
                    if (n !== selected.usable_capacity) updateRoute(selected.id, { usable_capacity: n });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-[11px] text-slate-400">지역 태그(쉼표로 구분, 지역별 대시보드에서 씁니다)</label>
                <input
                  key={`${selected.id}-regions",`}
                  defaultValue={selected.regions.join(", ")}
                  placeholder="예: 청담, 압구정"
                  onBlur={(e) => {
                    const arr = e.target.value.split(",").map((v) => v.trim()).filter(Boolean);
                    if (arr.join(",") !== selected.regions.join(",")) updateRoute(selected.id, { regions: arr });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
            </div>

            {selected.usable_capacity != null && (
              <p className={"mb-3 -mt-2 text-[11px] " + (selectedRiderCount > selected.usable_capacity ? "font-semibold text-red-600" : "text-slate-400")}>
                현재 배정 인원 {selectedRiderCount}명 / 탑승가능 {selected.usable_capacity}명
                {selectedRiderCount > selected.usable_capacity && " ⚠️ 정원을 초과했습니다"}
              </p>
            )}

            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700">🚏 정류장 ({selectedStops.length})</h3>
              <button
                onClick={addStop}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                + 정류장 추가
              </button>
            </div>
            <p className="mb-2 text-[11px] text-slate-400">위에서부터 차가 도는 순서입니다. 칸을 클릭해 바로 수정하세요.</p>

            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-500">
                  <th className="w-14 px-2 py-1.5">순서</th>
                  <th className="w-24 px-2 py-1.5">시간</th>
                  <th className="px-2 py-1.5">주소</th>
                  <th className="w-24 px-2 py-1.5">도착장소</th>
                  {/* 담당자: "인원만 뜨고 누가 타는지 안 나와." 숫자만으로는 정류장을 지울 때
                      무엇을 잃는지도, 명단이 맞는지도 알 수 없었습니다. */}
                  <th className="w-64 px-2 py-1.5">타는 학생</th>
                  <th className="w-10 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {selectedStops.map((s, i) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="px-2 py-1 text-slate-400">
                      <div className="flex items-center gap-0.5">
                        <span className="w-4">{i + 1}</span>
                        <button onClick={() => moveStop(i, -1)} disabled={i === 0} className="disabled:opacity-20" title="위로">
                          ↑
                        </button>
                        <button
                          onClick={() => moveStop(i, 1)}
                          disabled={i === selectedStops.length - 1}
                          className="disabled:opacity-20"
                          title="아래로"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        defaultValue={s.stop_time ?? ""}
                        placeholder="8:27"
                        onBlur={(e) => e.target.value !== (s.stop_time ?? "") && updateStop(s.id, { stop_time: e.target.value })}
                        className="w-full rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-slate-300"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        defaultValue={s.address ?? ""}
                        placeholder="주소"
                        onBlur={(e) => e.target.value !== (s.address ?? "") && updateStop(s.id, { address: e.target.value })}
                        className="w-full rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-slate-300"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        defaultValue={s.gate ?? ""}
                        placeholder="정문 앞"
                        onBlur={(e) => e.target.value !== (s.gate ?? "") && updateStop(s.id, { gate: e.target.value })}
                        className="w-full rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-slate-300"
                      />
                    </td>
                    <td className="px-2 py-1 align-top">
                      {(() => {
                        const riders = asgByStop.get(s.id) ?? [];
                        if (riders.length === 0) return <span className="text-slate-300">없음</span>;
                        return (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500">
                              {riders.length}명
                            </span>
                            {riders.map((a) => {
                              const tag = weekdayTag(a.weekdays);
                              return (
                                <span
                                  key={a.id}
                                  className={
                                    "rounded px-1 py-0.5 text-[10px] font-semibold " +
                                    // 요일이 빠지는 학생은 색으로 구분합니다 - 명단을 훑을 때
                                    // 가장 자주 틀리는 자리입니다.
                                    (tag ? "bg-amber-50 text-amber-700" : "bg-white text-slate-600")
                                  }
                                  title={tag ? `${a.student_name_raw} · ${tag.slice(1, -1)}요일만 탑승` : a.student_name_raw}
                                >
                                  {a.student_name_raw}
                                  {tag && <span className="ml-0.5 font-normal">{tag}</span>}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button onClick={() => deleteStop(s)} className="text-slate-300 hover:text-red-500" title="정류장 삭제">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {selectedStops.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-slate-400">
                      정류장이 없습니다. [+ 정류장 추가]를 눌러주세요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
