"use client";

import { Who } from "@/components/common/HomonymProvider";
import { STATUS_STYLE, type ConsultAppt, type ConsultStatus } from "@/lib/consult/model";
import type { Student } from "@/lib/students";

/** 상태 알약. 색은 model.ts 한 곳에서 정합니다 - 현황판과 같은 색이어야 안내가 맞아떨어집니다. */
export function StatusChip({ status, className = "" }: { status: ConsultStatus; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLE[status].chip} ${className}`}>
      {STATUS_STYLE[status].label}
    </span>
  );
}

/**
 * 예약에 붙은 학생 이름(형제면 여럿). 이름은 `<Who>` 로 그립니다 - 동명이인이면 반이 붙고,
 * 누르면 학생 창이 열립니다(CLAUDE.md §2-4-2).
 */
export function ApptNames({
  appt,
  studentById,
  showGrade = true,
}: {
  appt: Pick<ConsultAppt, "student_ids">;
  studentById: Map<string, Student>;
  showGrade?: boolean;
}) {
  if (appt.student_ids.length === 0) return <span className="text-slate-400">(학생 없음)</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {appt.student_ids.map((sid, i) => {
        const s = studentById.get(sid);
        return (
          <span key={sid} className="inline-flex items-baseline gap-1">
            {i > 0 && <span className="text-slate-300">·</span>}
            <Who id={sid} name={s?.name ?? "?"} className="font-semibold text-slate-900" />
            {showGrade && s && (
              <span className="text-xs text-slate-500">
                {s.grade ?? ""}
                {s.class_name ? ` ${s.class_name}` : ""}
              </span>
            )}
          </span>
        );
      })}
      {appt.student_ids.length > 1 && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">형제 함께</span>}
    </span>
  );
}

/** 요청 하나 보내고 오류 문장을 돌려받습니다. 조용히 실패하지 않게 화면이 그대로 띄웁니다. */
export async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!res.ok) return { ok: false, error: j.error ?? `실패했습니다 (${res.status})` };
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
