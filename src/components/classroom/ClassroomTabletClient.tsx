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
 *   ③ 특이사항·문의를 행정실로 보내고, **읽었는지**를 봅니다
 *
 * ── 한글/영문 ──
 *
 * 담임 중 여러 분이 한국어를 읽지 않으십니다. 그런데 이 화면은 (dashboard) 밖이라 앱의
 * 언어 설정을 물려받지 못합니다. 그래서 화면 자체에 전환 단추를 두고 그 태블릿에 기억시킵니다 -
 * 반마다 기기가 다르니 오히려 이쪽이 맞습니다(한국인 담임 반은 한글, 외국인 담임 반은 영문).
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
const LANG_KEY = "classroomLang";

type Call = { id: string; kind: string; studentName: string | null; reason: string | null; at: string; by: string | null };
type Student = { id: string; name: string; status: string | null };
type Note = {
  id: string;
  kind: string;
  studentName: string | null;
  body: string;
  urgency: string;
  at: string;
  readAt: string | null;
  reply: string | null;
  repliedAt: string | null;
  doneAt: string | null;
};
type Board = {
  today: string;
  isWeekday: boolean;
  className: string;
  teacher: string | null;
  room: string | null;
  periodLabel: string | null;
  calls: Call[];
  roster: Student[];
  notes: Note[];
};

type Lang = "ko" | "en";

/** 출결 표시. 값은 한국어로 저장하고(표가 그렇게 되어 있습니다) 화면에만 번역합니다. */
const MARKS: { value: string; ko: string; en: string }[] = [
  { value: "결석", ko: "결석", en: "Absent" },
  { value: "지각", ko: "지각", en: "Late" },
  { value: "조퇴", ko: "조퇴", en: "Left early" },
];

/**
 * 자주 쓰는 문장. 태블릿에서 길게 치는 것은 그 자체로 «나중에 하자»가 됩니다.
 * 눌러서 넣고 필요하면 뒤에 덧붙입니다.
 *
 * **보내는 글은 늘 한국어입니다.** 받는 쪽이 행정실이라, 영문 화면에서 눌러도 한국어가
 * 갑니다 - 여기서 영어로 보내면 행정실이 다시 번역해야 하고 그만큼 늦어집니다.
 */
const QUICK_NOTE = [
  { send: "다쳤습니다", en: "Injured" },
  { send: "열이 납니다", en: "Has a fever" },
  { send: "토했습니다", en: "Vomited" },
  { send: "친구와 다툼", en: "Conflict with a friend" },
  { send: "많이 웁니다", en: "Crying a lot" },
  { send: "화장실 사고", en: "Bathroom accident" },
];
const QUICK_ASK = [
  { send: "오늘 이 아이 하원 어떻게 하나요?", en: "How does this student go home today?" },
  { send: "학부모 연락 부탁드립니다", en: "Please contact the parent" },
  { send: "물품이 필요합니다", en: "Need supplies" },
  { send: "확인 부탁드립니다", en: "Please check" },
];

export default function ClassroomTabletClient({ token }: { token: string }) {
  const [data, setData] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // [오늘 시작]을 눌렀는가(소리 허용)
  const [clock, setClock] = useState("");
  const [lang, setLang] = useState<Lang>("ko");
  const [tab, setTab] = useState<"home" | "attendance" | "note">("home");
  const [noteKind, setNoteKind] = useState<"특이사항" | "문의">("특이사항");
  const [noteWho, setNoteWho] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const rungRef = useRef<Set<string>>(new Set());

  const t = useCallback((ko: string, en: string) => (lang === "ko" ? ko : en), [lang]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "ko") setLang(saved);
    } catch {
      // 저장소가 막힌 기기 - 한국어로 시작할 뿐 동작에는 지장 없습니다.
    }
  }, []);

  function switchLang(next: Lang) {
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* 기억하지 못해도 이번 화면에서는 바뀝니다 */
    }
  }

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
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
      setClock(`${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(timer);
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

  async function sendNote() {
    const text = noteBody.trim();
    if (!text) return;
    setBusy(true);
    const res = await fetch(`/api/classroom/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note: { kind: noteKind, studentName: noteWho.trim() || null, body: text, urgency: urgent ? "급함" : "보통" },
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setErr(t("보내지 못했습니다. 와이파이를 확인해주세요.", "Could not send. Please check the Wi-Fi."));
      return;
    }
    setErr(null);
    setNoteBody("");
    setNoteWho("");
    setUrgent(false);
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
      setErr(t("저장하지 못했습니다. 와이파이를 확인해주세요.", "Could not save. Please check the Wi-Fi."));
      void load();
      return;
    }
    setErr(null);
  }

  if (err && !data) {
    return (
      <main style={S.center}>
        <p style={{ fontSize: 22, color: "#fca5a5" }}>{err}</p>
        <p style={{ fontSize: 14, color: "#64748b" }}>{t("행정실에 알려주세요.", "Please tell the office.")}</p>
      </main>
    );
  }
  if (!data) return <main style={S.center}><p style={{ color: "#64748b" }}>…</p></main>;

  const call = data.calls[0] ?? null;
  const unread = data.notes.filter((n) => !n.readAt && !n.doneAt).length;
  const quick = noteKind === "특이사항" ? QUICK_NOTE : QUICK_ASK;

  return (
    <main style={S.page}>
      {/* ── 호출 ─────────────────────────────────────────────────────────── */}
      {call && (
        <div style={{ ...S.callBox, background: call.kind === "픽업" ? "#7f1d1d" : "#0c4a6e" }}>
          <p style={S.callKind}>
            {call.kind === "픽업"
              ? t("🔔 픽업", "🔔 Pick-up")
              : call.kind === "하원"
              ? t("🚌 하원", "🚌 Dismissal")
              : t("🔔 호출", "🔔 Office call")}
          </p>
          {call.studentName && <p style={S.callName}>{call.studentName}</p>}
          <p style={S.callReason}>{call.reason || t("행정실로 보내주세요", "Please send to the office")}</p>
          <button type="button" disabled={busy} onClick={() => ack(call.id)} style={S.ackBtn}>
            {t("확인했습니다", "Got it")}
          </button>
          {data.calls.length > 1 && (
            <p style={S.more}>
              {t(`확인할 호출이 ${data.calls.length - 1}건 더 있습니다`, `${data.calls.length - 1} more to confirm`)}
            </p>
          )}
        </div>
      )}

      {/* ── 평소 화면 ────────────────────────────────────────────────────── */}
      {!call && (
        <>
          <header style={S.head}>
            <div style={{ minWidth: 0 }}>
              <p style={S.cls}>{data.className}</p>
              <p style={S.sub}>{[data.teacher, data.room, data.periodLabel].filter(Boolean).join(" · ") || " "}</p>
            </div>
            <p style={S.clock}>{clock}</p>
            {/* 담임에 따라 반마다 다릅니다. 그 태블릿에 기억시킵니다. */}
            <div style={{ display: "flex", gap: 4 }}>
              {(["ko", "en"] as const).map((l) => (
                <button key={l} type="button" onClick={() => switchLang(l)} style={lang === l ? S.langOn : S.langBtn}>
                  {l === "ko" ? "한" : "EN"}
                </button>
              ))}
            </div>
          </header>

          {!ready && (
            /* 소리를 낼 수 있게 하려면 사람이 한 번 눌러야 합니다. 안 누르면 조용히 안
               울리는데, 그게 가장 나쁜 상태라 화면에 크게 적어둡니다. */
            <button type="button" onClick={() => { setReady(true); beep(audioRef); }} style={S.startBtn}>
              {t("🔔 오늘 시작 — 눌러야 호출 소리가 납니다", "🔔 Start the day — tap once so call sounds work")}
            </button>
          )}

          <div style={S.tabs}>
            <button type="button" onClick={() => setTab("home")} style={tab === "home" ? S.tabOn : S.tab}>
              {t("대기", "Standby")}
            </button>
            <button type="button" onClick={() => setTab("attendance")} style={tab === "attendance" ? S.tabOn : S.tab}>
              {t("오늘 출결", "Attendance")}
            </button>
            <button type="button" onClick={() => setTab("note")} style={tab === "note" ? S.tabOn : S.tab}>
              {t("행정실로 보내기", "Send to office")}
              {/* 아직 안 읽은 것이 있으면 숫자로. 보냈는지 자체를 잊는 것이 가장 흔합니다. */}
              {unread > 0 && <span style={S.badge}>{unread}</span>}
            </button>
          </div>

          {tab === "attendance" ? (
            <div style={S.roster}>
              {data.roster.length === 0 ? (
                <p style={{ color: "#64748b" }}>{t("이 반 학생 명단을 찾지 못했습니다.", "No student list found for this class.")}</p>
              ) : (
                data.roster.map((s) => (
                  <div key={s.id} style={S.row}>
                    <b style={S.rowName}>{s.name}</b>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => mark(s.id, null)} style={!s.status ? S.pillOn : S.pill}>
                        {t("출석", "Present")}
                      </button>
                      {MARKS.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => mark(s.id, m.value)}
                          style={s.status === m.value ? { ...S.pillOn, background: "#b45309" } : S.pill}
                        >
                          {t(m.ko, m.en)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <p style={S.note}>
                {t(
                  "안 온 아이만 눌러주세요. 나머지는 출석입니다. 누르는 즉시 저장되고 행정실 화면에 바로 뜹니다.",
                  "Tap only the students who are not here. Everyone else counts as present. Saved instantly and shown in the office."
                )}
              </p>
            </div>
          ) : tab === "note" ? (
            <div style={S.noteWrap}>
              <div style={{ display: "flex", gap: 8 }}>
                {(["특이사항", "문의"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setNoteKind(k)} style={noteKind === k ? S.kindOn : S.kind}>
                    {k === "특이사항" ? t("🩹 특이사항", "🩹 Incident") : t("❓ 행정실 문의", "❓ Ask the office")}
                  </button>
                ))}
              </div>

              <input
                value={noteWho}
                onChange={(e) => setNoteWho(e.target.value)}
                placeholder={t("누구 (반 전체면 비워두세요)", "Which student (leave blank for the whole class)")}
                style={S.input}
              />

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {quick.map((q) => (
                  /* 눌러도 **한국어가 담깁니다** - 받는 쪽이 행정실이라, 영어로 보내면
                     행정실이 다시 옮겨야 하고 그만큼 늦어집니다. */
                  <button key={q.send} type="button" onClick={() => setNoteBody(q.send)} style={S.quick}>
                    {t(q.send, q.en)}
                  </button>
                ))}
              </div>

              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder={t("내용을 적어주세요", "Write the details")}
                rows={3}
                style={{ ...S.input, resize: "none" }}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={() => setUrgent((v) => !v)} style={urgent ? S.urgentOn : S.urgent}>
                  {urgent ? t("🔴 급함", "🔴 Urgent") : t("급함으로 보내기", "Mark urgent")}
                </button>
                <button type="button" disabled={busy || !noteBody.trim()} onClick={sendNote} style={S.sendBtn}>
                  {t("보내기", "Send")}
                </button>
              </div>

              {/* 보낸 것과 그 상태. **읽었는지가 여기 그대로 보입니다** -
                  «보냈는데 왜 답이 없지»를 없애는 유일한 방법입니다. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", marginTop: 4 }}>
                {data.notes.length === 0 ? (
                  <p style={{ color: "#475569", fontSize: 15 }}>{t("오늘 보낸 것이 없습니다.", "Nothing sent today.")}</p>
                ) : (
                  data.notes.map((n) => (
                    <div key={n.id} style={S.noteRow}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 17, color: "#e2e8f0" }}>
                          {n.urgency === "급함" && <span style={{ color: "#fca5a5" }}>🔴 </span>}
                          {n.studentName ? <b style={{ color: "#fff" }}>{n.studentName} </b> : null}
                          {n.body}
                        </p>
                        {n.reply && <p style={{ margin: "4px 0 0", fontSize: 16, color: "#7dd3fc" }}>↩ {n.reply}</p>}
                      </div>
                      <span style={n.readAt || n.doneAt ? S.stateRead : S.stateSent}>
                        {n.doneAt
                          ? t("처리됨", "Done")
                          : n.readAt
                          ? t(`읽음 ${hhmm(n.readAt)}`, `Read ${hhmm(n.readAt)}`)
                          : t("보냄", "Sent")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div style={S.idle}>
              <p style={{ fontSize: 22, color: "#475569" }}>
                {t("호출이 오면 이 화면이 바뀝니다.", "This screen changes when the office calls.")}
              </p>
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

/** 「읽음 15:32」에 쓸 시:분. */
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", background: "#0b1220", color: "#e2e8f0", padding: 20, display: "flex", flexDirection: "column", gap: 16 },
  center: { minHeight: "100dvh", background: "#0b1220", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cls: { margin: 0, fontSize: 34, fontWeight: 900, color: "#fff" },
  sub: { margin: 0, fontSize: 15, color: "#64748b" },
  clock: { margin: 0, fontSize: 34, fontWeight: 800, color: "#94a3b8", fontVariantNumeric: "tabular-nums" },
  langBtn: { borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#64748b", fontSize: 15, fontWeight: 800, padding: "7px 11px", cursor: "pointer" },
  langOn: { borderRadius: 8, border: "1px solid #38bdf8", background: "#0c4a6e", color: "#fff", fontSize: 15, fontWeight: 800, padding: "7px 11px", cursor: "pointer" },
  callBox: { flex: 1, borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 },
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
  badge: { marginLeft: 8, borderRadius: 999, background: "#dc2626", color: "#fff", fontSize: 14, fontWeight: 800, padding: "2px 9px" },
  noteWrap: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 },
  kind: { flex: 1, borderRadius: 12, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontSize: 18, fontWeight: 700, padding: "12px 0", cursor: "pointer" },
  kindOn: { flex: 1, borderRadius: 12, border: "1px solid #38bdf8", background: "#0c4a6e", color: "#fff", fontSize: 18, fontWeight: 800, padding: "12px 0", cursor: "pointer" },
  input: { width: "100%", borderRadius: 12, border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0", fontSize: 18, padding: "12px 14px" },
  quick: { borderRadius: 999, border: "1px solid #334155", background: "#111c33", color: "#cbd5e1", fontSize: 16, padding: "9px 14px", cursor: "pointer" },
  urgent: { borderRadius: 999, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontSize: 16, fontWeight: 700, padding: "11px 18px", cursor: "pointer" },
  urgentOn: { borderRadius: 999, border: "1px solid #ef4444", background: "#7f1d1d", color: "#fff", fontSize: 16, fontWeight: 800, padding: "11px 18px", cursor: "pointer" },
  sendBtn: { marginLeft: "auto", borderRadius: 12, border: "none", background: "#0284c7", color: "#fff", fontSize: 20, fontWeight: 900, padding: "13px 34px", cursor: "pointer" },
  noteRow: { display: "flex", alignItems: "flex-start", gap: 10, background: "#111c33", borderRadius: 12, padding: "10px 14px" },
  stateSent: { flexShrink: 0, borderRadius: 999, background: "#334155", color: "#cbd5e1", fontSize: 14, fontWeight: 700, padding: "4px 12px" },
  stateRead: { flexShrink: 0, borderRadius: 999, background: "#14532d", color: "#86efac", fontSize: 14, fontWeight: 800, padding: "4px 12px" },
};
