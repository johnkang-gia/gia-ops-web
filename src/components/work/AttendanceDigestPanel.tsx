"use client";

import { useMemo } from "react";
import type { GoogleChatMirrorMessage } from "@/lib/types";

// 출결알림 방에 올라온 구글챗 메시지를 키워드로 분류해 "누가 결석이고 누가 픽업인지"만 뽑아
// 정리해 보여줍니다(요청: "구글챗에서 결석,픽업 등의 글을 찾아서... 필터링해서 정리해서
// 깔끔하게 보여주도록"). 왼쪽 출결알림 패널은 원문 그대로 흐르는 로그이고, 이 패널은 그
// 원문에서 뽑아낸 요약본입니다 - 원문은 그대로 두고 읽기만 하므로 구글챗 쪽에는 아무 영향이
// 없습니다.
//
// AI를 쓰지 않고 순수 키워드 규칙으로 분류합니다(추가 비용 0, 즉시 반영). 선생님들이 실제로
// 쓰는 표현이 늘어나면 아래 CATEGORIES의 keywords에 단어만 더 넣으면 됩니다.
type CategoryKey = "결석" | "픽업" | "지각" | "조퇴";

const CATEGORIES: { key: CategoryKey; label: string; icon: string; color: string; keywords: string[] }[] = [
  { key: "결석", label: "결석", icon: "🚫", color: "text-red-600", keywords: ["결석", "안 와", "안와", "못 와", "못와", "absent", "absence"] },
  { key: "픽업", label: "픽업", icon: "🚗", color: "text-blue-600", keywords: ["픽업", "픽엄", "데리러", "하원", "pick up", "pickup", "pick-up"] },
  { key: "지각", label: "지각", icon: "⏰", color: "text-amber-600", keywords: ["지각", "늦게", "늦어", "late"] },
  { key: "조퇴", label: "조퇴", icon: "🏃", color: "text-purple-600", keywords: ["조퇴", "일찍", "early"] },
];

function categorize(text: string): CategoryKey | null {
  const lower = text.toLowerCase();
  for (const c of CATEGORIES) {
    if (c.keywords.some((k) => lower.includes(k.toLowerCase()))) return c.key;
  }
  return null;
}

// 메시지에서 학생 이름으로 보이는 부분을 최대한 뽑아냅니다. 정확한 학생 레코드 연결이 아니라
// (그건 사건기록의 "관련 학생 연결"처럼 사람이 직접 골라야 정확합니다) 한눈에 훑기 위한
// 힌트라, 못 찾으면 그냥 원문 앞부분을 그대로 보여줍니다.
function guessStudentName(text: string): string {
  // "OOO 학생", "OOO 결석" 처럼 한글 이름(2~4자) 뒤에 조사/키워드가 붙는 흔한 형태를 먼저 봅니다.
  const m = text.match(/([가-힣]{2,4})\s*(?:학생|어린이)?\s*(?:은|는|이|가|님)?\s*(?:오늘|내일)?\s*(?:결석|지각|조퇴|픽업|하원)/);
  if (m) return m[1];
  const first = text.match(/[가-힣]{2,4}/);
  return first ? first[0] : text.slice(0, 12);
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(iso: string, base: Date) {
  const d = new Date(iso);
  return d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth() && d.getDate() === base.getDate();
}

export default function AttendanceDigestPanel({ messages }: { messages: GoogleChatMirrorMessage[] }) {
  // 출결은 "오늘 누가 안 오는지"가 핵심이라 오늘 것만 봅니다(어제 결석이 계속 쌓여 보이면
  // 오히려 한눈에 안 들어옵니다).
  const items = useMemo(() => {
    const today = new Date();
    return messages
      .filter((m) => m.source_key === "attendance" && isSameDay(m.created_at_google, today))
      .map((m) => ({ msg: m, category: categorize(m.content) }))
      .filter((x): x is { msg: GoogleChatMirrorMessage; category: CategoryKey } => x.category !== null)
      .sort((a, b) => a.msg.created_at_google.localeCompare(b.msg.created_at_google));
  }, [messages]);

  const grouped = useMemo(() => {
    const map = new Map<CategoryKey, { msg: GoogleChatMirrorMessage; category: CategoryKey }[]>();
    for (const it of items) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    return map;
  }, [items]);

  return (
    <div className="glass flex h-full flex-col overflow-hidden p-2.5">
      <div className="mb-1.5 flex shrink-0 items-center justify-between text-[12px] font-bold text-emerald-600">
        <span>📊 출결내역</span>
        <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] text-slate-500">오늘 {items.length}건</span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-[11px] leading-relaxed opacity-40">
          오늘 결석·픽업 관련 메시지가 아직 없습니다.
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {CATEGORIES.map((c) => {
            const list = grouped.get(c.key);
            if (!list || list.length === 0) return null;
            return (
              <div key={c.key}>
                <div className={"mb-0.5 flex items-center gap-1 text-[11px] font-bold " + c.color}>
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                  <span className="rounded-full bg-black/5 px-1.5 text-[9px] font-semibold text-slate-500">{list.length}</span>
                </div>
                <div className="flex flex-col gap-1">
                  {list.map(({ msg }) => (
                    <div key={msg.id} className="rounded-lg bg-black/[0.02] px-2 py-1 text-[11px]">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-semibold text-slate-700">{guessStudentName(msg.content)}</span>
                        <span className="shrink-0 text-[9px] text-slate-400">{timeStr(msg.created_at_google)}</span>
                      </div>
                      <p className="truncate text-[10px] text-slate-500" title={msg.content}>
                        {msg.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
