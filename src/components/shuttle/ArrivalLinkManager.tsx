"use client";

import { useState } from "react";
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

  async function toggleEnabled(link: ShuttleArrivalLink) {
    const supabase = createClient();
    const next = !link.enabled;
    setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, enabled: next } : l)));
    const { error } = await supabase.from("shuttle_arrival_links").update({ enabled: next }).eq("id", link.id);
    if (error) notify("변경하지 못했습니다: " + error.message, "error");
  }

  function copyLink(token: string) {
    const link = `${window.location.origin}/shuttle-arrival/${token}`;
    navigator.clipboard.writeText(link).then(
      () => notify("도착체크 링크를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
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
                <button
                  onClick={() => toggleEnabled(l)}
                  className={"rounded-lg px-2 py-1 text-[11px] font-semibold " + (l.enabled ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")}
                >
                  {l.enabled ? "끄기" : "켜기"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
