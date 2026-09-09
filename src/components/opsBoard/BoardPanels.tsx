"use client";

import { useState } from "react";
import type { BoardScale } from "@/lib/useBoardDensity";
import { lessonPlace } from "@/lib/lessonLocation";
import { BoardData, STATUS_COLOR, WEEKDAY_KO, btn, dayRange, shortName } from "./boardShared";

/**
 * 대시보드의 **칸들** — 밤 정보, 교실 쪽지, 확인대기 인박스, 오늘 변동사항, 그리고 이 칸들을
 * 담는 틀(Panel·Empty).
 *
 * 하나하나가 독립된 위젯이라 서로 모르고, 본체는 자료만 넘겨줍니다.
 */

// grow를 주면 남는 세로 공간을 그 비율만큼 가져가고, 내용이 넘치면 패널 안에서만 스크롤됩니다.
// 패널이 커져서 아래 패널을 화면 밖으로 밀어내는 일이 없어집니다 - 대시보드는 아무도 스크롤하지
// 않기 때문에, 밀려난 정보는 없는 것과 같습니다.
// 하원 시작~다음날 아침에 시간표 자리에 띄우는 학교 정보·학사일정 패널(요청). 밤에는 시간표가
// 쓸모없으므로, 대신 "오늘의 학교 요약"과 이번 달 학사일정 달력을 보여줍니다.
export function NightInfoPanel({ sc, data }: { sc: BoardScale; data: BoardData }) {
  const events = data.nightInfo?.events ?? [];
  const reports = data.nightInfo?.reportsThisWeek ?? 0;
  const absent = data.absences.filter((a) => a.status === "결석").length;
  const late = data.absences.filter((a) => a.status === "지각").length;
  const pickupCount = data.pickups.length;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDate = now.getDate();
  const startDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const eventByDay = new Map<number, string>();
  for (const e of events) {
    const d = new Date(e.date + "T00:00:00");
    if (d.getFullYear() === year && d.getMonth() === month) eventByDay.set(d.getDate(), e.name);
  }
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

  const stat = (label: string, value: number | string, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "#0c1729", borderRadius: sc.s(10, 6), padding: `${sc.s(8, 5)}px ${sc.s(10, 6)}px`, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: sc.s(22, 15), fontWeight: 900, color }}>{value}</span>
      <span style={{ fontSize: sc.s(12, 9), color: "#94a3b8", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );

  return (
    <div style={{ background: "#111c33", borderRadius: sc.s(14, 8), padding: sc.s(12, 7), display: "flex", flexDirection: "column", minHeight: 0, flex: "6 1 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(8, 5), flexShrink: 0 }}>
        <h2 style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#e2e8f0", margin: 0 }}>🌙 오늘의 학교 · 학사일정</h2>
        <span style={{ fontSize: sc.s(13, 10), color: "#64748b", marginLeft: "auto" }}>
          {year}년 {month + 1}월
        </span>
      </div>
      <div style={{ minHeight: 0, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column", gap: sc.s(10, 6) }}>
        {/* 오늘 학교 요약 */}
        <div style={{ display: "flex", gap: sc.s(8, 5), flexShrink: 0 }}>
          {stat("재적", data.studentCount, "#e2e8f0")}
          {stat("결석", absent, "#f87171")}
          {stat("지각", late, "#fb923c")}
          {stat("하원 픽업", pickupCount, "#38bdf8")}
          {stat("이번주 리포트", reports, "#34d399")}
        </div>

        {/* 이번 달 학사일정 달력 */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: sc.s(10, 6) }}>
          <div style={{ flex: 3, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
              {weekdayLabels.map((w, i) => (
                <div key={w} style={{ textAlign: "center", fontSize: sc.s(11, 9), fontWeight: 700, color: i === 0 ? "#f87171" : i === 6 ? "#60a5fa" : "#64748b" }}>{w}</div>
              ))}
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "1fr", gap: 2 }}>
              {cells.map((d, i) => {
                const isToday = d === todayDate;
                const hasEvent = d != null && eventByDay.has(d);
                return (
                  <div
                    key={i}
                    title={hasEvent ? eventByDay.get(d as number) : undefined}
                    style={{
                      borderRadius: sc.s(7, 5),
                      background: isToday ? "#2563eb" : hasEvent ? "#1e3a5f" : "#0c1729",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      minHeight: 0, padding: 2,
                    }}
                  >
                    {d != null && (
                      <>
                        <span style={{ fontSize: sc.s(13, 10), fontWeight: isToday ? 900 : 600, color: isToday ? "#fff" : hasEvent ? "#bfdbfe" : "#94a3b8" }}>{d}</span>
                        {hasEvent && <span style={{ width: sc.s(5, 4), height: sc.s(5, 4), borderRadius: 999, background: "#38bdf8", marginTop: 1 }} />}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* 다가오는 학사일정 목록 */}
          <div style={{ flex: 2, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: sc.s(4, 3) }}>
            <span style={{ fontSize: sc.s(13, 10), fontWeight: 700, color: "#cbd5e1" }}>다가오는 일정</span>
            {events.length === 0 ? (
              <span style={{ fontSize: sc.s(12, 10), color: "#475569" }}>등록된 학사일정이 없습니다</span>
            ) : (
              events.slice(0, 7).map((e, i) => {
                const d = new Date(e.date + "T00:00:00");
                return (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", gap: sc.s(6, 4), background: "#0c1729", borderRadius: sc.s(7, 5), padding: `${sc.s(4, 3)}px ${sc.s(8, 5)}px` }}>
                    <span style={{ fontSize: sc.s(12, 10), fontWeight: 800, color: "#38bdf8", whiteSpace: "nowrap" }}>{d.getMonth() + 1}/{d.getDate()}</span>
                    <span style={{ fontSize: sc.s(13, 10), color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 교실에서 온 것 - 특이사항·문의.
//
// 행정실이 실제로 보고 있는 화면이 이것이라 여기 띄웁니다. 다른 화면에 로그인해야 처리할 수
// 있다면 그 한 단계 때문에 «나중에»가 되고, 선생님 화면에는 영영 «보냄»으로 남습니다.
//
// **반 이름이 가장 큽니다.** 행정실이 먼저 아는 것은 «무슨 일»이 아니라 «어느 교실»입니다 -
// 그리로 가야 하니까요. 반 이름은 이미 영문 코드(G2C·G3JU)라 한국인·외국인 직원이 같은
// 글자를 읽습니다.
//
// 누르면 그 순간 교실 화면에 «읽음 15:32»가 뜹니다. 보냈다와 받았다를 잇는 유일한 자리입니다.
const QUICK_REPLY = ["확인했습니다", "곧 가겠습니다", "학부모에 연락합니다", "잠시만 기다려주세요"];

export function ClassroomNotes({
  sc,
  items,
  onAct,
}: {
  sc: BoardScale;
  items: NonNullable<BoardData["classroomNotes"]>;
  onAct: (id: string, patch: { reply?: string; done?: boolean }) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return null;
  const unread = items.filter((n) => !n.readAt);

  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: sc.s(6, 4) }}>
      {items.slice(0, 4).map((n) => {
        const isOpen = open === n.id;
        return (
          <div
            key={n.id}
            style={{
              background: n.readAt ? "#132033" : n.urgent ? "#3b1414" : "#13253a",
              border: `2px solid ${n.readAt ? "#1e293b" : n.urgent ? "#ef4444" : "#0ea5e9"}`,
              borderRadius: sc.s(12, 7),
              padding: `${sc.s(9, 6)}px ${sc.s(14, 9)}px`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: `${sc.s(5, 3)}px ${sc.s(14, 9)}px` }}>
              {/* 어느 교실인가 - 가장 크게. */}
              <span
                style={{
                  fontSize: sc.s(30, 20),
                  fontWeight: 900,
                  color: n.readAt ? "#94a3b8" : "#fff",
                  background: n.readAt ? "transparent" : n.urgent ? "#7f1d1d" : "#0c4a6e",
                  borderRadius: sc.s(8, 5),
                  padding: n.readAt ? 0 : `${sc.s(2, 1)}px ${sc.s(10, 6)}px`,
                  letterSpacing: 0.5,
                }}
              >
                {n.className}
              </span>
              <span style={{ fontSize: sc.s(16, 12), fontWeight: 800, color: n.urgent ? "#fca5a5" : "#7dd3fc" }}>
                {n.urgent ? "🔴 급함" : n.kind === "문의" ? "❓ 문의" : "🩹 특이사항"}
              </span>
              {n.studentName && <b style={{ fontSize: sc.s(22, 15), color: "#fff" }}>{n.studentName}</b>}
              <span style={{ fontSize: sc.s(20, 14), color: "#e2e8f0" }}>{n.body}</span>
              <span style={{ fontSize: sc.s(14, 11), color: "#64748b", marginLeft: "auto" }}>
                {new Date(n.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                {n.readAt ? " · 읽음" : ""}
              </span>
            </div>

            {n.reply && <p style={{ margin: `${sc.s(4, 2)}px 0 0`, fontSize: sc.s(16, 12), color: "#7dd3fc" }}>↩ {n.reply}</p>}

            <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(6, 4), marginTop: sc.s(7, 5) }}>
              {!n.readAt && (
                <button type="button" onClick={() => onAct(n.id, {})} style={btn(sc, "#0284c7")}>
                  읽음
                </button>
              )}
              <button type="button" onClick={() => setOpen(isOpen ? null : n.id)} style={btn(sc, "#334155")}>
                답 보내기
              </button>
              <button type="button" onClick={() => onAct(n.id, { done: true })} style={btn(sc, "#166534")}>
                처리 완료
              </button>
            </div>

            {isOpen && (
              /* 벽에 걸린 화면에서 길게 치기 어려워 버튼으로 답합니다. 짧아도 «받았다»가
                 교실에 전해지는 것이 요점입니다. */
              <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(6, 4), marginTop: sc.s(6, 4) }}>
                {QUICK_REPLY.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      onAct(n.id, { reply: r });
                      setOpen(null);
                    }}
                    style={btn(sc, "#1e3a5f")}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {items.length > 4 && (
        <p style={{ margin: 0, fontSize: sc.s(14, 11), color: "#64748b" }}>
          외 {items.length - 4}건 (안 읽은 것 {unread.length}건)
        </p>
      )}
    </div>
  );
}

// 아직 손 안 댄 인박스.
//
// 픽업 요청은 «확인대기»로 들어와서, 사람이 인박스에서 눌러야 하원 체크표로 넘어갑니다.
// 안 누르면 아무 일도 일어나지 않습니다 - 오류도 안 뜨고 화면도 평소와 같고, 그대로 하원
// 시각이 옵니다. 그래서 «없음»을 조용히 넘기지 않고 **비었다는 사실도 화면에 적습니다**.
// 비었을 때 아무것도 안 그리면, 위젯이 고장 나서 안 뜨는 것과 구별되지 않습니다.
export function PendingInbox({ sc, items }: { sc: BoardScale; items: { name: string; date: string | null; time: string | null; today: boolean }[] }) {
  const todayItems = items.filter((i) => i.today);
  const later = items.filter((i) => !i.today);

  if (items.length === 0) {
    return (
      <div
        style={{
          background: "#0f1f1a",
          border: "1px solid #14532d",
          borderRadius: sc.s(12, 7),
          padding: `${sc.s(7, 5)}px ${sc.s(12, 7)}px`,
          fontSize: sc.s(14, 11),
          color: "#4ade80",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        ✓ 인박스 비었습니다 — 확인할 픽업 요청 없음
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#2a1a0c",
        border: `1px solid ${todayItems.length > 0 ? "#b45309" : "#78350f"}`,
        borderRadius: sc.s(12, 7),
        padding: sc.s(10, 6),
        flexShrink: 0,
        maxHeight: sc.s(112, 82),
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(6, 4) }}>
        <span style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#fbbf24" }}>⚠ 확인 필요 {items.length}건</span>
        <span style={{ fontSize: sc.s(12, 10), color: "#a16207" }}>
          {todayItems.length > 0 ? `오늘 ${todayItems.length}건` : "오늘 것은 없음"}
        </span>
        <span style={{ fontSize: sc.s(12, 10), color: "#a16207", marginLeft: "auto" }}>[픽업 인박스]에서 확인해주세요</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(5, 3) }}>
        {items.slice(0, 10).map((it, i) => (
          <span
            key={i}
            title={[it.name, it.date ?? "날짜 미정", it.time].filter(Boolean).join(" · ")}
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: sc.s(5, 3),
              background: it.today ? "#422006" : "#1c1508",
              borderRadius: 6,
              padding: `${sc.s(3, 2)}px ${sc.s(8, 5)}px`,
              fontSize: sc.s(16, 12),
              whiteSpace: "nowrap",
            }}
          >
            <b style={{ color: it.today ? "#fde68a" : "#a8a29e" }}>{shortName(it.name)}</b>
            <span style={{ fontSize: sc.s(14, 10), color: "#a16207" }}>
              {/* 오늘 것은 시각만, 앞날 것은 날짜(월-일)만. 오늘 화면에서 «내일 건»이
                  오늘 것처럼 읽히면 사람이 헛걸음합니다. */}
              {it.today ? (it.time ?? "시각 미정") : it.date ? it.date.slice(5).replace("-", "/") : "날짜 미정"}
            </span>
          </span>
        ))}
        {items.length > 10 && (
          <span style={{ fontSize: sc.s(12, 10), color: "#a16207", alignSelf: "center" }}>외 {items.length - 10}건</span>
        )}
      </div>
      {later.length > 0 && todayItems.length === 0 && (
        <p style={{ margin: `${sc.s(5, 3)}px 0 0`, fontSize: sc.s(11, 9), color: "#78716c" }}>
          모두 앞날 요청입니다 — 오늘 안에 처리하지 않아도 되지만, 미뤄두면 그날 아침에 몰립니다.
        </p>
      )}
    </div>
  );
}

// 오늘 변동사항 - 픽업(시각이 주인공) + 결석·지각(작은 배지).
//
// 예전에는 결석·지각·픽업을 같은 크기로 셋에 나눠 담았습니다. 그런데 이 셋은 화면 앞에 선
// 사람이 해야 할 일이 다릅니다. 픽업은 **정해진 시각에 교실에서 아이를 데려와야** 하므로
// 시각이 없으면 움직일 수 없고, 결석·지각은 이미 지난 일이라 "그런 아이가 있다"만 알면
// 됩니다. 그래서 픽업만 크게 시각 순으로 세우고, 나머지는 배지로 줄였습니다.
//
// 시각이 안 적힌 픽업은 빼지 않고 "시각 미정"으로 남깁니다 - 연락은 왔는데 시각만 모르는
// 것이고, 그건 오히려 물어봐야 할 건입니다.
export function TodayChanges({ sc, data }: { sc: BoardScale; data: BoardData }) {
  const absent = data.absences.filter((a) => a.status === "결석");
  const late = data.absences.filter((a) => a.status !== "결석");
  const pickups = data.pickups;
  const upcoming = data.upcoming ?? [];
  const dismissal = data.dismissalToday ?? [];
  // 앞으로 예약된 하원. 결석 「예정」과 **같은 자리**에 세웁니다 - 사람이 앞날을 확인하는
  // 자리는 하나여야 합니다. 두 곳이면 한 곳만 보고 다른 곳을 놓칩니다.
  const dismissalAhead = data.dismissalAhead ?? [];
  const aheadCount = upcoming.length + dismissalAhead.length;
  // 화면에 실제로 세운 개수. 「외 N건」을 어림으로 적으면 숫자가 맞지 않고, 맞지 않는
  // 숫자는 목록 전체를 못 믿게 만듭니다.
  const aheadShown = Math.min(dismissalAhead.length, 8) + Math.min(upcoming.length, 8);

  return (
    <div style={{ flexShrink: 0, minHeight: 0 }}>
      {/* 예정된 변동사항 - 맨 위.
          「이연우 9/21~23 결석」처럼 미리 알려온 건은 등록만 되어 있고 그날이 와야 화면에
          떴습니다. 그때까지는 아무 데도 안 보여서 정작 그날 아침에 «몰랐다»가 됩니다.
          위에 세워두면 며칠 전부터 모두가 눈에 담습니다.

          지우는 일은 사람이 하지 않습니다 - 시작일이 되면 아래 오늘 명단으로 넘어가고
          여기서는 저절로 빠집니다. 사람이 지워야 하는 목록은 언젠가 안 지워집니다. */}
      {aheadCount > 0 && (
        <div
          style={{
            background: "#1a1330",
            border: "1px solid #4c1d95",
            borderRadius: sc.s(10, 6),
            padding: sc.s(8, 5),
            marginBottom: sc.s(9, 6),
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(7, 4), marginBottom: sc.s(5, 3) }}>
            <span style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#c4b5fd" }}>📌 예정 {aheadCount}건</span>
            <span style={{ fontSize: sc.s(13, 10), color: "#7c6ba8" }}>미리 알려온 건 · 그날이 되면 아래로 내려옵니다</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(5, 3) }}>
            {/* 예약된 하원 - 「다음 주 화요일만 할머니가 데리러 갑니다」. 넣어두면 그날
                아침까지 아무 데도 안 보이던 것을 며칠 전부터 세워둡니다. */}
            {dismissalAhead.slice(0, 8).map((d, i) => (
              <span
                key={`d${i}`}
                title={[d.name, d.className, d.kind, d.label, d.date].filter(Boolean).join(" · ")}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: sc.s(5, 3),
                  background: "#2a1f4d",
                  border: "1px solid #6d28d9",
                  borderRadius: 6,
                  padding: `${sc.s(3, 2)}px ${sc.s(8, 5)}px`,
                  fontSize: sc.s(17, 12),
                  whiteSpace: "nowrap",
                }}
              >
                <b style={{ color: "#ddd6fe" }}>{shortName(d.name)}</b>
                <span style={{ color: "#a78bfa", fontWeight: 700 }}>{d.label || d.kind}</span>
                <span style={{ fontSize: sc.s(15, 11), color: "#8b7bb8", fontVariantNumeric: "tabular-nums" }}>
                  {dayRange(d.date, d.date)}
                  {d.time ? ` ${d.time}` : ""}
                </span>
              </span>
            ))}
            {upcoming.slice(0, 8).map((u, i) => (
              <span
                key={i}
                title={[u.name, u.status, `${u.from}~${u.to}`, u.note].filter(Boolean).join(" · ")}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: sc.s(5, 3),
                  background: "#2a1f4d",
                  borderRadius: 6,
                  padding: `${sc.s(3, 2)}px ${sc.s(8, 5)}px`,
                  fontSize: sc.s(17, 12),
                  whiteSpace: "nowrap",
                }}
              >
                <b style={{ color: "#ddd6fe" }}>{shortName(u.name)}</b>
                <span style={{ color: "#a78bfa", fontWeight: 700 }}>{u.status}</span>
                <span style={{ fontSize: sc.s(15, 11), color: "#8b7bb8" }}>{dayRange(u.from, u.to)}</span>
              </span>
            ))}
            {aheadCount > aheadShown && (
              <span style={{ fontSize: sc.s(14, 11), color: "#7c6ba8", alignSelf: "center" }}>외 {aheadCount - aheadShown}건</span>
            )}
          </div>
        </div>
      )}

      {/* 픽업 - 시각이 먼저, 이름이 뒤. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(7, 4), marginBottom: sc.s(6, 4) }}>
        <span style={{ width: sc.s(9, 7), height: sc.s(9, 7), borderRadius: 3, background: "#0ea5e9" }} />
        <span style={{ fontSize: sc.s(18, 13), fontWeight: 800, color: "#38bdf8" }}>하원 픽업 {pickups.length}</span>
      </div>

      {pickups.length === 0 ? (
        <p style={{ margin: 0, fontSize: sc.s(16, 12), color: "#475569" }}>오늘은 전원 차량 하원</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${sc.s(180, 122)}px, 1fr))`,
            gap: sc.s(6, 4),
            maxHeight: sc.s(196, 132),
            overflow: "hidden",
          }}
        >
          {pickups.slice(0, 10).map((p, i) => (
            <div
              key={i}
              title={p.name}
              style={{
                display: "flex",
                // 세로로 두 줄. 윗줄은 시각과 이름, 아랫줄은 무슨 차인지입니다.
                // 한 줄에 다 넣었더니 차 이름이 자리를 먹어 **이름이 잘렸습니다.** 이름이
                // 가려지면 이 목록은 있으나 마나입니다 - 누구를 데려오는지 모르니까요.
                flexDirection: "column",
                gap: sc.s(2, 1),
                background: "#0c2233",
                borderLeft: `${sc.s(5, 3)}px solid #0ea5e9`,
                borderRadius: sc.s(8, 5),
                padding: `${sc.s(6, 4)}px ${sc.s(9, 6)}px`,
              }}
            >
            <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(7, 4) }}>
              <b
                style={{
                  fontSize: p.time ? sc.s(31, 20) : sc.s(17, 12),
                  fontWeight: 900,
                  color: p.time ? "#7dd3fc" : "#64748b",
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {p.time ?? "시각 미정"}
              </b>
              {/* **이름은 절대 줄이지 않습니다.** 줄바꿈도 말줄임도 없습니다 - 이름이
                  가려지면 누구를 데려오는지 모르고, 그러면 이 목록이 있을 이유가 없습니다.
                  칸이 모자라면 카드가 넓어지고, 목록이 아래로 흐릅니다. */}
              <span
                style={{
                  fontSize: sc.s(21, 14),
                  fontWeight: 700,
                  color: "#fff",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {shortName(p.name)}
              </span>
              {/* 명부와 못 이은 건. 조용히 빼면 아무도 데리러 가지 않으므로 올리되,
                  「확인해야 하는 줄」이라고 눈에 띄게 적습니다. */}
              {p.unmatched && (
                <span
                  style={{
                    fontSize: sc.s(12, 9),
                    fontWeight: 800,
                    color: "#fca5a5",
                    whiteSpace: "nowrap",
                  }}
                  title="학부모 연락은 왔는데 명부의 어느 학생인지 아직 잇지 못했습니다. 픽업 인박스에서 학생을 골라주세요."
                >
                  학생 미연결
                </span>
              )}
            </div>
              {/* 무슨 차인지. 학교 앞에서 타는 것이라 «시각과 차 이름»만 알면 되고, 시각은
                  이미 윗줄에 큽니다. 그래서 아래에 아주 작게 한 줄로만 둡니다. */}
              {p.plan && (
                <span
                  style={{
                    fontSize: sc.s(12, 9),
                    fontWeight: 700,
                    color: "#a78bfa",
                    whiteSpace: "nowrap",
                  }}
                  title={`평소 하원수단: ${p.plan}`}
                >
                  🚐 {p.plan}
                </span>
              )}
            </div>
          ))}
          {pickups.length > 10 && (
            <div style={{ display: "flex", alignItems: "center", fontSize: sc.s(15, 11), color: "#64748b" }}>
              외 {pickups.length - 10}명
            </div>
          )}
        </div>
      )}

      {/* 오늘 학원차·보호자 하원.
          매주 같은 요일에 학원 차를 타는 아이가 있습니다. 셔틀을 안 타니 하원 체크표에 줄이
          없고, 학사일정도 아니라 달력에도 안 뜹니다. **반복되는 일이라 오히려 잊힙니다** -
          «오늘도 있다»고 말해주는 자리가 없으면 어느 주에 그냥 지나갑니다. */}
      {dismissal.length > 0 && (
        <div style={{ marginTop: sc.s(9, 6) }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(7, 4), marginBottom: sc.s(5, 3) }}>
            <span style={{ width: sc.s(9, 7), height: sc.s(9, 7), borderRadius: 3, background: "#a3e635" }} />
            <span style={{ fontSize: sc.s(16, 12), fontWeight: 800, color: "#bef264" }}>학원차·보호자 하원 {dismissal.length}</span>
            <span style={{ fontSize: sc.s(12, 10), color: "#65a30d" }}>매주 이 요일</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(5, 3) }}>
            {dismissal.slice(0, 10).map((d, i) => (
              <span
                key={i}
                title={[d.name, d.className, d.kind, d.label, d.note].filter(Boolean).join(" · ")}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: sc.s(6, 4),
                  background: "#1a2410",
                  border: "1px solid #3f6212",
                  borderRadius: sc.s(8, 5),
                  padding: `${sc.s(4, 2)}px ${sc.s(9, 6)}px`,
                  fontSize: sc.s(17, 12),
                  whiteSpace: "nowrap",
                }}
              >
                <b style={{ fontSize: sc.s(20, 14), color: "#d9f99d", fontVariantNumeric: "tabular-nums" }}>
                  {d.time ?? "시각 미정"}
                </b>
                <b style={{ color: "#fff" }}>{shortName(d.name)}</b>
                <span style={{ fontSize: sc.s(15, 11), color: "#a3e635" }}>{d.label || d.kind}</span>
              </span>
            ))}
            {dismissal.length > 10 && (
              <span style={{ fontSize: sc.s(15, 11), color: "#65a30d", alignSelf: "center" }}>외 {dismissal.length - 10}명</span>
            )}
          </div>
        </div>
      )}

      {/* 결석·지각 - 배지로만. 여기 있는 아이 때문에 지금 할 일은 없습니다. */}
      {(absent.length > 0 || late.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: sc.s(5, 3), marginTop: sc.s(8, 5) }}>
          {absent.length > 0 && (
            <span style={{ fontSize: sc.s(15, 11), fontWeight: 800, color: "#f87171" }}>결석 {absent.length}</span>
          )}
          {absent.map((a, i) => (
            <span
              key={`a${i}`}
              title={[a.name, a.note].filter(Boolean).join(" · ")}
              style={{
                background: "#2a1414",
                border: "1px solid #7f1d1d",
                borderRadius: 999,
                padding: `${sc.s(2, 1)}px ${sc.s(8, 5)}px`,
                fontSize: sc.s(16, 12),
                color: "#fecaca",
                whiteSpace: "nowrap",
              }}
            >
              {shortName(a.name)}
            </span>
          ))}
          {late.length > 0 && (
            <span style={{ fontSize: sc.s(15, 11), fontWeight: 800, color: "#fbbf24", marginLeft: sc.s(6, 4) }}>
              지각·조퇴 {late.length}
            </span>
          )}
          {late.map((a, i) => (
            <span
              key={`l${i}`}
              title={[a.name, a.status, a.note].filter(Boolean).join(" · ")}
              style={{
                background: "#2a2110",
                border: "1px solid #92400e",
                borderRadius: 999,
                padding: `${sc.s(2, 1)}px ${sc.s(8, 5)}px`,
                fontSize: sc.s(16, 12),
                color: "#fde68a",
                whiteSpace: "nowrap",
              }}
            >
              {shortName(a.name)}
              {a.status === "조퇴" ? " 조퇴" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  sc,
  grow,
  fixedHeight,
}: {
  title: string;
  right?: string | null;
  children: React.ReactNode;
  sc: BoardScale;
  grow?: number;
  /** 높이를 못 박습니다(시간표처럼 내용이 늘어도 칸 크기가 흔들리면 안 되는 위젯용). */
  fixedHeight?: number;
}) {
  return (
    <div
      style={{
        background: "#111c33",
        borderRadius: sc.s(14, 8),
        padding: sc.s(12, 7),
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...(fixedHeight ? { height: fixedHeight, flex: "0 0 auto" } : grow ? { flex: `${grow} 1 0` } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(8, 5), flexShrink: 0 }}>
        <h2 style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#e2e8f0", margin: 0 }}>{title}</h2>
        {right && <span style={{ fontSize: sc.s(13, 10), color: "#64748b", marginLeft: "auto", textAlign: "right" }}>{right}</span>}
      </div>
      {/* 요청: "공용모니터에 연결한거라 스크롤이 되면 내릴사람이 없어, 때문에 스크롤안되게"
          스크롤을 막으면 넘치는 것은 잘립니다. 그래서 각 칸에서 보여줄 개수를 미리 줄여
          애초에 넘치지 않게 했습니다 - 아래에 뭔가 더 있는데 아무도 못 보는 것보다,
          중요한 것부터 화면 안에 들어오게 하는 편이 낫습니다. */}
      <div style={{ minHeight: 0, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

export function Empty({ text, tone, sc }: { text: string; tone?: "good"; sc: BoardScale }) {
  return (
    <p style={{ margin: 0, padding: `${sc.s(10, 5)}px 0`, fontSize: sc.s(16, 12), color: tone === "good" ? "#10b981" : "#475569" }}>{text}</p>
  );
}
