"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DismissalOpsClient from "./DismissalOpsClient";
import { VISIBLE_DEPARTMENTS } from "@/lib/department";
import { useKstClock } from "@/lib/useKstClock";
import { useFullscreen } from "@/lib/useFullscreen";

// 요청: "gia운영에 있는 업무 탭을 사무실 가운데에 큰 모니터에 띄워서 전체가 한눈에 보고 파악할
// 수 있는 통합 대시보드... 페이지를 반으로 나눠서 한쪽은 cctv 그리고 한쪽은 우리 gia운영 앱"
//
// 이 화면은 그 "운영앱 쪽 절반"입니다. CCTV는 노트북에서 따로 띄우고, 이 페이지는 브라우저
// 창 하나로 화면 절반을 채우는 방식이라 가로폭이 좁아도 읽히도록 세로로 쌓는 배치를 씁니다.
// 멀리서 보는 화면이라 글자를 크게 잡았습니다.
//
// 오후 4시(설정값)가 되면 요청대로 이 절반이 통째로 하원 차량 화면으로 바뀝니다.

const POLL_MS = 30_000;

type Lesson = { subjectName: string; teacherName: string | null; room: string | null };
type BoardData = {
  label: string;
  department: string;
  today: string;
  nowLabel: string;
  isWeekday: boolean;
  currentPeriod: { id: string; label: string; startTime: string; endTime: string } | null;
  nextPeriod: { id: string; label: string; startTime: string; endTime: string } | null;
  grades: {
    grade: string;
    classes: { id: string; className: string; homeroom: string | null; room: string | null; current: Lesson | null; next: Lesson | null }[];
  }[];
  studentCount: number;
  absences: { name: string; grade: string | null; className: string | null; status: string; note: string | null; contacted: boolean }[];
  pickups: string[];
  taskSummary: {
    statusCounts: Record<string, number>;
    todayTasks: { title: string; status: string; department: string | null; dueLabel: string | null; urgent: boolean; kind: string }[];
    todayTotal: number;
  };
  shuttle: { mode: boolean; boardToken: string | null; switchLabel: string; endLabel: string };
};

const STATUS_COLOR: Record<string, string> = {
  결석: "#dc2626",
  지각: "#d97706",
  조퇴: "#7c3aed",
  기타: "#64748b",
};

export default function OpsBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  // 요청: "대시보드 분말고 초까지 나오도록" - 1초마다 도는 시계(서버 갱신 주기와 무관).
  const clock = useKstClock();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 부서는 화면에서 바로 바꿀 수 있습니다(요청: "화면에서 유치부,초등부,중고등부 선택할 수
  // 있게"). null이면 링크에 설정된 기본 부서를 씁니다.
  const [department, setDepartment] = useState<string | null>(null);

  // ── 하원 전체화면 ──────────────────────────────────────────────────────────
  // 요청: "하원시간에는 전체화면으로 전환되고 하원종료버튼을 누르거나 종료시간이 되면 다시
  // 화면 되돌리게".
  const { isFullscreen, enter, exit } = useFullscreen();
  // 사람이 [하원 종료]를 누른 날짜(YYYY-MM-DD). 브라우저에 저장해서 새로고침하거나 화면이
  // 저절로 다시 불러와져도 종료 상태가 유지되고, 날짜가 바뀌면 자연스럽게 초기화됩니다.
  const [endedOn, setEndedOn] = useState<string | null>(null);
  // 브라우저가 자동 전체화면을 거절했는지. 거절당했으면 큰 버튼을 띄워 한 번만 눌러달라고 합니다.
  const [needsManualFullscreen, setNeedsManualFullscreen] = useState(false);
  // 같은 하원 시간에 자동 전환을 반복해서 시도하지 않도록 하는 표시입니다.
  const autoTriedRef = useRef(false);

  const endedKey = `opsBoardDismissalEnded:${token}`;
  useEffect(() => {
    try {
      setEndedOn(localStorage.getItem(endedKey));
    } catch {
      // 브라우저 저장소를 못 쓰는 환경 - 종료 상태가 새로고침 후 풀릴 뿐 동작에는 지장 없습니다.
    }
  }, [endedKey]);

  const shuttleMode = !!data && data.shuttle.mode && endedOn !== data.today;

  // 하원 화면으로 바뀌면 전체화면을 시도하고, 끝나면 원래 반반 화면으로 돌려놓습니다.
  useEffect(() => {
    if (shuttleMode) {
      if (autoTriedRef.current) return;
      autoTriedRef.current = true;
      // 브라우저는 "사용자가 방금 누른 직후"가 아니면 전체화면을 거절합니다. 사무실 PC가 크롬
      // 기업정책으로 자동 전체화면을 허용해 뒀다면 여기서 바로 성공하고, 아니면 버튼을 띄웁니다.
      enter().then((ok) => setNeedsManualFullscreen(!ok));
      return;
    }
    autoTriedRef.current = false;
    setNeedsManualFullscreen(false);
    // 종료 시각이 지났거나 [하원 종료]를 눌렀을 때 - 전체화면에서 빠져나오는 것은 브라우저
    // 제약이 없어 완전히 자동으로 됩니다.
    exit();
  }, [shuttleMode, enter, exit]);

  function endDismissal() {
    if (!data) return;
    try {
      localStorage.setItem(endedKey, data.today);
    } catch {
      // 저장 실패해도 아래 상태 변경만으로 이번 세션에서는 종료됩니다.
    }
    setEndedOn(data.today);
  }

  function reopenDismissal() {
    try {
      localStorage.removeItem(endedKey);
    } catch {
      // 무시
    }
    setEndedOn(null);
  }

  const load = useCallback(async () => {
    try {
      const qs = department ? `?department=${encodeURIComponent(department)}` : "";
      const res = await fetch(`/api/ops-board/${token}${qs}`);
      if (!res.ok) {
        setErrorMsg("유효하지 않거나 종료된 링크입니다.");
        return;
      }
      setErrorMsg(null);
      setData((await res.json()) as BoardData);
    } catch {
      setErrorMsg("연결에 실패했습니다. 잠시 후 다시 시도합니다.");
    }
  }, [token, department]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (errorMsg && !data) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#e2e8f0", fontSize: 22 }}>
        {errorMsg}
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#64748b", fontSize: 20 }}>
        불러오는 중...
      </div>
    );
  }

  // 요청: "셔틀시작시간때(4:00)가 되면 화면이 전환되면서 실시간 셔틀 운행지도가 뜨고... 아래쪽에는
  // 아이들이 차량을 다 탑승했는지 하원차량 체크화면이 뜨고" - 설정한 시각이 되면 이 대시보드
  // 전체가 하원 운행 화면(위 지도 + 아래 차량 체크)으로 바뀝니다.
  if (shuttleMode) {
    return (
      <>
        <DismissalOpsClient
          token={token}
          endLabel={data.shuttle.endLabel}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => (isFullscreen ? exit() : enter().then((ok) => setNeedsManualFullscreen(!ok)))}
          onEnd={endDismissal}
        />
        {needsManualFullscreen && !isFullscreen && (
          <FullscreenPrompt
            onClick={() => enter().then((ok) => setNeedsManualFullscreen(!ok))}
            onDismiss={() => setNeedsManualFullscreen(false)}
          />
        )}
      </>
    );
  }

  const absentCount = data.absences.filter((a) => a.status === "결석").length;
  const lateCount = data.absences.filter((a) => a.status === "지각").length;

  return (
    <div style={{ minHeight: "100dvh", background: "#0f172a", color: "#e2e8f0", padding: 16, fontFamily: "sans-serif", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 상단 - 날짜/시각/부서 선택 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{clock ?? data.nowLabel}</span>
        <span style={{ fontSize: 15, color: "#94a3b8" }}>{data.today}</span>
        {/* 오늘 하원을 이미 종료한 경우 - 잘못 눌렀거나 늦게 도착한 차가 있으면 다시 열 수 있게
            합니다. 종료 시각(기본 17:30)이 지나면 이 버튼도 사라집니다. */}
        {data.shuttle.mode && endedOn === data.today && (
          <button
            onClick={reopenDismissal}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid #334155",
              background: "transparent",
              color: "#94a3b8",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🚌 하원 화면 다시 열기
          </button>
        )}
        {/* 지금은 초등부만 운영하므로 선택지가 하나뿐입니다. 고를 것이 없는 버튼은 화면만
            차지하므로, 부서가 둘 이상일 때만 보여줍니다. */}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {(VISIBLE_DEPARTMENTS.length > 1 ? VISIBLE_DEPARTMENTS : []).map((d) => {
            const active = data.department === d;
            return (
              <button
                key={d}
                onClick={() => setDepartment(d)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: "none",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: active ? "#2563eb" : "#1e293b",
                  color: active ? "#fff" : "#94a3b8",
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {/* ① 지금 수업 */}
      <Panel title={data.currentPeriod ? `지금 ${data.currentPeriod.label} (${data.currentPeriod.startTime}~${data.currentPeriod.endTime})` : "수업 시간 아님"}
        right={data.nextPeriod ? `다음 ${data.nextPeriod.label} ${data.nextPeriod.startTime}` : null}>
        {!data.isWeekday ? (
          <Empty text="주말입니다" />
        ) : data.grades.length === 0 ? (
          <Empty text="이 부서에 등록된 반이 없습니다 — [학교 > 반·담임 관리]에서 반을 먼저 만들어주세요" />
        ) : (
          /* 요청: "각 학년과 반별로 어느수업이 진행되는지 뜨도록" - 학년을 왼쪽에 세로로 두고,
             그 학년의 반들을 오른쪽에 가로로 늘어놓아 학년 단위로 훑어볼 수 있게 했습니다. */
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.grades.map((g) => (
              <div key={g.grade || "미지정"} style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
                <div
                  style={{
                    minWidth: 58,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#1e3a5f",
                    borderRadius: 10,
                    fontSize: 17,
                    fontWeight: 800,
                    color: "#bfdbfe",
                    padding: "0 8px",
                  }}
                >
                  {g.grade || "미지정"}
                </div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(138px, 1fr))", gap: 6 }}>
                  {/* 요청: "그냥 지금 어느학년 어느반이 무슨시간인지 한눈에 볼 수있도록만 해주고".
                      반 이름과 지금 과목 두 줄만 남기고 담임·다음교시·담당교사는 뺐습니다 - 멀리서
                      보는 화면에서는 글자가 많을수록 오히려 안 읽힙니다. 수업이 없는 시간에만
                      교실 위치를 대신 보여줍니다(요청: "수업중이 아닐때 교실위치 보여주는 것은 좋고"). */}
                  {g.classes.map((c) => (
                    <div key={c.id} style={{ background: "#1e293b", borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>{c.className}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: c.current ? "#fff" : "#475569", marginTop: 2, lineHeight: 1.15 }}>
                        {c.current?.subjectName ?? (c.room || "—")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ② 오늘 출결 + 픽업 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title={`오늘 출결 · 결석 ${absentCount} 지각 ${lateCount}`} right={`재적 ${data.studentCount}명`}>
          {data.absences.length === 0 ? (
            <Empty text="전원 출석" tone="good" />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.absences.map((a, i) => (
                <span
                  key={i}
                  title={a.note ?? undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "#1e293b",
                    borderLeft: `4px solid ${STATUS_COLOR[a.status] ?? "#64748b"}`,
                    borderRadius: 6,
                    padding: "5px 9px",
                    fontSize: 16,
                  }}
                >
                  <b style={{ color: "#fff" }}>{a.name}</b>
                  <span style={{ fontSize: 12, color: STATUS_COLOR[a.status] ?? "#94a3b8", fontWeight: 700 }}>{a.status}</span>
                  {!a.contacted && <span style={{ fontSize: 11, color: "#f59e0b" }}>연락전</span>}
                </span>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`오늘 하원 픽업 ${data.pickups.length}명`}>
          {data.pickups.length === 0 ? (
            <Empty text="픽업 예정 없음" />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.pickups.map((name, i) => (
                <span key={i} style={{ background: "#1e293b", borderLeft: "4px solid #0ea5e9", borderRadius: 6, padding: "5px 9px", fontSize: 16, color: "#fff", fontWeight: 600 }}>
                  {name}
                </span>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ③ 오늘 업무 */}
      <Panel
        title={`오늘 업무 ${data.taskSummary.todayTotal}건`}
        right={Object.entries(data.taskSummary.statusCounts)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ")}
      >
        {data.taskSummary.todayTasks.length === 0 ? (
          <Empty text="오늘 마감·신규 업무 없음" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.taskSummary.todayTasks.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e293b", borderRadius: 8, padding: "6px 10px" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: t.kind === "지남" ? "#7f1d1d" : t.kind === "마감" ? "#78350f" : "#1e3a8a",
                    color: t.kind === "지남" ? "#fca5a5" : t.kind === "마감" ? "#fcd34d" : "#93c5fd",
                  }}
                >
                  {t.kind}
                </span>
                {t.urgent && <span style={{ fontSize: 13 }}>🔥</span>}
                <span style={{ fontSize: 16, color: "#fff", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.title}
                </span>
                {t.department && <span style={{ fontSize: 12, color: "#64748b" }}>{t.department}</span>}
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div style={{ marginTop: "auto", fontSize: 12, color: "#475569", textAlign: "center" }}>
        {data.label} · 30초마다 자동 갱신 · {data.shuttle.switchLabel}~{data.shuttle.endLabel} 하원 운행 화면(전체화면)
      </div>
    </div>
  );
}

function Panel({ title, right, children }: { title: string; right?: string | null; children: React.ReactNode }) {
  return (
    <div style={{ background: "#111c33", borderRadius: 14, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "#e2e8f0", margin: 0 }}>{title}</h2>
        {right && <span style={{ fontSize: 13, color: "#64748b", marginLeft: "auto" }}>{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ text, tone }: { text: string; tone?: "good" }) {
  return <p style={{ margin: 0, padding: "10px 0", fontSize: 16, color: tone === "good" ? "#10b981" : "#475569" }}>{text}</p>;
}

// 브라우저가 자동 전체화면을 거절했을 때 뜨는 안내입니다.
//
// 아무 웹사이트나 시간이 되면 마음대로 화면을 덮지 못하게 하는 브라우저 규칙 때문에, 전체화면은
// "사람이 방금 누른 직후"에만 시작할 수 있습니다. 그래서 하루 한 번 이 버튼을 눌러주셔야 합니다.
// 반대로 되돌아오는 것은 제약이 없어 종료 시각이 되면 저절로 풀립니다.
//
// 화면 전체를 가리지 않고 오른쪽 아래에 띄웁니다 - 누르지 않아도 하원 화면 자체는 이미 잘 보이고
// 있어서, 급할 때는 그냥 무시하고 반반 화면으로 쓰셔도 됩니다.
function FullscreenPrompt({ onClick, onDismiss }: { onClick: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 60,
        background: "#1d4ed8",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: 420,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>하원 시간입니다 — 전체화면으로 볼까요?</div>
        <div style={{ fontSize: 12, color: "#c7d8ff", marginTop: 2, lineHeight: 1.5 }}>
          브라우저 보안 규칙 때문에 전체화면은 사람이 눌러야 시작됩니다. 종료 시각이 되거나 [하원 종료]를 누르면 저절로 원래
          화면으로 돌아옵니다.
        </div>
      </div>
      <button
        onClick={onClick}
        style={{
          flexShrink: 0,
          background: "#fff",
          color: "#1d4ed8",
          border: "none",
          borderRadius: 10,
          padding: "10px 16px",
          fontSize: 15,
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        전체화면
      </button>
      <button
        onClick={onDismiss}
        title="이번에는 반반 화면으로 두기"
        style={{ flexShrink: 0, background: "transparent", border: "none", color: "#c7d8ff", fontSize: 18, cursor: "pointer" }}
      >
        ✕
      </button>
    </div>
  );
}
