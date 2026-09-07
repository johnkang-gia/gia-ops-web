"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * 오늘 학원차·보호자로 가는 아이들 — 업무보드 리마인드.
 *
 * 매주 같은 요일에 학원 차를 타는 아이가 있습니다(월·금 14:40 와이키키짐). 셔틀을 안 타니
 * 하원 체크표에 줄이 없고, 학사일정도 아니라 달력에도 안 뜹니다.
 *
 * **반복되는 일이라 오히려 잊힙니다.** 한 번뿐인 일은 메모라도 남기는데, 매주 있는 일은
 * «늘 하던 것»이라 아무도 적지 않고, 그러다 한 주에 그냥 지나갑니다.
 *
 * 새 표를 만들지 않았습니다. 이 자료는 이미 [학생 → 하원수단]에 요일별로 있습니다 -
 * 같은 사실을 두 곳에 적으면 언젠가 어긋나고, 어긋난 쪽이 어느 쪽인지 아무도 모릅니다.
 * 여기서는 오늘 요일의 «셔틀이 아닌 것»만 꺼내 시각 순으로 세울 뿐입니다.
 */

type Row = { name: string; className: string; kind: string; label: string | null; time: string | null; note: string | null };

const KIND_TONE: Record<string, string> = {
  외부버스: "border-lime-300 bg-lime-50 text-lime-800",
  보호자픽업: "border-sky-300 bg-sky-50 text-sky-800",
  도보: "border-slate-300 bg-slate-50 text-slate-700",
  기타: "border-slate-300 bg-slate-50 text-slate-700",
};

export default function TodayDismissalReminder() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      // 한국 요일. 세계표준시로 계산하면 오전 9시 이전에 어제 요일이 나옵니다.
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const weekday = kst.getUTCDay();
      if (weekday < 1 || weekday > 5) {
        setRows([]);
        return;
      }
      const { data: plans } = await supabase
        .from("student_dismissal_plans")
        .select("student_id, kind, label, depart_time, note")
        .eq("weekday", weekday)
        .neq("kind", "셔틀");
      const ids = (plans ?? []).map((p) => p.student_id as string);
      if (ids.length === 0) {
        setRows([]);
        return;
      }
      const { data: students } = await supabase
        .from("wr_students")
        .select("id, name, grade, class_name")
        .eq("is_demo", false)
        .in("id", ids);
      const byId = new Map(((students as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? []).map((s) => [s.id, s]));
      const out: Row[] = (plans ?? [])
        .map((p) => {
          const st = byId.get(p.student_id as string);
          if (!st) return null; // 졸업·전학 등으로 명부에 없는 아이 - 조용히 빼지 않고 그냥 안 보여줍니다
          return {
            name: st.name,
            className: [st.grade ? `${st.grade}학년` : null, st.class_name].filter(Boolean).join(" "),
            kind: p.kind as string,
            label: (p.label as string | null) ?? null,
            time: (p.depart_time as string | null) ?? null,
            note: (p.note as string | null) ?? null,
          };
        })
        .filter((x): x is Row => !!x)
        .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.name.localeCompare(b.name, "ko"));
      setRows(out);
    })();
  }, []);

  if (rows === null || rows.length === 0) return null;

  return (
    <div className="mb-2 rounded-xl border border-lime-200 bg-lime-50/60 px-2.5 py-2">
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <b className="text-lime-800">🎒 오늘 학원차·보호자 하원 {rows.length}명</b>
        <span className="text-lime-700/70">매주 이 요일 반복 · 셔틀을 타지 않아 체크표에는 줄이 없습니다</span>
        <Link href="/students" className="ml-auto font-semibold text-lime-800 underline decoration-dotted">
          하원수단 고치기
        </Link>
      </p>
      <div className="flex flex-wrap gap-1">
        {rows.map((r, i) => (
          <span
            key={i}
            title={[r.name, r.className, r.kind, r.label, r.note].filter(Boolean).join(" · ")}
            className={"inline-flex items-baseline gap-1.5 rounded-lg border px-2 py-1 text-[11px] " + (KIND_TONE[r.kind] ?? KIND_TONE.기타)}
          >
            <b className="tabular-nums">{r.time ?? "시각 미정"}</b>
            <b>{r.name}</b>
            <span className="opacity-70">{r.label || r.kind}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
