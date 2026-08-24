"use client";

import { useEffect, useMemo, useState } from "react";

// 운영 대시보드의 학부모 문의 칸.
//
// 요청: "글자를 좀더 크게 해주고 이름을 좀더 크게 그리고 그아래에 문의내용 간단히 요약해서
// 나오도록 (...) 스크롤이 내려간다면 계속 몇초에 한번씩 다음페이지 보여줬다가 돌아왔다가"
//
// 공용 모니터라 스크롤을 내릴 사람이 없습니다. 그래서 한 화면에 들어갈 만큼만 보여주고,
// 넘치면 몇 초마다 다음 장으로 넘겼다가 마지막 장에서 다시 처음으로 돌아옵니다. 지나가면서
// 몇 초만 봐도 결국 전부 보게 됩니다.

export type BoardInquiry = {
  id: string;
  student: string;
  type: string | null;
  summary: string;
  urgent: boolean;
  at: string;
  /** 다른 선생님이 이미 답글을 단 건. 이름 뒤에 초록 체크가 붙습니다. */
  replied?: boolean;
};

const PAGE_MS = 8000;
// 이 시간 안에 들어온 문의는 "새 것"으로 강조합니다(요청). 화면이 15초마다 갱신되므로
// 넉넉히 잡아, 잠깐 자리를 비운 사이 올라온 것도 눈에 띄게 합니다.
const NEW_MS = 3 * 60 * 1000;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hhmm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return hhmm;
  return `${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]} ${hhmm}`;
}

export default function InquiryBoard({
  items,
  perPage,
  s,
}: {
  items: BoardInquiry[];
  /** 한 장에 몇 건을 넣을지. 화면 높이에 맞춰 바깥에서 정합니다. */
  perPage: number;
  /** 화면 크기에 맞춘 글자 크기 계산기. */
  s: (px: number, min: number) => number;
}) {
  const pages = useMemo(() => {
    const out: BoardInquiry[][] = [];
    for (let i = 0; i < items.length; i += perPage) out.push(items.slice(i, i + perPage));
    return out.length > 0 ? out : [[]];
  }, [items, perPage]);

  const [page, setPage] = useState(0);

  // 장이 줄어들었는데 마지막 장을 보고 있으면 빈 화면이 됩니다.
  useEffect(() => {
    if (page >= pages.length) setPage(0);
  }, [page, pages.length]);

  useEffect(() => {
    if (pages.length <= 1) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages.length), PAGE_MS);
    return () => clearInterval(t);
  }, [pages.length]);

  const shown = pages[Math.min(page, pages.length - 1)] ?? [];

  // 지금 시각 기준으로 "새 문의"를 가립니다. 1초마다 다시 그려, 3분이 지나면 강조가 저절로
  // 풀립니다(계속 강조돼 있으면 어느 게 진짜 새 것인지 알 수 없습니다).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: s(7, 4), flex: 1, minHeight: 0 }}>
        {shown.map((q) => {
          const isNew = Date.now() - new Date(q.at).getTime() < NEW_MS && now >= 0;
          return (
          <div
            key={q.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: s(10, 6),
              // 새 문의는 배경을 살짝 밝혀 눈이 먼저 가게 합니다.
              background: isNew ? "#1e3352" : "#1e293b",
              borderLeft: `${s(5, 3)}px solid ${q.urgent ? "#dc2626" : q.replied ? "#16a34a" : isNew ? "#38bdf8" : "#0284c7"}`,
              borderRadius: s(9, 6),
              padding: `${s(8, 5)}px ${s(12, 7)}px`,
              minWidth: 0,
              boxShadow: isNew ? "0 0 0 1px #38bdf8" : "none",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* 이름 줄 - 멀리서도 누구 얘기인지 먼저 보여야 합니다. */}
              <div style={{ display: "flex", alignItems: "center", gap: s(7, 4), minWidth: 0 }}>
                {isNew && (
                  <span
                    style={{
                      fontSize: s(12, 9),
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
                    fontSize: s(21, 14),
                    color: "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {q.student}
                </b>
                {/* 요청: "답글달렸다는 표시로 이름 뒤에 초록색 체크표시" */}
                {q.replied && (
                  <span style={{ fontSize: s(17, 12), color: "#22c55e", fontWeight: 800 }} title="이미 답글이 달렸습니다">
                    ✓
                  </span>
                )}
                {q.type && (
                  <span
                    style={{
                      fontSize: s(13, 10),
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
                  <span style={{ fontSize: s(13, 10), fontWeight: 800, color: "#fca5a5", whiteSpace: "nowrap" }}>급함</span>
                )}
                <span style={{ fontSize: s(13, 10), color: "#64748b", marginLeft: "auto", whiteSpace: "nowrap" }}>
                  {timeLabel(q.at)}
                </span>
              </div>
              {/* 요약 - 이름 아래 한 줄. 두 줄까지는 내려 씁니다. */}
              <div
                style={{
                  fontSize: s(16, 12),
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

      {/* 여러 장일 때만 아래에 점을 찍습니다. 지금 몇 번째 장인지 알 수 있어야
          "아까 본 것이 또 나온 건가?" 하고 헷갈리지 않습니다. */}
      {pages.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: s(6, 4), paddingTop: s(6, 4), flexShrink: 0 }}>
          {pages.map((_, i) => (
            <span
              key={i}
              style={{
                width: s(7, 5),
                height: s(7, 5),
                borderRadius: 999,
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
