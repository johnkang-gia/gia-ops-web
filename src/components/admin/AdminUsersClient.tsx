"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppUser } from "@/lib/types";
import { isDeveloperEmail } from "@/lib/roles";

function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 16).replace("T", " ");
}

export default function AdminUsersClient({ initialUsers }: { initialUsers: AppUser[] }) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const rejected = users.filter((u) => u.status === "rejected");

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-bold">사용자 관리</h1>
      <p className="mb-6 text-sm text-slate-500">
        giamicro.com 계정으로 로그인하면 자동으로 승인 대기 목록에 올라갑니다. 승인해야 해당
        계정이 대시보드에 들어갈 수 있고, 퇴사 등으로 접근을 막아야 할 때는 승인된 계정을
        &quot;차단&quot;하면 즉시 접근이 제한됩니다. 개발자 계정(johnkang@giamicro.com)은 상태와
        무관하게 항상 접근할 수 있어 목록에서 변경할 수 없습니다.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-slate-700">
          승인 대기 <span className="text-slate-400">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
            대기 중인 신청이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((u) => (
              <div
                key={u.email}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
              >
                <div>
                  <div className="text-sm font-semibold">
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
                  </div>
                  <div className="text-xs text-slate-500">
                    {u.email} · 신청일 {formatDate(u.requested_at)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateStatus(u.email, "approved")}
                    disabled={busyEmail === u.email}
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
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-slate-700">
          승인됨 <span className="text-slate-400">({approved.length})</span>
        </h2>
        <div className="flex flex-col gap-2">
          {approved.map((u) => {
            const developer = isDeveloperEmail(u.email);
            return (
              <div
                key={u.email}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div>
                  <div className="text-sm font-semibold">
                    {u.name || u.email}
                    {(developer || u.position) && (
                      <span className="ml-2 rounded bg-gia-navy px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {developer ? "개발자" : u.position}
                      </span>
                    )}
                    {u.department && <span className="ml-1.5 font-normal text-slate-500">{u.department}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {u.email} · 승인일 {formatDate(u.decided_at)} {u.decided_by ? `· ${u.decided_by}` : ""}
                  </div>
                </div>
                {!developer && (
                  <button
                    onClick={() => updateStatus(u.email, "rejected")}
                    disabled={busyEmail === u.email}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    차단
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {rejected.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-700">
            거절/차단됨 <span className="text-slate-400">({rejected.length})</span>
          </h2>
          <div className="flex flex-col gap-2">
            {rejected.map((u) => (
              <div
                key={u.email}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-500">{u.name || u.email}</div>
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
        </section>
      )}
    </div>
  );
}
