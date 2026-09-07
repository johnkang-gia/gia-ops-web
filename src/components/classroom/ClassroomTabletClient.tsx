"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 교실 태블릿.
 *
 * 하는 일은 셋뿐입니다. 늘리지 않는 것이 요점입니다 - 화면에 볼 것이 많아지면 정작 호출이
 * 왔을 때 눈에 안 띕니다.
 *
 *   ① 행정실 호출을 받아 크게 띄우고 소리를 냅니다 → [확인]
 *   ② 오늘 출결을 그 자리에서 확정합니다
 *   ③ 그 밖에는 반 이름과 시각만 (배경화면에 가깝게)
 *
 * ── 왜 실시간 구독이 아니라 3초마다 부르는가 ──
 *
 * 이 화면은 로그인이 없어서 DB 실시간 구독의 보안 규칙을 통과하지 못합니다. 통과시키려면
 * 표를 익명에게 열어야 하는데, 학생 이름이 든 표를 그렇게 열 수는 없습니다. 3초 폴링이면
 * 사람이 느끼기에 «바로»입니다.
 *
 * ── 소리 ──
 *
 * 브라우저는 사람이 화면을 한 번 누르기 전에는 소리를 못 냅니다. 그래서 아침에 [오늘 시작]을
 * 한 번 누르게 합니다. 우회가 아니라 이게 정석입니다 - 누르지 않으면 소리가 안 난다는 것을
 * 화면에 적어둡니다. 조용히 안 울리는 것이 가장 나쁩니다.
 */

const POLL_MS = 3000;

type Call = { id: string; kind: string; studentName: string | null; reason: string | null; at: string; by: string | null };
type Student = { id: string; name: string; status: string | null };
type Board = {
  today: string;
  isWeekday: boolean;
  className: string;
  teacher: string | null;
  room: string | null;
  periodLabel: string | null;
  calls: Call[];
  roster: Student[];
};

const MARKS = ["결석", "지각", "조퇴"] as const;

export default function ClassroomTabletClient({ token }: { token: string }) {
  const [data, setData] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // [오늘 시작]을 눌렀는가(소리 허용)
  const [clock, setClock] = useState("");
  const [tab, setTab] = useState<"home" | "attendance">("home");
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const rungRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/classroom/${token}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "화면을 열지 못했습니다.");
        return;
      }
      setErr(null);
      setData(j as Board);
    } catch {
      // 와이파이가 잠깐 끊긴 것일 수 있습니다. 다음 차례에 다시 봅니다 - 여기서 화면을
      // 비우면 교실에 아무것도 안 뜬 채로 남습니다.
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
      setClock(`${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // 새 호출이 오면 소리. 같은 호출로 두 번 울리지 않게 울린 것을 기억합니다.
  useEffect(() => {
    if (!ready || !data) return;
    for (const c of data.calls) {
      if (rungRef.current.has(c.id)) continue;
      rungRef.current.add(c.id);
      beep(audioRef);
    }
  }, [data, ready]);

  async function ack(id: string) {
    setBusy(true);
    await fetch(`/api/classroom/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ackCallId: id }),
    }).catch(() => null);
    setBusy(false);
    void load();
  }

  async function mark(studentId: string, status: string | null) {
    // 화면을 먼저 바꿉니다 - 태블릿에서 한 박자 늦게 반응하면 두 번 누릅니다.
    setData((prev) =>
      prev ? { ...prev, roster: prev.roster.map((s) => (s.id === studentId ? { ...s, status } : s)) } : prev
    );
    const res = await fetch(`/api/classroom/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendance: [{ studentId, status: status ?? "출석" }] }),
    }).catch(() => null);
    if (!res || !res.ok) {
      // 저장이 안 됐으면 화면도 되돌립니다. 화면만 바뀐 채로 두면 «찍었는데 안 남았다»가 됩니다.
      setErr("저장하지 못했습니다. 와이파이를 확인해주세요.");
      void load();
      return;
    }
    setErr(null);
  }

  if (err && !data) {
    return (
      <main style={S.center}>
        <p style={{ fontSize: 22, color: "#fca5a5" }}>{err}</p>
        <p style={{ fontSize: 14, color: "#64748b" }}>행정실에 알려주세요.</p>
      </main>
    );
  }
  if (!data) return <main style={S.center}><p style={{ color: "#64748b" }}>불러오는 중…</p></main>;

  const call = data.calls[0] ?? null;

  return (
    <main style={S.page}>
      {/* ── 호출 ─────────────────────────────────────────────────────────── */}
      {call && (
        <div style={{ ...S.callBox, background: call.kind === "픽업" ? "#7f1d1d" : "#0c4a6e" }}>
          <p style={S.callKind}>{call.kind === "픽업" ? "🔔 픽업" : call.kind === "하원" ? "🚌 하원" : "🔔 호출"}</p>
          {call.studentName && <p style={S.callName}>{call.studentName}</p>}
          <p style={S.callReason}>{call.reason || "행정실로 보내주세요"}</p>
          <button type="button" disabled={busy} onClick={() => ack(call.id)} style={S.ackBtn}>
            확인했습니다
          </button>
          {data.calls.length > 1 && <p style={S.more}>확인할 호출이 {data.calls.length}건 더 있습니다</p>}
        </div>
      )}

      {/* ── 평소 화면 ────────────────────────────────────────────────────── */}
      {!call && (
        <>
          <header style={S.head}>
            <div>
              <p style={S.cls}>{data.className}</p>
              <p style={S.sub}>
                {[data.teacher, data.room, data.periodLabel].filter(Boolean).join(" · ") || " "}
              </p>
            </div>
            <p style={S.clock}>{clock}</p>
          </header>

          {!ready && (
            /* 소리를 낼 수 있게 하려면 사람이 한 번 눌러야 합니다. 안 누르면 조용히 안
               울리는데, 그게 가장 나쁜 상태라 화면에 크게 적어둡니다. */
            <button type="button" onClick={() => { setReady(true); beep(audioRef); }} style={S.startBtn}>
              🔔 오늘 시작 — 눌러야 호출 소리가 납니다
            </button>
          )}

          <div style={S.tabs}>
            <button type="button" onClick={() => setTab("home")} style={tab === "home" ? S.tabOn : S.tab}>
              대기
            </button>
            <button type="button" onClick={() => setTab("attendance")} style={tab === "attendance" ? S.tabOn : S.tab}>
              오늘 출결
            </button>
          </div>

          {tab === "attendance" ? (
            <div style={S.roster}>
              {data.roster.length === 0 ? (
                <p style={{ color: "#64748b" }}>이 반 학생 명단을 찾지 못했습니다.</p>
              ) : (
                data.roster.map((s) => (
                  <div key={s.id} style={S.row}>
                    <b style={S.rowName}>{s.name}</b>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => mark(s.id, null)}
                        style={!s.status ? S.pillOn : S.pill}
                      >
                        출석
                      </button>
                      {MARKS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => mark(s.id, m)}
                          style={s.status === m ? { ...S.pillOn, background: "#b45309" } : S.pill}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <p style={S.note}>
                안 온 아이만 눌러주세요. 나머지는 출석입니다. 누르는 즉시 저장되고 행정실 화면에 바로 뜹니다.
              </p>
            </div>
          ) : (
            <div style={S.idle}>
              <p style={{ fontSize: 22, color: "#475569" }}>호출이 오면 이 화면이 바뀝니다.</p>
              {err && <p style={{ fontSize: 15, color: "#fca5a5", marginTop: 12 }}>{err}</p>}
            </div>
          )}
        </>
      )}
    </main>
  );
}

/** 짧은 알림음. 파일을 받아오지 않아 와이파이가 느려도 늦지 않습니다. */
function beep(ref: React.MutableRefObject<AudioContext | null>) {
  try {
    type Ctor = new () => AudioContext;
    const W = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const Ctx = W.AudioContext ?? W.webkitAudioContext;
    if (!Ctx) return;
    if (!ref.current) ref.current = new Ctx();
    const ctx = ref.current;
    void ctx.resume();
    [0, 0.35, 0.7].forEach((delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + 0.3);
    });
  } catch {
    // 소리를 못 내도 화면은 이미 바뀌어 있습니다.
  }
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", background: "#0b1220", color: "#e2e8f0", padding: 20, display: "flex", flexDirection: "column", gap: 16 },
  center: { minHeight: "100dvh", background: "#0b1220", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 },
  head: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  cls: { margin: 0, fontSize: 34, fontWeight: 900, color: "#fff" },
  sub: { margin: 0, fontSize: 15, color: "#64748b" },
  clock: { margin: 0, fontSize: 34, fontWeight: 800, color: "#94a3b8", fontVariantNumeric: "tabular-nums" },
  callBox: { flex: 1, borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, animation: "none" },
  callKind: { margin: 0, fontSize: 28, fontWeight: 800, color: "#fde68a" },
  callName: { margin: 0, fontSize: 76, fontWeight: 900, color: "#fff", lineHeight: 1.1, textAlign: "center" },
  callReason: { margin: 0, fontSize: 26, color: "#e0f2fe", textAlign: "center" },
  ackBtn: { marginTop: 14, borderRadius: 999, border: "none", background: "#fff", color: "#0f172a", fontSize: 26, fontWeight: 900, padding: "18px 52px", cursor: "pointer" },
  more: { margin: 0, fontSize: 15, color: "#fca5a5" },
  startBtn: { borderRadius: 14, border: "2px solid #f59e0b", background: "#422006", color: "#fde68a", fontSize: 19, fontWeight: 800, padding: "16px 18px", cursor: "pointer" },
  tabs: { display: "flex", gap: 8 },
  tab: { flex: 1, borderRadius: 12, border: "1px solid #1e293b", background: "#0f172a", color: "#64748b", fontSize: 19, fontWeight: 700, padding: "14px 0", cursor: "pointer" },
  tabOn: { flex: 1, borderRadius: 12, border: "1px solid #38bdf8", background: "#0c4a6e", color: "#fff", fontSize: 19, fontWeight: 800, padding: "14px 0", cursor: "pointer" },
  roster: { flex: 1, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#111c33", borderRadius: 12, padding: "10px 14px" },
  rowName: { fontSize: 24, color: "#fff" },
  pill: { borderRadius: 999, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontSize: 17, fontWeight: 700, padding: "10px 18px", cursor: "pointer" },
  pillOn: { borderRadius: 999, border: "none", background: "#166534", color: "#fff", fontSize: 17, fontWeight: 800, padding: "10px 18px", cursor: "pointer" },
  note: { fontSize: 14, color: "#64748b", marginTop: 6 },
  idle: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
};
