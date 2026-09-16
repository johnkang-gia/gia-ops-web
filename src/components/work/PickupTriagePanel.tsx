"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayKst } from "@/lib/kst";
import PickupTriage, { type PickupRow, type StudentOption } from "@/components/pickup/PickupTriage";
import type { RosterStudent } from "@/lib/attendanceDigest";

/**
 * **업무보드 안에서 픽업을 판단하는 자리.**
 *
 * ── 왜 여기에 있나 ─────────────────────────────────────────────────────────
 *
 * 확인이 필요한 픽업은 **셔틀 > 픽업 인박스**에만 있었습니다. 업무보드는 하루 종일 열어두는
 * 화면인데, 토들에서 「오늘 3시에 데리러 갑니다」가 들어오면 메뉴를 건너가 다른 화면을 열고,
 * 처리한 뒤 다시 돌아와야 했습니다. 하원 준비로 바쁜 시간에 그 왕복을 하는 사람은 없습니다 —
 * 그러면 그 연락은 아무도 안 본 채 인박스에 쌓입니다.
 *
 * ── 화면을 두 벌로 만들지 않습니다 ─────────────────────────────────────────
 *
 * 판단하는 덩어리(`PickupTriage`)는 픽업 인박스와 **같은 것**입니다. 단추가 여섯이고 그 중
 * 넷이 되돌릴 수 없는 일(픽업 확정·결석·지각·오늘 셔틀)이라, 두 벌로 두면 한쪽에만 고친
 * 단추가 생깁니다. 그건 오류가 아니라 **다른 답**으로 보입니다.
 *
 * 여기서 하는 일은 **줄을 가져다 주는 것**뿐입니다.
 */
export default function PickupTriagePanel({ roster }: { roster: RosterStudent[] }) {
  const [rows, setRows] = useState<PickupRow[] | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("pickup_requests")
      .select(
        "id, service_date, source, channel_label, sender_name, received_at, raw_text, ai_student_name, ai_pickup_time, ai_confidence, ai_note, student_id, matched_name, status, resolved_by, is_demo",
      )
      .eq("status", "확인대기")
      // 지난 것까지 전부 끌어오면 오래된 줄이 오늘 것을 덮습니다. 어제 것은 인박스에서 봅니다.
      .gte("service_date", todayKst())
      .order("received_at", { ascending: false })
      .limit(40);
    // 조용히 넘기지 않습니다(CLAUDE.md §5) - 빈 목록은 「없음」과 구별되지 않습니다.
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setRows(((data as (PickupRow & { is_demo?: boolean })[] | null) ?? []).filter((r) => !r.is_demo));
  }, []);

  useEffect(() => {
    void load();
    const supabase = createClient();
    // 조건을 걸지 않습니다. 화면에 아직 없는 줄이 새로 생기거나 처리되어 빠지는 것은
    // 조건에 안 걸려 통째로 놓칩니다.
    const channel = supabase
      .channel("work-pickup-triage")
      .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  /** 명부는 업무보드가 이미 들고 있습니다 - 139명을 또 읽지 않습니다. */
  const students = useMemo<StudentOption[]>(
    () =>
      roster
        .filter((s): s is RosterStudent & { id: string } => !!s.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          grade: s.grade,
          class_name: s.className ?? null,
          name_en: s.nameEn ?? null,
          birth_date: s.birthDate ?? null,
        })),
    [roster],
  );

  const count = rows?.length ?? 0;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden border-t border-black/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {/* **「픽업」이라고 적으면 픽업 글만 있는 줄로 읽힙니다.** 여기 모이는 것은 약·
            준비물·분실물처럼 픽업이 아닌 부탁이 더 많고, 그 이름 때문에 픽업 담당이 아닌
            사람은 열어보지 않았습니다. */}
        <span className="text-[11px] font-bold text-slate-600">{open ? "▾" : "▸"} 📥 확인이 필요한 사항</span>
        {count > 0 ? (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{count}건</span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">없음</span>
        )}
        <span className="ml-auto text-[10px] text-slate-400">여기서 바로 처리됩니다</span>
      </button>

      {open && (
        // 가둔 칸에는 안쪽 스크롤을 둡니다(CLAUDE.md §2-10). 없으면 셋째 줄부터 손이 안 닿는데
        // 스크롤 막대조차 안 생겨서, 보는 사람은 그게 전부인 줄 압니다.
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {error ? (
            <p className="rounded-lg bg-red-50 p-2 text-[11px] text-red-700">픽업을 읽지 못했습니다: {error}</p>
          ) : rows === null ? (
            <p className="py-3 text-center text-[11px] text-slate-400">불러오는 중…</p>
          ) : (
            <PickupTriage rows={rows} students={students} onChanged={load} compact />
          )}
        </div>
      )}
    </div>
  );
}
