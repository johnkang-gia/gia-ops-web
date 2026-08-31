"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { AppUser } from "@/lib/types";
import { isDeveloperEmail } from "@/lib/roles";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "👥 사용자 관리란?",
    lines: [
      "가입 신청한 계정을 승인/거부하고, 이름·소속·직위(교사/행정직원/관리자)를 지정합니다.",
      "직위에 따라 접근 가능한 메뉴가 달라지므로, 신규 직원이 들어오면 여기서 먼저 직위를 정확히 설정해야 합니다.",
    ],
  },
];

// 개발자 계정은 서버(admin/users/page.tsx)에서 이미 걸러서 initialUsers에 담겨오지 않지만,
// 실시간 구독(postgres_changes)은 app_users 테이블 전체를 대상으로 하므로 여기서도 한 번 더
// 걸러서 개발자 계정이 실시간 이벤트로 화면에 새로 나타나는 일이 없게 합니다.

// 세 목록(대기/승인/거절)이 각자 계속 늘어질 수 있어, 게시판처럼 각각 독립적으로 페이지를
// 나눠 보여줍니다.
const PAGE_SIZE = 10;
const POSITIONS = ["교사", "행정직원", "관리자"] as const;
// 최고관리자는 개발자만 지정합니다(개발자 바로 밑 계층). 관리자가 스스로를 올릴 수 있으면
// 계층이 계층이 아닙니다.
const DEVELOPER_ONLY_POSITIONS = ["최고관리자"] as const;
const DEPARTMENTS = ["유치부", "초등부", "중고등부"] as const;

function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 16).replace("T", " ");
}

export default function AdminUsersClient({
  initialUsers,
  viewerIsDeveloper = false,
  canManageFinance = false,
}: {
  initialUsers: AppUser[];
  viewerIsDeveloper?: boolean;
  /**
   * 재무 열쇠를 주고 뺏을 수 있는가(개발자·최고관리자만 true).
   *
   * 담당자: "재무관리자는 다른 사람들이 볼 때는 그냥 관리자로 보이도록."
   * 그래서 이 값이 false면 열쇠 표시 자체가 **화면에 아예 없습니다** - 흐리게 보이거나
   * 잠긴 채로 보이면 "저 사람 뭔가 더 있구나"가 드러납니다.
   */
  canManageFinance?: boolean;
}) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 요청("개발자는 사용자관리에서 사용자의 이름,부서들을 바꿀 수 있도록") - 개발자 계정에게만
  // 이름/소속 인라인 편집을 노출합니다. 온보딩 때 본인이 잘못 입력했거나 오탈자가 있을 때
  // 개발자가 직접 정정할 수 있게 하려는 용도라, 일반 관리자에게는 이 편집 UI 자체를 숨깁니다.
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDept, setEditDept] = useState("");

  function startEdit(u: AppUser) {
    setEditingEmail(u.email);
    setEditName(u.name ?? "");
    setEditDept(u.department ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingEmail(null);
  }

  async function saveEdit(email: string) {
    if (!editName.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }
    setBusyEmail(email);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: editName.trim(), department: editDept }),
    });
    const data = await res.json();
    setBusyEmail(null);
    if (!res.ok) {
      setError(data.error || "처리하지 못했습니다.");
      return;
    }
    setEditingEmail(null);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("app-users-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_users" },
        (payload) => {
          setUsers((prev) => {
            if (payload.eventType === "DELETE") {
              const oldEmail = (payload.old as { email: string }).email;
              return prev.filter((u) => u.email !== oldEmail);
            }
            const next = payload.new as AppUser;
            if (isDeveloperEmail(next.email)) return prev;
            const exists = prev.some((u) => u.email === next.email);
            const merged = exists
              ? prev.map((u) => (u.email === next.email ? next : u))
              : [...prev, next];
            return merged;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function updateStatus(email: string, status: "approved" | "rejected") {
    setBusyEmail(email);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, status }),
    });
    const data = await res.json();
    setBusyEmail(null);
    if (!res.ok) {
      setError(data.error || "처리하지 못했습니다.");
    }
  }

  // 직위(권한)는 이 화면에서 관리자가 언제든 바꿀 수 있습니다 - 온보딩 때 본인이 고른 값은
  // 참고용일 뿐이고, 승인 전이든 후든 실제 권한은 여기서 관리자가 확정/정정합니다.
  async function updatePosition(email: string, position: string) {
    setBusyEmail(email);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, position }),
    });
    const data = await res.json();
    setBusyEmail(null);
    if (!res.ok) {
      setError(data.error || "처리하지 못했습니다.");
    }
  }

  // 재무 열쇠 주기·뺏기. 이유를 함께 남깁니다(나중에 "왜 줬더라"를 못 대면 기록이 반쪽입니다).
  async function updateFinanceAccess(email: string, next: boolean) {
    const reason = window.prompt(
      next ? `${email} 에게 재무 권한을 줍니다. 이유를 적어주세요(기록에 남습니다).` : `${email} 의 재무 권한을 회수합니다. 이유를 적어주세요.`,
      ""
    );
    if (reason === null) return; // 취소
    setBusyEmail(email);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, financeAccess: next, financeReason: reason }),
    });
    const data = await res.json();
    setBusyEmail(null);
    if (!res.ok) {
      setError(data.error || "처리하지 못했습니다.");
      return;
    }
    setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, finance_access: next } : u)));
  }

  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const rejected = users.filter((u) => u.status === "rejected");

  const [pendingPage, setPendingPage] = useState(1);
  const pendingPageItems = useMemo(
    () => pending.slice((pendingPage - 1) * PAGE_SIZE, pendingPage * PAGE_SIZE),
    [pending, pendingPage]
  );
  const pendingTotalPages = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));
  useEffect(() => {
    setPendingPage(1);
  }, [pending.length]);

  // 직위 탭(담당자: "교직원도 행정·교사·관리자로 나눠놨으니까 탭을 나눠서 볼 수 있게 해줘").
  // null = 전체. 직위가 아직 안 정해진 분들은 '미지정'으로 따로 모읍니다 - 전체에만 묻어
  // 있으면 직위를 정해줘야 하는 분을 영영 못 찾습니다.
  const [posTab, setPosTab] = useState<string | null>(null);
  const posCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const u of approved) c.set(u.position || "미지정", (c.get(u.position || "미지정") ?? 0) + 1);
    return c;
  }, [approved]);
  const approvedFiltered = useMemo(
    () => (posTab == null ? approved : approved.filter((u) => (u.position || "미지정") === posTab)),
    [approved, posTab]
  );

  const [approvedPage, setApprovedPage] = useState(1);
  const approvedPageItems = useMemo(
    () => approvedFiltered.slice((approvedPage - 1) * PAGE_SIZE, approvedPage * PAGE_SIZE),
    [approvedFiltered, approvedPage]
  );
  const approvedTotalPages = Math.max(1, Math.ceil(approvedFiltered.length / PAGE_SIZE));
  useEffect(() => {
    setApprovedPage(1);
  }, [approvedFiltered.length]);

  const [rejectedPage, setRejectedPage] = useState(1);
  const rejectedPageItems = useMemo(
    () => rejected.slice((rejectedPage - 1) * PAGE_SIZE, rejectedPage * PAGE_SIZE),
    [rejected, rejectedPage]
  );
  const rejectedTotalPages = Math.max(1, Math.ceil(rejected.length / PAGE_SIZE));
  useEffect(() => {
    setRejectedPage(1);
  }, [rejected.length]);

  // 이름/소속 표시 + (개발자에게만 보이는) 편집 토글을 세 목록(대기/승인/거절)이 공통으로
  // 씁니다. 편집 중이면 입력폼으로, 아니면 기존처럼 텍스트로 보여줍니다.
  function renderNameBlock(u: AppUser, options?: { mutedName?: boolean }) {
    const isEditing = editingEmail === u.email;
    if (isEditing) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="이름"
            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
          />
          <select
            value={editDept}
            onChange={(e) => setEditDept(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="">소속 미지정</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            onClick={() => saveEdit(u.email)}
            disabled={busyEmail === u.email}
            className="rounded-lg bg-gia-navy px-2 py-1 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            저장
          </button>
          <button
            onClick={cancelEdit}
            disabled={busyEmail === u.email}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            취소
          </button>
        </div>
      );
    }
    return (
      <div className={"text-sm font-semibold" + (options?.mutedName ? " text-slate-500" : "")}>
        {u.name ? (
          <>
            {u.name}
            <span className="ml-1.5 font-normal text-slate-500">
              {[u.department, u.position].filter(Boolean).join(" · ")}
            </span>
          </>
        ) : (
          <span className="text-amber-600">이름 미입력(온보딩 대기 중)</span>
        )}
        {viewerIsDeveloper && (
          <button
            onClick={() => startEdit(u)}
            title="이름/소속 편집(개발자 전용)"
            className="ml-1.5 text-xs text-slate-400 hover:text-slate-600"
          >
            ✏️
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">사용자 관리</h1>
          <GuideButton title="사용자 관리 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-6 text-sm text-slate-500">
          giamicro.com 계정으로 로그인하면 자동으로 승인 대기 목록에 올라갑니다. 직위(교사/행정직원/
          관리자)는 온보딩 때 본인이 고른 값과 무관하게 여기서 관리자가 최종적으로 지정·변경하며,
          실제 메뉴 접근 권한은 이 직위를 기준으로만 결정됩니다(교사는 위클리 리포트만, 관리자는
          전체). 직위를 지정해야 승인할 수 있고, 승인된 계정도 언제든 직위를 바꿀 수 있습니다.
          퇴사 등으로 접근을 막아야 할 때는 승인된 계정을 &quot;차단&quot;하면 즉시 접근이
          제한됩니다.
          {viewerIsDeveloper && " 이름 옆 ✏️를 누르면 개발자 권한으로 이름/소속을 직접 정정할 수 있습니다."}
        </p>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-slate-700">
            승인 대기 <span className="text-slate-400">({pending.length})</span>
          </h2>
          {pending.length === 0 ? (
            <p className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
              대기 중인 신청이 없습니다.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {pendingPageItems.map((u) => (
                  <div
                    key={u.email}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
                  >
                    <div>
                      {renderNameBlock(u)}
                      <div className="text-xs text-slate-500">
                        {u.email} · 신청일 {formatDate(u.requested_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={u.position ?? ""}
                        onChange={(e) => updatePosition(u.email, e.target.value)}
                        disabled={busyEmail === u.email}
                        className="rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      >
                        <option value="">직위 미지정</option>
                        {POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => updateStatus(u.email, "approved")}
                        disabled={busyEmail === u.email || !u.position}
                        title={!u.position ? "승인하려면 먼저 직위를 지정해주세요." : undefined}
                        className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                      >
                        승인
                      </button>
                      <button
                        onClick={() => updateStatus(u.email, "rejected")}
                        disabled={busyEmail === u.email}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        거절
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Pagination page={pendingPage} totalPages={pendingTotalPages} onChange={setPendingPage} />
            </>
          )}
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-slate-700">
            승인됨 <span className="text-slate-400">({approved.length})</span>
          </h2>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPosTab(null)}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition " +
                (posTab == null ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
              }
            >
              전체 <span className="tabular-nums">{approved.length}</span>
            </button>
            {[...POSITIONS, "미지정"].map((p) => {
              const n = posCount.get(p) ?? 0;
              if (n === 0) return null;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosTab(p)}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition " +
                    (posTab === p ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                  }
                >
                  {p} <span className="tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2">
            {approvedPageItems.map((u) => (
              <div
                key={u.email}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div>
                  {renderNameBlock(u)}
                  <div className="text-xs text-slate-500">
                    {u.email} · 승인일 {formatDate(u.decided_at)} {u.decided_by ? `· ${u.decided_by}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/staff/${encodeURIComponent(u.email)}`}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    📋 근무기록
                  </Link>
                  <select
                    value={u.position ?? ""}
                    onChange={(e) => updatePosition(u.email, e.target.value)}
                    disabled={busyEmail === u.email}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    <option value="">직위 미지정</option>
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    {/* 최고관리자는 개발자에게만 보입니다. */}
                    {viewerIsDeveloper &&
                      DEVELOPER_ONLY_POSITIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                  </select>
                  {/* 재무 열쇠. 개발자·최고관리자에게만 이 버튼 자체가 존재합니다. */}
                  {canManageFinance && (
                    <button
                      onClick={() => updateFinanceAccess(u.email, !u.finance_access)}
                      disabled={busyEmail === u.email}
                      title={
                        u.finance_access
                          ? "재무 권한 있음 — 눌러서 회수합니다. (이 표시는 개발자·최고관리자에게만 보입니다)"
                          : "재무 권한 없음 — 눌러서 부여합니다."
                      }
                      className={
                        "rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-50 " +
                        (u.finance_access
                          ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border border-slate-200 text-slate-400 hover:bg-slate-50")
                      }
                    >
                      {u.finance_access ? "💰 재무" : "재무"}
                    </button>
                  )}
                  <button
                    onClick={() => updateStatus(u.email, "rejected")}
                    disabled={busyEmail === u.email}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    차단
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={approvedPage} totalPages={approvedTotalPages} onChange={setApprovedPage} />
        </section>

        {rejected.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold text-slate-700">
              거절/차단됨 <span className="text-slate-400">({rejected.length})</span>
            </h2>
            <div className="flex flex-col gap-2">
              {rejectedPageItems.map((u) => (
                <div
                  key={u.email}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div>
                    {renderNameBlock(u, { mutedName: true })}
                    <div className="text-xs text-slate-400">
                      {u.email} · 처리일 {formatDate(u.decided_at)} {u.decided_by ? `· ${u.decided_by}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => updateStatus(u.email, "approved")}
                    disabled={busyEmail === u.email}
                    className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                  >
                    다시 승인
                  </button>
                </div>
              ))}
            </div>
            <Pagination page={rejectedPage} totalPages={rejectedTotalPages} onChange={setRejectedPage} />
          </section>
        )}
      </div>
    </div>
  );
}
