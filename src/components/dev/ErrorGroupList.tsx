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

/** 전체 다시 확인의 결과. 창구가 돌려주는 모양 그대로입니다. */
type RecheckReport = {
  checked: number;
  probed: number;
  resolved: number;
  outcomes: { fingerprint: string; route: string; resolved: boolean; why: string }[];
};

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
  /** 전체 다시 확인 결과. 무엇을 넘겼고 무엇이 아직 나는지 그대로 보여줍니다. */
  const [recheck, setRecheck] = useState<RecheckReport | null>(null);
  const [rechecking, setRechecking] = useState(false);

  const open = useMemo(() => groups.filter((g) => !g.resolved), [groups]);
  const done = useMemo(() => groups.filter((g) => g.resolved), [groups]);
  const shown = tab === "open" ? open : done;

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  /**
   * **전부 다시 확인합니다.**
   *
   * 창구가 열어볼 수 있는 화면은 실제로 열어보고, 열 수 없는 자리(크론·POST)는 조용한
   * 시간으로 봅니다. 고쳐진 것만 해결로 넘어가고, 아직 나는 것은 그대로 남습니다 -
   * **무엇을 왜 그렇게 판단했는지** 줄마다 돌려받아 화면에 적습니다.
   */
  async function recheckAll() {
    setRechecking(true);
    setError(null);
    setRecheck(null);
    try {
      const res = await fetch("/api/dev/error-recheck", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as RecheckReport & { error?: string };
      if (!res.ok) {
        setError(json.error ?? `창구가 ${res.status} 로 답했습니다`);
        return;
      }
      setRecheck(json);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRechecking(false);
    }
  }

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
        {/* **전부 다시 확인.** 오류마다 하나씩 누르게 하면 아무도 안 누릅니다 - 고친 뒤에
            확인할 것이 스무 가지면 스무 번을 눌러야 했습니다. */}
        <button
          type="button"
          onClick={() => void recheckAll()}
          disabled={rechecking || open.length === 0}
          title="열어볼 수 있는 화면은 실제로 열어보고, 열 수 없는 자리(크론·창구)는 조용한 시간으로 봅니다. 고쳐진 것만 해결로 넘어갑니다."
          className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {rechecking ? "확인하는 중…" : `↻ ${open.length}가지 전부 다시 확인`}
        </button>
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

      {recheck && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-900">
          <b>
            {recheck.checked}가지를 다시 확인했습니다 — {recheck.resolved}가지를 해결로 넘겼고,{" "}
            {recheck.checked - recheck.resolved}가지는 그대로 남았습니다.
          </b>
          {recheck.probed > 0 && <span className="text-blue-700"> (그중 {recheck.probed}가지는 화면을 실제로 열어봤습니다)</span>}
          <ul className="mt-1 flex flex-col gap-0.5">
            {recheck.outcomes.map((o) => (
              <li key={o.fingerprint} className={o.resolved ? "text-emerald-800" : "text-slate-600"}>
                {o.resolved ? "✓" : "·"} <span className="font-mono">{o.route}</span> — {o.why}
              </li>
            ))}
          </ul>
          {/* 넘긴 판단이 틀려도 되돌릴 필요가 없다는 것을 적어둡니다 - 안 적으면 누르기를
              망설이게 되고, 망설이는 단추는 안 쓰이는 단추입니다. */}
          <p className="mt-1 text-blue-700">해결로 넘긴 것이 또 나면 저절로 「다시 났습니다」를 달고 돌아옵니다.</p>
        </div>
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
              {/* 예전에는 이 단추가 목록을 다시 세어올 뿐이라, 눌러도 **아무 일도 안 일어나
                  보였습니다.** 이제 위의 「전부 다시 확인」과 같은 일을 합니다 - 열어볼 수 있는
                  화면은 실제로 열어보고, 열 수 없는 자리는 조용한 시간으로 봅니다. 한 줄만
                  확인하는 길은 두지 않습니다: 고친 뒤에는 어차피 전부 봐야 하고, 길이 둘이면
                  한쪽만 고치는 날이 옵니다. */}
              <button
                type="button"
                disabled={rechecking}
                onClick={() => void recheckAll()}
                title="열어볼 수 있는 화면은 실제로 열어봅니다. 고쳐졌으면 해결로 넘어가고, 아직 나면 그대로 남습니다."
                className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                {rechecking ? "확인 중…" : "↻ 다시 확인"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
