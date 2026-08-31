"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useLang, useT } from "@/components/common/LanguageProvider";

// 요청: "교사가 전화나, 다른 메세지로 픽업을 받은 경우, 체크를 할 수 있도록... 담임교사는 자기
// 반만 보이고, 과목교사선생님은 보이지 않도록"
//
// 담임 선생님이 자기 반 학생의 하원 픽업·결석을 직접 체크하는 화면입니다. 저장하는 곳은 하원
// 체크표와 같은 shuttle_boardings라, 여기서 누르면 안내보드·차량 도착체크·하원 운행 화면에
// 그대로 반영됩니다. 구글챗 자동 반영과 같은 칸을 쓰기 때문에 두 방식이 충돌 없이 병행됩니다.

export type PickupStatus = "예정" | "탑승" | "미탑승" | "결석" | "픽업";

export type PickupItem = {
  studentId: string;
  name: string;
  nameEn: string | null;
  // 오늘 이 학생이 타는 셔틀 배정. 셔틀을 안 타는 학생은 null이라 체크할 것이 없습니다.
  assignmentId: string | null;
  routeLabel: string | null;
  status: PickupStatus;
};

export type PickupClassGroup = { classId: string; label: string; items: PickupItem[] };

export default function PickupCheckClient({ groups: initialGroups, today }: { groups: PickupClassGroup[]; today: string }) {
  const notify = useToast();
  const t = useT();
  const { lang } = useLang();
  const [groups, setGroups] = useState(initialGroups);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 다른 곳(하원 체크표·구글챗 자동 반영)에서 상태가 바뀌면 이 화면에도 바로 보이도록
  // 구독합니다. 선생님이 보고 있는 동안 행정실에서 먼저 체크하는 경우가 있어서입니다.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("pickup-check")
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_boardings" }, (payload) => {
        const row = payload.new as { assignment_id?: string; status?: string; service_date?: string } | null;
        if (!row?.assignment_id || row.service_date !== today) return;
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            items: g.items.map((it) =>
              it.assignmentId === row.assignment_id ? { ...it, status: (row.status as PickupStatus) ?? "예정" } : it
            ),
          }))
        );
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [today]);

  // 한 학생의 상태만 바꿔주는 작은 도우미(낙관적 갱신과 실패 시 되돌리기에 공통으로 씁니다).
  function applyStatus(studentId: string, status: PickupStatus) {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((it) => (it.studentId === studentId ? { ...it, status } : it)),
      }))
    );
  }

  async function setStatus(item: PickupItem, next: PickupStatus) {
    if (!item.assignmentId) return;
    // 같은 것을 한 번 더 누르면 원래대로(예정) 돌아갑니다.
    const finalStatus: PickupStatus = item.status === next ? "예정" : next;
    const previous = item.status;

    // 화면은 먼저 바꿔서 바로 반응하게 하고, 저장이 실패하면 되돌립니다.
    setBusyId(item.studentId);
    applyStatus(item.studentId, finalStatus);

    const supabase = createClient();
    const { error } = await supabase.from("shuttle_boardings").upsert(
      {
        service_date: today,
        assignment_id: item.assignmentId,
        status: finalStatus,
        checked_by: "담임",
        checked_at: new Date().toISOString(),
      },
      { onConflict: "service_date,assignment_id" }
    );
    setBusyId(null);

    if (error) {
      applyStatus(item.studentId, previous);
      notify(t("저장하지 못했습니다: ", "Could not save: ") + error.message, "error");
    }
  }

  if (groups.length === 0) {
    return (
      <p className="g-panel-solid p-8 text-center text-sm text-slate-400">
        {t("우리 반 학생 명단이 아직 없습니다.", "No students are listed for your class yet.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => {
        const pickupCount = g.items.filter((i) => i.status === "픽업").length;
        const absentCount = g.items.filter((i) => i.status === "결석").length;
        return (
          <div key={g.classId}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-700">{g.label}</h2>
              <span className="text-[11px] text-slate-400">
                {t(`${g.items.length}명`, `${g.items.length} students`)}
              </span>
              {pickupCount > 0 && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-600">
                  {t("픽업", "Pickup")} {pickupCount}
                </span>
              )}
              {absentCount > 0 && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                  {t("결석", "Absent")} {absentCount}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {g.items.map((it) => {
                const noShuttle = !it.assignmentId;
                const isPickup = it.status === "픽업";
                const isAbsent = it.status === "결석";
                return (
                  <div
                    key={it.studentId}
                    className={
                      "flex items-center gap-2 rounded-xl border p-2.5 " +
                      (isPickup ? "border-sky-300 bg-sky-50" : isAbsent ? "border-red-200 bg-red-50" : "border-slate-200 bg-white")
                    }
                  >
                    <div className="min-w-0 flex-1">
                      {/* 영어 화면에서는 명부에 저장된 영어 이름을 우선 보여줍니다 - 원어민
                          선생님이 한글 이름만 보고 학생을 찾기는 어렵습니다. 영어 이름이 아직
                          없는 학생은 한글 이름을 그대로 씁니다. */}
                      <div className="truncate text-sm font-bold text-slate-800">
                        {lang === "en" && it.nameEn ? it.nameEn : it.name}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {noShuttle
                          ? t("셔틀 미탑승", "No shuttle")
                          : it.routeLabel
                            ? t(it.routeLabel, `Bus ${it.routeLabel.replace("호", "")}`)
                            : t("노선 미배정", "No route")}
                      </div>
                    </div>
                    {noShuttle ? (
                      <span className="shrink-0 text-[11px] text-slate-300">—</span>
                    ) : (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          disabled={busyId === it.studentId}
                          onClick={() => setStatus(it, "픽업")}
                          className={
                            "rounded-lg px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-50 " +
                            (isPickup ? "bg-sky-500 text-white" : "bg-sky-50 text-sky-600")
                          }
                        >
                          {isPickup ? "✓ " : ""}
                          {t("픽업", "Pickup")}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === it.studentId}
                          onClick={() => setStatus(it, "결석")}
                          className={
                            "rounded-lg px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-50 " +
                            (isAbsent ? "bg-red-500 text-white" : "bg-red-50 text-red-600")
                          }
                        >
                          {isAbsent ? "✓ " : ""}
                          {t("결석", "Absent")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
