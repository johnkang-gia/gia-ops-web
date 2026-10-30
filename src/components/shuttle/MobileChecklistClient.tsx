"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddToHomeScreenBanner from "./AddToHomeScreenBanner";
import { pollDelay } from "@/lib/useSmartPoll";

/**
 * 모바일 하원 체크표 — 현장에서 휴대폰으로 픽업·결석을 누르고 하원 메모를 남깁니다.
 *
 * 명단은 서버(/api/shuttle/checklist-mobile)가 PC 체크표와 같은 함수로 만들어 보냅니다. 이 화면은
 * 그리기와 누르기만 합니다 - 판단을 여기서 다시 하면 PC와 다른 명단이 됩니다.
 */

// 하원 시간에는 5초마다, 그 밖에는 2분마다 묻습니다. 명단은 번호가 바뀌었을 때만 실려 옵니다.
const POLL_MS = 5000;
const IDLE_POLL_MS = 2 * 60_000;
const NAME_KEY = "gia-mobile-checklist-name";

type Student = {
  assignmentId: string;
  studentId: string | null;
  name: string;
  rawName: string;
  status: "예정" | "탑승" | "미탑승" | "결석" | "픽업";
  riding: boolean;
  baseRiding: boolean;
  moved: string | null;
  note: string | null;
  individual: boolean;
  plan: string | null;
  auto: { kind: string; source: string; by: string | null; text: string } | null;
};
type Route = {
  id: string;
  routeNo: string;
  name: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleNo: string | null;
  students: Student[];
};
type Memo = {
  id: string;
  content: string;
  author: string | null;
  source: string;
  created_at: string;
  checked_at: string | null;
  checked_by: string | null;
};
type Payload = {
  label?: string;
  term?: string;
  today?: string;
  revision?: number;
  routes?: Route[];
  rideAlongs?: { id: string; name: string; host: string | null; routeNo: string | null; status: string }[];
  memos?: Memo[];
  memoError?: string | null;
  loadErrors?: string[];
  unchanged?: boolean;
  error?: string;
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
const tail4 = (v: string | null) => (v ? v.replace(/\s+/g, "").slice(-4) : null);

export default function MobileChecklistClient({ token }: { token: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [rideAlongs, setRideAlongs] = useState<NonNullable<Payload["rideAlongs"]>>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [memoError, setMemoError] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ label: string; term: string; today: string } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [me, setMe] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [memoText, setMemoText] = useState("");
  const [sending, setSending] = useState(false);
  const [hideAsk, setHideAsk] = useState<string | null>(null);
  const [openRoutes, setOpenRoutes] = useState<Set<string>>(new Set());
  const revRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(NAME_KEY) ?? "";
      setMe(v);
      if (!v) setEditingName(true);
    } catch {
      setEditingName(true);
    }
  }, []);

  const say = (text: string, tone: "ok" | "err" = "ok") => {
    setNotice({ text, tone });
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), tone === "err" ? 6000 : 2500);
  };

  const fetchNow = useCallback(
    async (force = false) => {
      const since = !force && revRef.current !== null ? `?since=${revRef.current}` : "";
      const res = await fetch(`/api/shuttle/checklist-mobile/${token}${since}`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as Payload;
      if (!res.ok) {
        // 링크가 닫혔거나 틀렸습니다. 조용히 빈 화면을 두면 「오늘 탈 아이 없음」으로 읽힙니다.
        setFatal(j.error ?? "명단을 불러오지 못했습니다.");
        return;
      }
      setFatal(null);
      setMemos(j.memos ?? []);
      setMemoError(j.memoError ?? null);
      if (typeof j.revision === "number") revRef.current = j.revision;
      if (j.unchanged) return;
      setRoutes(j.routes ?? []);
      setLoadErrors(j.loadErrors ?? []);
      setRideAlongs(j.rideAlongs ?? []);
      if (j.label && j.term && j.today) setMeta({ label: j.label, term: j.term, today: j.today });
      setLoaded(true);
    },
    [token],
  );

  useEffect(() => {
    let timer: number | undefined;
    let alive = true;
    const loop = async () => {
      try {
        await fetchNow();
      } catch {
        if (alive) say("연결이 불안정합니다. 잠시 뒤 다시 불러옵니다.", "err");
      }
      if (alive) timer = window.setTimeout(loop, pollDelay(POLL_MS, IDLE_POLL_MS, 14, 19));
    };
    void loop();
    const onShow = () => {
      if (document.visibilityState === "visible") void fetchNow(true);
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [fetchNow]);

  function saveName(v: string) {
    const n = v.replace(/\s+/g, " ").trim().slice(0, 20);
    setMe(n);
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* 저장이 안 되는 브라우저면 이번 접속 동안만 씁니다 */
    }
    setEditingName(false);
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/shuttle/checklist-mobile/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, author: me }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; memo?: Memo };
    if (!res.ok) throw new Error(j.error ?? "저장하지 못했습니다.");
    return j;
  }

  async function setStatus(s: Student, next: Student["status"]) {
    if (!me) {
      setEditingName(true);
      say("누가 눌렀는지 남기도록 이름을 먼저 적어 주세요.", "err");
      return;
    }
    const target = s.status === next ? "예정" : next;
    setBusy(s.assignmentId);
    // 먼저 화면에 반영하고, 실패하면 되돌리고 이유를 띄웁니다(CLAUDE.md 5).
    const prev = routes;
    setRoutes((rs) =>
      rs.map((r) => ({
        ...r,
        students: r.students.map((x) =>
          x.assignmentId === s.assignmentId ? { ...x, status: target, riding: target === "탑승" ? true : x.baseRiding } : x,
        ),
      })),
    );
    try {
      await post({ action: "status", assignmentId: s.assignmentId, status: target, studentName: s.rawName });
      say(target === "예정" ? `${s.name} — 되돌렸습니다` : `${s.name} — ${target}`);
      await fetchNow(true);
    } catch (e) {
      setRoutes(prev);
      say(`${s.name}: ${(e as Error).message}`, "err");
    } finally {
      setBusy(null);
    }
  }

  async function sendMemo() {
    const content = memoText.trim();
    if (!content) return;
    if (!me) {
      setEditingName(true);
      say("누가 쓴 메모인지 남기도록 이름을 먼저 적어 주세요.", "err");
      return;
    }
    setSending(true);
    try {
      const j = await post({ action: "memo", content });
      if (j.memo) setMemos((m) => [j.memo as Memo, ...m]);
      setMemoText("");
      say("메모를 남겼습니다. 운영앱 하원 체크표에 바로 뜹니다.");
    } catch (e) {
      // 적은 글은 지우지 않습니다 - 다시 보낼 수 있어야 합니다.
      say((e as Error).message, "err");
    } finally {
      setSending(false);
    }
  }

  async function hideMemo(id: string) {
    setHideAsk(null);
    try {
      await post({ action: "memo_hide", id });
      setMemos((m) => m.filter((x) => x.id !== id));
      say("메모를 내렸습니다.");
    } catch (e) {
      say((e as Error).message, "err");
    }
  }

  const query = q.replace(/\s+/g, "").toLowerCase();
  const view = useMemo(
    () =>
      routes
        .map((r) => ({
          ...r,
          students: query ? r.students.filter((s) => s.name.replace(/\s+/g, "").toLowerCase().includes(query)) : r.students,
        }))
        .filter((r) => (query ? r.students.length > 0 : true)),
    [routes, query],
  );
  const counts = useMemo(() => {
    let ride = 0, pickup = 0, absent = 0;
    for (const r of routes)
      for (const s of r.students) {
        if (s.status === "픽업") pickup++;
        else if (s.status === "결석") absent++;
        else if (s.riding) ride++;
      }
    return { ride, pickup, absent };
  }, [routes]);
  const unread = memos.filter((m) => !m.checked_at).length;

  if (fatal) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-lg font-bold text-rose-600">열 수 없습니다</p>
        <p className="mt-2 text-sm text-slate-600">{fatal}</p>
        <p className="mt-4 text-xs text-slate-400">행정실에 새 링크를 받아 주세요.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-24">
      <AddToHomeScreenBanner />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold">📋 하원 체크표</h1>
          <span className="text-[11px] text-slate-500">
            {meta ? `${meta.today} · ${meta.term}` : "불러오는 중…"}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">🚌 탑승 {counts.ride}</span>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">🚗 픽업 {counts.pickup}</span>
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">🚫 결석 {counts.absent}</span>
          <button
            onClick={() => setEditingName(true)}
            className="ml-auto truncate rounded-full border border-slate-300 px-2 py-0.5 text-slate-600"
          >
            👤 {me || "이름 적기"}
          </button>
        </div>
        {editingName && (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              saveName(new FormData(e.currentTarget).get("n") as string);
            }}
          >
            <input
              name="n"
              defaultValue={me}
              placeholder="내 이름 (누가 눌렀는지 남습니다)"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              autoFocus
            />
            <button className="rounded-lg bg-slate-800 px-3 text-sm font-semibold text-white">저장</button>
          </form>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 찾기"
          className="mt-2 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </header>

      {notice && (
        <div
          className={
            "fixed inset-x-3 bottom-4 z-30 rounded-xl px-3 py-2 text-center text-sm font-semibold shadow-lg " +
            (notice.tone === "err" ? "bg-rose-600 text-white" : "bg-slate-900 text-white")
          }
        >
          {notice.text}
        </div>
      )}

      {/* ── 하원 메모 ─────────────────────────────────────────── */}
      <section className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5">
        <p className="text-[12px] font-bold text-amber-800">
          📝 오늘 하원 메모 {unread > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">미확인 {unread}</span>}
        </p>
        <p className="mt-0.5 text-[10px] text-amber-700">여기 남긴 메모는 운영앱 하원 체크표에 바로 뜹니다.</p>
        <textarea
          value={memoText}
          onChange={(e) => setMemoText(e.target.value)}
          rows={2}
          placeholder="예: 7호 10분 지연 / 김OO 우산 두고 감"
          className="mt-1.5 w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm"
        />
        <button
          onClick={sendMemo}
          disabled={sending || !memoText.trim()}
          className="mt-1 w-full rounded-lg bg-amber-500 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {sending ? "남기는 중…" : "메모 남기기"}
        </button>
        {memoError && <p className="mt-1 text-[11px] font-semibold text-rose-600">메모를 읽지 못했습니다: {memoError}</p>}
        {memos.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {memos.map((m) => (
              <li key={m.id} className="rounded-lg bg-white px-2 py-1.5 text-[12px]">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="tabular-nums">{clock(m.created_at)}</span>
                  <b className="text-slate-700">{m.author ?? "이름 없음"}</b>
                  <span>{m.source === "모바일" ? "📱" : "💻"}</span>
                  {m.checked_at ? (
                    <span className="ml-auto text-emerald-600">✓ {m.checked_by ?? "확인"}</span>
                  ) : (
                    <span className="ml-auto text-amber-600">미확인</span>
                  )}
                  {m.source === "모바일" &&
                    (hideAsk === m.id ? (
                      <button onClick={() => hideMemo(m.id)} className="rounded bg-rose-600 px-1.5 text-white">
                        내리기
                      </button>
                    ) : (
                      <button onClick={() => setHideAsk(m.id)} className="text-slate-400">
                        ✕
                      </button>
                    ))}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{m.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rideAlongs.length > 0 && (
        <section className="mx-3 mt-3 rounded-xl border border-violet-200 bg-violet-50 p-2.5 text-[12px]">
          <p className="font-bold text-violet-800">👥 오늘만 같이 타는 아이</p>
          <ul className="mt-1">
            {rideAlongs.map((r) => (
              <li key={r.id}>
                {r.name}
                {r.host ? ` → ${r.host}` : ""} {r.routeNo ? `(${r.routeNo})` : ""}{" "}
                {r.status === "확인대기" && <span className="text-amber-600">확인대기</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {loadErrors.length > 0 && (
        <p className="mx-3 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
          명단 일부를 읽지 못했습니다 — 행정실에 알려 주세요. ({loadErrors.join(" / ")})
        </p>
      )}
      {!loaded && <p className="mt-10 text-center text-sm text-slate-400">명단을 불러오는 중…</p>}
      {loaded && view.length === 0 && (
        <p className="mt-10 text-center text-sm text-slate-400">{query ? "찾는 이름이 없습니다." : "오늘 하원 차량이 없습니다."}</p>
      )}

      {/* 호차로 바로 가기 */}
      {loaded && !query && view.length > 3 && (
        <nav className="mx-3 mt-3 flex gap-1 overflow-x-auto px-0.5 pb-1">
          {view.map((r) => (
            <a
              key={r.id}
              href={`#r-${r.id}`}
              className="shrink-0 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
            >
              {r.routeNo}
            </a>
          ))}
        </nav>
      )}

      {view.map((r) => {
        const riding = r.students.filter((s) => s.riding && s.status !== "픽업" && s.status !== "결석");
        const others = r.students.filter((s) => !(s.riding && s.status !== "픽업" && s.status !== "결석"));
        const showOthers = openRoutes.has(r.id) || !!query;
        const list = [...riding, ...(showOthers ? others : others.filter((s) => s.status === "픽업" || s.status === "결석"))];
        return (
          <section key={r.id} id={`r-${r.id}`} className="mx-3 mt-3 scroll-mt-40 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <b className="text-sm">{r.routeNo}</b>
              <span className="truncate text-[11px] text-slate-500">{r.name ?? ""}</span>
              {tail4(r.vehicleNo) && <span className="rounded bg-slate-200 px-1 text-[11px] font-bold">{tail4(r.vehicleNo)}</span>}
              <span className="ml-auto text-[11px] font-semibold text-emerald-700">{riding.length}명</span>
              {r.driverPhone && (
                <a href={`tel:${r.driverPhone}`} className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
                  📞
                </a>
              )}
            </div>
            <ul>
              {list.map((s) => {
                const off = !s.riding && s.status !== "픽업" && s.status !== "결석";
                return (
                  <li key={s.assignmentId} className={"border-b border-slate-100 px-3 py-2 last:border-0 " + (off ? "bg-slate-50" : "")}>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            "truncate text-[15px] font-semibold " +
                            (s.status === "픽업"
                              ? "text-sky-700 line-through"
                              : s.status === "결석"
                                ? "text-rose-600 line-through"
                                : off
                                  ? "text-slate-400"
                                  : "text-slate-900")
                          }
                        >
                          {s.name}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          {[
                            s.moved ? `↪ ${s.moved}에서 옮김` : null,
                            s.individual ? "개별하원" : null,
                            s.plan ? `🏠 ${s.plan}` : null,
                            s.auto ? `자동·${s.auto.source}` : null,
                            s.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {off ? (
                        <button
                          disabled={busy === s.assignmentId}
                          onClick={() => setStatus(s, "탑승")}
                          className="rounded-lg border border-emerald-300 px-2.5 py-2 text-xs font-bold text-emerald-700"
                        >
                          🚌 탑승
                        </button>
                      ) : (
                        <>
                          {!s.baseRiding && s.status === "탑승" && (
                            <button
                              disabled={busy === s.assignmentId}
                              onClick={() => setStatus(s, "탑승")}
                              className="rounded-lg bg-emerald-600 px-2 py-2 text-xs font-bold text-white"
                            >
                              🚌
                            </button>
                          )}
                          <button
                            disabled={busy === s.assignmentId}
                            onClick={() => setStatus(s, "픽업")}
                            className={
                              "rounded-lg px-2.5 py-2 text-xs font-bold " +
                              (s.status === "픽업" ? "bg-sky-600 text-white" : "border border-sky-300 text-sky-700")
                            }
                          >
                            🚗 픽업
                          </button>
                          <button
                            disabled={busy === s.assignmentId}
                            onClick={() => setStatus(s, "결석")}
                            className={
                              "rounded-lg px-2.5 py-2 text-xs font-bold " +
                              (s.status === "결석" ? "bg-rose-600 text-white" : "border border-rose-300 text-rose-700")
                            }
                          >
                            🚫 결석
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {!query && others.some((s) => s.status !== "픽업" && s.status !== "결석") && (
              <button
                onClick={() =>
                  setOpenRoutes((o) => {
                    const n = new Set(o);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    return n;
                  })
                }
                className="w-full bg-slate-50 py-1.5 text-[11px] font-semibold text-slate-500"
              >
                {showOthers ? "오늘 안 타는 아이 접기" : `오늘 안 타는 아이 ${others.filter((s) => s.status !== "픽업" && s.status !== "결석").length}명 보기`}
              </button>
            )}
          </section>
        );
      })}
      <p className="mt-6 text-center text-[10px] text-slate-400">
        누른 것은 운영앱 하원 체크표·도착체크·안내보드에 함께 반영됩니다. 다시 누르면 되돌아갑니다.
      </p>
    </div>
  );
}
