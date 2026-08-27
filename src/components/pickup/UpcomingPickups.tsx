"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import StudentPicker from "@/components/pickup/StudentPicker";

// 앞으로 예정된 픽업.
//
// 요청: "'이번주 목금 이라엘 픽업입니다' 이라던가 특정날짜가 보이면 이것도 분석해서 미리
// 예정으로 등록해주고, 지정한날이 되면 자동으로 리마인드도 해줘"
//
// 연락 하나가 여러 날을 가리키는 경우가 많아서, 날짜마다 한 줄씩 예약해둡니다. 당일 아침에
// 크론이 그날치를 꺼내 하원 체크표에 픽업으로 걸고 담임 선생님께 알립니다.
//
// 이 화면이 필요한 이유: 예약이 어딘가에 잡혔는데 눈으로 확인할 곳이 없으면 아무도 믿지
// 않습니다. 특히 "이번주 목금"처럼 해석이 들어간 건은 사람이 한 번 봐야 합니다.

export type ScheduleRow = {
  id: string;
  service_date: string;
  pickup_time: string | null;
  student_name: string | null;
  student_id: string | null;
  status: string;
  needs_confirm: boolean;
  source_note: string | null;
  homeroom_email: string | null;
  request_id?: string | null;
  /** 이 예약이 나온 원래 연락. 담당자: "예정된 픽업에서 전문을 못 보니까 업무보드를
   *  갔다가 다시 돌아와야 해." 맞다/아니다를 정하려면 원문을 봐야 하는데, 그걸 보려고
   *  화면을 옮기게 하면 아무도 확인을 안 하게 됩니다. */
  pickup_requests?: {
    raw_text: string | null;
    summary: string | null;
    channel_label: string | null;
    source_url: string | null;
    source_chat_id: string | null;
    received_at: string | null;
  } | null;
};

function dateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00+09:00");
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  if (iso === today) return `오늘(${wd})`;
  if (iso === tomorrow) return `내일(${wd})`;
  return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
}

// 학생 고르기 목록에 쓰는 최소 정보. 동명이인이 있으면 반을 붙여 구별합니다.
type StudentOption = { id: string; name: string; grade: string | null; class_name: string | null; name_en: string | null; student_no: string | null };

export default function UpcomingPickups({ initialRows }: { initialRows: ScheduleRow[] }) {
  const notify = useToast();
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);

  // ── 학생 연결 ────────────────────────────────────────────────────────────
  // 담당자: "앞으로 예정된 픽업에서 확인필요 버튼 눌러서 학생 연결해줄 수 있도록 해줘."
  //
  // 지금까지 '확인 필요'에 할 수 있는 일은 "맞음"(그대로 두기)과 "✕"(취소) 둘뿐이었습니다.
  // 정작 가장 흔한 경우 - 이름은 읽혔는데 **누구인지 못 정한 경우** - 를 고칠 방법이
  // 없었습니다. 사람이 보고 "이 아이입니다" 하고 짚어줄 자리가 필요합니다.
  const [openText, setOpenText] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await createClient()
        .from("wr_students")
        .select("id, name, grade, class_name, name_en, student_no")
        .eq("status", "active")
        .eq("is_demo", false)
        .order("name");
      setStudents((data as StudentOption[] | null) ?? []);
    })();
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const { data } = await supabase
      .from("pickup_schedules")
      .select("id, service_date, pickup_time, student_name, student_id, status, needs_confirm, source_note, homeroom_email, request_id, pickup_requests(raw_text, summary, channel_label, source_url, source_chat_id, received_at)")
      .gte("service_date", today)
      .in("status", ["예정", "적용됨", "실패"])
      .order("service_date", { ascending: true })
      .limit(200);
    setRows((data as ScheduleRow[] | null) ?? []);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("pickup-schedules")
      .on("postgres_changes", { event: "*", schema: "public", table: "pickup_schedules" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  // 날짜별로 묶습니다. 하루씩 훑는 것이 사람이 보는 방식입니다.
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const r of rows) {
      if (r.status === "취소") continue;
      const list = map.get(r.service_date) ?? [];
      list.push(r);
      map.set(r.service_date, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const needsConfirmCount = rows.filter((r) => r.needs_confirm && r.status === "예정").length;

  async function cancel(row: ScheduleRow) {
    setBusy(true);
    const supabase = createClient();
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    const { error } = await supabase
      .from("pickup_schedules")
      .update({ status: "취소", cancelled_at: new Date().toISOString() })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      notify("취소하지 못했습니다: " + error.message, "error");
      load();
    }
  }

  // 사람이 고른 학생으로 연결합니다. 이름도 명부 이름으로 맞춰둡니다 - 예약에 남은 이름이
  // 원문 그대로("jay kim(190828)")면 나중에 체크표에서 또 못 찾습니다.
  async function linkStudent(row: ScheduleRow, studentId: string) {
    const s = students.find((x) => x.id === studentId);
    if (!s) return;
    setBusy(true);
    const supabase = createClient();
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, student_id: s.id, student_name: s.name, needs_confirm: false } : r))
    );
    const { error } = await supabase
      .from("pickup_schedules")
      .update({ student_id: s.id, student_name: s.name, needs_confirm: false })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      notify("연결하지 못했습니다: " + error.message, "error");
      load();
      return;
    }
    notify(`${s.name} 학생으로 연결했습니다.`, "success");
  }

  async function confirm(row: ScheduleRow) {
    setBusy(true);
    const supabase = createClient();
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, needs_confirm: false } : r)));
    const { error } = await supabase.from("pickup_schedules").update({ needs_confirm: false }).eq("id", row.id);
    setBusy(false);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      load();
    }
  }

  if (byDate.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">앞으로 예정된 픽업</h2>
        {needsConfirmCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
            확인 필요 {needsConfirmCount}
          </span>
        )}
        <span className="text-[11px] text-slate-400">당일 아침에 하원 체크표에 자동으로 걸립니다</span>
      </div>

      <div className="flex flex-col gap-2">
        {byDate.map(([date, list]) => (
          <div key={date} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2">
            <div className="mb-1 text-xs font-bold text-slate-600">
              {dateLabel(date)} · {list.length}명
            </div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((r) => (
                <div
                  key={r.id}
                  className={
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs " +
                    (r.status === "실패"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : r.needs_confirm
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-white text-slate-700")
                  }
                  title={r.source_note ?? undefined}
                >
                  <span className="font-semibold">{r.student_name ?? "학생 미확인"}</span>
                  {/* 명부에 붙지 않은 줄은 눈에 띄게 표시합니다 - 이 상태로 당일이 되면 체크표에
                      아무것도 걸리지 않고 조용히 지나갑니다. */}
                  {!r.student_id && <span className="text-[10px] text-amber-600">미연결</span>}
                  {r.pickup_time && <span className="text-[11px] text-slate-500">{r.pickup_time}</span>}
                  {r.status === "적용됨" && <span className="text-[10px] text-emerald-600">반영됨</span>}
                  {r.status === "실패" && <span className="text-[10px]">확인 필요</span>}

                  {/* 확인 필요 / 미연결이면 학생을 직접 고를 수 있게 합니다(담당자 요청). */}
                  {/* 원문 보기(담당자 요청). 맞다/아니다를 정하려면 원문을 봐야 하는데, 그걸
                      보려고 업무보드로 갔다 오게 하면 아무도 확인을 안 하게 됩니다. */}
                  {(r.pickup_requests?.raw_text || r.source_note) && (
                    <button
                      type="button"
                      onClick={() => setOpenText(openText === r.id ? null : r.id)}
                      className="rounded px-1 text-[11px] text-slate-400 hover:text-slate-700"
                      title="이 예약이 나온 원문 보기"
                    >
                      💬
                    </button>
                  )}

                  {/* 확인 필요 / 미연결이면 학생을 직접 고를 수 있게 합니다. 137명 목록을
                      눈으로 훑는 대신 두 글자만 쳐도 좁혀집니다(담당자 요청). */}
                  {(r.needs_confirm || !r.student_id) && r.status !== "적용됨" && (
                    <StudentPicker
                      students={students}
                      disabled={busy}
                      label="학생 연결"
                      autoFocusQuery={(r.student_name ?? "").replace(/\(.*$/, "").trim()}
                      onPick={(s) => linkStudent(r, s.id)}
                    />
                  )}

                  {r.needs_confirm && r.status === "예정" && r.student_id && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => confirm(r)}
                      className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                    >
                      맞음
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => cancel(r)}
                    className="rounded px-1 text-[11px] text-slate-400 hover:text-red-500 disabled:opacity-50"
                    aria-label="예약 취소"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* 펼친 원문. 칩 줄 아래 넓게 펴야 읽힙니다 - 칩 안에 넣으면 줄이 깨집니다. */}
            {list.filter((r) => openText === r.id).map((r) => (
              <div key={`t-${r.id}`} className="mt-1.5 rounded-lg border border-slate-200 bg-white p-2">
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  <span className="font-semibold text-slate-600">{r.student_name ?? "학생 미확인"}</span>
                  {r.pickup_requests?.channel_label && <span>{r.pickup_requests.channel_label}</span>}
                  {r.pickup_requests?.received_at && (
                    <span>{new Date(r.pickup_requests.received_at).toLocaleString("ko-KR")}</span>
                  )}
                  {r.pickup_requests?.source_url && (
                    <a
                      href={r.pickup_requests.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-600 hover:bg-slate-800 hover:text-white"
                    >
                      토들 ↗
                    </a>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">
                  {r.pickup_requests?.raw_text || r.source_note}
                </p>
                {r.source_note && r.pickup_requests?.raw_text && (
                  <p className="mt-1 text-[10px] text-slate-400">판단 근거: {r.source_note}</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
