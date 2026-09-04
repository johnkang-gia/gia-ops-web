"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { placeLabel, type TodayPickupItem } from "@/lib/todayPickup";
import { ALERT_LEAD_MINUTES, minutesUntil, pickupDueAt } from "@/lib/pickupTask";

/**
 * 오늘 픽업 리스트.
 *
 * 셔틀을 타는 아이와 안 타는 아이를 갈라 보여줍니다. 해야 할 일이 서로 다르기 때문입니다.
 *
 *   · 타는 아이 — 체크표에서 이미 빠졌습니다. 확인만 하면 됩니다.
 *   · 안 타는 아이 — 보호자가 교실로 옵니다. **몇 시에 어디로**를 안내해야 합니다.
 *
 * 그래서 두 번째 묶음을 위에 크게 둡니다. 손이 가는 쪽이 위입니다.
 */
export default function TodayPickupList({
  items,
  dateLabel,
  serviceDate,
}: {
  items: TodayPickupItem[];
  dateLabel: string;
  /** 'YYYY-MM-DD'. 픽업 시각을 실제 시점으로 바꿀 때 씁니다. */
  serviceDate: string;
}) {
  const [q, setQ] = useState("");
  /** 돋보기로 펼친 줄. 출처(원문·채널·받은 시각)를 보여줍니다. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** 1분마다 다시 그려 «곧 픽업»을 갱신합니다. */
  const [now, setNow] = useState<Date | null>(null);
  /** 이미 알린 건. 같은 건을 1분마다 다시 울리면 사람이 알림을 꺼버립니다. */
  const alerted = useRef<Set<string>>(new Set());

  // 서버와 시각이 다르면 첫 렌더가 어긋나므로, 시계는 브라우저에서만 돕니다.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * 오늘 확정된 픽업을 업무보드에 올립니다.
   *
   * 픽업은 시각이 되면 행정직원이 교실로 가야 하는 일입니다. 인박스와 체크표는 «지금
   * 상태»를 보여주는 화면이지 «누가 언제 무엇을 해야 하는가»를 관리하는 자리가 아닙니다.
   */
  useEffect(() => {
    void fetch("/api/pickup/ensure-tasks", { method: "POST" }).catch(() => {
      /* 업무가 안 생겨도 이 목록 자체는 보여야 합니다. */
    });
  }, [serviceDate]);

  /** 시각이 5분 안으로 다가온 픽업. */
  const soon = useMemo(() => {
    if (!now) return [] as TodayPickupItem[];
    return items
      .map((i) => ({ i, m: minutesUntil(pickupDueAt(serviceDate, i.pickupTime), now) }))
      .filter((x) => x.m !== null && x.m <= ALERT_LEAD_MINUTES && x.m >= -10)
      .sort((a, b) => (a.m ?? 0) - (b.m ?? 0))
      .map((x) => x.i);
  }, [items, now, serviceDate]);

  // 브라우저 알림. 허락하지 않았으면 화면 배너만 뜹니다 - 배너가 본체이고 알림은 덤입니다.
  useEffect(() => {
    if (!now || soon.length === 0) return;
    for (const i of soon) {
      if (alerted.current.has(i.requestId)) continue;
      alerted.current.add(i.requestId);
      if (typeof Notification === "undefined") continue;
      const fire = () =>
        new Notification(`${i.pickupTime ?? ""} 픽업 — ${i.name}`, {
          body: `${placeLabel(i)}${i.ridesShuttle ? "" : " · 교실로 데리러 가주세요"}`,
          tag: `pickup-${i.requestId}`,
        });
      if (Notification.permission === "granted") fire();
      else if (Notification.permission === "default") void Notification.requestPermission().then((p) => p === "granted" && fire());
    }
  }, [soon, now]);

  const { walk, ride } = useMemo(() => {
    const key = q.replace(/\s+/g, "").trim();
    const hit = (i: TodayPickupItem) =>
      !key ||
      i.name.replace(/\s+/g, "").includes(key) ||
      (i.className ?? "").replace(/\s+/g, "").includes(key) ||
      (i.room ?? "").replace(/\s+/g, "").includes(key);
    const f = items.filter(hit);
    return { walk: f.filter((i) => !i.ridesShuttle), ride: f.filter((i) => i.ridesShuttle) };
  }, [items, q]);

  const Row = ({ i, tone }: { i: TodayPickupItem; tone: "walk" | "ride" }) => (
    <li
      className={
        "flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-2.5 py-2 last:border-0 " +
        (i.unmatched ? "bg-amber-50/60" : "")
      }
    >
      <span
        className={
          "w-[54px] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[12px] font-bold tabular-nums " +
          (i.pickupTime
            ? tone === "walk"
              ? "bg-violet-100 text-violet-800"
              : "bg-slate-100 text-slate-700"
            : "bg-slate-50 text-slate-400")
        }
        title={i.pickupTime ? "" : "연락에 시각이 적혀 있지 않습니다"}
      >
        {i.pickupTime ?? "시각?"}
      </span>

      {i.studentId ? (
        <Link href={`/students/${i.studentId}`} className="text-[13px] font-bold text-slate-800 hover:underline">
          {i.name}
        </Link>
      ) : (
        <span className="text-[13px] font-bold text-slate-800">{i.name}</span>
      )}

      <span className="text-[12px] text-slate-600">{placeLabel(i)}</span>
      {i.teacherName && <span className="text-[11px] text-slate-400">담임 {i.teacherName}</span>}

      {i.unmatched && (
        <span
          className="rounded-md bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900"
          title="명부에서 이 아이를 한 명으로 특정하지 못했습니다. 아래 [확인이 필요한 픽업]에서 학생을 골라주세요."
        >
          학생 확인 필요
        </span>
      )}

      {/* **자동이 어디까지 갔는지**를 줄마다 보여줍니다.
          「문의사항에는 픽업이라고 떠 있는데 체크표에는 안 걸려 있다」가 되풀이된 이유는,
          AI가 확신하지 못해 멈춰 세워둔 것이 화면 어디에도 안 보였기 때문입니다. */}
      {i.pending ? (
        <span
          className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
          title="AI가 확신하지 못해 자동으로 걸지 않았습니다. 아래 [확인이 필요한 픽업]에서 눌러주셔야 하원 체크표에 반영됩니다."
        >
          아직 자동 처리 안 됨
        </span>
      ) : i.ridesShuttle && !i.applied ? (
        <span
          className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
          title="확정된 픽업인데 하원 체크표에 아직 픽업으로 안 걸려 있습니다. 체크표에서 직접 눌러주세요."
        >
          체크표 미반영
        </span>
      ) : null}

      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
        {i.source && <span>{i.source}</span>}
        {i.senderName && <span>· {i.senderName}</span>}
        <button
          type="button"
          onClick={() => setOpenId((v) => (v === i.requestId ? null : i.requestId))}
          title="어디서 온 연락인지 보기"
          className="rounded px-1 text-[12px] leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          🔎
        </button>
      </span>
      {i.note && <span className="w-full pl-[62px] text-[11px] text-slate-500">{i.note}</span>}

      {openId === i.requestId && (
        <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 pl-2.5 text-[11px] leading-relaxed text-slate-600">
          <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-slate-500">
            <span>출처 {i.source ?? "알 수 없음"}</span>
            {i.channelLabel && <span>· {i.channelLabel}</span>}
            {i.receivedAt && <span>· {new Date(i.receivedAt).toLocaleString("ko-KR", { hour12: false })}</span>}
            <span>· {i.pending ? "확인대기" : "확정"}</span>
          </p>
          {i.rawText ? (
            <p className="whitespace-pre-wrap break-words rounded bg-white px-2 py-1.5 text-slate-700">{i.rawText}</p>
          ) : (
            <p className="text-slate-400">
              원문이 남아 있지 않습니다 — 픽업이 아니라고 판단된 연락은 본문을 저장하지 않습니다.
            </p>
          )}
          {i.sourceUrl && (
            <a
              href={i.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block font-semibold text-teal-700 underline"
            >
              토들에서 원문 열기 →
            </a>
          )}
        </div>
      )}
    </li>
  );

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-slate-800">🧍 오늘 픽업 리스트</h2>
        <span className="text-[11px] text-slate-400">{dateLabel}</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·반·교실 찾기"
          className="ml-auto w-40 rounded-lg border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-slate-400"
        />
      </div>

      {/* 곧 나가야 하는 픽업.
          목록 안에서 시각을 눈으로 훑어 찾는 일은 바쁜 시간대에 반드시 새어 나갑니다.
          5분 전이 되면 맨 위로 끌어올려 한 줄로 보여줍니다. */}
      {soon.length > 0 && now && (
        <div className="mb-3 animate-pulse rounded-xl border-2 border-rose-400 bg-rose-50 px-3 py-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-bold text-rose-900">
            <span>⏰ 곧 픽업</span>
            {soon.map((i) => {
              const m = minutesUntil(pickupDueAt(serviceDate, i.pickupTime), now) ?? 0;
              return (
                <span key={i.requestId} className="rounded-lg bg-white px-2 py-0.5 shadow-sm">
                  {i.pickupTime} {i.name}
                  <span className="ml-1 text-[11px] font-semibold text-rose-600">
                    {m > 0 ? `${m}분 뒤` : m === 0 ? "지금" : `${-m}분 지남`}
                  </span>
                  <span className="ml-1 text-[11px] font-normal text-slate-500">{placeLabel(i)}</span>
                </span>
              );
            })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* 셔틀을 안 타는 아이 — 교실로 데리러 옵니다. 이쪽이 안내가 필요한 쪽이라 왼쪽입니다. */}
        <div className="rounded-xl border-2 border-violet-200 bg-violet-50/40">
          <p className="flex items-baseline gap-2 border-b border-violet-200 px-2.5 py-1.5">
            <b className="text-[13px] text-violet-900">교실로 데리러 옵니다</b>
            <span className="text-[11px] text-violet-700">셔틀 안 타는 아이</span>
            <span className="ml-auto text-[12px] font-bold text-violet-800">{walk.length}명</span>
          </p>
          {walk.length === 0 ? (
            <p className="px-2.5 py-3 text-[12px] text-slate-400">해당 없음</p>
          ) : (
            <ul>
              {walk.map((i) => (
                <Row key={i.requestId} i={i} tone="walk" />
              ))}
            </ul>
          )}
        </div>

        {/* 셔틀을 타는 아이 — 체크표에서 이미 빠졌습니다. 확인용입니다. */}
        <div className="rounded-xl border border-slate-200">
          <p className="flex items-baseline gap-2 border-b border-slate-200 px-2.5 py-1.5">
            <b className="text-[13px] text-slate-800">셔틀에서 뺐습니다</b>
            <span className="text-[11px] text-slate-500">평소 셔틀 타는 아이</span>
            <span className="ml-auto text-[12px] font-bold text-slate-700">{ride.length}명</span>
          </p>
          {ride.length === 0 ? (
            <p className="px-2.5 py-3 text-[12px] text-slate-400">해당 없음</p>
          ) : (
            <ul>
              {ride.map((i) => (
                <Row key={i.requestId} i={i} tone="ride" />
              ))}
            </ul>
          )}
          <p className="border-t border-slate-100 px-2.5 py-1.5 text-[11px] text-slate-400">
            <Link href="/shuttle/checklist" className="font-semibold text-slate-600 underline">
              하원 체크표
            </Link>
            에 픽업으로 표시됩니다.
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        오늘 셔틀 배정의 <b>요일까지</b> 보고 갈랐습니다 — 화·목만 타는 아이는 월요일에는 안 타는 쪽으로 셉니다.
        <br />
        확정된 픽업은 <b>업무보드에도 자동으로 올라갑니다</b>(마감시각 = 픽업 시각). 시각 <b>{ALERT_LEAD_MINUTES}분 전</b>에
        이 화면 위쪽으로 올라오고, 브라우저 알림을 허락하셨다면 알림도 한 번 뜹니다.
      </p>
    </section>
  );
}
