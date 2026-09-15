"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardScale } from "@/lib/useBoardDensity";
import { lessonPlace } from "@/lib/lessonLocation";
import { BoardData, btn, shortName } from "./boardShared";

/**
 * 픽업 알람 — 시각이 적힌 픽업을 **5분 전에** 화면 위로 끌어올립니다.
 *
 * 화면에서 가장 시간에 민감한 조각이라(놓치면 아이가 교실에 남습니다) 따로 둡니다.
 */

// 픽업 알람.
//
// 시각이 적힌 픽업은 그 시각에 **행정실이 교실로 데리러 갑니다.** 그런데 목록에 적혀 있는
// 것만으로는 아무도 시계를 보지 않습니다 - 15:40 이 지나서야 «아 맞다»가 됩니다.
// 5분 전에 화면 맨 위를 크게 차지하게 해서, 지나가다 보이면 바로 움직일 수 있게 합니다.
//
// 이름만으로는 못 움직입니다. 어느 반이 지금 어느 교실에서 무슨 수업 중인지가 있어야
// 곧장 그리로 갑니다. 그래서 시간표에서 그 반의 지금 수업을 찾아 함께 적습니다.
//
// 시각이 지나도 10분은 남깁니다 - 5분 전에 자리를 비웠던 사람도 봐야 하고, 지난 일이라고
// 사라지면 «놓쳤다»는 사실 자체가 화면에서 없어집니다.
const ALERT_LEAD_MIN = 5;
const ALERT_KEEP_MIN = 10;

/**
 * 팝업이 화면을 덮고 있는 시간(초).
 *
 * **20초로 정했습니다.** 두 가지를 저울질한 값입니다.
 *
 *   · 10초 — 자리를 잠깐 비웠다 돌아오면 놓칩니다. 소리 없이 팝업만 뜨므로 눈으로
 *     지나치면 그대로 끝입니다.
 *   · 30초 이상 — 그동안 시간표와 오늘 변동사항을 못 봅니다. 이 화면은 하루 종일 켜져
 *     있으므로, 가리는 시간이 길면 팝업 자체가 방해물이 됩니다.
 *
 * 20초면 복도 끝에서 보고 걸어와 읽을 수 있고, 화면을 오래 막지 않습니다.
 *
 * 그리고 **팝업이 사라져도 위쪽 알림 띠는 남습니다.** 놓쳐도 정보가 사라지지 않는 것이
 * 이 설계의 요점입니다 - 팝업은 「지금 봐라」이고, 띠는 「아직 안 끝났다」입니다.
 */
const POPUP_SEC = 20;

/**
 * 화면 위쪽에 뜨는 노란 쪽지.
 *
 * 예전에는 화면을 통째로 덮는 큰 팝업이었습니다. 하원 시각은 몰려 있어서 20초 안에 다른
 * 아이가 또 걸리는데, 그때마다 새 팝업이 뜨면 앞의 아이가 지워지고 화면이 깜빡였습니다.
 * 그리고 팝업이 떠 있는 동안에는 시간표도 오늘 변동사항도 못 봅니다.
 *
 * 그래서 **덮지 않고 위쪽에 얹습니다.** 아이가 늘면 쪽지에 줄만 늘어나고, 아이마다 자기
 * 20초를 따로 세다가 다 센 줄부터 하나씩 빠집니다.
 */
export function PickupToast({
  items,
  onClose,
}: {
  items: {
    name: string;
    time: string | null;
    grade?: string | null;
    className?: string | null;
    left: number;
    lesson: { subjectName: string; room?: string | null } | null;
    room: string | null;
    until: number;
    /** 학생 특이사항이면 종류와 내용. 하원 건에는 없습니다. */
    noteKind?: string | null;
    note?: string | null;
  }[];
  onClose: () => void;
}) {
  return (
    // 자리는 바깥(PickupAlarm)이 잡습니다 - 예전에는 여기서도 따로 화면에 못박아서, 띠와
    // 팝업이 같은 자리에 겹쳐 떴습니다.
    <div style={{ maxWidth: "min(92vw, 760px)", pointerEvents: "auto" }}>
      <div
        onClick={onClose}
        style={{
          borderRadius: 18,
          border: "3px solid #f59e0b",
          background: "#fef3c7",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          padding: "12px 18px",
          cursor: "pointer",
        }}
        title="누르면 닫힙니다"
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: "#92400e", marginBottom: 6 }}>
          {items.every((i) => !i.note) ? "🔔 곧 하원" : items.some((i) => !i.note) ? "🔔 곧 할 일" : "🔔 곧 챙길 것"}
          {items.length > 1 ? ` · ${items.length}건` : ""}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((p, i) => {
            const where = p.lesson
              ? `${p.lesson.subjectName}${p.lesson.room ? ` · ${p.lesson.room}` : p.room ? ` · ${p.room}` : ""}`
              : p.room
                ? `교실 ${p.room}`
                : "지금 수업 없음";
            return (
              <div key={i} style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 10px" }}>
                <b style={{ fontSize: 24, fontWeight: 900, color: "#b45309", fontVariantNumeric: "tabular-nums" }}>
                  {p.time ?? "시각 미정"}
                </b>
                {/* 이름 - 이 쪽지에서 가장 큰 글자. */}
                {/* **이름은 절대 줄이지 않습니다.** 가려지면 누구를 데려오는지 모릅니다. */}
                <b style={{ fontSize: 30, fontWeight: 900, color: "#111827", lineHeight: 1.1, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {p.name}
                </b>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#78350f" }}>
                  {[p.grade ? `${p.grade}학년` : null, p.className].filter(Boolean).join(" ") || "반 미확인"}
                </span>
                {/* **무엇을 해야 하는가**가 이름 다음입니다. 특이사항은 이름만 알면 못 움직입니다. */}
                {p.note && (
                  <span style={{ fontSize: 20, fontWeight: 900, color: "#9f1239" }}>
                    {p.noteKind} · {p.note}
                  </span>
                )}
                {/* 어디로 가야 하는가. 이름만 알면 못 움직입니다. */}
                <span style={{ fontSize: 18, fontWeight: 900, color: "#a16207" }}>📍 {where}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                  {p.left > 0 ? `${p.left}분 뒤` : "지금"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PickupAlarm({ sc, data, nowMin }: { sc: BoardScale; data: BoardData; nowMin: number }) {
  // 「시각이 정해진 하원」은 학부모 연락뿐이 아닙니다. 매주 같은 요일 14:40 에 학원차가
  // 오는 아이도 그 시각에 내려보내야 합니다. 알릴 때를 아는 것은 **시각이 적혀 있는가**
  // 하나뿐이라, 두 갈래를 여기서 한 줄로 세웁니다.
  const timed = [
    ...data.pickups.map((p) => ({ ...p, noteKind: null as string | null, note: null as string | null })),
    ...(data.dismissalToday ?? []).map((d) => ({
      name: d.name,
      time: d.time,
      grade: null as string | null,
      className: d.className,
      classId: d.classId ?? null,
      source: undefined,
      unmatched: false,
      plan: [d.kind, d.label].filter(Boolean).join(" · "),
      noteKind: null as string | null,
      note: null as string | null,
    })),
    // 「12:40 서후 약」처럼 **시각이 적힌 학생 특이사항**. 알릴 때를 아는 기준은 하나뿐입니다 -
    // 시각이 적혀 있는가. 갈래마다 알람을 따로 만들면 화면이 두 벌 생기고, 한 벌이 틀리면
    // 그쪽만 조용히 안 울립니다.
    //
    // 오늘 것만입니다. 내일 12시에 할 일을 오늘 11시 55분에 울리면 사람이 하루 일찍 움직입니다.
    ...(data.dayNotes ?? [])
      .filter((n) => n.today && n.atTime)
      .map((n) => ({
        name: n.name,
        time: n.atTime,
        grade: null as string | null,
        className: null as string | null,
        classId: n.classId ?? null,
        source: undefined,
        unmatched: false,
        plan: null as string | null,
        noteKind: n.kind,
        note: n.content,
      })),
  ];

  const due = timed
    .map((p) => {
      const m = (p.time ?? "").match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null; // 시각을 모르면 알릴 때도 모릅니다
      const at = Number(m[1]) * 60 + Number(m[2]);
      const left = at - nowMin;
      if (left > ALERT_LEAD_MIN || left < -ALERT_KEEP_MIN) return null;
      const cls = data.grades.flatMap((g) => g.classes).find((c) => c.id === p.classId);
      return { ...p, at, left, lesson: cls?.current ?? null, room: cls?.room ?? null };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.at - b.at);

  // ── 팝업: 창을 넘은 그 순간 한 번 ──────────────────────────────────────
  //
  // 띠는 「아직 안 끝났다」를 계속 보여주고, 팝업은 「지금 봐라」를 한 번만 말합니다. 둘을
  // 같은 것으로 만들면 - 계속 뜨는 팝업 - 사람이 화면을 덮어버리거나 아예 안 봅니다.
  //
  // 한 아이당 하루 한 번. 새로고침해도 다시 뜨지 않게 브라우저에 남깁니다(대시보드는
  // 스스로 새로고침합니다).
  const [stack, setStack] = useState<((typeof due)[number] & { until: number })[]>([]);
  const shown = useRef<Set<string>>(new Set());

  useEffect(() => {
    // 아직 시각이 안 지난 건만 팝업으로 띄웁니다. 이미 지난 것은 띠로 충분합니다 -
    // 화면을 켜자마자 지난 알림이 팝업으로 쏟아지면 안 됩니다.
    const fresh = due.filter((p) => p.left >= 0 && !shown.current.has(`${p.name}|${p.time}`));
    if (fresh.length === 0) return;
    for (const f of fresh) shown.current.add(`${f.name}|${f.time}`);
    const until = Date.now() + POPUP_SEC * 1000;
    setStack((prev) => [...prev, ...fresh.map((f) => ({ ...f, until }))]);
  }, [due]);

  // 다 센 줄부터 하나씩 뺍니다. 통째로 지우면 방금 올라온 아이까지 같이 사라집니다.
  useEffect(() => {
    if (stack.length === 0) return;
    const t = setInterval(() => setStack((prev) => prev.filter((x) => x.until > Date.now())), 500);
    return () => clearInterval(t);
  }, [stack.length]);

  if (due.length === 0 && stack.length === 0) return null;

  return (
    /**
     * **덮습니다. 밀지 않습니다. 그리고 시간표는 안 가립니다.**
     *
     * 예전에는 이 줄이 흐름 안에 있어서, 알림이 뜨는 순간 시간표와 아래 칸이 통째로 밀려
     * 내려갔습니다. 벽에 걸어두고 하루 종일 보는 화면에서 **레이아웃이 움직이는 것**은
     * 알림보다 더 큰 방해입니다 - 보던 자리를 잃고, 알림이 사라지면 또 한 번 튑니다.
     * 그래서 흐름 밖에 겹쳐 띄웁니다. 뒤의 화면은 한 픽셀도 안 움직입니다.
     *
     * ── 왜 가운데가 아니라 오른쪽인가 ──────────────────────────────────
     *
     * 가운데에 띄웠더니 **시간표 위를 덮었습니다.** 이 화면에서 가장 오래, 가장 자주 보는
     * 것은 시간표입니다 - 「지금 몇 반이 어디서 무슨 수업인지」를 하루 종일 확인하는 자리라,
     * 20초 동안이라도 가려지면 그 사이에 물어보러 온 사람에게 답을 못 합니다.
     *
     * 화면은 왼쪽(시간표)·오른쪽(변동사항·문의) 두 칸입니다. 알림을 **오른쪽 칸 위**에
     * 얹으면 시간표는 한 번도 안 가려지고, 알림이 덮는 것은 「오늘 변동사항」의 윗줄입니다 -
     * 그 줄에 적힌 것이 바로 이 알림이 말하는 그 아이라, 잠깐 가려도 잃는 것이 없습니다.
     *
     * 좁은 화면에서는 칸이 한 줄로 쌓이므로 가릴 곳을 고를 수 없습니다. 그때는 가운데입니다.
     */
    <div
      style={{
        position: "fixed",
        top: sc.s(14, 8),
        ...(sc.narrow
          ? { left: "50%", transform: "translateX(-50%)" }
          : // 오른쪽 절반 안에서만. 왼쪽 절반(시간표)에는 한 픽셀도 걸치지 않습니다.
            { left: "50%", right: sc.s(12, 6), transform: "none", alignItems: "flex-end" }),
        zIndex: 9000,
        display: "flex",
        flexDirection: "column",
        gap: sc.s(6, 4),
        // 오른쪽 배치일 때는 left/right 가 폭을 정하므로 max-content 를 쓰지 않습니다 -
        // 쓰면 긴 줄 하나가 칸 밖으로 삐져나가 시간표 위로 넘어옵니다.
        ...(sc.narrow ? { width: "max-content", maxWidth: "min(92vw, 900px)" } : { maxWidth: "100%" }),
        pointerEvents: "none",
      }}
    >
      {stack.length > 0 && <PickupToast items={stack} onClose={() => setStack([])} />}
      {due.map((p, i) => {
        const late = p.left < 0;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: `${sc.s(6, 4)}px ${sc.s(16, 10)}px`,
              background: late ? "#7f1d1d" : "#0c4a6e",
              border: `2px solid ${late ? "#ef4444" : "#38bdf8"}`,
              borderRadius: sc.s(14, 8),
              padding: `${sc.s(10, 6)}px ${sc.s(16, 10)}px`,
              animation: "opsPickupPulse 1.6s ease-in-out infinite",
              // 겹쳐 뜨므로 그림자가 있어야 뒤 화면과 갈립니다. 평평하면 시간표의 일부로
              // 읽힙니다.
              boxShadow: "0 10px 34px rgba(0,0,0,0.5)",
            }}
          >
            <span style={{ fontSize: sc.s(28, 18), fontWeight: 900, color: late ? "#fecaca" : "#7dd3fc" }}>
              {late ? "🔔 지금" : `🔔 ${p.left}분 뒤`}
            </span>
            <span
              style={{ fontSize: sc.s(34, 22), fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums" }}
            >
              {p.time}
            </span>
            <span style={{ fontSize: sc.s(30, 20), fontWeight: 900, color: "#fff" }}>{p.name}</span>
            {/* 무엇을 하러 가는지. 하원은 이 띠의 기본값이라 따로 안 적고, 특이사항만
                종류와 내용을 붙입니다 - 「약」과 「하원」은 하는 일이 다릅니다. */}
            {p.note && (
              <span style={{ fontSize: sc.s(24, 16), fontWeight: 900, color: late ? "#fecaca" : "#fde68a" }}>
                {p.noteKind} · {p.note}
              </span>
            )}
            <span style={{ fontSize: sc.s(20, 14), fontWeight: 700, color: late ? "#fca5a5" : "#bae6fd" }}>
              {[p.grade ? `${p.grade}학년` : null, p.className].filter(Boolean).join(" ") || "반 미확인"}
            </span>
            {/* 지금 어디 있나. 수업이 없으면 교실 위치라도 적습니다 - 빈손으로 보내지 않습니다. */}
            <span style={{ fontSize: sc.s(20, 14), color: "#e0f2fe", marginLeft: "auto" }}>
              {p.lesson
                ? `지금 ${p.lesson.subjectName}${p.lesson.room ? ` · ${p.lesson.room}` : p.room ? ` · ${p.room}` : ""}`
                : p.room
                ? `교실 ${p.room}`
                : "지금 수업 없음"}
            </span>
          </div>
        );
      })}
      <style>{"@keyframes opsPickupPulse{0%,100%{opacity:1}50%{opacity:.72}}"}</style>
    </div>
  );
}
