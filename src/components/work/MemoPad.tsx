"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { createTaskFromInbox } from "@/lib/taskFromInbox";
import { todayKst } from "@/lib/kst";

/**
 * 메모장 — 전화 받으며 적는 칸.
 *
 * 전화 응대를 남길 자리가 없어서 포스트잇·개인 메모장에 적었고, 그 내용은 다른 직원에게도 기록에도 남지
 * 않았습니다. 이 칸은 **늘 열려 있고, 적는 즉시 저장됩니다**:
 *   - 이 브라우저(localStorage)에 바로 → 새로고침·실수로 닫아도 남습니다.
 *   - 1.5초 쉬면 서버(staff_memo_pads)에도 → 다른 컴퓨터에서 열어도 이어 씁니다.
 * 둘 중 더 늦게 고친 쪽을 씁니다. 서버 저장이 실패하면 숨기지 않고 칸 아래에 적습니다(이 컴퓨터에는 남아 있음).
 *
 * 「등록하기」는 AI 가 메모를 한 건씩 나눠 갈래(문의·업무·쪽지)를 제안하고, 사람이 미리보기에서 고친 뒤
 * 보냅니다. 문의는 기존 접수 길(/api/pickup manual)을 타서 학생 판정·픽업 반영·뱃지가 토들 글과 같게 됩니다.
 */

type Dest = "문의" | "업무" | "쪽지" | "빼기";
type Item = { text: string; title: string; dest: Dest; state?: "ok" | "fail"; error?: string };

const LS_KEY = (email: string) => `gia-memo-pad-v1:${email}`;
type Saved = { content: string; at: number };

function readLocal(email: string): Saved | null {
  try {
    const raw = localStorage.getItem(LS_KEY(email));
    if (!raw) return null;
    const p = JSON.parse(raw) as Saved;
    return typeof p.content === "string" ? p : null;
  } catch {
    return null;
  }
}
function writeLocal(email: string, content: string): boolean {
  try {
    localStorage.setItem(LS_KEY(email), JSON.stringify({ content, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

export default function MemoPad({
  currentUserEmail,
  currentUserName,
  department,
}: {
  currentUserEmail: string;
  currentUserName: string | null;
  department: string;
}) {
  const notify = useToast();
  const email = currentUserEmail.toLowerCase();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [splitNote, setSplitNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  // 처음: 이 브라우저 것과 서버 것 중 더 늦게 고친 쪽.
  useEffect(() => {
    let stop = false;
    const local = readLocal(email);
    if (local) {
      setText(local.content);
      latest.current = local.content;
    }
    void createClient()
      .from("staff_memo_pads")
      .select("content, updated_at")
      .eq("user_email", email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (stop) return;
        if (error) setServerError("서버 메모를 읽지 못했습니다: " + error.message);
        const row = data as { content: string; updated_at: string } | null;
        if (row && (!local || new Date(row.updated_at).getTime() > local.at)) {
          setText(row.content);
          latest.current = row.content;
          writeLocal(email, row.content);
        }
        setLoaded(true);
      });
    return () => {
      stop = true;
    };
  }, [email]);

  const saveServer = useCallback(
    async (content: string) => {
      setSaving(true);
      const { error } = await createClient()
        .from("staff_memo_pads")
        .upsert({ user_email: email, content, updated_at: new Date().toISOString() }, { onConflict: "user_email" });
      setSaving(false);
      if (error) setServerError("서버에 저장하지 못했습니다(이 컴퓨터에는 남아 있습니다): " + error.message);
      else {
        setServerError(null);
        setSavedAt(Date.now());
      }
    },
    [email],
  );

  function onChange(v: string) {
    setText(v);
    latest.current = v;
    if (!writeLocal(email, v)) setServerError("이 브라우저에 저장하지 못했습니다(시크릿 창일 수 있습니다).");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveServer(latest.current), 1500);
  }

  // 창을 닫거나 다른 화면으로 갈 때 기다리던 저장을 마저 합니다.
  useEffect(() => {
    const flush = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void saveServer(latest.current);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [saveServer]);

  async function split() {
    const body = text.trim();
    if (!body) return;
    setSplitting(true);
    try {
      const res = await fetch("/api/work/memo-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.items) {
        notify(json?.error ?? "메모를 나누지 못했습니다.", "error");
        return;
      }
      setItems(json.items as Item[]);
      setSplitNote((json.note as string | undefined) ?? null);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSplitting(false);
    }
  }

  async function sendOne(it: Item): Promise<string | null> {
    if (it.dest === "빼기") return null;
    if (it.dest === "문의") {
      const res = await fetch("/api/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual", text: it.text, source: "전화", senderName: currentUserName ?? email }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) return json?.error ?? `접수 실패(${res.status})`;
      return null;
    }
    if (it.dest === "업무") {
      const { error } = await createTaskFromInbox({
        title: it.title || it.text.slice(0, 50),
        description: `메모장에서 등록 · ${currentUserName ?? email}\n\n${it.text}`,
        department,
        userEmail: email,
      });
      return error;
    }
    const { error } = await createClient().from("board_notes").insert({
      department,
      content: it.text,
      color: "yellow",
      expires_on: todayKst(),
      author_email: email,
      author_name: currentUserName ?? null,
    });
    return error ? error.message : null;
  }

  async function sendAll() {
    if (!items || sending) return;
    setSending(true);
    const next: Item[] = [];
    for (const it of items) {
      if (it.state === "ok") {
        next.push(it);
        continue;
      }
      const err = await sendOne(it);
      next.push(err ? { ...it, state: "fail", error: err } : { ...it, state: "ok" });
    }
    setItems(next);
    setSending(false);
    const failed = next.filter((x) => x.state === "fail");
    if (failed.length === 0) {
      const sent = next.filter((x) => x.dest !== "빼기").length;
      notify(`${sent}건을 등록했습니다.`, "success");
      // 다 보냈으면 메모장을 비웁니다. 남겨 두면 다음에 또 등록해 같은 일이 두 번 생깁니다.
      onChange("");
      setItems(null);
    } else {
      notify(`${failed.length}건을 등록하지 못했습니다. 이유를 확인하고 다시 눌러 주세요.`, "error");
    }
  }

  const status = serverError
    ? null
    : saving
      ? "저장 중…"
      : savedAt
        ? `저장됨 ${hhmm(savedAt)}`
        : loaded
          ? "자동 저장"
          : "불러오는 중…";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-2.5 pb-1 pt-1.5">
        <span className="text-[12px] font-bold text-slate-700">📝 메모장</span>
        <span className="text-[10px] text-slate-400">{status}</span>
        <button
          type="button"
          disabled={!text.trim() || splitting}
          onClick={() => void split()}
          className="ml-auto rounded-full bg-blue-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          title="메모를 한 건씩 나눠 오늘의 문의사항·업무·쪽지로 보냅니다"
        >
          {splitting ? "나누는 중…" : "등록하기"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"전화·요청을 자유롭게 적으세요. 적는 대로 저장됩니다.\n예) 3시 김OO 어머님 전화 - 내일 병원 때문에 결석\n2층 프린터 토너 주문"}
        className="mx-2 mb-1 min-h-0 flex-1 resize-none rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-[12.5px] leading-relaxed text-slate-800 outline-none focus:border-amber-400"
      />
      {serverError && <p className="shrink-0 px-2.5 pb-1 text-[10px] font-bold text-rose-600">{serverError}</p>}

      {items &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[900] flex items-start justify-center bg-black/40 p-3 sm:p-8" onClick={() => setItems(null)}>
            <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2.5">
                <h2 className="text-sm font-bold text-slate-800">📝 메모 등록 미리보기</h2>
                <span className="text-[11px] text-slate-400">{items.length}건 · 갈래와 글을 고친 뒤 등록하세요</span>
              </div>
              {splitNote && <p className="shrink-0 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800">{splitNote}</p>}
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {items.map((it, i) => (
                  <li
                    key={i}
                    className={
                      "rounded-xl border p-2 " +
                      (it.state === "ok" ? "border-emerald-300 bg-emerald-50" : it.state === "fail" ? "border-rose-300 bg-rose-50" : "border-slate-200")
                    }
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      {(["문의", "업무", "쪽지", "빼기"] as Dest[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          disabled={it.state === "ok"}
                          onClick={() => setItems((p) => p && p.map((x, j) => (j === i ? { ...x, dest: d } : x)))}
                          className={
                            "rounded-full border px-2 py-0.5 text-[11px] font-bold " +
                            (it.dest === d ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")
                          }
                        >
                          {d === "문의" ? "📨 오늘의 문의사항" : d === "업무" ? "✅ 업무" : d === "쪽지" ? "🗒️ 쪽지(오늘)" : "빼기"}
                        </button>
                      ))}
                      {it.state === "ok" && <span className="ml-auto text-[11px] font-bold text-emerald-700">등록됨</span>}
                    </div>
                    {it.dest === "업무" && (
                      <input
                        value={it.title}
                        disabled={it.state === "ok"}
                        onChange={(e) => setItems((p) => p && p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                        className="mb-1 w-full rounded border border-slate-200 px-2 py-1 text-[12px] font-bold"
                        placeholder="업무 제목"
                      />
                    )}
                    <textarea
                      value={it.text}
                      disabled={it.state === "ok"}
                      rows={Math.min(5, Math.max(2, Math.ceil(it.text.length / 50)))}
                      onChange={(e) => setItems((p) => p && p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                      className={"w-full resize-y rounded border border-slate-200 px-2 py-1 text-[12px] " + (it.dest === "빼기" ? "opacity-40" : "")}
                    />
                    {it.state === "fail" && <p className="mt-0.5 text-[11px] font-bold text-rose-600">{it.error}</p>}
                  </li>
                ))}
              </ul>
              <div className="flex shrink-0 items-center gap-2 border-t border-black/5 px-4 py-2.5">
                <p className="text-[10px] text-slate-400">문의로 보낸 건은 학생 판정·픽업 반영이 토들 글과 같은 규칙으로 됩니다. 다 보내면 메모장은 비워집니다.</p>
                <button type="button" onClick={() => setItems(null)} className="ml-auto rounded-lg border px-3 py-1 text-[12px] font-bold text-slate-600">
                  닫기
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void sendAll()}
                  className="rounded-lg bg-blue-600 px-3 py-1 text-[12px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {sending ? "등록 중…" : "등록"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
