"use client";

import { useCallback, useEffect, useState } from "react";
import ShuttleBoardClient from "@/components/shuttle/ShuttleBoardClient";
import { VISIBLE_DEPARTMENTS } from "@/lib/department";

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
  grades: { grade: string; classes: { id: string; className: string; current: Lesson | null; next: Lesson | null }[] }[];
  studentCount: number;
  absences: { name: string; grade: string | null; className: string | null; status: string; note: string | null; contacted: boolean }[];
  pickups: string[];
  taskSummary: {
    statusCounts: Record<string, number>;
    todayTasks: { title: string; status: string; department: string | null; dueLabel: string | null; urgent: boolean; kind: string }[];
    todayTotal: number;
  };
  shuttle: { mode: boolean; boardToken: string | null; switchLabel: string };
};

const STATUS_COLOR: Record<string, string> = {
  결석: "#dc2626",
  지각: "#d97706",
  조퇴: "#7c3aed",
  기타: "#64748b",
};

export default function OpsBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 부서는 화면에서 바로 바꿀 수 있습니다(요청: "화면에서 유치부,초등부,중고등부 선택할 수
  // 있게"). null이면 링크에 설정된 기본 부서를 씁니다.
  const [department, setDepartment] = useState<string | null>(null);

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

  // 요청: "오후 4시쯤에 하원차량 픽업이 시작되기때문에... 앱쪽 전체가 차량화면으로 전환"
  if (data.shuttle.mode && data.shuttle.boardToken) {
    return <ShuttleBoardClient token={data.shuttle.boardToken} />;
  }

  const absentCount = data.absences.filter((a) => a.status === "결석").length;
  const lateCount = data.absences.filter((a) => a.status === "지각").length;

  return (
    <div style={{ minHeight: "100dvh", background: "#0f172a", color: "#e2e8f0", padding: 16, fontFamily: "sans-serif", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 상단 - 날짜/시각/부서 선택 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: "#fff" }}>{data.nowLabel}</span>
        <span style={{ fontSize: 15, color: "#94a3b8" }}>{data.today}</span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {VISIBLE_DEPARTMENTS.map((d) => {
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
          <Empty text="이 부서에 등록된 반이 없습니다" />
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
                  {g.classes.map((c) => (
                    <div key={c.id} style={{ background: "#1e293b", borderRadius: 10, padding: "7px 10px" }}>
                      <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>{c.className}</div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: c.current ? "#fff" : "#475569", marginTop: 1 }}>
                        {c.current?.subjectName ?? "—"}
                      </div>
                      {c.current && (c.current.teacherName || c.current.room) && (
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {[c.current.teacherName, c.current.room].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {c.next && <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>다음 {c.next.subjectName}</div>}
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
        {data.label} · 30초마다 자동 갱신
        {data.shuttle.boardToken ? ` · ${data.shuttle.switchLabel}부터 하원 차량 화면으로 전환` : " · 차량 화면 링크가 아직 설정되지 않았습니다"}
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
