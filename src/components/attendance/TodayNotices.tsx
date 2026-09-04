"use client";

import type { AttendanceRecord, WrStudent } from "@/lib/types";

/**
 * 오늘의 특이사항.
 *
 * 명단 137칸을 눈으로 훑어서 결석을 찾는 것은 사람이 할 일이 아닙니다. 오늘 **다른 일이
 * 일어난 아이만** 위로 끌어올려 한눈에 보여줍니다.
 *
 * 세 덩이로 나눕니다. 순서가 곧 해야 할 일의 순서입니다.
 *
 *   ① 확인 필요  — 연락에서 자동으로 결석이 잡혔는데 아직 사람이 안 본 것
 *   ② 결석       — 확인된 결석. 보호자 연락이 남았는지도 함께
 *   ③ 그 밖      — 조퇴·기타·지각. 지각이 가장 뒤입니다
 *
 * 지각을 결석과 같은 크기로 띄우지 않습니다. 지각 열 건 사이에 결석 한 건이 섞이면 그
 * 결석이 묻히고, 묻힌 결석은 연락이 안 갑니다.
 */

export type PendingEntry = {
  id: string;
  studentName: string;
  reason: string | null;
  rawText: string | null;
};

export default function TodayNotices({
  students,
  records,
  /** 연락에서 결석으로 읽었는데 **누구인지 못 가린** 것들. 사람이 봐야 합니다. */
  pending,
  onJump,
}: {
  students: WrStudent[];
  records: Map<string, AttendanceRecord>;
  pending: PendingEntry[];
  onJump: (studentId: string) => void;
}) {
  const byId = new Map(students.map((s) => [s.id, s]));
  const rows = [...records.values()]
    .filter((r) => r.status !== "출석" && byId.has(r.student_id))
    .map((r) => ({ r, s: byId.get(r.student_id)! }));

  const unconfirmed = rows.filter((x) => x.r.status === "결석" && x.r.confirmed_by_human === false);
  const absent = rows.filter((x) => x.r.status === "결석" && x.r.confirmed_by_human !== false);
  const others = rows.filter((x) => x.r.status !== "결석");
  // 조퇴 → 기타 → 지각. 지각이 가장 덜 중요합니다.
  const rank: Record<string, number> = { 조퇴: 0, 기타: 1, 지각: 2 };
  others.sort((a, b) => (rank[a.r.status] ?? 9) - (rank[b.r.status] ?? 9));

  const nothing = unconfirmed.length === 0 && absent.length === 0 && others.length === 0 && pending.length === 0;

  const Name = ({ id, label, tone }: { id: string; label: string; tone: string }) => (
    <button
      onClick={() => onJump(id)}
      className={"rounded-md px-1.5 py-0.5 text-[12px] font-bold transition hover:brightness-95 " + tone}
      title="눌러서 아래 명단에서 찾기"
    >
      {label}
    </button>
  );

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <p className="mb-2 text-[12px] font-bold text-slate-700">
        오늘 특이사항
        {nothing ? <span className="ml-1.5 font-normal text-slate-400">— 없습니다. 전원 출석입니다.</span> : null}
      </p>

      {/* ① 확인 필요.
          자동으로 잡혔지만 아직 사람이 안 본 것. 가장 위입니다 - 여기 남아 있으면 그
          결석은 아직 아무도 모르는 것과 같습니다. */}
      {(unconfirmed.length > 0 || pending.length > 0) && (
        <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
          <p className="mb-1 text-[11px] font-bold text-amber-900">
            확인 필요 {unconfirmed.length + pending.length}건 — 연락에서 결석으로 읽었습니다
          </p>
          {unconfirmed.length > 0 && (
            <div className="mb-1 flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-amber-800">자동으로 처리했습니다 (맞는지 봐주세요)</span>
              {unconfirmed.map(({ r, s }) => (
                <Name key={r.id} id={s.id} label={s.name} tone="bg-amber-200 text-amber-900" />
              ))}
            </div>
          )}
          {/* 자동으로 처리 **못한** 것. 이름이 겹치거나 명부에서 못 찾은 경우입니다. */}
          {pending.length > 0 && (
            <div className="space-y-0.5">
              <span className="text-[11px] text-amber-800">결석인 것 같은데 누구인지 못 가렸습니다 — 직접 눌러주세요</span>
              {pending.map((p) => (
                <p key={p.id} className="text-[11px] leading-relaxed text-amber-900">
                  <b>{p.studentName}</b>
                  {p.reason && <span className="ml-1 text-amber-700">· {p.reason}</span>}
                  {p.rawText && (
                    <span className="ml-1 text-amber-600/80">
                      · {p.rawText.length > 60 ? `${p.rawText.slice(0, 60)}…` : p.rawText}
                    </span>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ② 결석. 가장 중요합니다. */}
      {absent.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">결석 {absent.length}</span>
          {absent.map(({ r, s }) => (
            <Name
              key={r.id}
              id={s.id}
              label={`${s.name}${r.reason_type ? ` (${r.reason_type})` : ""}`}
              tone="bg-red-100 text-red-800"
            />
          ))}
          {/* 보호자 연락이 남았는지. 결석보다 먼저 눈에 띌 필요는 없지만 같이 있어야 합니다. */}
          {absent.filter((x) => !x.r.contacted_guardian).length > 0 && (
            <span className="text-[11px] font-semibold text-amber-700">
              📞 미연락 {absent.filter((x) => !x.r.contacted_guardian).length}
            </span>
          )}
          {absent.filter((x) => !x.r.reason_type).length > 0 && (
            <span className="text-[11px] text-slate-400">사유 안 고름 {absent.filter((x) => !x.r.reason_type).length}</span>
          )}
        </div>
      )}

      {/* ③ 그 밖. 조퇴·기타·지각. 한 줄로 작게. */}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {others.map(({ r, s }) => (
            <Name
              key={r.id}
              id={s.id}
              label={`${s.name} ${r.status}`}
              tone={
                r.status === "조퇴"
                  ? "bg-orange-100 text-orange-800"
                  : r.status === "기타"
                    ? "bg-slate-200 text-slate-700"
                    : "bg-amber-50 text-amber-700"
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
