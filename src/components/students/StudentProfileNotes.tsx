"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

/**
 * **학생 특이사항 메모** — 사건이 없어도 적어 두는 아이 이야기.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 학생별 기록은 전부 «무슨 일이 일어나야» 남았습니다(사건기록·출결·픽업·하루 메모). 「방과후 펜싱을
 * 가기 싫어해서 아프다고 하거나 부모님께 전화하는 일이 잦다」 같은 성향·관계·사정은 담당자
 * 머릿속에만 있었고, 그 사람이 자리에 없으면 전화를 받은 다른 직원은 아무것도 몰랐습니다.
 *
 * ── 항목을 나누지 않습니다 ──────────────────────────────────────────
 *
 * 성향·교우관계·가정·건강 칸을 만들면 어디에 적을지 고민하다 안 적습니다. 한 칸에 자유롭게 적고,
 * 같은 메모를 계속 고치거나 새 메모를 덧붙입니다. 누가 언제 적었는지는 줄마다 남습니다.
 *
 * ── 학기마다 새로 씁니다 ────────────────────────────────────────────
 *
 * 메모는 적은 시점의 학기에 묶입니다. 학기가 바뀌면 지난 학기 메모는 「이전 특이사항」으로 접혀
 * 보이고 이번 학기 칸은 비어 시작합니다. 지난 학기 메모는 고치지 않습니다 - 그때 그렇게 보였다는
 * 기록이고, 지금 다르면 이번 학기에 새로 적습니다.
 */

export type ProfileNote = {
  id: string;
  term_id: string | null;
  body: string;
  author_email: string;
  author_name: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT = "id, term_id, body, author_email, author_name, updated_by, created_at, updated_at";

function when(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  // kst-ok: 브라우저(한국)에서 보는 시각 표시입니다. 날짜 계산이 아니라 «언제 적었나» 표기입니다.
  return `${d.getFullYear()}.${mm}.${dd} ${hh}:${mi}`;
}

export default function StudentProfileNotes({
  studentId,
  studentName,
  currentTermId,
  termLabels,
  me,
  myName,
}: {
  studentId: string;
  studentName: string;
  /** 진행중 학기. 없으면 새 메모는 학기 미지정으로 들어갑니다. */
  currentTermId: string | null;
  /** 학기 번호 → «2026 1학기» 같은 글자. 이전 특이사항을 학기별로 접는 데 씁니다. */
  termLabels: Record<string, string>;
  me: string;
  myName: string;
}) {
  const notify = useToast();
  const [notes, setNotes] = useState<ProfileNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = createClient();
      const { data, error } = await sb
        .from("student_profile_notes")
        .select(SELECT)
        .eq("student_id", studentId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (!alive) return;
      // 못 읽은 것을 «메모 없음»으로 보여주면 사람은 적을 것이 없다고 믿습니다.
      if (error) notify(`특이사항을 읽지 못했습니다: ${error.message}`, "error");
      setNotes((data as ProfileNote[] | null) ?? []);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [studentId, notify]);

  const current = notes.filter((n) => (n.term_id ?? null) === (currentTermId ?? null));
  const past = notes.filter((n) => (n.term_id ?? null) !== (currentTermId ?? null));
  // 이전 학기 메모는 학기별로 묶어 최근 학기가 위에 오게 합니다.
  const pastGroups = new Map<string, ProfileNote[]>();
  for (const n of past) {
    const k = n.term_id ?? "";
    if (!pastGroups.has(k)) pastGroups.set(k, []);
    pastGroups.get(k)!.push(n);
  }
  const pastKeys = [...pastGroups.keys()].sort((a, b) => {
    const la = pastGroups.get(a)![0].created_at;
    const lb = pastGroups.get(b)![0].created_at;
    return lb.localeCompare(la);
  });

  async function add() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const sb = createClient();
    const { data, error } = await sb
      .from("student_profile_notes")
      .insert({ student_id: studentId, term_id: currentTermId, body, author_email: me, author_name: myName })
      .select(SELECT)
      .single();
    setBusy(false);
    if (error) return notify(`저장하지 못했습니다: ${error.message}`, "error");
    setNotes((p) => [...p, data as ProfileNote]);
    setDraft("");
  }

  async function saveEdit() {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return notify("빈 메모는 저장하지 않습니다. 지우려면 「내리기」를 누르세요.", "error");
    setBusy(true);
    const sb = createClient();
    const { data, error } = await sb
      .from("student_profile_notes")
      .update({ body, updated_by: me })
      .eq("id", editing.id)
      .select(SELECT)
      .single();
    setBusy(false);
    if (error) return notify(`고치지 못했습니다: ${error.message}`, "error");
    setNotes((p) => p.map((n) => (n.id === editing.id ? (data as ProfileNote) : n)));
    setEditing(null);
  }

  async function remove(n: ProfileNote) {
    if (!confirm("이 메모를 내립니다. 화면에서 사라지지만 기록은 남습니다.")) return;
    setBusy(true);
    const sb = createClient();
    const { error } = await sb
      .from("student_profile_notes")
      .update({ deleted_at: new Date().toISOString(), deleted_by: me })
      .eq("id", n.id);
    setBusy(false);
    if (error) return notify(`내리지 못했습니다: ${error.message}`, "error");
    setNotes((p) => p.filter((x) => x.id !== n.id));
  }

  const termName = (id: string | null) => (id ? termLabels[id] ?? "지난 학기" : "학기 미지정");

  return (
    <div className="g-panel-solid p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-700">
          📝 특이사항 <span className="ml-1 text-[11px] font-semibold text-slate-400">{termName(currentTermId)}</span>
        </h2>
        <span className="text-[11px] text-slate-400">
          성향·교우관계·가정 사정·건강 등 이 아이에 대해 교직원이 알아야 할 것을 자유롭게. 누가 봐도 알 수 있게 적어 주세요.
        </span>
      </div>

      {!loaded ? (
        <div className="py-3 text-[12px] text-slate-400">읽는 중…</div>
      ) : current.length === 0 ? (
        <div className="mb-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-400">
          이번 학기에 적힌 특이사항이 없습니다.
          {past.length > 0 && " 지난 학기 메모는 아래 「이전 특이사항」에 있습니다."}
        </div>
      ) : (
        <ul className="mb-2 space-y-1.5">
          {current.map((n) => (
            <li key={n.id} className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2">
              {editing?.id === n.id ? (
                <div className="space-y-1.5">
                  <textarea
                    value={editing.body}
                    onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                    rows={3}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-[13px] leading-relaxed"
                    autoFocus
                  />
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setEditing(null)} className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100">취소</button>
                    <button onClick={() => void saveEdit()} disabled={busy} className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-40">저장</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">{n.body}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-400">
                    <span>
                      {n.author_name || n.author_email} · {when(n.created_at)}
                      {n.updated_at !== n.created_at && ` · 고침 ${when(n.updated_at)}${n.updated_by ? ` (${n.updated_by.split("@")[0]})` : ""}`}
                    </span>
                    <button onClick={() => setEditing({ id: n.id, body: n.body })} disabled={busy} className="rounded px-1.5 py-0.5 font-bold text-amber-700 hover:bg-amber-100">고치기</button>
                    <button onClick={() => void remove(n)} disabled={busy} className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-700">내리기</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={`${studentName.split("(")[0].trim()} — 예: 이번 학기 방과후 펜싱을 가기 싫어해 수업 전 아프다고 하거나 부모님께 전화하는 일이 잦음`}
          className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-relaxed"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void add();
          }}
        />
        <button
          onClick={() => void add()}
          disabled={busy || !draft.trim()}
          className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-700 disabled:opacity-40"
          title="⌘/Ctrl + Enter"
        >
          적어 두기
        </button>
      </div>

      {past.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button onClick={() => setShowPast((v) => !v)} className="text-[12px] font-bold text-slate-500 hover:text-slate-800">
            {showPast ? "▾" : "▸"} 이전 특이사항 {past.length}건
          </button>
          {showPast && (
            <div className="mt-1.5 space-y-2">
              {pastKeys.map((k) => (
                <div key={k || "none"}>
                  <div className="mb-1 text-[11px] font-bold text-slate-500">{termName(k || null)}</div>
                  <ul className="space-y-1">
                    {pastGroups.get(k)!.map((n) => (
                      <li key={n.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5">
                        <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-600">{n.body}</div>
                        <div className="mt-0.5 text-[10.5px] text-slate-400">
                          {n.author_name || n.author_email} · {when(n.created_at)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
