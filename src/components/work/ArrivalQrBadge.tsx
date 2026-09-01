"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";

// 업무보드 머리줄의 "도착체크 QR" 배지.
//
// 정규학기 도착체크 링크의 QR을 여기서 바로 띄웁니다. 지금까지 이 QR을 보려면
// 관리 → 링크·기기까지 들어가야 했습니다. 그런데 이 QR이 필요한 순간은 대개
// **선생님이 옆에 서 계실 때**입니다. 그 자리에서 세 화면을 거쳐 들어가면, 결국
// "나중에 보내드릴게요"가 되고 그 나중은 오지 않습니다.
//
// 링크를 만드는 일은 여기서 하지 않습니다. 만들고 지우는 것은 관리 화면의 일이고,
// 여기는 이미 있는 것을 꺼내 보여주기만 합니다.
export default function ArrivalQrBadge() {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function show() {
    setOpen(true);
    if (dataUrl || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("shuttle_arrival_links")
      .select("token, label, active")
      .eq("term", "정규학기")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setBusy(false);
    if (err) {
      // 조용히 빈 창을 띄우지 않습니다. 왜 안 되는지 적어야 다음 행동을 정할 수 있습니다.
      setError(`도착체크 링크를 읽지 못했습니다: ${err.message}`);
      return;
    }
    if (!data) {
      setError("정규학기 도착체크 링크가 아직 없습니다. 관리 → 링크·기기에서 하나 만들어주세요.");
      return;
    }
    const link = `${window.location.origin}/shuttle-arrival/${data.token}`;
    setUrl(link);
    setDataUrl(await QRCode.toDataURL(link, { width: 320, margin: 1 }));
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        title="정규학기 도착체크 QR코드 — 선생님 휴대폰으로 찍으면 바로 열립니다"
        className="shrink-0 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
      >
        📱 도착체크 QR
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-xs rounded-xl bg-white p-4 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 text-sm font-bold text-slate-800">정규학기 도착체크</p>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
              선생님 휴대폰 카메라로 찍으면 바로 열립니다. 로그인은 필요 없습니다.
            </p>
            {error ? (
              <p className="rounded-lg bg-orange-50 px-3 py-2 text-left text-[12px] leading-relaxed text-orange-800">{error}</p>
            ) : dataUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={dataUrl} alt="도착체크 QR코드" className="mx-auto h-56 w-56" />
                <p className="mt-2 break-all text-[10px] text-slate-400">{url}</p>
              </>
            ) : (
              <p className="py-10 text-[12px] text-slate-400">QR을 만드는 중…</p>
            )}
            <div className="mt-3 flex items-center justify-center gap-2">
              {url && (
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(url)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  링크 복사
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-700"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
