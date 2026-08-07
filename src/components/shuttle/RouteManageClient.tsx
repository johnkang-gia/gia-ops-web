"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShuttleAssignment, ShuttleDirection, ShuttleRoute, ShuttleStop } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";

type StopDraft = { stop_time: string; address: string; gate: string };

export default function RouteManageClient({
  initialRoutes,
  initialStops,
  assignmentCounts,
}: {
  initialRoutes: ShuttleRoute[];
  initialStops: ShuttleStop[];
  assignmentCounts: Pick<ShuttleAssignment, "id" | "stop_id">[];
}) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const [routes, setRoutes] = useState(initialRoutes);
  const [stops, setStops] = useState(initialStops);
  const [direction, setDirection] = useState<ShuttleDirection>("등원");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // 정류장별 배정 인원 - 정류장을 지울 때 "학생 N명 배정도 함께 사라진다"고 경고하기 위해 씁니다.
  const asgCountByStop = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignmentCounts) m.set(a.stop_id, (m.get(a.stop_id) ?? 0) + 1);
    return m;
  }, [assignmentCounts]);

  const visibleRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes
      .filter((r) => r.direction === direction)
      .filter((r) => !q || `${r.route_no} ${r.name ?? ""} ${r.driver_name ?? ""} ${r.teacher_name ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => a.sort_order - b.sort_order);
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
                  <th className="w-24 px-2 py-1.5">게이트</th>
                  <th className="w-16 px-2 py-1.5">인원</th>
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
                        placeholder="gate 1-1"
                        onBlur={(e) => e.target.value !== (s.gate ?? "") && updateStop(s.id, { gate: e.target.value })}
                        className="w-full rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-slate-300"
                      />
                    </td>
                    <td className="px-2 py-1 text-slate-400">{asgCountByStop.get(s.id) ?? 0}명</td>
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
