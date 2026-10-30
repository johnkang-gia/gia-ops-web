"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { shareUrl } from "@/lib/appUrl";

type Memo = {
  id: string;
  content: string;
  author: string | null;
  source: string;
  created_at: string;
  checked_at: string | null;
  checked_by: string | null;
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

/**
 * **오늘 하원 메모** — 모바일 하원 체크표에서 현장이 남긴 메모를 PC 체크표 위에 띄웁니다.
 *
 * 현장에서 알게 된 것이 전화로만 오면 체크표를 보는 사람은 모릅니다. 안 읽은 메모는 위에 노랗게
 * 남겨 두고, [확인]을 누른 사람·때를 남깁니다 - 누가 읽었는지 모르면 두 사람이 같은 일을 처리하거나
 * 아무도 안 합니다. 들어오는 즉시 뜨도록 실시간으로 듣습니다.
 */
export default function ChecklistMemoPanel({
  term,
  today,
  actorName,
  mobileToken,
}: {
  term: string;
  today: string;
  actorName: string;
  /** 이 학기의 켜진 도착체크 링크 열쇠. 모바일 체크표가 같은 열쇠로 열립니다. 없으면 null. */
  mobileToken: string | null;
}) {
  const notify = useToast();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("shuttle_day_memos")
      .select("id, content, author, source, created_at, checked_at, checked_by")
      .eq("service_date", today)
      .eq("term", term)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    // 표가 아직 없으면(마이그레이션 적용 전) 그 사실을 적습니다. 「메모 없음」과 구별되어야 합니다.
    setLoadError(error ? error.message : null);
    if (!error) setMemos((data as Memo[] | null) ?? []);
  }, [today, term]);

  useEffect(() => {
    void load();
    const supabase = createClient();
    // 조건을 걸지 않고 듣습니다. 화면에 없는 줄이 새로 생기는 것은 조건에 안 걸립니다(CLAUDE.md 2-11).
    const ch = supabase
      .channel(`shuttle-day-memos-${term}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shuttle_day_memos" }, () => void load())
      .subscribe();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [load, term]);

  async function add() {
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    const { error } = await createClient()
      .from("shuttle_day_memos")
      .insert({ service_date: today, term, content, author: actorName, source: "체크표" });
    setBusy(false);
    if (error) {
      notify("메모를 저장하지 못했습니다: " + error.message, "error");
      return;
    }
    setText("");
    void load();
  }

  async function check(m: Memo) {
    const undo = !!m.checked_at;
    const { error } = await createClient()
      .from("shuttle_day_memos")
      .update(undo ? { checked_at: null, checked_by: null } : { checked_at: new Date().toISOString(), checked_by: actorName })
      .eq("id", m.id);
    if (error) notify("확인 표시를 남기지 못했습니다: " + error.message, "error");
    else void load();
  }

  async function hide(m: Memo) {
    const { error } = await createClient()
      .from("shuttle_day_memos")
      .update({ hidden_at: new Date().toISOString(), hidden_by: actorName })
      .eq("id", m.id);
    if (error) notify("메모를 내리지 못했습니다: " + error.message, "error");
    else void load();
  }

  const unread = memos.filter((m) => !m.checked_at).length;
  const mobileUrl = mobileToken ? shareUrl(`/shuttle-checklist/${mobileToken}`) : null;

  return (
    <section className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-amber-900">📝 오늘 하원 메모</p>
        {unread > 0 && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">미확인 {unread}</span>}
        <span className="text-[11px] text-amber-700">모바일 하원 체크표에서 현장이 남긴 메모가 여기 바로 뜹니다.</span>
        {mobileUrl && (
          <span className="ml-auto flex items-center gap-1">
            <a href={mobileUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700">
              📱 모바일 체크표 열기
            </a>
            <button
              onClick={() =>
                navigator.clipboard.writeText(mobileUrl).then(
                  () => notify("모바일 체크표 링크를 복사했습니다.", "success"),
                  () => notify(mobileUrl, "info"),
                )
              }
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
            >
              🔗 링크 복사
            </button>
          </span>
        )}
      </div>
      {!mobileUrl && (
        <p className="mt-1 text-[11px] text-slate-500">
          모바일 체크표는 셔틀 › 링크·기기의 도착체크 링크로 열립니다. 이 학기의 켜진 도착체크 링크가 아직 없습니다.
        </p>
      )}
      {loadError && <p className="mt-1 text-[11px] font-semibold text-rose-600">메모를 읽지 못했습니다: {loadError}</p>}
      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void add();
          }}
          placeholder="여기서도 메모를 남길 수 있습니다 (모바일에도 보입니다)"
          className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm"
        />
        <button onClick={add} disabled={busy || !text.trim()} className="rounded-lg bg-amber-500 px-3 text-sm font-semibold text-white disabled:opacity-40">
          남기기
        </button>
      </div>
      {memos.length > 0 && (
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {memos.map((m) => (
            <li key={m.id} className={"rounded-lg border px-2.5 py-1.5 text-sm " + (m.checked_at ? "border-slate-200 bg-white" : "border-amber-300 bg-amber-100/70")}>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="tabular-nums">{clock(m.created_at)}</span>
                <b className="text-slate-700">{m.author ?? "이름 없음"}</b>
                <span>{m.source === "모바일" ? "📱 모바일" : "💻 체크표"}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => check(m)}
                    className={
                      "rounded px-1.5 py-0.5 text-[11px] font-semibold " +
                      (m.checked_at ? "text-emerald-700 hover:bg-emerald-50" : "bg-emerald-600 text-white")
                    }
                    title={m.checked_at ? "다시 누르면 확인을 풉니다" : "읽고 처리했으면 누르세요"}
                  >
                    {m.checked_at ? `✓ ${m.checked_by ?? "확인"} ${clock(m.checked_at)}` : "확인"}
                  </button>
                  <button onClick={() => hide(m)} className="rounded px-1 text-slate-400 hover:text-rose-500" title="화면에서 내립니다(기록은 남습니다)">
                    ✕
                  </button>
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{m.content}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
