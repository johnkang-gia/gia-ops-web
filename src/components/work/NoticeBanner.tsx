"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { nameFor } from "@/lib/teamName";
import type { TeamMember, WorkNotice } from "@/lib/types";

// 요청: "업무에서 전체공지가 있을경우 바로 상단으로 옮겨지고, 새로운 공지가 있으면 이전공지가
// 사라지고, 다음공지가 상단으로 옮겨지게 하고, 전체공지 히스토리를 상단오른쪽에 히스토리
// 아이콘을 눌러서 볼 수 있도록 만들어주고, 공지로 상단에 뜨는경우, 각각의 이용자들이 공지를
// 접을 수 있게 해줘"
//
// 동작 요약
//  - 공지는 지우지 않고 계속 쌓아두고, 지금 보는 부서에 해당하는 것 중 "가장 최근 하나"만
//    상단에 띄웁니다. 그래서 새 공지를 올리면 이전 공지는 저절로 상단에서 내려가고 히스토리에만
//    남습니다(별도의 내리기 조작이 필요 없습니다).
//  - 접기는 사람마다 따로 저장됩니다(work_notice_collapses). 접어둔 뒤 새 공지가 올라오면 그
//    공지는 다시 펼쳐진 채로 보이므로, 접어놨다고 새 공지를 놓치지 않습니다.
//  - 올리기/내리기는 관리자·행정직원만 할 수 있고, 보는 것은 모두 가능합니다.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function NoticeBanner({
  initialNotices,
  collapsedIds,
  activeDepartmentName,
  team,
  userEmail,
  canManage,
}: {
  initialNotices: WorkNotice[];
  collapsedIds: string[];
  activeDepartmentName: string;
  team: TeamMember[];
  userEmail: string;
  canManage: boolean;
}) {
  const notify = useToast();
  const [notices, setNotices] = useState(initialNotices);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(collapsedIds));
  const [showHistory, setShowHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"전체" | "부서">("전체");

  // 다른 사람이 공지를 올리면 새로고침 없이 바로 뜨도록 구독합니다. tasks처럼 화면 곳곳에서
  // 쓰이는 표가 아니라 이 컴포넌트 하나만 쓰므로 여기서 직접 구독해도 채널이 겹치지 않습니다.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("work-notices")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_notices" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const row = payload.new as WorkNotice;
          setNotices((prev) => (prev.some((n) => n.id === row.id) ? prev : [row, ...prev]));
        } else if (payload.eventType === "UPDATE") {
          const row = payload.new as WorkNotice;
          setNotices((prev) => prev.map((n) => (n.id === row.id ? row : n)));
        } else if (payload.eventType === "DELETE") {
          const row = payload.old as { id: string };
          setNotices((prev) => prev.filter((n) => n.id !== row.id));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 지금 보고 있는 부서에서 볼 수 있는 공지만, 최신순으로.
  const visibleNotices = useMemo(
    () =>
      notices
        .filter((n) => !n.archived_at)
        .filter((n) => n.scope === "전체" || n.department === activeDepartmentName)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [notices, activeDepartmentName]
  );

  const current = visibleNotices[0] ?? null;
  const isCollapsed = current ? collapsed.has(current.id) : false;

  async function toggleCollapse() {
    if (!current) return;
    const next = !isCollapsed;
    setCollapsed((prev) => {
      const set = new Set(prev);
      if (next) set.add(current.id);
      else set.delete(current.id);
      return set;
    });
    const supabase = createClient();
    if (next) {
      await supabase.from("work_notice_collapses").upsert({ notice_id: current.id, user_email: userEmail });
    } else {
      await supabase.from("work_notice_collapses").delete().eq("notice_id", current.id).eq("user_email", userEmail);
    }
  }

  async function submitNotice() {
    if (!title.trim()) {
      notify("공지 제목을 입력해주세요.", "error");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("work_notices")
      .insert({
        scope,
        department: scope === "부서" ? activeDepartmentName : null,
        title: title.trim(),
        body: body.trim() || null,
        author_email: userEmail,
      })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      notify("공지를 올리지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setNotices((prev) => (prev.some((n) => n.id === (data as WorkNotice).id) ? prev : [data as WorkNotice, ...prev]));
    setTitle("");
    setBody("");
    setScope("전체");
    setShowForm(false);
    notify("공지를 올렸습니다.", "success");
  }

  async function archiveNotice(id: string) {
    if (!window.confirm("이 공지를 내릴까요? 히스토리에서도 숨겨집니다.")) return;
    const supabase = createClient();
    const archivedAt = new Date().toISOString();
    setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, archived_at: archivedAt } : n)));
    const { error } = await supabase.from("work_notices").update({ archived_at: archivedAt }).eq("id", id);
    if (error) {
      setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, archived_at: null } : n)));
      notify("공지를 내리지 못했습니다: " + error.message, "error");
    }
  }

  return (
    <>
      {/* 공지 줄 - 공지가 없어도 관리자·행정직원에게는 올리기/히스토리 버튼이 보여야 하므로
          한 줄은 항상 그려둡니다(일반 사용자는 공지가 없으면 아무것도 안 보입니다). */}
      {(current || canManage) && (
        <div className="glass-panel flex shrink-0 items-start gap-2 border-b border-black/5 px-3 py-1.5">
          {current ? (
            <button
              type="button"
              onClick={toggleCollapse}
              title={isCollapsed ? "공지 펼치기" : "공지 접기"}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-black/5"
            >
              <span className="shrink-0 pt-0.5 text-sm">📢</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {current.scope === "부서" && (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500">
                      {current.department}
                    </span>
                  )}
                  <span className="truncate text-xs font-bold text-slate-800">{current.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {nameFor(team, current.author_email)} · {formatWhen(current.created_at)}
                  </span>
                </span>
                {!isCollapsed && current.body && (
                  <span className="mt-1 block whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">{current.body}</span>
                )}
              </span>
              <span className="shrink-0 pt-0.5 text-[10px] text-slate-400">{isCollapsed ? "▼" : "▲"}</span>
            </button>
          ) : (
            <span className="flex-1 px-1 py-0.5 text-[11px] text-slate-400">올라온 공지가 없습니다.</span>
          )}

          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  title="공지 올리기"
                  className="rounded-full bg-black/5 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-black/10"
                >
                  ✏️ 공지
                </button>
                {current && (
                  <button
                    type="button"
                    onClick={() => archiveNotice(current.id)}
                    title="이 공지 내리기"
                    className="rounded-full bg-black/5 px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-black/10"
                  >
                    내리기
                  </button>
                )}
              </>
            )}
            {/* 요청: "전체공지 히스토리를 상단오른쪽에 히스토리 아이콘을 눌러서 볼 수 있도록" */}
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              title="공지 히스토리"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/5 text-slate-600 transition hover:bg-black/10"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v5h5" />
                <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-bold text-slate-800">📢 공지 올리기</h3>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
              올리는 즉시 상단에 뜹니다. 이미 올라와 있던 공지는 자동으로 내려가고 히스토리에 남습니다.
            </p>
            <div className="mb-2 flex gap-1.5">
              {(["전체", "부서"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition " +
                    (scope === s ? "bg-blue-600 text-white" : "bg-black/5 text-slate-500")
                  }
                >
                  {s === "전체" ? "전체 부서" : `${activeDepartmentName}만`}
                </button>
              ))}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="공지 제목"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="내용 (선택)"
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitNotice}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {saving ? "올리는 중..." : "올리기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowHistory(false)}>
          <div className="flex max-h-[75vh] w-full max-w-lg flex-col rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 shrink-0 text-sm font-bold text-slate-800">🕐 공지 히스토리</h3>
            {visibleNotices.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">지난 공지가 없습니다.</p>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                {visibleNotices.map((n, i) => (
                  <div
                    key={n.id}
                    className={"rounded-xl border p-2.5 " + (i === 0 ? "border-blue-200 bg-blue-50/50" : "border-slate-200")}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {i === 0 && (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">현재</span>
                      )}
                      {n.scope === "부서" && (
                        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500">
                          {n.department}
                        </span>
                      )}
                      <span className="text-xs font-bold text-slate-800">{n.title}</span>
                      <span className="ml-auto text-[10px] text-slate-400">
                        {nameFor(team, n.author_email)} · {formatWhen(n.created_at)}
                      </span>
                    </div>
                    {n.body && <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">{n.body}</p>}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="mt-3 shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
