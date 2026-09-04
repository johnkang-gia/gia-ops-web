"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import TermPicker, { initialTermId } from "@/components/finance/TermPicker";
import type { StudentGroup, Term } from "@/lib/types";

/**
 * 수강 그룹 — 반이 아닌 명단.
 *
 * 명단을 한 번 만들어 두면 이번 학기 교재도, 다음 학기 교재도, 그 그룹에 붙는 다른 것도
 * 전부 그 하나를 가리킵니다. 지금까지는 항목마다 아이를 하나씩 체크했고, 그렇게 만든 명단은
 * 항목 안에 갇혀 있어서 **"로봇공학 하는 아이가 누구지" 를 물으면 답할 데가 없었습니다.**
 */

export type GroupStudent = {
  id: string;
  name: string;
  nameEn: string | null;
  grade: string | null;
  className: string | null;
  department: string | null;
};

const KINDS = ["방과후", "악기", "동아리", "특강", "기타"];
const KIND_STYLE: Record<string, string> = {
  방과후: "bg-teal-50 text-teal-700 border-teal-200",
  악기: "bg-violet-50 text-violet-700 border-violet-200",
  동아리: "bg-amber-50 text-amber-700 border-amber-200",
  특강: "bg-sky-50 text-sky-700 border-sky-200",
  기타: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function GroupsClient({
  initialGroups,
  initialMembers,
  students,
  terms,
  currentUserEmail,
  isDemo,
  loadError,
}: {
  initialGroups: StudentGroup[];
  initialMembers: Record<string, string[]>;
  students: GroupStudent[];
  terms: Term[];
  currentUserEmail: string;
  isDemo: boolean;
  loadError: string | null;
}) {
  const notify = useToast();
  const [groups, setGroups] = useState(initialGroups);
  const [members, setMembers] = useState(initialMembers);
  const [termId, setTermId] = useState(() => initialTermId(terms));
  const [selected, setSelected] = useState<string | null>(initialGroups[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "방과후", note: "" });

  const inTerm = useMemo(
    // 학기가 없던 시절 그룹(비어 있음)은 지금 학기에서 함께 보여줍니다.
    () => groups.filter((g) => (g.term_id ?? "") === termId || (!g.term_id && terms.find((t) => t.id === termId)?.status === "진행중")),
    [groups, termId, terms],
  );
  const group = inTerm.find((g) => g.id === selected) ?? inTerm[0] ?? null;
  const memberIds = new Set(group ? members[group.id] ?? [] : []);

  /** 명단에 든 아이가 먼저, 그 다음 나머지. 넣고 빼는 화면이라 든 아이가 위에 있어야 합니다. */
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase().replace(/\s+/g, "");
    const match = (s: GroupStudent) =>
      !k ||
      s.name.toLowerCase().replace(/\s+/g, "").includes(k) ||
      (s.nameEn ?? "").toLowerCase().replace(/\s+/g, "").includes(k) ||
      (s.className ?? "").toLowerCase().includes(k);
    return students.filter(match).sort((a, b) => Number(memberIds.has(b.id)) - Number(memberIds.has(a.id)));
  }, [students, q, memberIds]);

  async function createGroup() {
    const name = form.name.trim();
    if (!name) return;
    setBusy(true);
    const { data, error } = await createClient()
      .from("student_groups")
      .insert({ name, kind: form.kind, note: form.note.trim() || null, term_id: termId || null, created_by: currentUserEmail, is_demo: isDemo })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("그룹을 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    const g = data as StudentGroup;
    setGroups((p) => [...p, g]);
    setSelected(g.id);
    setForm({ name: "", kind: form.kind, note: "" });
    setNewOpen(false);
    notify(`"${g.name}" 그룹을 만들었습니다. 아래에서 학생을 넣어주세요.`, "success");
  }

  async function toggle(studentId: string) {
    if (!group) return;
    const on = memberIds.has(studentId);
    const supabase = createClient();
    // 화면을 먼저 바꿉니다. 137명을 하나씩 누르는 자리라 왕복을 기다리면 손이 앞서갑니다.
    setMembers((p) => ({
      ...p,
      [group.id]: on ? (p[group.id] ?? []).filter((x) => x !== studentId) : [...(p[group.id] ?? []), studentId],
    }));
    const { error } = on
      ? await supabase.from("student_group_members").delete().eq("group_id", group.id).eq("student_id", studentId)
      : await supabase.from("student_group_members").insert({ group_id: group.id, student_id: studentId, added_by: currentUserEmail });
    if (error) {
      // 조용히 넘기면 화면에는 들어간 것처럼 보이는데 다음에 열면 빠져 있습니다.
      notify("바꾸지 못했습니다: " + error.message, "error");
      setMembers((p) => ({
        ...p,
        [group.id]: on ? [...(p[group.id] ?? []), studentId] : (p[group.id] ?? []).filter((x) => x !== studentId),
      }));
    }
  }

  /** 지금 걸러 보이는 아이 전부. 반 하나를 통째로 넣는 일이 잦습니다. */
  async function addAllShown() {
    if (!group) return;
    const add = shown.filter((s) => !memberIds.has(s.id));
    if (add.length === 0) return;
    setBusy(true);
    const { error } = await createClient()
      .from("student_group_members")
      .insert(add.map((s) => ({ group_id: group.id, student_id: s.id, added_by: currentUserEmail })));
    setBusy(false);
    if (error) {
      notify("넣지 못했습니다: " + error.message, "error");
      return;
    }
    setMembers((p) => ({ ...p, [group.id]: [...(p[group.id] ?? []), ...add.map((s) => s.id)] }));
    notify(`${add.length}명을 넣었습니다.`, "success");
  }

  async function removeGroup(g: StudentGroup) {
    const n = (members[g.id] ?? []).length;
    if (!confirm(`"${g.name}" 그룹을 지웁니다.\n\n명단 ${n}명이 함께 사라집니다.\n이 그룹을 대상으로 하는 학비외 항목이 있으면 그 항목은 아무에게도 안 붙게 됩니다.`)) return;
    const { error } = await createClient().from("student_groups").delete().eq("id", g.id);
    if (error) {
      notify("지우지 못했습니다: " + error.message, "error");
      return;
    }
    setGroups((p) => p.filter((x) => x.id !== g.id));
    if (selected === g.id) setSelected(null);
    notify(`"${g.name}" 그룹을 지웠습니다.`, "success");
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">👥 수강 그룹</h1>
        <span className="text-xs text-slate-400">방과후·악기반처럼 반이 아닌 명단</span>
        <span className="ml-auto flex items-center gap-2">
          <TermPicker terms={terms} value={termId} onChange={setTermId} />
          <button onClick={() => setNewOpen(true)} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white">
            + 그룹
          </button>
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        학년·반은 <b>어느 교실에 앉는가</b>이고, 방과후·악기는 <b>무엇을 하는가</b>입니다. 명부에는 방과후를 하는지 예/아니오만 있어서
        무엇을 하는지는 어디에도 없었습니다. 여기서 만든 명단은 학비외 항목의 대상으로 바로 고를 수 있고, 명단이 바뀌면 대상도 저절로
        따라옵니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          그룹을 읽지 못했습니다: {loadError}
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {inTerm.map((g) => {
          const n = (members[g.id] ?? []).length;
          const on = group?.id === g.id;
          return (
            <button
              key={g.id}
              onClick={() => setSelected(g.id)}
              className={
                "rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition " +
                (on ? "border-slate-800 bg-slate-800 text-white" : KIND_STYLE[g.kind] ?? KIND_STYLE.기타)
              }
            >
              {g.name}
              <span className={"ml-1.5 text-[11px] " + (on ? "opacity-70" : "opacity-60")}>{n}명</span>
            </button>
          );
        })}
        {inTerm.length === 0 && (
          <span className="text-[12px] text-slate-400">아직 그룹이 없습니다. 오른쪽 위 «+ 그룹»으로 만들어보세요.</span>
        )}
      </div>

      {group && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
            <b className="text-[13px] text-slate-800">{group.name}</b>
            <span className={"rounded border px-1.5 py-0.5 text-[10px] font-semibold " + (KIND_STYLE[group.kind] ?? KIND_STYLE.기타)}>
              {group.kind}
            </span>
            <span className="text-[11px] text-slate-400">{memberIds.size}명</span>
            {group.note && <span className="text-[11px] text-slate-400">· {group.note}</span>}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름·반으로 찾기"
              className="ml-auto w-44 rounded-lg border border-slate-300 px-2 py-1 text-xs"
            />
            {q.trim() && (
              <button
                onClick={() => void addAllShown()}
                disabled={busy}
                className="rounded-lg border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-bold text-teal-700 disabled:opacity-40"
                title="지금 걸러 보이는 아이를 한꺼번에 넣습니다"
              >
                보이는 {shown.filter((s) => !memberIds.has(s.id)).length}명 넣기
              </button>
            )}
            <button onClick={() => void removeGroup(group)} className="text-[11px] font-semibold text-slate-400 hover:text-red-600">
              그룹 삭제
            </button>
          </div>

          {/* 이름을 눌러 넣고 뺍니다. 든 아이가 위로 올라옵니다. */}
          <div className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((s) => {
              const on = memberIds.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => void toggle(s.id)}
                  className={
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[12px] transition " +
                    (on ? "border-teal-500 bg-teal-50 font-semibold text-teal-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")
                  }
                >
                  <span className={"shrink-0 text-[11px] " + (on ? "text-teal-600" : "text-slate-300")}>{on ? "✓" : "+"}</span>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{s.className ?? `${s.grade ?? "?"}학년`}</span>
                </button>
              );
            })}
            {shown.length === 0 && <p className="col-span-full py-6 text-center text-[12px] text-slate-400">찾는 학생이 없습니다.</p>}
          </div>
        </div>
      )}

      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setNewOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-slate-800">새 수강 그룹</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              학기마다 다시 짜는 명단입니다. 지금 고른 학기에 속하게 됩니다.
            </p>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && void createGroup()}
              placeholder="예: 방과후 로봇공학 · 오케스트라 바이올린"
              className="mt-3 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                  className={
                    "rounded-lg border px-2 py-1 text-[11px] font-semibold " +
                    (form.kind === k ? "border-teal-500 bg-teal-600 text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50")
                  }
                >
                  {k}
                </button>
              ))}
            </div>
            <input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="메모(선택) — 요일·시간·담당 선생님"
              className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNewOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600">
                그만두기
              </button>
              <button
                onClick={() => void createGroup()}
                disabled={busy || !form.name.trim()}
                className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
