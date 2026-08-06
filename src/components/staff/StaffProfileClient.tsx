"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppUser, StaffAssignment, Task, WrClass } from "@/lib/types";

const DEPARTMENTS = ["유치부", "초등부", "중고등부"];
const POSITIONS = ["교사", "행정직원", "관리자"];

function fmtDate(d: string | null) {
  return d || "-";
}

// 학생 통합 프로필(/students/[id])과 같은 구조입니다 - 기본 인적사항 + 연도/학기별 담당 이력 +
// 관련 업무를 한 화면에서 보여줍니다. 입사일/퇴사일 수정과 담당 이력 추가/삭제는 관리자만
// 할 수 있고(viewerIsAdmin), 그 외에는 조회만 됩니다(행정직원도 조회는 가능 - 화면 진입 자체가
// 이미 관리자·행정직원으로 제한되어 있습니다).
export default function StaffProfileClient({
  staff,
  assignments,
  tasks,
  terms,
  classes,
  termLabel,
  classLabel,
  viewerIsAdmin,
}: {
  staff: AppUser;
  assignments: StaffAssignment[];
  tasks: Task[];
  terms: { id: string; year: string; term_type: string }[];
  classes: WrClass[];
  termLabel: Record<string, string>;
  classLabel: Record<string, string>;
  viewerIsAdmin: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── 입사일/퇴사일 편집 ──────────────────────────────────────────────
  const [editingDates, setEditingDates] = useState(false);
  const [hireDate, setHireDate] = useState(staff.hire_date ?? "");
  const [leaveDate, setLeaveDate] = useState(staff.leave_date ?? "");

  async function saveDates() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: staff.email, hire_date: hireDate, leave_date: leaveDate }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "저장하지 못했습니다.");
      return;
    }
    setEditingDates(false);
    router.refresh();
  }

  // ── 담당 이력 추가 ──────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTermId, setNewTermId] = useState("");
  const [newDepartment, setNewDepartment] = useState(staff.department ?? "");
  const [newPosition, setNewPosition] = useState(staff.position ?? "");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newClassId, setNewClassId] = useState("");

  async function addAssignment() {
    if (!newRoleLabel.trim()) {
      setError("담당 역할을 입력해주세요(예: 3학년 2반 담임).");
      return;
    }
    setBusy(true);
    setError(null);
    const cls = classes.find((c) => c.id === newClassId);
    const res = await fetch("/api/staff/assignments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        staff_email: staff.email,
        term_id: newTermId || null,
        department: newDepartment || null,
        position: newPosition || null,
        role_label: newRoleLabel.trim(),
        grade: cls?.grade ?? null,
        class_id: newClassId || null,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "추가하지 못했습니다.");
      return;
    }
    setShowAddForm(false);
    setNewRoleLabel("");
    setNewClassId("");
    router.refresh();
  }

  async function deleteAssignment(id: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff/assignments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "삭제하지 못했습니다.");
      return;
    }
    router.refresh();
  }

  const retired = !!staff.leave_date;
  const quickNav = [
    { href: "#basic", label: "기본정보" },
    { href: "#history", label: "담당 이력" },
    { href: "#tasks", label: "관련 업무" },
  ];

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
      )}

      <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800">{staff.name || "(이름 미입력)"}</h1>
          </div>
          <p className="text-sm text-slate-500">
            {[staff.department, staff.position].filter(Boolean).join(" · ") || "-"} · {staff.email}
          </p>
        </div>
        <span
          className={
            "shrink-0 rounded-full px-2 py-1 text-xs font-semibold " +
            (retired ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700")
          }
        >
          {retired ? "퇴사" : "재직중"}
        </span>
      </div>

      <div className="sticky top-0 z-10 mb-5 flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur">
        {quickNav.map((n) => (
          <a key={n.href} href={n.href} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
            {n.label}
          </a>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">담당 이력 {assignments.length}건</span>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">관련 업무 {tasks.length}건</span>
      </div>

      <div id="basic" className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm scroll-mt-16">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">기본정보</h2>
          {viewerIsAdmin && !editingDates && (
            <button onClick={() => setEditingDates(true)} className="text-xs text-slate-400 hover:text-slate-600">
              ✏️ 입사/퇴사일 편집
            </button>
          )}
        </div>
        {editingDates ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">입사일</label>
              <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">퇴사일</label>
              <input type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
            <button onClick={saveDates} disabled={busy} className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50">
              저장
            </button>
            <button onClick={() => setEditingDates(false)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
              취소
            </button>
          </div>
        ) : (
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-400">입사일</dt><dd>{fmtDate(staff.hire_date)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">퇴사일</dt><dd>{fmtDate(staff.leave_date)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">계정 상태</dt><dd>{staff.status === "approved" ? "승인됨" : staff.status === "pending" ? "승인대기" : "거절/차단"}</dd></div>
          </dl>
        )}
      </div>

      <div id="history" className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm scroll-mt-16">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">🗓️ 연도·학기별 담당 이력 ({assignments.length}건)</h2>
          {viewerIsAdmin && (
            <button onClick={() => setShowAddForm((v) => !v)} className="text-xs text-slate-400 hover:text-slate-600">
              {showAddForm ? "닫기" : "+ 이력 추가"}
            </button>
          )}
        </div>

        {showAddForm && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">학기</label>
              <select value={newTermId} onChange={(e) => setNewTermId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
                <option value="">미지정</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>{t.year} {t.term_type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">소속</label>
              <select value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
                <option value="">미지정</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">직위</label>
              <select value={newPosition} onChange={(e) => setNewPosition(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
                <option value="">미지정</option>
                {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">반(선택)</label>
              <select value={newClassId} onChange={(e) => setNewClassId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
                <option value="">선택안함</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.grade}학년 {c.class_name}반</option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="mb-1 block text-[11px] text-slate-400">담당 역할</label>
              <input
                value={newRoleLabel}
                onChange={(e) => setNewRoleLabel(e.target.value)}
                placeholder="예: 3학년 2반 담임"
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
            <button onClick={addAssignment} disabled={busy} className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50">
              추가
            </button>
          </div>
        )}

        {assignments.length === 0 ? (
          <p className="text-xs text-slate-400">등록된 담당 이력이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5 text-xs">
            {assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-600">{a.term_id ? termLabel[a.term_id] ?? "학기 미상" : "학기 미상"}</span>
                  <span className="ml-2 text-slate-500">
                    {a.role_label}
                    {a.class_id && classLabel[a.class_id] ? ` (${classLabel[a.class_id]})` : ""}
                    {[a.department, a.position].filter(Boolean).length > 0 ? ` · ${[a.department, a.position].filter(Boolean).join(" · ")}` : ""}
                  </span>
                </div>
                {viewerIsAdmin && (
                  <button onClick={() => deleteAssignment(a.id)} disabled={busy} className="shrink-0 text-slate-300 hover:text-red-500">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="tasks" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm scroll-mt-16">
        <h2 className="mb-2 text-sm font-bold text-slate-700">🗂️ 관련 업무 ({tasks.length}건)</h2>
        {tasks.length === 0 ? (
          <p className="text-xs text-slate-400">등록자이거나 담당자로 태그된 업무가 없습니다.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 text-slate-400">{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
