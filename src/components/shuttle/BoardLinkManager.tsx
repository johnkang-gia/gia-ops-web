"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { parseYoutubeInput } from "@/lib/youtube";
import type { ShuttleBoardLink } from "@/lib/types";

// 안내보드(로비/복도 화면) 링크 관리 - 관리자 전용(요청: "운영앱에서 로그인하지 않고 별도의
// 페이지로 안내보드는 나오도록"). 화면마다 이름(label)과 재생할 유튜브 영상을 따로 설정할 수
// 있습니다. 여기서 만든 토큰 링크를 그 화면(TV/모니터 브라우저)에 띄워두면 됩니다.
export default function BoardLinkManager({ initialLinks }: { initialLinks: ShuttleBoardLink[] }) {
  const notify = useToast();
  const [links, setLinks] = useState(initialLinks);
  const [busy, setBusy] = useState(false);

  async function createLink() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("shuttle_board_links").insert({ label: "새 안내보드" }).select().single();
    setBusy(false);
    if (error || !data) {
      notify("안내보드 링크를 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setLinks((prev) => [data as ShuttleBoardLink, ...prev]);
  }

  async function saveLabel(id: string, label: string) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, label } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_board_links").update({ label }).eq("id", id);
    if (error) notify("이름을 저장하지 못했습니다: " + error.message, "error");
  }

  async function saveYoutube(id: string, raw: string) {
    const parsed = parseYoutubeInput(raw);
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, youtube_video_id: parsed } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_board_links").update({ youtube_video_id: parsed }).eq("id", id);
    if (error) notify("유튜브 영상을 저장하지 못했습니다: " + error.message, "error");
    else notify("유튜브 영상이 저장되었습니다.", "success");
  }

  async function toggleEnabled(link: ShuttleBoardLink) {
    const supabase = createClient();
    const next = !link.enabled;
    setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, enabled: next } : l)));
    const { error } = await supabase.from("shuttle_board_links").update({ enabled: next }).eq("id", link.id);
    if (error) notify("변경하지 못했습니다: " + error.message, "error");
  }

  function copyLink(token: string) {
    const link = `${window.location.origin}/shuttle-board/${token}`;
    navigator.clipboard.writeText(link).then(
      () => notify("안내보드 링크를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-slate-700">📺 안내보드 링크 (로비·복도 화면 - 로그인 불필요)</p>
        <button onClick={createLink} disabled={busy} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          + 새 안내보드 만들기
        </button>
      </div>

      {links.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">아직 만든 안내보드 링크가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map((l) => (
            <div key={l.id} className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2.5 sm:flex-row sm:items-center">
              <input
                defaultValue={l.label}
                onBlur={(e) => e.target.value.trim() && e.target.value !== l.label && saveLabel(l.id, e.target.value.trim())}
                className="w-full max-w-[160px] rounded-lg border border-slate-300 px-2 py-1 text-sm font-semibold"
              />
              <input
                defaultValue={l.youtube_video_id ?? ""}
                placeholder="유튜브 영상/재생목록 URL 붙여넣기"
                onBlur={(e) => e.target.value.trim() && saveYoutube(l.id, e.target.value)}
                className="w-full flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <div className="flex items-center gap-2">
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
