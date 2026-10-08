"use client";

import { useEffect, useState } from "react";
import type { PersonalPayload } from "@/lib/consult/server";

const MSG: Record<PersonalPayload["status"], { ko: string; en: string; tone: string }> = {
  미도착: { ko: "학교에 도착하시면 안내데스크에 말씀해 주세요.", en: "Please check in at the front desk when you arrive.", tone: "bg-slate-100 text-slate-700" },
  대기: { ko: "대기 중입니다. 잠시만 기다려 주세요.", en: "You are in the queue. Please wait a moment.", tone: "bg-amber-100 text-amber-900" },
  상담준비: { ko: "곧 차례입니다. 상담실 앞에서 기다려 주세요.", en: "You are next. Please wait outside the room.", tone: "bg-sky-100 text-sky-900" },
  상담중: { ko: "상담 중입니다.", en: "Your conference is in progress.", tone: "bg-emerald-100 text-emerald-900" },
  완료: { ko: "상담을 마쳤습니다. 감사합니다.", en: "Your conference is complete. Thank you.", tone: "bg-slate-100 text-slate-700" },
  취소: { ko: "취소된 예약입니다.", en: "This booking was cancelled.", tone: "bg-rose-100 text-rose-800" },
  전화상담: { ko: "전화로 상담합니다. 선생님이 연락드립니다.", en: "This will be a phone conference. The teacher will call you.", tone: "bg-violet-100 text-violet-900" },
};

/**
 * 학부모 휴대폰 화면. 10초마다 다시 묻습니다. 다른 가정의 정보는 받지 않습니다(서버가 이 예약
 * 하나만 보냅니다).
 */
export default function ConsultMeClient({ token }: { token: string }) {
  const [me, setMe] = useState<PersonalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/consult/me/${token}`, { cache: "no-store" });
        const j = (await res.json()) as { me?: PersonalPayload; error?: string };
        if (!alive) return;
        if (!res.ok || !j.me) setError(j.error ?? "확인하지 못했습니다.");
        else {
          setMe(j.me);
          setError(null);
        }
      } catch {
        if (alive) setError("연결이 끊겼습니다. 잠시 뒤 다시 확인합니다.");
      }
    };
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [token]);

  const msg = me ? MSG[me.status] : null;
  return (
    <div className="mx-auto min-h-screen max-w-md bg-white p-5">
      <p className="text-xs text-slate-400">{me?.eventName ?? "학부모 상담"}</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{me ? `${me.label} 학부모님` : "상담 순서 확인"}</h1>
      {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {me && msg && (
        <div className="mt-5 space-y-4">
          {me.called && (
            <div className="animate-pulse rounded-2xl bg-sky-500 p-5 text-center text-white">
              <p className="text-2xl font-extrabold">📣 {me.room}로 와 주세요</p>
              <p className="text-sm">Please come to {me.room}</p>
            </div>
          )}
          <div className={`rounded-2xl p-5 ${msg.tone}`}>
            <p className="text-lg font-semibold">{msg.ko}</p>
            <p className="mt-1 text-sm opacity-80">{msg.en}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item label="상담실 · Room" value={me.room ? `${me.room}${me.teacher ? ` (${me.teacher})` : ""}` : "안내 예정"} />
            <Item label="예약 시각 · Time" value={me.scheduledTime ? `${me.scheduledTime}${me.delayMin ? ` (+${me.delayMin}분)` : ""}` : "-"} />
            <Item label="내 앞 · Ahead" value={me.ahead === null ? "-" : `${me.ahead}명`} />
            <Item label="예상 · Est. wait" value={me.wait === null ? "-" : me.wait <= 0 ? "곧 · soon" : `약 ${me.wait}분`} />
          </dl>
          {(me.doneRooms.length > 0 || me.remainingRooms.length > 0) && (
            <p className="text-sm text-slate-600">
              {me.doneRooms.length > 0 && <>✓ {me.doneRooms.join(", ")} </>}
              {me.remainingRooms.length > 0 && <>· 남은 방: {me.remainingRooms.join(", ")}</>}
            </p>
          )}
          <p className="text-xs text-slate-400">이 화면은 10초마다 저절로 새로 고쳐집니다. · Updates every 10 seconds.</p>
        </div>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
