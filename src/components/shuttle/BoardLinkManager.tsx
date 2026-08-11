"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { parseYoutubeMultilineInput, youtubeValueToEditableText } from "@/lib/youtube";
import type { ShuttleBoardLink } from "@/lib/types";

// 짧은 주소용 코드에 헷갈리는 글자(0/O, 1/I/l)를 빼서 공용컴퓨터에서 눈으로 보고 타이핑해도
// 실수하지 않게 합니다(요청: "주소가 너무 복잡해서 바로 주소를 공용컴퓨터 주소창에 치는게
// 어려워... 짧은 주소로 만들어줘").
const SHORT_CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";
function randomShortCode(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) out += SHORT_CODE_CHARS[Math.floor(Math.random() * SHORT_CODE_CHARS.length)];
  return out;
}

// 안내보드(로비/복도 화면) 링크 관리 - 관리자 전용(요청: "운영앱에서 로그인하지 않고 별도의
// 페이지로 안내보드는 나오도록"). 화면마다 이름(label)과 재생할 유튜브 영상을 따로 설정할 수
// 있습니다. 여기서 만든 토큰 링크를 그 화면(TV/모니터 브라우저)에 띄워두면 됩니다.
export default function BoardLinkManager({ initialLinks }: { initialLinks: ShuttleBoardLink[] }) {
  const notify = useToast();
  const [links, setLinks] = useState(initialLinks);
  const [busy, setBusy] = useState(false);

  async function createLink(term: "정규학기" | "여름캠프2") {
    setBusy(true);
    const supabase = createClient();
    // 짧은 코드가 다른 링크와 우연히 겹칠 수 있으니(유니크 제약 위반, 23505), 몇 번 다시
    // 시도합니다. 4자리 코드라 겹칠 확률은 매우 낮습니다.
    let data: ShuttleBoardLink | null = null;
    let error: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 5 && !data; attempt++) {
      const res = await supabase
        .from("shuttle_board_links")
        .insert({ label: term === "여름캠프2" ? "여름캠프2 안내보드" : "새 안내보드", term, short_code: randomShortCode() })
        .select()
        .single();
      data = res.data as ShuttleBoardLink | null;
      error = res.error;
      if (!error) break;
      if (error.code !== "23505") break;
    }
    setBusy(false);
    if (error || !data) {
      notify("안내보드 링크를 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setLinks((prev) => [data as ShuttleBoardLink, ...prev]);
  }

  async function saveShortCode(id: string, raw: string) {
    const code = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!code) {
      notify("짧은 주소는 비워둘 수 없습니다.", "error");
      setLinks((prev) => [...prev]); // 인풋을 이전 값으로 되돌리기 위해 강제로 리렌더링
      return;
    }
    const prevLinks = links;
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, short_code: code } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_board_links").update({ short_code: code }).eq("id", id);
    if (error) {
      const msg = error.code === "23505" ? "이미 다른 안내보드가 쓰고 있는 코드입니다." : error.message;
      notify("짧은 주소를 저장하지 못했습니다: " + msg, "error");
      setLinks(prevLinks);
    } else {
      notify("짧은 주소가 저장되었습니다.", "success");
    }
  }

  async function saveTerm(id: string, term: "정규학기" | "여름캠프2") {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, term } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_board_links").update({ term }).eq("id", id);
    if (error) notify("구분을 저장하지 못했습니다: " + error.message, "error");
  }

  async function saveLabel(id: string, label: string) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, label } : l)));
    const supabase = createClient();
    const { error } = await supabase.from("shuttle_board_links").update({ label }).eq("id", id);
    if (error) notify("이름을 저장하지 못했습니다: " + error.message, "error");
  }

  async function saveYoutube(id: string, raw: string) {
    const parsed = parseYoutubeMultilineInput(raw);
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

  function boardLinkUrl(token: string) {
    return `${window.location.origin}/shuttle-board/${token}`;
  }

  function copyLink(token: string) {
    const link = boardLinkUrl(token);
    navigator.clipboard.writeText(link).then(
      () => notify("안내보드 링크를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
  }

  // 요청: "링크복사와 함께 링크열기버튼도 만들어줘" - 링크를 복사만 하지 않고, 바로 새 탭으로
  // 열어서 그 화면(TV/모니터)에서 확인할 수 있게 합니다.
  function openLink(token: string) {
    window.open(boardLinkUrl(token), "_blank");
  }

  // 요청: "주소가 너무 복잡해서... 짧은 주소로 만들어줘" - /b/[code]로 접속하면 이 안내보드로
  // 자동 연결됩니다(로그인 불필요, 기존 토큰 링크와 동일하게 동작).
  function shortLinkUrl(code: string) {
    return `${window.location.origin}/b/${code}`;
  }

  function copyShortLink(code: string) {
    const link = shortLinkUrl(code);
    navigator.clipboard.writeText(link).then(
      () => notify("짧은 주소를 복사했습니다.", "success"),
      () => notify(link, "info")
    );
  }

  function openShortLink(code: string) {
    window.open(shortLinkUrl(code), "_blank");
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">📺 안내보드 링크 (로비·복도 화면 - 로그인 불필요)</p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => createLink("정규학기")}
            disabled={busy}
            className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            + 정규학기 안내보드
          </button>
          <button
            onClick={() => createLink("여름캠프2")}
            disabled={busy}
            className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            + 여름캠프2 안내보드
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">아직 만든 안내보드 링크가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map((l) => (
            <div key={l.id} className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2.5 sm:flex-row sm:items-start">
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
              <textarea
                defaultValue={youtubeValueToEditableText(l.youtube_video_id)}
                placeholder={"유튜브 영상 링크 붙여넣기\n(여러 개면 한 줄에 하나씩 - 순서대로 이어서 반복 재생됩니다.\n재생목록 링크를 붙여넣어도 됩니다)"}
                rows={2}
                onBlur={(e) => e.target.value.trim() && saveYoutube(l.id, e.target.value)}
                className="w-full flex-1 resize-y rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-400">짧은 주소</span>
                <input
                  key={l.id + ":" + (l.short_code ?? "")}
                  defaultValue={l.short_code ?? ""}
                  placeholder="예: b3k9"
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim().toLowerCase() !== l.short_code && saveShortCode(l.id, e.target.value)}
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-mono font-semibold"
                />
                {l.short_code && (
                  <>
                    <button onClick={() => copyShortLink(l.short_code!)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                      🔗 복사
                    </button>
                    <button onClick={() => openShortLink(l.short_code!)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                      ↗ 열기
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => copyLink(l.token)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                  🔗 원본 링크 복사
                </button>
                <button onClick={() => openLink(l.token)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                  ↗ 원본 링크 열기
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
