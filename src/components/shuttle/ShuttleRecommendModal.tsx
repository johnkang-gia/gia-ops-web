"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { geocodeAddress } from "@/lib/kakaoMap";
import { recommendStops, formatDistance } from "@/lib/shuttleRecommend";
import type { ShuttleDirection, ShuttleRoute, ShuttleStop, WrStudent } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";

// 학생 명부에서 "차량탑승 여부"를 체크한 학생의 주소를 지오코딩해서, 방향별로 가장 가까운
// 정류장 상위 3곳을 추천합니다. 실제 배정은 담당자가 이 목록에서 하나를 골라 눌러야 생성됩니다
// (자동 배정 아님 - 실제 도로 상황은 담당자 판단이 필요할 수 있어서).
export default function ShuttleRecommendModal({
  student,
  routes,
  stops,
  onClose,
  onStudentUpdated,
}: {
  student: WrStudent;
  routes: ShuttleRoute[];
  stops: ShuttleStop[];
  onClose: () => void;
  onStudentUpdated: (patch: Partial<WrStudent>) => void;
}) {
  const notify = useToast();
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(
    student.lat != null && student.lng != null ? { lat: student.lat, lng: student.lng } : null
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(coord ? "ready" : "loading");
  const [assignedStopIds, setAssignedStopIds] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState<string | null>(null);

  const directions: ShuttleDirection[] =
    student.shuttle_mode === "등하원" ? ["등원", "하원"] : student.shuttle_mode === "등원" ? ["등원"] : student.shuttle_mode === "하원" ? ["하원"] : [];

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (coord || !student.address) {
        if (!coord) setStatus("error");
        return;
      }
      const result = await geocodeAddress(student.address);
      if (cancelled) return;
      if (!result) {
        setStatus("error");
        return;
      }
      setCoord(result);
      setStatus("ready");
      const supabase = createClient();
      await supabase.from("wr_students").update({ lat: result.lat, lng: result.lng, geocoded_at: new Date().toISOString() }).eq("id", student.id);
      onStudentUpdated({ lat: result.lat, lng: result.lng });
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function assign(stop: ShuttleStop, route: ShuttleRoute) {
    setAssigning(stop.id);
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_assignments").insert({
      stop_id: stop.id,
      student_id: student.id,
      student_name_raw: student.name,
      class_raw: [student.grade ? `${student.grade}학년` : null, student.class_name].filter(Boolean).join(" ") || null,
      weekdays: [1, 2, 3, 4, 5],
      guardian_phone: student.parent_phone,
    });
    setAssigning(null);
    if (error) {
      notify("배정하지 못했습니다: " + error.message, "error");
      return;
    }
    setAssignedStopIds((prev) => new Set(prev).add(stop.id));
    notify(`${route.direction} ${route.route_no}호에 배정했습니다. 요일·정류장은 [탑승 배정] 메뉴에서 조정할 수 있습니다.`, "success");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">🚌 {student.name} 학생 노선 추천</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <p className="mb-3 text-[11px] text-slate-400">{student.address || "(주소가 등록되어 있지 않습니다)"}</p>

        {status === "loading" && <p className="py-8 text-center text-xs text-slate-400">주소로 좌표를 찾는 중…</p>}
        {status === "error" && (
          <p className="py-8 text-center text-xs text-red-500">
            주소로 위치를 찾지 못했습니다. 학생 명부의 주소가 정확한지 확인 후 다시 시도해주세요.
          </p>
        )}

        {status === "ready" &&
          coord &&
          directions.map((dir) => {
            const candidates = recommendStops(coord.lat, coord.lng, dir, routes, stops, 3);
            return (
              <div key={dir} className="mb-4">
                <p className="mb-1.5 text-xs font-semibold text-slate-600">{dir === "등원" ? "🌅 등원" : "🌇 하원"} 추천 노선</p>
                {candidates.length === 0 && (
                  <p className="text-[11px] text-slate-400">좌표가 계산된 {dir} 정류장이 아직 없습니다. 셔틀 현황 → 노선도 탭을 한 번 열어 좌표를 채운 뒤 다시 시도해주세요.</p>
                )}
                <div className="space-y-1.5">
                  {candidates.map(({ route, stop, distanceM }) => {
                    const done = assignedStopIds.has(stop.id);
                    return (
                      <div key={stop.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px]">
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-700">
                            {route.route_no}호 {route.name}
                          </span>
                          <span className="ml-1.5 text-slate-400">{stop.address}</span>
                          <div className="text-slate-400">
                            직선거리 {formatDistance(distanceM)} · 예상 시각 {stop.stop_time ?? "미정"}
                            <span className="text-slate-300"> (해당 정류장 등록 시각 기준)</span>
                          </div>
                        </div>
                        <button
                          onClick={() => assign(stop, route)}
                          disabled={assigning === stop.id || done}
                          className={
                            "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50 " +
                            (done ? "bg-emerald-500" : "bg-gia-navy")
                          }
                        >
                          {done ? "배정됨 ✓" : "배정"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
