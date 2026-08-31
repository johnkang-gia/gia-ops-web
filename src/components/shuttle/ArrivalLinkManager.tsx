"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import type { ShuttleArrivalLink } from "@/lib/types";

// 교직원용 도착·출발 체크 단독 링크 관리 - 관리자 전용(요청: "교직원이 모바일로 도착한 차량
// 누를 수 있는 단독 링크"). GPS 위치 전송이나 학생별 개별 탑승 체크 없이, 차량이 왔다/떠났다만
// 빠르게 알리면 되는 경우(여름캠프 등)에 씁니다. 여기서 만든 토큰 링크를 교직원 여러 명이
// 함께 써도 됩니다(동시에 눌러도 DB 부분 유니크 인덱스가 중복을 막아줍니다).
export default function ArrivalLinkManager({ initialLinks }: { initialLinks: ShuttleArrivalLink[] }) {
  const notify = useToast();
  const [links, setLinks] = useState(initialLinks);
  const [busy, setBusy] = useState(false);
  const [qrLink, setQrLink] = useState<{ token: string; label: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  async function createLink(term: "정규학기" | "여름캠프2") {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("shuttle_arrival_links")
      .insert({ label: term === "여름캠프2" ? "여름캠프2 도착체크" : "도착체크", term })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      notify("도착체크 링크를 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setLinks((prev) => [data as ShuttleArrivalLink, ...prev]);
  }

  async function saveLabel(id: string, label: string) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, label } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_arrival_links").update({ label }).eq("id", id);
    if (error) notify("이름을 저장하지 못했습니다: " + error.message, "error");
  }

  async function saveTerm(id: string, term: "정규학기" | "여름캠프2") {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, term } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_arrival_links").update({ term }).eq("id", id);
    if (error) notify("구분을 저장하지 못했습니다: " + error.message, "error");
  }

  // 담당자: "링크들 만들기만 할 수 있어서 삭제도 할 수 있게 해줘."
  //
  // 켜기/끄기만 있어서 잘못 만든 링크가 목록에 영영 남았습니다. 목록이 길어지면 지금 쓰는
  // 링크가 어느 것인지 헷갈리고, 헷갈리면 엉뚱한 링크를 나눠주게 됩니다.
  //
  // 지우기 전에 한 번 묻습니다. 이미 나눠준 링크를 지우면 **그 링크를 받은 분들 화면이
  // 전부 막힙니다.** 되돌릴 수 없습니다.
  async function removeLink(l: ShuttleArrivalLink) {
    if (!confirm(`"${l.label}" 링크를 지웁니다.\n\n이미 나눠준 링크라면 받으신 분들 화면이 전부 막힙니다. 되돌릴 수 없습니다.\n\n계속할까요?`)) return;
    setBusy(true);
    const supabase = createClient();
    // .select()를 붙여 **정말 지워졌는지** 확인합니다.
    //
    // 권한(RLS)이 지우기를 막고 있으면 오류 없이 0줄이 지워집니다. 그대로 화면에서만
    // 빼면 지운 것처럼 보이다가 새로고침하면 되살아납니다 - 지웠다고 믿고 계속 쓰던
    // 링크가 살아 있는 것이 가장 나쁩니다.
    const { data: removed, error } = await supabase.from("shuttle_arrival_links").delete().eq("id", l.id).select("id");
    setBusy(false);
    if (error) {
      notify("지우지 못했습니다: " + error.message, "error");
      return;
    }
    if (!removed || removed.length === 0) {
      notify("지울 권한이 없습니다. 관리자 계정으로 다시 시도해주세요.", "error");
      return;
    }
    setLinks((prev) => prev.filter((x) => x.id !== l.id));
    notify("링크를 지웠습니다.", "success");
  }

  async function toggleEnabled(link: ShuttleArrivalLink) {
    const supabase = createClient();
    const next = !link.enabled;
    setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, enabled: next } : l)));
    const { error } = await supabase.from("shuttle_arrival_links").update({ enabled: next }).eq("id", link.id);
    if (error) notify("변경하지 못했습니다: " + error.message, "error");
  }

  function arrivalLinkUrl(token: string) {
    return `${window.location.origin}/shuttle-arrival/${token}`;
  }

  function copyLink(token: string) {
    const link = arrivalLinkUrl(token);
    navigator.clipboard.writeText(link).then(
      () => notify("도착체크 링크를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
  }

  // 요청: "링크복사와 함께 링크열기버튼도 만들어줘" - 복사만 하지 않고 바로 새 탭으로 열어서
  // 확인할 수 있게 합니다.
  function openLink(token: string) {
    window.open(arrivalLinkUrl(token), "_blank");
  }

  // 요청: "못하는 사람들 하나하나 찾아다니면서 설명할 수가 없어, 더 간단하게 자기 핸드폰에
  // 추가하게 하는 방법 없을까?" - 주소를 복사해서 붙여넣는 대신, QR코드를 카톡방 등에 공유하면
  // 카메라로 스캔만 해도 바로 그 링크가 열립니다(브라우저 안에서 client 전용 qrcode 패키지로
  // 만들어 서버 왕복 없이 즉시 생성).
  async function showQr(l: ShuttleArrivalLink) {
    setQrLink({ token: l.token, label: l.label });
    setQrDataUrl(null);
    try {
      const dataUrl = await QRCode.toDataURL(arrivalLinkUrl(l.token), { width: 320, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch {
      notify("QR코드를 만들지 못했습니다.", "error");
      setQrLink(null);
    }
  }

  return (
    <div className="g-panel-solid p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">📍 교직원 도착체크 단독 링크 (GPS·개별 탑승체크 없음)</p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => createLink("정규학기")}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            + 정규학기 도착체크
          </button>
          <button
            onClick={() => createLink("여름캠프2")}
            disabled={busy}
            className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            + 여름캠프2 도착체크
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">아직 만든 도착체크 링크가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map((l) => (
            <div key={l.id} className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2.5 sm:flex-row sm:items-center">
              <input
                defaultValue={l.label}
                onBlur={(e) => e.target.value.trim() && e.target.value !== l.label && saveLabel(l.id, e.target.value.trim())}
                className="w-full max-w-[160px] rounded-lg border border-slate-300 px-2 py-1 text-sm font-semibold"
              />
              <select
                value={l.term}
                onChange={(e) => saveTerm(l.id, e.target.value as "정규학기" | "여름캠프2")}
                className={
                  "rounded-lg border px-1.5 py-1 text-[11px] font-bold " +
                  (l.term === "여름캠프2" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-300 bg-white text-slate-600")
                }
              >
                <option value="정규학기">정규학기</option>
                <option value="여름캠프2">여름캠프2</option>
              </select>
              <div className="flex flex-1 items-center justify-end gap-2">
                <button onClick={() => copyLink(l.token)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                  🔗 링크 복사
                </button>
                <button onClick={() => openLink(l.token)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                  ↗ 링크 열기
                </button>
                <button onClick={() => showQr(l)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                  📱 QR코드
                </button>
                <button
                  onClick={() => toggleEnabled(l)}
                  className={"rounded-lg px-2 py-1 text-[11px] font-semibold " + (l.enabled ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")}
                >
                  {l.enabled ? "끄기" : "켜기"}
                </button>
                <button
                  onClick={() => removeLink(l)}
                  disabled={busy}
                  className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-500 hover:bg-red-50 disabled:opacity-40"
                >
                  🗑 삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {qrLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setQrLink(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-4 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-bold text-slate-800">{qrLink.label} QR코드</p>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR코드" className="mx-auto h-64 w-64" />
            ) : (
              <div className="mx-auto flex h-64 w-64 items-center justify-center text-xs text-slate-400">만드는 중...</div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              휴대폰 카메라로 이 QR코드를 비추면 링크가 바로 열립니다. 연 다음 화면의 공유 버튼을 눌러 &quot;홈 화면에 추가&quot;를 선택하면 아이콘이 생깁니다.
            </p>
            <div className="mt-3 flex gap-2">
              {qrDataUrl && (
                <a
                  href={qrDataUrl}
                  download={`${qrLink.label}_QR.png`}
                  className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
                >
                  ⬇ 이미지로 저장
                </a>
              )}
              <button onClick={() => setQrLink(null)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
