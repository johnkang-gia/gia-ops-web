"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { placeLabel, type TodayPickupItem } from "@/lib/todayPickup";

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
export default function TodayPickupList({ items, dateLabel }: { items: TodayPickupItem[]; dateLabel: string }) {
  const [q, setQ] = useState("");
  /** 돋보기로 펼친 줄. 출처(원문·채널·받은 시각)를 보여줍니다. */
  const [openId, setOpenId] = useState<string | null>(null);

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
        오늘 셔틀 배정의 <b>요일까지</b> 보고 갈랐습니다 — 화·목만 타는 아이는 월요일에는 안 타는 쪽으로 셉니다. 교실은 반에
        적어둔 위치입니다(<b>반 · 시간표 → 반/담임</b>에서 적습니다).
      </p>
    </section>
  );
}
