"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StudentSelect, { type SelectableStudent } from "@/components/common/StudentSelect";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import { ITEM_LOOK, TOPIC_LOOK, bucketOf, toMinutes, topicOf, whenLabel, type Topic, type DayBoard, type DayItem, type DayItemKind, type StudentDay, type UnknownItem } from "@/lib/studentDay";
import { NOTE_KINDS, KIND_LOOK, type NoteKind } from "@/lib/studentDayNotes";
import DismissalModal from "./DismissalModal";

/**
 * **오늘 학생 — 「누가 오늘 평소와 다른가」를 한 곳에 모은 보드.**
 *
 * ── 어지럽지 않게 만드는 규칙 넷 ────────────────────────────────────────────
 *
 * 139명입니다. 규칙 없이 늘어놓으면 첫날부터 아무도 안 봅니다.
 *
 *  ① **한 아이 = 한 줄.** 백서아의 픽업과 약이 두 줄로 나뉘면 보는 사람이 다시 눈으로
 *     이어야 합니다. 여러 건은 한 줄 안에 작은 칩으로 늘어섭니다.
 *  ② **갈래로 가르지 않습니다.** 사람이 하는 질문은 「누가 몇 시에 무엇을」이지 「결석이
 *     몇 명인가」가 아닙니다. 갈래로 칸을 나누면 백서아가 두 칸에 나뉩니다.
 *  ③ **지난 것과 앞날은 접습니다.** 펼쳐두면 지금 할 일이 그 사이에 묻힙니다. 숫자는
 *     늘 보이므로 「없어진 것」과 「접힌 것」이 구별됩니다.
 *  ④ **적는 폼은 접어둡니다.** 보는 일은 하루에 수십 번, 적는 일은 몇 번입니다. 폼이
 *     펼쳐져 있으면 칸의 절반을 늘 먹습니다.
 */

type Draft = { studentId: string | null; kind: NoteKind; content: string; onDate: string; atTime: string };

/**
 * **여기서 이을 수 있는 줄인가.**
 *
 * 인박스에서 온 연락(`pending:` · `inquiry:`)만 잇습니다. 그 줄에는 이을 자리
 * (`pickup_requests.student_id`)가 있고, 창구가 이미 있습니다. 다른 갈래는 번호를 담을
 * 칸이 없거나 제 화면에서 처리돼야 하는 것이라, **여기서 이을 수 없다고 적습니다** -
 * 고를 수 있게 해놓고 아무 일도 안 일어나는 것이 가장 나쁩니다.
 */
/**
 * **오늘 칸을 둘로 나눕니다 — 가는 일과 챙길 일.**
 *
 * 한 줄에 「13:55 픽업 · 1시 이후 약」이 함께 있으면 두 가지를 동시에 읽어야 합니다. 그런데
 * 하는 일이 다릅니다 - 픽업은 **그 시각에 아이를 내보내는 일**이고, 약·결제·준비물은
 * **오늘 안에 챙기는 일**입니다. 보는 사람도 대개 둘 중 하나를 찾고 있습니다.
 *
 * 아이로 가르지 않고 **일로 가릅니다.** 백서아는 위(픽업)에도 아래(특이사항)에도 섭니다 -
 * 한쪽에만 두면 다른 쪽을 보는 사람이 그 아이를 놓칩니다.
 */
const MOVE_KINDS: ReadonlySet<DayItemKind> = new Set(["픽업", "결석", "지각", "조퇴"]);

function slice(day: StudentDay, keep: (k: DayItemKind) => boolean, date: string): StudentDay | null {
  const items = day.items.filter((i) => keep(i.kind));
  if (items.length === 0) return null;
  return {
    ...day,
    items,
    // 시각·확인 수는 **남은 것만으로 다시 셉니다.** 그대로 두면 아래 칸에 위 칸의 시각이
    // 찍혀, 약을 13:55에 먹이는 것처럼 보입니다.
    firstTime: items.find((i) => i.onDate === date && i.at)?.at ?? null,
    pendingCount: items.filter((i) => i.pending).length,
  };
}

function linkableId(u: UnknownItem): string | null {
  for (const p of ["pending:", "inquiry:"]) if (u.id.startsWith(p)) return u.id.slice(p.length);
  return null;
}

export default function StudentDayBoard({ students }: { students: SelectableStudent[] }) {
  const notify = useToast();
  const router = useRouter();
  const [board, setBoard] = useState<DayBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMin, setNowMin] = useState(() => nowMinutesKst());

  const [q, setQ] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showPast, setShowPast] = useState(false);
  const [showAhead, setShowAhead] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  /** 하원수단 창. 머리글 [🎒 하원수단]에서 엽니다. */
  const [dismissalOpen, setDismissalOpen] = useState(false);
  /** 누른 아이의 세부. **줄에서 펼치지 않고 창으로 엽니다** - 두 줄로 세운 칸에서 한 줄만
      길어지면 옆 줄과 어긋나 읽기 어렵습니다. */
  const [detail, setDetail] = useState<StudentDay | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/student-day", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) return setLoadError(body?.error ?? `보드를 읽지 못했습니다 (${res.status}).`);
      setLoadError(null);
      setBoard(body as DayBoard);
    } catch (e) {
      // 조용히 빈 칸을 띄우면 「오늘은 아무 일 없구나」로 읽힙니다. 다른 말입니다.
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      setNowMin(nowMinutesKst());
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const date = board?.date ?? "";

  /** 검색·필터를 먼저 걸고, 그 다음에 묶음으로 가릅니다. */
  const { today, past, ahead, unknown } = useMemo(() => {
    const empty = { today: [] as StudentDay[], past: [] as StudentDay[], ahead: [] as StudentDay[], unknown: [] as UnknownItem[] };
    if (!board) return empty;
    const needle = q.trim().toLowerCase();
    const hit = (d: StudentDay) =>
      !needle ||
      d.name.toLowerCase().includes(needle) ||
      (d.className ?? "").toLowerCase().includes(needle) ||
      d.items.some((i) => i.text.toLowerCase().includes(needle));

    const days = board.days.filter((d) => hit(d) && (!onlyPending || d.pendingCount > 0));
    const out = { ...empty, unknown: board.unknown };
    for (const d of days) {
      const b = bucketOf(d, board.date, nowMin);
      if (b === "오늘") out.today.push(d);
      else if (b === "지남") out.past.push(d);
      else out.ahead.push(d);
    }
    return out;
  }, [board, q, onlyPending, nowMin]);

  /**
   * 오늘 칸을 둘로. **시각이 있는 것이 먼저이고, 이른 것부터**입니다 - 그 시각에 사람이
   * 움직여야 하고 놓치면 그날 못 합니다.
   */
  const byTime = (a: StudentDay, b: StudentDay) =>
    (a.firstTime ?? "99:99").localeCompare(b.firstTime ?? "99:99") || a.name.localeCompare(b.name, "ko");
  const todayMove = useMemo(
    () => today.map((d) => slice(d, (k) => MOVE_KINDS.has(k), date)).filter((d): d is StudentDay => !!d).sort(byTime),
    [today, date],
  );
  const todayNote = useMemo(
    () => today.map((d) => slice(d, (k) => !MOVE_KINDS.has(k), date)).filter((d): d is StudentDay => !!d).sort(byTime),
    [today, date],
  );

  /** 이 보드 안에서 겹치는 이름. 겹칠 때만 반을 붙입니다. */
  const dupNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const d of board?.days ?? []) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n));
  }, [board]);

  const pendingTotal = (board?.days.reduce((n, d) => n + d.pendingCount, 0) ?? 0) + (board?.unknown.length ?? 0);

  /**
   * 잘못 적은 특이사항 내리기.
   *
   * **보드에서 내릴 수 있어야 합니다.** 적는 자리와 내리는 자리가 갈리면, 오타로 들어간
   * 줄이 영영 남습니다 - 내리러 다른 화면을 찾아가는 일은 대개 안 하게 됩니다.
   *
   * 내릴 수 있는 것은 **사람이 적은 특이사항뿐**입니다. 픽업·결석·문의는 각자 제 화면에서
   * 처리되어야 하고, 여기서 지우면 그 화면과 답이 갈립니다.
   */
  async function dropNote(item: DayItem) {
    const id = item.id.startsWith("note:") ? item.id.slice(5) : null;
    if (!id) return;

    // **먼저 화면에서 뺍니다.** 서버를 기다리면 누른 뒤 한 박자 동안 아무 일도 안 일어난
    // 것처럼 보여, 사람이 한 번 더 누릅니다. 실패하면 되돌리고 그 사실을 알립니다.
    const before = board;
    setBoard((b) =>
      b
        ? {
            ...b,
            days: b.days
              .map((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }))
              .filter((d) => d.items.length > 0),
          }
        : b,
    );

    try {
      const res = await fetch("/api/student-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setBoard(before); // 되돌립니다 - 화면에서만 사라진 줄이 남으면 안 됩니다
        notify(body?.error ?? "내리지 못했습니다.", "error");
        return;
      }
      // 되돌릴 수 있게 알립니다. 잘못 누르고 이 칸을 다시 찾아 적는 일은 대개 안 합니다.
      notify(`「${item.text.slice(0, 20)}」 내렸습니다.`, "success", {
        undo: async () => {
          const r = await fetch("/api/student-notes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, restore: true }),
          });
          if (!r.ok) {
            const b = await r.json().catch(() => null);
            notify(b?.error ?? "되돌리지 못했습니다.", "error");
          }
          void load();
        },
      });
      void load();
    } catch (err) {
      setBoard(before);
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  /**
   * **누구인지 모르는 연락에 학생을 바로 잇습니다.**
   *
   * 예전에는 이 줄에서 할 수 있는 일이 「픽업 인박스 열기」 링크뿐이었습니다. 건너가서
   * 그 줄을 다시 찾아야 했고, 건너간 김에 다른 일을 하다 잊습니다 - 그러면 그 연락은
   * 누구의 것도 아닌 채로 남습니다.
   *
   * **픽업으로 읽힌 줄은 확정까지, 문의는 잇기만** 합니다. 문의에는 확정이라는 것이 없고,
   * 픽업은 이으면서 확정하는 것이 인박스와 같은 손놀림입니다(같은 창구를 씁니다 - 두
   * 화면이 다른 일을 하면 언젠가 답이 갈립니다).
   */
  async function linkStudent(u: UnknownItem, studentId: string) {
    const id = linkableId(u);
    if (!id) return;
    const asPickup = u.kind !== "문의";
    try {
      const res = await fetch("/api/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: asPickup ? "confirm" : "link", id, studentId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        notify(body?.error ?? "잇지 못했습니다.", "error");
        return;
      }
      notify(asPickup ? "학생을 잇고 픽업으로 확정했습니다." : "학생을 이었습니다.", "success");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
      {/* ── 머리: 숫자 한 줄 ────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-baseline gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-bold text-slate-800">📋 오늘 학생</h2>
        <span className="text-[11px] text-slate-500">{today.length}명</span>
        {pendingTotal > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">확인 {pendingTotal}</span>
        )}
        {/* **하원수단은 여기서 고칩니다.** 예전에는 화면 맨 위 배너에 단추가 있었는데,
            그 배너가 보여주던 명단이 이 칸과 같아서 배너를 뺐습니다. 고치는 자리는 그 명단
            옆에 있어야 합니다. */}
        <button
          type="button"
          onClick={() => setDismissalOpen(true)}
          title="요일별 하원수단을 넣거나 고칩니다. 오늘 것은 셔틀 체크표에 바로 반영됩니다."
          className="ml-auto rounded-lg bg-lime-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-lime-700"
        >
          🎒 하원수단
        </button>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="rounded-lg border border-slate-300 px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
        >
          {formOpen ? "닫기" : "+ 특이사항"}
        </button>
      </div>

      {formOpen && <NoteForm students={students} today={date} onSaved={() => void load()} onClose={() => setFormOpen(false)} />}

      {/* ── 찾기 한 줄. 139명 중에서 한 아이를 볼 때 씁니다. ─────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 반 · 내용으로 좁히기"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-[12px]"
        />
        <button
          type="button"
          onClick={() => setOnlyPending((v) => !v)}
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold transition " +
            (onlyPending ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300" : "text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50")
          }
        >
          확인 필요만
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loadError ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
            {loadError}
            <button type="button" onClick={() => void load()} className="ml-2 font-bold underline">
              다시 시도
            </button>
          </div>
        ) : !board ? (
          <p className="py-4 text-center text-[12px] text-slate-400">불러오는 중…</p>
        ) : (
          <>
            {/* 읽다 실패한 갈래가 있으면 숨기지 않습니다 - 「조용히 빠진 갈래」가 가장 나쁩니다. */}
            {board.problems.length > 0 && (
              <ul className="mb-2 space-y-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-800">
                {board.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}

            {/* ── 오늘 ──────────────────────────────────────────────── */}
            {today.length === 0 && past.length === 0 && ahead.length === 0 && unknown.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-slate-400">
                오늘 평소와 다른 아이가 없습니다. 연락이 오면 여기 모입니다.
              </p>
            ) : (
              <>
                {/* 위 — 가는 일. **시각이 이른 것부터**입니다. 다가오면 색이 변합니다. */}
                <Group icon="🚗" label="픽업 · 하원" n={todayMove.length} tone="blue">
                  {todayMove.map((d) => (
                    <Row
                      key={d.studentId}
                      day={d}
                      date={date}
                      nowMin={nowMin}
                      dupName={dupNames.has(d.name)}
                      onOpen={() => setDetail(d)}
                    />
                  ))}
                </Group>

                {/* 아래 — 챙길 일. 시각이 있으면 그 순서, 없으면 「오늘 중에」라 뒤로. */}
                <Group icon="📌" label="특이사항" n={todayNote.length} tone="violet">
                  {todayNote.map((d) => (
                    <Row
                      key={d.studentId}
                      day={d}
                      date={date}
                      nowMin={nowMin}
                      dupName={dupNames.has(d.name)}
                      onOpen={() => setDetail(d)}
                    />
                  ))}
                </Group>
              </>
            )}

            {/* ── 누구인지 모름. 접지 않습니다 — 여기 남아 있으면 누군가 놓칩니다. ── */}
            {unknown.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
                <p className="mb-1 text-[11px] font-bold text-amber-800">❓ 누구인지 아직 모릅니다 · {unknown.length}건</p>
                <ul className="space-y-1">
                  {unknown.slice(0, 6).map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span>{ITEM_LOOK[u.kind].icon}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700">{u.text}</span>
                      {u.hint && <span className="shrink-0 text-[10px] text-amber-700">{u.hint}</span>}

                      {/* **이어 둔 형제방은 「미연결」이 아닙니다.**
                          학기 초에 사람이 황라원·황라윤을 그 방에 이어 두었는데, 본문이
                          둘 중 누구인지 안 갈랐다고 화면이 아무것도 모르는 것처럼 떴습니다.
                          그러면 사람은 연결이 안 된 줄 알고 처음부터 다시 찾습니다.

                          이어 둔 것이 있으면 **그 집 아이 전부가 기본**이고, 한 명만
                          해당하면 그 자리에서 눌러 좁힙니다. */}
                      {u.house.length > 1 && (
                        <span className="flex shrink-0 flex-wrap items-center gap-1">
                          <span className="rounded bg-white px-1 text-[10px] font-bold text-amber-800 ring-1 ring-amber-300">
                            🏠 {u.house.map((s) => s.name).join("·")} 둘 다 해당
                          </span>
                          <span className="text-[10px] text-amber-700">한 명이면 →</span>
                          {u.house.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => void linkStudent(u, s.id)}
                              title={`이 연락을 ${s.name} 한 명의 것으로 정합니다`}
                              className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-amber-700"
                            >
                              {s.name}
                            </button>
                          ))}
                        </span>
                      )}

                      {/* **여기서 바로 잇습니다.** 예전에는 「픽업 인박스에서 연결하세요」
                          링크뿐이었는데, 건너간 김에 다른 일을 하다 잊습니다 - 그러면 그
                          연락은 누구의 것도 아닌 채로 남습니다.

                          집이 이어진 줄에는 검색칸을 안 띄웁니다 - 그 집 아이는 위 단추로
                          고르는 것이 맞고, 검색칸을 함께 두면 남의 집 아이를 고를 수 있게
                          됩니다. */}
                      {u.house.length > 1 ? null : linkableId(u) ? (
                        <StudentSelect
                          students={students}
                          value={null}
                          onChange={(id) => id && void linkStudent(u, id)}
                          placeholder="학생 잇기…"
                          className="w-40 shrink-0"
                        />
                      ) : (
                        <span className="shrink-0 text-[10px] text-amber-700">여기서는 이을 수 없습니다</span>
                      )}
                    </li>
                  ))}
                </ul>
                <a href="/pickup/inbox" className="mt-1 inline-block text-[11px] font-bold text-amber-800 underline">
                  픽업 인박스 열기 →
                </a>
              </div>
            )}

            {/* ── 접어두는 둘 ──────────────────────────────────────────── */}
            <Folded label="지난 것" n={past.length} open={showPast} onToggle={() => setShowPast((v) => !v)}>
              {past.map((d) => (
                <Row key={d.studentId} day={d} date={date} nowMin={nowMin} dim dupName={dupNames.has(d.name)} onOpen={() => setDetail(d)} />
              ))}
            </Folded>
            <Folded label="앞날" n={ahead.length} open={showAhead} onToggle={() => setShowAhead((v) => !v)}>
              {ahead.map((d) => (
                <Row key={d.studentId} day={d} date={date} nowMin={nowMin} dim dupName={dupNames.has(d.name)} onOpen={() => setDetail(d)} />
              ))}
            </Folded>
          </>
        )}
      </div>

      {/* **줄을 누르면 여기가 뜹니다.** 앞 판에서는 이 줄이 빠져 있어, 눌러도 아무 일도
          일어나지 않았습니다. */}
      {detail && (
        <DetailModal
          day={detail}
          date={date}
          onClose={() => setDetail(null)}
          onDrop={(i) => {
            void dropNote(i);
            setDetail(null);
          }}
          onFixed={() => router.refresh()}
        />
      )}
      {dismissalOpen && <DismissalModal onClose={() => setDismissalOpen(false)} />}
    </section>
  );
}

/**
 * **한 아이 한 줄.** 시각 · 이름 · 반 · 그리고 할 일들이 작은 칩으로.
 *
 * 누르면 그 줄만 펼쳐져 전체 글과 출처가 보입니다 - 보드는 훑는 곳이고, 자세한 것은
 * 필요한 한 줄에서만 봅니다.
 */
/**
 * 묶음 머리. **비어 있어도 줄은 남깁니다** - 칸이 통째로 사라지면 「오늘 픽업이 없다」와
 * 「그 칸이 어디 갔지」가 구별되지 않습니다.
 */
function Group({
  icon,
  label,
  n,
  tone,
  children,
}: {
  icon: string;
  label: string;
  n: number;
  tone: "blue" | "violet";
  children: React.ReactNode;
}) {
  const head =
    tone === "blue" ? "text-sky-700 border-sky-200 bg-sky-50" : "text-violet-700 border-violet-200 bg-violet-50";
  return (
    // 두 묶음 사이에 **굵은 선**을 둡니다. 색만으로 가르면 줄이 많아질수록 경계가 흐려집니다.
    <section className="mb-3 border-b-2 border-slate-200 pb-3 last:mb-0 last:border-b-0 last:pb-0">
      <div className={"mb-1 flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-bold " + head}>
        <span>{icon}</span>
        <span>{label}</span>
        <span className="tabular-nums opacity-70">{n}</span>
      </div>
      {n === 0 ? (
        <p className="px-2 py-1 text-[11px] text-slate-400">없습니다.</p>
      ) : (
        // **두 줄로 세웁니다.** 한 줄에 하나씩이면 여덟 명만 되어도 스크롤이 생기고, 스크롤
        // 아래에 있는 아이는 없는 것과 같습니다. 칸이 좁아지면 저절로 한 줄로 돌아갑니다.
        <ul className="grid grid-cols-1 gap-1 xl:grid-cols-2">{children}</ul>
      )}
    </section>
  );
}

function Row({
  day,
  date,
  nowMin,
  onOpen,
  dim,
  dupName,
}: {
  day: StudentDay;
  date: string;
  nowMin: number;
  /** 이름이 겹치는 아이인가. 겹칠 때만 반을 붙입니다. */
  dupName?: boolean;
  /** 누르면 세부 창이 뜹니다. 줄 안에서 펼치지 않습니다 - 두 줄로 세운 칸에서 한 줄만
      길어지면 옆 줄과 어긋나 읽기 어렵습니다. */
  onOpen: () => void;
  dim?: boolean;
}) {
  /**
   * **시각이 다가오면 줄이 스스로 말합니다.**
   *
   * 10분 안쪽은 붉게 **깜박이고**, 30분 안쪽은 노랗습니다 - 색이 두 단계여야 「곧」과
   * 「지금」이 구별됩니다. **지난 것은 채도를 빼되 지우지 않습니다** - 놓친 것이 화면에서
   * 사라지면 아무도 안 찾습니다.
   */
  const left = day.firstTime !== null ? toMinutes(day.firstTime) - nowMin : null;
  const urgent = left !== null && left <= 10 && left >= -20;
  const soon = left !== null && left <= 30 && left > 10;
  const past = dim || (left !== null && left < -20);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={
          "flex w-full items-baseline gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors duration-500 " +
          (past
            ? "border-slate-100 bg-slate-50 opacity-60 saturate-50"
            : urgent
              ? "animate-pulse border-rose-400 bg-rose-50"
              : soon
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-white hover:bg-slate-50")
        }
      >
        {/* 시각이 이름보다 먼저입니다 — 몇 시가 움직이는 시점을 정합니다. */}
        {day.firstTime && (
          <b className={"shrink-0 tabular-nums text-[13px] " + (past ? "text-slate-400" : "text-slate-900")}>{day.firstTime}</b>
        )}
        {/* 색만으로는 몇 분 남았는지 모릅니다. 색은 눈에 먼저 들어오고, 숫자가 답을 줍니다. */}
        {!past && left !== null && left <= 30 && (
          <span className={"shrink-0 text-[10px] font-bold " + (urgent ? "text-rose-600" : "text-amber-700")}>
            {left > 0 ? `${left}분 뒤` : left === 0 ? "지금" : `${-left}분 지남`}
          </span>
        )}
        <b className={"shrink-0 text-[13px] " + (past ? "text-slate-500" : "text-slate-900")}>{day.name}</b>
        {/* **반은 겹치는 이름에만** 붙입니다. 김재이가 셋일 때만 구분이 필요하고, 139명
            전부에 붙이면 정작 구분이 필요한 이름이 묻힙니다(CLAUDE.md §2-4-2). 두 줄로
            세운 좁은 칸에서는 그 글자가 칩 자리를 먹습니다. */}
        {dupName && <span className="shrink-0 text-[10px] text-slate-400">{day.className ?? day.grade ?? ""}</span>}

        {/* 칩은 **한 줄에서 넘치지 않게** 잘립니다. 줄바꿈되면 두 줄로 세운 칸이 들쭉날쭉해져
            어느 줄이 누구 것인지 눈으로 다시 이어야 합니다. */}
        {/* **아이콘이 잘리지 않게** — baseline 으로 맞추고 넘침을 자르면 이모지의 아래위가
            깎입니다. 가운데 정렬로 두고, 넘치는 칩은 다음 줄로 넘기지 않고 그냥 둡니다. */}
        <span className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
          {/* 같은 갈래가 여럿이면 하나로 묶고 개수만 적습니다 - 「💬 문의 💬 문의」는
              칸만 먹고 알려주는 것이 없습니다. */}
          {/* **칩은 글자입니다.** 예전에는 아이콘만 뒀는데, 💊·💳·📌는 아는 사람에게만
              뜻이 있고 새로 온 직원에게는 그림입니다. 「약」·「결제」·「기타」 두 글자면
              누구나 바로 읽습니다 - 색은 멀리서 훑을 때의 보조이고, 뜻은 글자가 냅니다. */}
          {/* **칩은 두 개까지.** 세 개가 되면 좁은 칸에서 셋 다 잘려 아무것도 못 읽습니다 -
              나머지는 「+N」으로 세고 줄을 눌러 봅니다. */}
          {groupItems(day.items).slice(0, 2).map(({ item, count }) => (
            <span
              key={item.id}
              title={`${item.kind} · ${shortOf(item, date)}${item.text ? ` — ${item.text}` : ""}`}
              className={
                "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold leading-none " +
                (past ? "bg-slate-100 text-slate-500" : ITEM_LOOK[item.kind].chip)
              }
            >
              {/* 문의는 「문의」가 아니라 **무엇에 관한 문의인지**(학사·차량·출결·납부·건강)
                  를 적습니다 - 담임이 볼 것과 행정실이 볼 것이 갈리는데 화면에는 다 같은
                  「문의」였습니다. 나머지 갈래는 갈래 이름 그대로가 곧 할 일입니다. */}
              {topicLabel(item) ?? <span className="text-[10px] font-bold">{item.kind}</span>}
              {count > 1 ? count : ""}
            </span>
          ))}
          {groupItems(day.items).length > 2 && (
            <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">
              +{groupItems(day.items).length - 2}
            </span>
          )}
        </span>

        {day.pendingCount > 0 && (
          <span title={`확인이 필요한 것 ${day.pendingCount}건`} className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">
            ❗{day.pendingCount}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * 한 아이의 오늘 — 창으로 엽니다.
 *
 * 목록에서는 한 줄에 요약만 보이므로, 원문·근거·시각은 여기서 봅니다. 사람이 적은
 * 특이사항은 여기서 바로 내릴 수 있습니다(다른 갈래는 제 화면에서 처리해야 합니다).
 */
function DetailModal({
  day,
  date,
  onClose,
  onDrop,
  onFixed,
}: {
  day: StudentDay;
  date: string;
  onClose: () => void;
  onDrop: (item: DayItem) => void;
  /** 고친 뒤. 보드를 다시 읽습니다 - 화면이 자기 상태를 손으로 고치지 않습니다. */
  onFixed: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[950] flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-2 border-b border-slate-200 px-4 py-2.5">
          <b className="text-[15px] text-slate-900">{day.name}</b>
          <span className="text-[11px] text-slate-400">{day.className ?? day.grade ?? ""}</span>
          <a href={`/students/${day.studentId}`} className="text-[11px] font-bold text-blue-600 underline">
            학생 기록 →
          </a>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-slate-800 px-3 py-1 text-[12px] font-bold text-white">
            닫기
          </button>
        </div>
        <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto p-3">
          {day.items.map((i) => (
            <li key={i.id} className="rounded-lg border border-slate-200 px-2.5 py-2">
              <div className="flex items-baseline gap-1.5">
                <span className={"shrink-0 rounded px-1 text-[10px] font-bold " + ITEM_LOOK[i.kind].chip}>
                  {ITEM_LOOK[i.kind].icon} {i.kind}
                </span>
                {topicChip(i)}
                {whenLabel(i.onDate, i.at, date) && (
                  <b className="shrink-0 tabular-nums text-[12px] text-slate-700">{whenLabel(i.onDate, i.at, date)}</b>
                )}
                {i.pending && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">확인 필요</span>
                )}
                {i.id.startsWith("note:") && (
                  <button
                    type="button"
                    onClick={() => onDrop(i)}
                    title="이 특이사항을 내립니다"
                    className="ml-auto shrink-0 rounded px-1 text-[12px] font-bold text-slate-300 hover:bg-red-50 hover:text-red-500"
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">{i.text}</p>

              {/* **근거.** 「왜 이 줄이 떴지」에 답하는 자리입니다. 표 이름은 사람에게 아무
                  말도 아니므로, 토들에서 온 것이면 **학부모가 쓴 글 그대로**를 보여줍니다 -
                  요약이 잘못됐을 때 그걸 알아채는 길은 이것뿐입니다. */}
              {i.evidence && (
                <div className="mt-1.5 rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] font-bold text-slate-500">📎 {i.evidence.label}</p>
                  {i.evidence.raw ? (
                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">
                      {i.evidence.raw}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">글로 온 근거는 없습니다(설정·체크로 정해진 것).</p>
                  )}
                </div>
              )}

              {/* 특이사항은 **그 자리에서 고칩니다.** 내리고 새로 적게 하면 원문과 이어둔
                  실이 끊기고, 바쁜 사람은 고치는 대신 그냥 둡니다 - 틀린 시각으로 알람이
                  울립니다. */}
              {i.id.startsWith("note:") && <FixNote item={i} onDone={onFixed} />}

              <a href={i.from.screen} className="mt-1 inline-block text-[10px] text-slate-400 underline">
                {i.from.screen} 에서 보기 →
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Folded({
  label,
  n,
  open,
  onToggle,
  children,
}: {
  label: string;
  n: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (n === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>
          {label} {n}명
        </span>
      </button>
      {open && <ul className="mt-1 space-y-1">{children}</ul>}
    </div>
  );
}

/** 접힌 줄에 들어갈 짧은 글. 칩 하나가 줄을 통째로 먹으면 「몇 건인가」가 안 보입니다. */
/**
 * 칩에 적는 짧은 글.
 *
 * **두 줄로 세운 칸에서는 내용을 넣으면 한두 글자만 보입니다** — 「💬 흭」처럼 잘린 글자는
 * 아무 뜻도 전하지 못하면서 이름 자리를 먹습니다. 그래서 칩은 **갈래와 날짜**만 말하고,
 * 내용은 줄을 눌러 세부 창에서 봅니다.
 */
function shortOf(i: DayItem, date: string): string {
  const when = i.onDate === date ? "" : `${whenLabel(i.onDate, null, date)} `;
  return `${when}${i.at ?? ""}`.trim() || i.kind;
}

/**
 * 문의·기타에 붙는 주제 이름표(학사·차량·출결·납부·건강).
 *
 * 픽업·결석처럼 **갈래 자체가 이미 무슨 일인지 말하는 것에는 붙이지 않습니다** - 「🚗 픽업
 * 차량」은 같은 말을 두 번 하는 것입니다.
 */
function topicOfItem(item: DayItem): Topic | null {
  if (item.kind !== "문의" && item.kind !== "기타") return null;
  const topic = topicOf(item.text);
  return topic === "기타" ? null : topic;
}

/** 줄에 붙는 주제 글자. 칩 안에 들어가므로 테두리를 또 두르지 않습니다. */
function topicLabel(item: DayItem) {
  const topic = topicOfItem(item);
  return topic ? <span className="text-[10px] font-bold">{topic}</span> : null;
}

/** 세부 창에 붙는 주제 칩. 여기는 자리가 넉넉하므로 따로 두릅니다. */
function topicChip(item: DayItem) {
  const topic = topicOfItem(item);
  return topic ? <span className={"shrink-0 rounded px-1 text-[10px] font-bold " + TOPIC_LOOK[topic].chip}>{topic}</span> : null;
}

/** 같은 날·같은 갈래는 한 칩으로. 세부는 창에서 하나씩 봅니다. */
function groupItems(items: DayItem[]): { item: DayItem; count: number }[] {
  const out: { item: DayItem; count: number }[] = [];
  for (const it of items) {
    const hit = out.find((o) => o.item.kind === it.kind && o.item.onDate === it.onDate);
    if (hit) hit.count += 1;
    else out.push({ item: it, count: 1 });
  }
  return out;
}

function nowMinutesKst(): number {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * 특이사항 적는 폼. **접어둡니다** — 보는 일은 하루에 수십 번, 적는 일은 몇 번입니다.
 *
 * 저장하는 창구는 `/api/student-notes` 그대로입니다. 보드는 읽기만 하고, 적는 일은 원래
 * 있던 자리에서 합니다 - 저장을 두 곳에 두면 어느 날 한쪽에만 칸이 늘어납니다.
 */
function NoteForm({
  students,
  today,
  onSaved,
  onClose,
}: {
  students: SelectableStudent[];
  today: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const notify = useToast();
  const [d, setD] = useState<Draft>({ studentId: null, kind: "약", content: "", onDate: today, atTime: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setD((p) => ({ ...p, onDate: p.onDate || today }));
  }, [today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.studentId) return notify("학생을 먼저 골라주세요.", "error");
    if (!d.content.trim()) return notify("무엇을 해야 하는지 적어주세요.", "error");
    setBusy(true);
    try {
      const res = await fetch("/api/student-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: d.studentId,
          kind: d.kind,
          content: d.content.trim(),
          onDate: d.onDate || today,
          atTime: d.atTime || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) return notify(body?.error ?? "저장하지 못했습니다.", "error");
      setD({ studentId: null, kind: "약", content: "", onDate: today, atTime: "" });
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="shrink-0 space-y-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <StudentSelect
          students={students}
          value={d.studentId}
          onChange={(v) => setD((p) => ({ ...p, studentId: v }))}
          placeholder="학생 검색…"
          className="min-w-[150px] flex-1"
          disabled={busy}
          autoOpen
        />
        <input
          type="date"
          value={d.onDate}
          min={today}
          onChange={(e) => setD((p) => ({ ...p, onDate: e.target.value }))}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
          title="어느 날의 일인가요. 기본은 오늘입니다."
        />
        <input
          type="time"
          value={d.atTime}
          onChange={(e) => setD((p) => ({ ...p, atTime: e.target.value }))}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
          title="몇 시에 할 일인가요. 적어두면 5분 전에 알림이 뜹니다. 비워도 됩니다."
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {NOTE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setD((p) => ({ ...p, kind: k }))}
            disabled={busy}
            className={
              "rounded-full px-2 py-0.5 text-[11px] font-bold transition " +
              (d.kind === k ? KIND_LOOK[k].chip : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100")
            }
          >
            {KIND_LOOK[k].icon} {k}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        <input
          value={d.content}
          onChange={(e) => setD((p) => ({ ...p, content: e.target.value }))}
          disabled={busy}
          maxLength={300}
          placeholder="예: 점심 먹고 감기약 한 봉 / 픽업 오실 때 교재비 결제 예정"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
        >
          등록
        </button>
      </div>
    </form>
  );
}


/**
 * **특이사항 한 줄 고치기** — 시각과 내용.
 *
 * 창을 새로 띄우지 않습니다. 고칠 것은 두 칸뿐이고, 창이 또 뜨면 뒤에 있던 근거(원문)가
 * 가려집니다 - 원문을 보면서 고치는 것이 이 자리의 목적입니다.
 */
function FixNote({ item, onDone }: { item: DayItem; onDone: () => void }) {
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(item.text);
  const [at, setAt] = useState(item.at ?? "");
  const [busy, setBusy] = useState(false);
  const id = item.id.slice("note:".length);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/student-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: text.trim(), atTime: at.trim() }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    // 조용히 넘기지 않습니다 - 안 고쳐진 줄 모르고 창을 닫으면 틀린 값이 그대로 남습니다.
    if (!res.ok) return notify(json.error ?? "고치지 못했습니다.", "error");
    notify("고쳤습니다.", "success");
    setOpen(false);
    onDone();
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 mr-2 rounded-lg border border-violet-300 px-2 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-50"
      >
        ✏️ 고치기
      </button>
    );

  return (
    <div className="mt-1.5 rounded-lg border border-violet-300 bg-violet-50/60 p-2">
      <div className="mb-1 flex items-center gap-1.5">
        <input
          value={at}
          onChange={(e) => setAt(e.target.value)}
          placeholder="14:30"
          inputMode="numeric"
          className="w-[72px] rounded border border-slate-300 px-1.5 py-1 text-[11px]"
        />
        <span className="text-[10px] text-violet-600">{at ? "그 시각에 알립니다" : "시각 없음 = 오늘 중에"}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 300))}
        rows={2}
        className="w-full rounded border border-slate-300 p-1.5 text-[12px]"
      />
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void save()}
          className="rounded-lg bg-violet-700 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
        >
          저장
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-500"
        >
          취소
        </button>
      </div>
    </div>
  );
}
