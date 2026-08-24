"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// 운영 대시보드의 학부모 문의 칸.
//
// 요청 흐름:
//  - "글자를 좀더 크게 (...) 스크롤이 내려간다면 계속 몇초에 한번씩 다음페이지"
//  - "백서아 아래 잘려" → 한 장에 담는 개수를 고정값으로 정하니, 이름·요약 길이에 따라
//    마지막 줄이 잘렸습니다. 그래서 **실제로 담기는 만큼만** 보여주도록 바꿨습니다. 칸 높이를
//    재서, 넘치면 한 건씩 줄여 딱 들어맞는 개수를 스스로 찾습니다. 나머지는 다음 장으로.
//  - "터치가능하게" → 각 문의를 누르면 토들 원문으로 바로 갑니다. 화면 아래 점을 누르면
//    그 장으로 넘어가고, 목록을 한 번 누르면 자동 넘김이 잠깐 멈춥니다(읽는 중 넘어가지 않게).

export type BoardInquiry = {
  id: string;
  student: string;
  type: string | null;
  summary: string;
  urgent: boolean;
  at: string;
  replied?: boolean;
  url?: string | null;
  /** 짧게 누르면 작은 창에 보여줄 원문. */
  raw?: string | null;
  channel?: string | null;
};

const PAGE_MS = 8000;
const NEW_MS = 3 * 60 * 1000;
// 누르고 나면 잠깐 자동 넘김을 멈춥니다 - 읽는 중에 장이 넘어가면 방해가 됩니다.
const PAUSE_MS = 20000;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hhmm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return hhmm;
  return `${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]} ${hhmm}`;
}

export default function InquiryBoard({
  items,
  s,
  onOpen,
  onDismiss,
}: {
  items: BoardInquiry[];
  s: (px: number, min: number) => number;
  /** 짧게 누름 - 작은 창으로 원문 보기. */
  onOpen: (q: BoardInquiry) => void;
  /** 길게 누름 - 목록에서 없애기(처리 완료). */
  onDismiss: (q: BoardInquiry) => void;
}) {
  // 한 장에 몇 건이 들어가는지. 칸 높이를 실제로 재서 정합니다.
  const [perPage, setPerPage] = useState(6);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 넘치면 한 건씩 줄여, 잘리지 않는 최대 개수를 찾습니다.
  //
  // 렌더 → 넘쳤나 확인 → 줄이기, 를 반복합니다. useLayoutEffect라 화면에 그려지기 전에
  // 끝나므로 사용자는 줄어드는 과정을 보지 못합니다.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const list = listRef.current;
    if (!wrap || !list) return;
    // 넘치면 한 칸 줄입니다(최소 1). 여유가 많으면 한 칸 늘려봅니다(최대 12).
    if (list.scrollHeight > wrap.clientHeight + 1 && perPage > 1) {
      setPerPage((n) => n - 1);
    }
  });

  // 칸 크기가 바뀌면(화면 회전·창 크기) 다시 처음부터 맞춰봅니다.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPerPage(8));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const pages = useMemo(() => {
    const out: BoardInquiry[][] = [];
    for (let i = 0; i < items.length; i += perPage) out.push(items.slice(i, i + perPage));
    return out.length > 0 ? out : [[]];
  }, [items, perPage]);

  const [page, setPage] = useState(0);
  const [pausedUntil, setPausedUntil] = useState(0);

  useEffect(() => {
    if (page >= pages.length) setPage(0);
  }, [page, pages.length]);

  useEffect(() => {
    if (pages.length <= 1) return;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil) return; // 방금 눌렀으면 잠깐 쉼
      setPage((p) => (p + 1) % pages.length);
    }, PAGE_MS);
    return () => clearInterval(t);
  }, [pages.length, pausedUntil]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const shown = pages[Math.min(page, pages.length - 1)] ?? [];

  // 짧게 누름 vs 길게 누름을 가립니다.
  //
  // 요청: "길게 눌러서 없앨수있고 짧게 누르면 해당 토들 메시지 따로 작은 창으로"
  // 누른 순간 타이머를 걸고, 0.6초 안에 떼면 짧게(원문 보기), 넘으면 길게(없애기)로 봅니다.
  // 길게 눌러 없애질 때는 떼는 순간의 짧게 동작이 겹쳐 일어나지 않도록 표시해 둡니다.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  function pressStart(q: BoardInquiry) {
    setPausedUntil(Date.now() + PAUSE_MS);
    longFired.current = false;
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      onDismiss(q);
    }, 600);
  }
  function pressEnd(q: BoardInquiry) {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    if (!longFired.current) onOpen(q); // 짧게 뗐으면 원문 보기
  }
  function pressCancel() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    longFired.current = true; // 밖으로 벗어나면 아무 동작 안 함
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, touchAction: "manipulation" }}>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: s(7, 4) }}>
          {shown.map((q) => {
            const isNew = now - new Date(q.at).getTime() < NEW_MS;
            return (
              <div
                key={q.id}
                onPointerDown={() => pressStart(q)}
                onPointerUp={() => pressEnd(q)}
                onPointerLeave={pressCancel}
                role="button"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: s(10, 6),
                  background: isNew ? "#1e3352" : "#1e293b",
                  borderLeft: `${s(5, 3)}px solid ${q.urgent ? "#dc2626" : q.replied ? "#16a34a" : isNew ? "#38bdf8" : "#0284c7"}`,
                  borderRadius: s(9, 6),
                  padding: `${s(8, 5)}px ${s(12, 7)}px`,
                  minWidth: 0,
                  boxShadow: isNew ? "0 0 0 1px #38bdf8" : "none",
                  cursor: q.url ? "pointer" : "default",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: s(7, 4), minWidth: 0 }}>
                    {isNew && (
                      <span
                        style={{
                          fontSize: s(13, 10),
                          fontWeight: 800,
                          color: "#0f172a",
                          background: "#38bdf8",
                          borderRadius: s(5, 4),
                          padding: `${s(1, 1)}px ${s(6, 4)}px`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        NEW
                      </span>
                    )}
                    <b
                      style={{
                        fontSize: s(23, 15),
                        color: "#fff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {q.student}
                    </b>
                    {q.replied && (
                      <span style={{ fontSize: s(18, 13), color: "#22c55e", fontWeight: 800 }} title="이미 답글이 달렸습니다">
                        ✓
                      </span>
                    )}
                    {q.type && (
                      <span
                        style={{
                          fontSize: s(14, 10),
                          fontWeight: 700,
                          color: "#93c5fd",
                          background: "#1e3a5f",
                          borderRadius: s(6, 4),
                          padding: `${s(1, 1)}px ${s(7, 4)}px`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {q.type}
                      </span>
                    )}
                    {q.urgent && (
                      <span style={{ fontSize: s(14, 10), fontWeight: 800, color: "#fca5a5", whiteSpace: "nowrap" }}>급함</span>
                    )}
                    <span style={{ fontSize: s(14, 10), color: "#64748b", marginLeft: "auto", whiteSpace: "nowrap" }}>
                      {timeLabel(q.at)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: s(17, 12),
                      color: "#cbd5e1",
                      marginTop: s(3, 2),
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {q.summary || "—"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {pages.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: s(10, 7), paddingTop: s(7, 5), flexShrink: 0 }}>
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${i + 1}번째 장`}
              onClick={() => {
                setPage(i);
                setPausedUntil(Date.now() + PAUSE_MS);
              }}
              style={{
                width: s(14, 10),
                height: s(14, 10),
                borderRadius: 999,
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: i === page ? "#38bdf8" : "#334155",
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
