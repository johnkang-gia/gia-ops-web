"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import type { WrClass } from "@/lib/types";

/**
 * 교실 태블릿 — 반별 전용 링크와 호출.
 *
 * 링크를 반 배정 화면 옆에 두는 이유: 반이 늘거나 이름이 바뀌면 링크도 같이 손봐야 하는데,
 * 다른 화면에 있으면 반만 고치고 링크는 그대로 남습니다. 그러면 새 반 태블릿에는 아무것도
 * 안 뜨는데 아무도 모릅니다.
 *
 * 태블릿은 학교 와이파이가 아닐 수 있어 **주소만으로 접속**해야 합니다. 그래서 로그인 없는
 * 토큰 링크이고, 짧은 코드도 함께 만들어 손으로 칠 수 있게 합니다.
 */

type Link = {
  id: string;
  class_id: string;
  token: string;
  short_code: string | null;
  enabled: boolean;
  last_seen_at: string | null;
  dismissal_auto: boolean;
};

const CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";
function randomCode(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

/** 자주 쓰는 호출 사유. 손으로 적는 것보다 빠르고, 무엇보다 표기가 흔들리지 않습니다. */
const QUICK = ["학부모님 오셨습니다", "행정실로 보내주세요", "짐 챙겨 내려보내주세요", "보건실로 보내주세요"];

export default function ClassroomTabletManager({ classes }: { classes: WrClass[] }) {
  const notify = useToast();
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [callFor, setCallFor] = useState<WrClass | null>(null);
  const [reason, setReason] = useState("");
  const [studentName, setStudentName] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("classroom_links").select("*");
      setLinks((data as Link[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  const byClass = useMemo(() => new Map(links.map((l) => [l.class_id, l])), [links]);

  async function createLink(c: WrClass) {
    setBusy(c.id);
    const supabase = createClient();
    // 짧은 코드가 우연히 겹칠 수 있어 몇 번 다시 시도합니다.
    let made: Link | null = null;
    let lastError: { code?: string; message: string } | null = null;
    for (let i = 0; i < 5 && !made; i++) {
      const res = await supabase
        .from("classroom_links")
        .insert({ class_id: c.id, label: `${c.grade}학년 ${c.class_name}`, short_code: randomCode() })
        .select()
        .single();
      made = res.data as Link | null;
      lastError = res.error;
      if (!lastError) break;
      if (lastError.code !== "23505") break;
    }
    setBusy(null);
    if (!made) {
      notify("링크를 만들지 못했습니다: " + (lastError?.message ?? ""), "error");
      return;
    }
    setLinks((prev) => [...prev, made as Link]);
  }

  async function toggle(l: Link) {
    setBusy(l.class_id);
    const supabase = createClient();
    const { error } = await supabase.from("classroom_links").update({ enabled: !l.enabled }).eq("id", l.id);
    setBusy(null);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      return;
    }
    setLinks((prev) => prev.map((x) => (x.id === l.id ? { ...x, enabled: !x.enabled } : x)));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("주소를 복사했습니다.", "success");
    } catch {
      // 복사가 막힌 브라우저도 있습니다. 그때는 주소를 화면에서 직접 읽어 적으시면 됩니다.
      notify("복사가 막혀 있습니다. 아래 주소를 직접 적어주세요.", "error");
    }
  }

  async function send() {
    if (!callFor) return;
    setBusy(callFor.id);
    const res = await fetch("/api/classroom/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: callFor.id,
        kind: studentName.trim() ? "픽업" : "호출",
        studentName: studentName.trim() || null,
        reason: reason.trim() || null,
      }),
    }).catch(() => null);
    setBusy(null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      notify("호출을 보내지 못했습니다: " + (j.error ?? ""), "error");
      return;
    }
    // 화면이 죽어 있으면 «보냈다»만 알리고 끝내지 않습니다.
    notify(j.warning ? j.warning : `${callFor.grade}학년 ${callFor.class_name} 교실에 띄웠습니다.`, j.warning ? "error" : "success");
    setCallFor(null);
    setReason("");
    setStudentName("");
  }

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-3">
      <h2 className="mb-1 text-sm font-bold text-slate-800">📟 교실 태블릿</h2>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        반마다 전용 주소를 만들어 교실 태블릿에 띄워둡니다. <b>로그인이 필요 없어</b> 학교 와이파이가 아니어도 주소만
        있으면 열립니다. [호출]을 누르면 그 반 화면이 바뀌고 소리가 납니다 — 선생님이 [확인]을 누르면 여기 기록이
        남습니다.
      </p>

      {loading ? (
        <p className="py-4 text-center text-xs text-slate-400">불러오는 중…</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {classes.map((c) => {
            const l = byClass.get(c.id);
            const seen = l?.last_seen_at ? new Date(l.last_seen_at).getTime() : 0;
            const alive = !!l?.enabled && Date.now() - seen < 2 * 60 * 1000;
            const url = l ? `${origin}/c/${l.short_code || l.token}` : "";
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2 text-xs">
                <b className="w-28 shrink-0 text-slate-800">
                  {c.grade}학년 {c.class_name}
                </b>

                {!l ? (
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => createLink(c)}
                    className="rounded-lg bg-teal-600 px-2.5 py-1 font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
                  >
                    링크 만들기
                  </button>
                ) : (
                  <>
                    {/* 화면이 살아 있는지. 이게 없으면 호출을 보내놓고 아무도 못 보는 줄 모릅니다. */}
                    <span
                      className={
                        "rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                        (alive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")
                      }
                      title={l.last_seen_at ? `마지막 신호 ${new Date(l.last_seen_at).toLocaleString("ko-KR")}` : "아직 한 번도 열린 적이 없습니다"}
                    >
                      {alive ? "● 켜짐" : l.last_seen_at ? "○ 조용함" : "○ 미접속"}
                    </span>
                    <code className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">{url}</code>
                    <button type="button" onClick={() => copy(url)} className="rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50">
                      복사
                    </button>
                    <button
                      type="button"
                      onClick={() => setCallFor(c)}
                      className="rounded-lg bg-sky-600 px-2.5 py-1 font-semibold text-white hover:bg-sky-700"
                    >
                      🔔 호출
                    </button>
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => toggle(l)}
                      className="ml-auto rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {l.enabled ? "끄기" : "켜기"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {classes.length === 0 && <p className="py-4 text-center text-xs text-slate-400">반이 없습니다.</p>}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        차량 도착을 GPS로 잡아 교실에 자동으로 알리는 기능은 만들어 두었지만 <b>아직 꺼져 있습니다</b> — 모든 차량에
        기기를 단 뒤에 켭니다. 지금 켜면 기기가 없는 노선은 영영 신호가 안 오는데, 화면에서는 「아직 안 왔다」로 읽힙니다.
      </p>

      {/* 호출 창 */}
      {callFor && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={() => setCallFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="mb-1 text-sm font-bold text-slate-800">
              🔔 {callFor.grade}학년 {callFor.class_name} 호출
            </h3>
            <p className="mb-3 text-[11px] text-slate-500">교실 화면이 바뀌고 소리가 납니다.</p>

            <label className="mb-1 block text-[11px] font-semibold text-slate-600">누구를 (비우면 반 전체 호출)</label>
            <input
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="예: 전지완"
              className="mb-2 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />

            <label className="mb-1 block text-[11px] font-semibold text-slate-600">왜</label>
            <div className="mb-2 flex flex-wrap gap-1">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setReason(q)}
                  className={
                    "rounded-full border px-2 py-1 text-[11px] font-semibold " +
                    (reason === q ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")
                  }
                >
                  {q}
                </button>
              ))}
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="직접 적어도 됩니다"
              className="mb-3 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCallFor(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">
                취소
              </button>
              <button
                type="button"
                disabled={busy === callFor.id}
                onClick={send}
                className="ml-auto rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-40"
              >
                교실에 띄우기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
