"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import type { ShuttleParentLink } from "@/lib/types";

type StudentLite = { id: string; name: string; name_en: string | null };

// 학부모 테스트 링크 발급 화면(요청: "학부모는 실질적으로 연결하지는 말고 기능만 구현해서
// 학부모계정도 테스트할 수 있도록"). 학생을 검색해 링크를 만들고, 강경원님(또는 테스트 담당자)
// 본인 휴대폰으로 열어 학부모 화면을 그대로 확인해볼 수 있습니다. 실제 학부모에게는 아직
// 배포하지 않습니다.
export default function ParentLinkManager({ students, initialLinks }: { students: StudentLite[]; initialLinks: ShuttleParentLink[] }) {
  const notify = useToast();
  const [links, setLinks] = useState(initialLinks);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const linkedStudentIds = useMemo(() => new Set(links.map((l) => l.student_id)), [links]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) => !linkedStudentIds.has(s.id) && (s.name.toLowerCase().includes(q) || (s.name_en ?? "").toLowerCase().includes(q))).slice(0, 8);
  }, [students, query, linkedStudentIds]);

  async function createLink(studentId: string) {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("shuttle_parent_links")
      .upsert({ student_id: studentId }, { onConflict: "student_id" })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("테스트 링크를 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setLinks((prev) => [data as ShuttleParentLink, ...prev.filter((l) => l.student_id !== studentId)]);
    setQuery("");
  }

  async function toggleEnabled(link: ShuttleParentLink) {
    const supabase = createClient();
    const next = !link.enabled;
    setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, enabled: next } : l)));
    const { error } = await supabase.from("shuttle_parent_links").update({ enabled: next }).eq("id", link.id);
    if (error) notify("변경하지 못했습니다: " + error.message, "error");
  }

  function copyLink(token: string) {
    const link = `${window.location.origin}/shuttle-parent/${token}`;
    navigator.clipboard.writeText(link).then(
      () => notify("링크를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs font-bold text-slate-700">👨‍👩‍👧 학부모 테스트 링크 (실제 배포 아님)</p>
      <div className="relative mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="학생 이름으로 검색해 테스트 링크 만들기"
          className="w-full max-w-sm rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
        {matches.length > 0 && (
          <div className="absolute left-0 top-full z-10 mt-1 w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {matches.map((s) => (
              <button
                key={s.id}
                onClick={() => createLink(s.id)}
                disabled={busy}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {s.name} {s.name_en && <span className="text-slate-400">({s.name_en})</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {links.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">아직 만든 테스트 링크가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {links.map((l) => {
            const student = studentById.get(l.student_id);
            return (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <span className="text-sm font-semibold text-slate-700">{student?.name ?? "(삭제된 학생)"}</span>
                {student?.name_en && <span className="text-[11px] text-slate-400">{student.name_en}</span>}
                <button onClick={() => copyLink(l.token)} className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                  🔗 링크 복사
                </button>
                <button
                  onClick={() => toggleEnabled(l)}
                  className={"rounded-lg px-2 py-1 text-[11px] font-semibold " + (l.enabled ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")}
                >
                  {l.enabled ? "끄기" : "켜기"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
