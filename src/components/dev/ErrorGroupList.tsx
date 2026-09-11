"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatGroup, type ErrorGroup } from "@/lib/errorGroup";

/**
 * **최근 오류 / 해결된 기록.**
 *
 * 예전에는 최근 50줄을 그냥 늘어놓았습니다. 한 가지가 고장 나면 같은 줄이 수십 개 쌓여
 * 다른 종류의 오류를 화면 밖으로 밀어냈고, 고쳐도 목록이 그대로라 화면만 봐서는 고쳤는지
 * 알 수 없었습니다.
 *
 * 이제 **같은 고장을 한 줄로 묶고**, 해결로 표시한 것은 「기록」 쪽으로 내립니다. 그리고
 * 해결 표시 뒤에 또 나면 **저절로 최근 쪽으로 되돌아옵니다** - 「다시 났습니다」를 달고.
 */

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 폴백으로 넘어갑니다 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function when(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

/** 「마지막으로 난 지 얼마나 됐나」. 이것이 해결 여부를 가늠하는 유일한 재료입니다. */
function sinceLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return "방금 전까지";
  if (h < 24) return `${h}시간째 조용`;
  return `${Math.floor(h / 24)}일째 조용`;
}

export default function ErrorGroupList({
  groups,
  truncated,
  days,
}: {
  groups: ErrorGroup[];
  /** 읽어온 줄이 상한에 걸렸는가. 걸렸으면 그 사실을 적습니다 - 조용히 자르지 않습니다. */
  truncated: boolean;
  days: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "done">("open");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const open = useMemo(() => groups.filter((g) => !g.resolved), [groups]);
  const done = useMemo(() => groups.filter((g) => g.resolved), [groups]);
  const shown = tab === "open" ? open : done;

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  async function resolve(g: ErrorGroup, memo: string) {
    setBusy(g.fingerprint);
    setError(null);
    try {
      const res = await fetch("/api/dev/error-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: g.fingerprint,
          route: g.route,
          sampleMessage: g.message,
          note: memo,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? `창구가 ${res.status} 로 답했습니다`);
        return;
      }
      setNoteFor(null);
      setNote("");
      // 서버가 다시 세어 넘겨줍니다. 화면에서만 지우면 실제로 표시가 됐는지 알 수 없습니다.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setTab("open")}
            className={
              "px-3 py-1.5 text-xs font-bold " +
              (tab === "open" ? "bg-red-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50")
            }
          >
            최근 오류 {open.length}
          </button>
          <button
            type="button"
            onClick={() => setTab("done")}
            className={
              "border-l border-slate-200 px-3 py-1.5 text-xs font-bold " +
              (tab === "done" ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50")
            }
          >
            해결된 기록 {done.length}
          </button>
        </div>
        {shown.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyText(shown.map(formatGroup).join("\n\n"));
              if (ok) flash("all");
            }}
            className="ml-auto rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900"
          >
            {copied === "all" ? "✓ 복사됨" : `📋 ${shown.length}건 전체 복사`}
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        같은 창구에서 같은 내용으로 난 오류는 <b>한 줄로 묶습니다</b> — 한 가지가 고장 나면 같은 줄이 수십 개 쌓여 다른 오류를
        화면 밖으로 밀어내기 때문입니다. 최근 {days}일치를 봅니다.
        {" "}<b>해결로 표시한 뒤에 또 나면 저절로 최근 쪽으로 되돌아옵니다</b> — 「다시 안 났다」만이 해결됐다는 증거입니다.
        {truncated && <span className="text-amber-700"> · 줄이 너무 많아 최근 것부터 일부만 읽었습니다.</span>}
      </p>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
          표시하지 못했습니다: {error}
        </p>
      )}

      {shown.length === 0 && (
        <div className="rounded-lg bg-white p-3 text-sm text-slate-400 shadow-sm">
          {tab === "open" ? `최근 ${days}일 동안 아직 안 고친 오류가 없습니다.` : "해결로 표시한 오류가 아직 없습니다."}
        </div>
      )}

      {shown.map((g) => (
        <div
          key={g.fingerprint}
          className={
            "g-panel-solid p-3 text-xs shadow-sm " + (g.regressed ? "border-l-4 border-l-amber-500" : "")
          }
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 font-mono text-red-600">{g.route}</span>
            {g.hits > 1 && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">{g.hits}번</span>
            )}
            <span className="shrink-0 text-slate-400" title={`처음 ${when(g.firstAt)} · 마지막 ${when(g.lastAt)}`}>
              {when(g.lastAt)}
            </span>
            {!g.resolved && <span className="shrink-0 text-slate-400">· {sinceLabel(g.lastAt)}</span>}
            {g.userEmail && <span className="shrink-0 text-slate-400">{g.userEmail}</span>}
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(formatGroup(g));
                if (ok) flash(g.fingerprint);
              }}
              className="ml-auto shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-50"
            >
              {copied === g.fingerprint ? "✓ 복사됨" : "📋 복사"}
            </button>
          </div>

          {g.regressed && (
            <p className="mb-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
              ⚠ {when(g.resolvedAt as string)}에 해결로 표시했는데 그 뒤에 또 났습니다
              {g.note ? ` (그때 적은 것: ${g.note})` : ""}.
            </p>
          )}

          <p className="whitespace-pre-wrap text-slate-700">{g.message}</p>
          {g.stack && <p className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-snug text-slate-400">{g.stack}</p>}

          {g.resolved ? (
            <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
              ✓ {when(g.resolvedAt as string)} {g.resolvedBy ?? ""} 해결로 표시 · 그 뒤로 다시 안 났습니다
              {g.note ? ` — ${g.note}` : ""}
            </p>
          ) : noteFor === g.fingerprint ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="무엇을 고쳤는지 (다시 났을 때 이 글을 읽게 됩니다)"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-[11px]"
              />
              <button
                type="button"
                disabled={busy === g.fingerprint}
                onClick={() => void resolve(g, note)}
                className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
              >
                {busy === g.fingerprint ? "표시 중…" : "해결로 표시"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNoteFor(null);
                  setNote("");
                }}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500"
              >
                취소
              </button>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNoteFor(g.fingerprint);
                  setNote(g.note ?? "");
                }}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
              >
                ✓ 고쳤습니다
              </button>
              {/* 「다시 확인」은 창구를 다시 불러보는 것이 아닙니다. 오류가 나는 창구는 대개
                  자료를 바꾸는 자리라, 확인하려다 진짜 자료를 건드리게 됩니다. 대신 지금까지의
                  발생을 다시 세어옵니다 - 누른 뒤로 안 났으면 조용한 시간이 늘어납니다. */}
              <button
                type="button"
                onClick={() => router.refresh()}
                title="창구를 다시 부르지는 않습니다. 지금까지의 발생을 다시 세어옵니다."
                className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
              >
                ↻ 다시 확인
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
