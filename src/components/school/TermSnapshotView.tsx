import type { WrTermClassSnapshot } from "@/lib/types";

// 지난 학기 반·과목 세팅 보기(읽기 전용).
//
// 지난 학기 배정을 이제 와서 고칠 일은 없습니다. 고칠 수 있게 만들면 "지금 반"과 헷갈려
// 엉뚱한 학기를 건드리게 됩니다. 그래서 읽기만 됩니다.

function Empty({ termLabel, kind }: { termLabel: string; kind: "반" | "과목" }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
      <p className="text-sm font-semibold text-slate-500">{termLabel}의 {kind} 기록이 없습니다.</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        학기 기록은 그 학기가 <b>끝날 때</b> 저절로 저장됩니다. 이 기능을 만들기 전에 지나간
        학기는 남아 있는 것이 없습니다 — 지금 진행중인 학기부터 쌓입니다.
      </p>
    </div>
  );
}

export function TermSnapshotClasses({
  snapshot,
  termLabel,
}: {
  snapshot: WrTermClassSnapshot | null;
  termLabel: string;
}) {
  const classes = snapshot?.classes ?? [];
  if (classes.length === 0) return <Empty termLabel={termLabel} kind="반" />;

  return (
    <div>
      <p className="mb-2 text-[11px] text-slate-400">
        {termLabel} 기록 · {new Date(snapshot!.taken_at).toLocaleString("ko-KR")}에 저장
        {snapshot!.source === "자동" ? " (학기 종료 시 자동)" : " (직접 저장)"} · 읽기 전용
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">학년</th>
              <th className="px-3 py-2 font-semibold">반</th>
              <th className="px-3 py-2 font-semibold">담임</th>
              <th className="px-3 py-2 font-semibold">부담임</th>
              <th className="px-3 py-2 font-semibold">학생</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 text-slate-600">{c.grade ?? "-"}</td>
                <td className="px-3 py-2 font-bold text-slate-800">{c.class_name ?? "-"}</td>
                <td className="px-3 py-2 text-slate-700">{c.teacher_name ?? <span className="text-slate-300">미배정</span>}</td>
                <td className="px-3 py-2 text-slate-500">{c.sub_teacher_name ?? "-"}</td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-slate-700">{c.student_count}명</span>
                  {c.students.length > 0 && (
                    <span className="ml-2 text-[11px] leading-relaxed text-slate-400">
                      {c.students.map((s) => s.name).join(" · ")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TermSnapshotSubjects({
  snapshot,
  termLabel,
}: {
  snapshot: WrTermClassSnapshot | null;
  termLabel: string;
}) {
  const subjects = snapshot?.subjects ?? [];
  if (subjects.length === 0) return <Empty termLabel={termLabel} kind="과목" />;

  return (
    <div>
      <p className="mb-2 text-[11px] text-slate-400">
        {termLabel} 기록 · {new Date(snapshot!.taken_at).toLocaleString("ko-KR")}에 저장 · 읽기 전용
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">과목</th>
              <th className="px-3 py-2 font-semibold">담당 교사</th>
              <th className="px-3 py-2 font-semibold">반</th>
              <th className="px-3 py-2 font-semibold">수강</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {s.color && (
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    )}
                    <b className="text-slate-800">{s.name}</b>
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">{s.teacher_name ?? <span className="text-slate-300">미배정</span>}</td>
                <td className="px-3 py-2 text-slate-500">{s.class_name ?? "-"}</td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-slate-700">{s.student_count}명</span>
                  {s.students.length > 0 && (
                    <span className="ml-2 text-[11px] leading-relaxed text-slate-400">{s.students.join(" · ")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
