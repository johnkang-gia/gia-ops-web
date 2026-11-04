"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { createTaskFromInbox } from "@/lib/taskFromInbox";
import { todayKst } from "@/lib/kst";
import { loadStudents } from "@/lib/students";

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

/**
 * 갈래. 한 건을 여러 갈래로 동시에 보낼 수 있습니다(문의로도 남기고 업무로도 걸기). 하나도 안 고르면 «빼기»입니다.
 *   전달사항 = 오늘·며칠만 챙길 일(약·준비물·아픔) → 학생 하루 메모(student_day_notes)
 *   특이사항 = 그 아이에 대해 계속 기억할 사실(알레르기·성향·교우관계) → 학생 창 특이사항(student_profile_notes)
 */
type Dest = "문의" | "전달사항" | "특이사항" | "업무" | "쪽지";
const DESTS: Dest[] = ["문의", "전달사항", "특이사항", "업무", "쪽지"];
const DEST_LABEL: Record<Dest, string> = {
  문의: "📨 문의사항",
  전달사항: "📋 전달사항",
  특이사항: "📝 학생 특이사항",
  업무: "✅ 업무",
  쪽지: "🗒️ 쪽지(오늘)",
};
/** 학생마다 한 줄씩 들어가는 갈래. 업무·쪽지는 한 건에 한 장이고 제목에 아이 이름을 모두 적습니다. */
const PER_STUDENT: Dest[] = ["문의", "전달사항", "특이사항"];
type Cand = { id: string; name: string; class_name: string | null };
type ApiItem = {
  text: string;
  title: string;
  dest: "문의" | "업무" | "쪽지" | "특이사항";
  studentText?: string | null;
  original?: string | null;
  studentId?: string | null;
  candidates?: Cand[];
};
type Item = {
  text: string;
  title: string;
  dests: Dest[];
  /** 이 건에 태그된 아이들. 여럿이면 문의·전달사항·특이사항은 아이마다 따로 들어갑니다. */
  students: Cand[];
  studentText?: string | null;
  original?: string | null;
  /** 동명이인이라 서버가 못 좁힌 후보. */
  candidates?: Cand[];
  /** 이미 들어간 것(갈래|학생). 일부만 실패했을 때 다시 눌러도 들어간 것은 두 번 넣지 않습니다. */
  done?: string[];
  state?: "ok" | "fail";
  error?: string;
};

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
      const named = uniqueNamesIn(body, await rosterCands());
      setItems(
        (json.items as ApiItem[]).map((r) => {
          const students: Cand[] = [];
          const tagged = r.studentId ? r.candidates?.find((c) => c.id === r.studentId) : null;
          if (tagged) students.push(tagged);
          // 서버는 한 건에 한 아이만 붙입니다. 같은 건 글에 다른 아이 이름도 있으면(명부에 한 명뿐인 이름만) 함께 태그합니다.
          const src = `${r.original ?? ""}\n${r.text}`;
          for (const c of named) if (src.includes(c.name) && !students.some((x) => x.id === c.id)) students.push(c);
          return { text: r.text, title: r.title, dests: [r.dest], students, studentText: r.studentText, original: r.original, candidates: r.candidates };
        }),
      );
      setSplitNote((json.note as string | undefined) ?? null);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSplitting(false);
    }
  }

  const names = (it: Item) => it.students.map((x) => x.name).join("·");

  async function post(body: Record<string, unknown>, url = "/api/pickup") {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  }

  /** 한 갈래·한 아이 몫을 넣습니다. 실패하면 이유를 돌려줍니다. */
  async function sendPart(it: Item, d: Dest, who: Cand | null): Promise<string | null> {
    if (d === "문의") {
      const r = await post({ action: "manual", text: it.text, source: "전화", senderName: currentUserName ?? email });
      if (!r.ok) return String(r.json?.error ?? `접수 실패(${r.status})`);
      // 사람이 미리보기에서 본 아이가 접수 규칙의 판단보다 이깁니다.
      if (who) {
        const ids = ((r.json?.results ?? []) as { id?: string }[]).map((x) => x.id).filter(Boolean) as string[];
        for (const id of ids) {
          const lr = await post({ action: "link", id, studentId: who.id });
          if (!lr.ok) return "접수는 됐지만 학생을 잇지 못했습니다: " + String(lr.json?.error ?? lr.status);
        }
      }
      return null;
    }
    if (d === "전달사항") {
      if (!who) return "학생을 골라야 등록됩니다.";
      const r = await post({ studentId: who.id, content: it.text.slice(0, 300), kind: "기타", onDate: todayKst() }, "/api/student-notes");
      return r.ok ? null : String(r.json?.error ?? `저장 실패(${r.status})`);
    }
    if (d === "특이사항") {
      if (!who) return "학생을 골라야 등록됩니다.";
      const r = await post({ action: "profile-note", studentId: who.id, text: it.text });
      return r.ok ? null : String(r.json?.error ?? `저장 실패(${r.status})`);
    }
    const tag = it.students.length ? `[${names(it)}] ` : "";
    if (d === "업무") {
      const { error } = await createTaskFromInbox({
        title: tag + (it.title || it.text.slice(0, 50)),
        description: `메모장에서 등록 · ${currentUserName ?? email}\n\n${it.text}`,
        department,
        userEmail: email,
      });
      return error;
    }
    const { error } = await createClient().from("board_notes").insert({
      department,
      content: tag + it.text,
      color: "yellow",
      expires_on: todayKst(),
      author_email: email,
      author_name: currentUserName ?? null,
    });
    return error ? error.message : null;
  }

  /** 한 건을 고른 갈래 전부로 보냅니다. 문의·전달사항·특이사항은 태그된 아이마다 한 줄씩. */
  async function sendOne(it: Item): Promise<Item> {
    const done = new Set(it.done ?? []);
    const errors: string[] = [];
    for (const d of it.dests) {
      const targets: (Cand | null)[] = PER_STUDENT.includes(d) && it.students.length ? it.students : [null];
      for (const who of targets) {
        const key = `${d}|${who?.id ?? ""}`;
        if (done.has(key)) continue;
        const err = await sendPart(it, d, who);
        if (err) errors.push(`${DEST_LABEL[d]}${who ? `(${who.name})` : ""}: ${err}`);
        else done.add(key);
      }
    }
    return errors.length
      ? { ...it, done: [...done], state: "fail", error: errors.join(" / ") }
      : { ...it, done: [...done], state: "ok", error: undefined };
  }

  async function sendAll() {
    if (!items || sending) return;
    setSending(true);
    const next: Item[] = [];
    for (const it of items) next.push(it.state === "ok" || it.dests.length === 0 ? it : await sendOne(it));
    setItems(next);
    setSending(false);
    const failed = next.filter((x) => x.state === "fail");
    if (failed.length === 0) {
      notify(`${next.filter((x) => x.dests.length > 0).length}건을 등록했습니다.`, "success");
      // 다 보냈으면 메모장을 비웁니다. 남겨 두면 다음에 또 등록해 같은 일이 두 번 생깁니다.
      onChange("");
      setItems(null);
    } else {
      notify(`${failed.length}건을 다 넣지 못했습니다. 이유를 확인하고 다시 눌러 주세요(들어간 것은 다시 넣지 않습니다).`, "error");
    }
  }

  const patchItem = (i: number, f: (x: Item) => Item) => setItems((p) => p && p.map((x, j) => (j === i ? f(x) : x)));

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
        placeholder="전화·요청을 자유롭게 적으세요."
        className="mx-2 mb-1 min-h-0 flex-1 resize-none rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-[12.5px] leading-relaxed text-slate-800 outline-none focus:border-amber-400"
      />
      <NameBadges text={text} />
      {serverError && <p className="shrink-0 px-2.5 pb-1 text-[10px] font-bold text-rose-600">{serverError}</p>}

      {items &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[900] flex items-start justify-center bg-black/40 p-3 sm:p-8" onClick={() => setItems(null)}>
            <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2.5">
                <h2 className="text-sm font-bold text-slate-800">📝 메모 등록 미리보기</h2>
                <span className="text-[11px] text-slate-400">{items.length}건 · 맞춤법·문체를 다듬었습니다. 갈래와 글을 확인한 뒤 등록하세요</span>
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
                      {DESTS.map((d) => {
                        const on = it.dests.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            disabled={it.state === "ok"}
                            onClick={() => patchItem(i, (x) => ({ ...x, dests: on ? x.dests.filter((v) => v !== d) : [...x.dests, d] }))}
                            className={
                              "rounded-full border px-2 py-0.5 text-[11px] font-bold " +
                              (on ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")
                            }
                            title="여러 개를 함께 고를 수 있습니다"
                          >
                            {on ? "✓ " : ""}
                            {DEST_LABEL[d]}
                          </button>
                        );
                      })}
                      {it.dests.length === 0 && <span className="text-[11px] text-slate-400">(안 보냄)</span>}
                      {it.state !== "ok" && (
                        <button
                          type="button"
                          onClick={() => setItems((p) => p && [...p.slice(0, i + 1), { ...it, done: [], state: undefined, error: undefined }, ...p.slice(i + 1)])}
                          className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
                          title="이 건을 하나 더 만듭니다 - 한 메모를 업무 여러 개로 나눌 때 씁니다"
                        >
                          ＋ 한 건 더
                        </button>
                      )}
                      {it.state === "ok" && <span className="ml-auto text-[11px] font-bold text-emerald-700">등록됨</span>}
                    </div>
                    <StudentTags
                      item={it}
                      disabled={it.state === "ok"}
                      onChange={(students) => patchItem(i, (x) => ({ ...x, students }))}
                    />
                    {it.students.length > 1 && it.dests.some((d) => PER_STUDENT.includes(d)) && (
                      <p className="mb-1 text-[10px] text-slate-400">
                        {it.dests.filter((d) => PER_STUDENT.includes(d)).map((d) => DEST_LABEL[d]).join("·")}은(는) {it.students.length}명 각각에게 따로 들어갑니다.
                      </p>
                    )}
                    {it.dests.includes("업무") && (
                      <input
                        value={it.title}
                        disabled={it.state === "ok"}
                        onChange={(e) => patchItem(i, (x) => ({ ...x, title: e.target.value }))}
                        className="mb-1 w-full rounded border border-slate-200 px-2 py-1 text-[12px] font-bold"
                        placeholder="업무 제목"
                      />
                    )}
                    <textarea
                      value={it.text}
                      disabled={it.state === "ok"}
                      rows={Math.min(5, Math.max(2, Math.ceil(it.text.length / 50)))}
                      onChange={(e) => setItems((p) => p && p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                      className={"w-full resize-y rounded border border-slate-200 px-2 py-1 text-[12px] " + (it.dests.length === 0 ? "opacity-40" : "")}
                    />
                    {it.original && it.original !== it.text && (
                      <details className="mt-0.5 text-[10.5px] text-slate-400">
                        <summary className="cursor-pointer">✍️ 맞춤법·문체를 다듬었습니다 — 원문 보기</summary>
                        <p className="mt-0.5 whitespace-pre-wrap rounded bg-slate-50 p-1 text-slate-500">{it.original}</p>
                        {it.state !== "ok" && (
                          <button
                            type="button"
                            onClick={() => setItems((p) => p && p.map((x, j) => (j === i ? { ...x, text: x.original ?? x.text } : x)))}
                            className="mt-0.5 text-[10.5px] font-bold text-blue-600"
                          >
                            원문 그대로 쓰기
                          </button>
                        )}
                      </details>
                    )}
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

/** 명부는 한 번만 읽습니다 - 찾기 칸에 글자를 칠 때마다 139명을 다시 받지 않게. */
let rosterOnce: ReturnType<typeof loadStudents> | null = null;
async function rosterCands(): Promise<Cand[]> {
  rosterOnce ??= loadStudents(createClient());
  const { rows } = await rosterOnce;
  return rows.map((s) => ({ id: s.id, name: s.name, class_name: s.class_name }));
}

/**
 * 글에 적힌 아이 이름 중 **명부에 한 명뿐인 이름**만 찾습니다. 같은 이름이 둘 이상이면(김재이 셋) 글자만으로 누구인지
 * 정할 수 없어 태그하지 않습니다 - 사람이 미리보기에서 고릅니다(CLAUDE.md §2-4-1).
 */
function uniqueNamesIn(text: string, roster: Cand[]): Cand[] {
  const count = new Map<string, number>();
  for (const c of roster) count.set(c.name, (count.get(c.name) ?? 0) + 1);
  return roster.filter((c) => c.name.length >= 2 && count.get(c.name) === 1 && text.includes(c.name));
}

/** 메모장 아래, 글에서 찾은 아이 이름을 뱃지로 보여줍니다. 등록하면 이 아이들이 각 건에 태그됩니다. */
function NameBadges({ text }: { text: string }) {
  const [roster, setRoster] = useState<Cand[] | null>(null);
  useEffect(() => {
    let stop = false;
    void rosterCands().then((r) => !stop && setRoster(r));
    return () => {
      stop = true;
    };
  }, []);
  if (!roster || !text.trim()) return null;
  const found = uniqueNamesIn(text, roster);
  const dupNames = [...new Set(roster.filter((c, _, all) => all.filter((x) => x.name === c.name).length > 1 && text.includes(c.name)).map((c) => c.name))];
  if (found.length === 0 && dupNames.length === 0) return null;
  return (
    <div className="mx-2 mb-1 flex shrink-0 flex-wrap items-center gap-1">
      {found.map((c) => (
        <span key={c.id} className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10.5px] font-bold text-indigo-800">
          👤 {c.name}
        </span>
      ))}
      {dupNames.map((n) => (
        <span key={n} className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10.5px] font-bold text-rose-700" title="같은 이름이 여럿이라 등록할 때 골라야 합니다">
          👤 {n} ?
        </span>
      ))}
    </div>
  );
}

/**
 * 한 건의 학생 태그(여러 명). 뱃지의 ×로 빼고, 찾기 칸으로 더합니다. 동명이인이라 서버가 못 좁힌 후보는 «누구?»로
 * 따로 보여 고르게 합니다. 명부 번호로 고르므로 같은 이름이 섞이지 않습니다.
 */
function StudentTags({ item, disabled, onChange }: { item: Item; disabled: boolean; onChange: (s: Cand[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Cand[]>([]);
  useEffect(() => {
    const t = q.trim();
    if (!t) {
      setHits([]);
      return;
    }
    let stop = false;
    void rosterCands().then((rows) => {
      if (stop) return;
      const k = t.toLowerCase();
      setHits(rows.filter((s) => s.name.includes(t) || (s.class_name ?? "").toLowerCase() === k).slice(0, 8));
    });
    return () => {
      stop = true;
    };
  }, [q]);
  const add = (c: Cand) => !item.students.some((x) => x.id === c.id) && onChange([...item.students, c]);
  const pending = item.students.length === 0 ? (item.candidates ?? []).filter((c) => !item.students.some((x) => x.id === c.id)) : [];
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px]">
      <span className="font-bold text-slate-400">학생</span>
      {item.students.length === 0 && pending.length === 0 && <span className="text-slate-400">없음</span>}
      {item.students.map((c) => (
        <span key={c.id} className="flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 font-bold text-indigo-800">
          👤 {c.name}
          {c.class_name ? <span className="font-normal text-indigo-500">({c.class_name})</span> : null}
          {!disabled && (
            <button type="button" onClick={() => onChange(item.students.filter((x) => x.id !== c.id))} className="ml-0.5 text-indigo-400 hover:text-rose-600" title="태그 빼기">
              ×
            </button>
          )}
        </span>
      ))}
      {pending.length > 1 && (
        <span className="flex items-center gap-0.5 rounded bg-rose-50 px-1 text-rose-700">
          {item.studentText ?? ""} 누구?
          {pending.map((c) => (
            <button key={c.id} type="button" disabled={disabled} onClick={() => add(c)} className="rounded border border-rose-200 bg-white px-1 font-bold">
              {c.name}
              {c.class_name ? ` (${c.class_name})` : ""}
            </button>
          ))}
        </span>
      )}
      {!disabled && (
        <span className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="＋ 학생 더하기" className="w-28 rounded border border-slate-200 px-1.5 py-0.5" />
          {hits.length > 0 && (
            <span className="absolute left-0 top-full z-10 mt-0.5 flex w-48 flex-col rounded border bg-white shadow">
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    add(h);
                    setQ("");
                  }}
                  className="px-2 py-1 text-left hover:bg-slate-50"
                >
                  {h.name}
                  {h.class_name ? ` (${h.class_name})` : ""}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
