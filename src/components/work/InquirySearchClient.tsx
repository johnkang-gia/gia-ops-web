"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/kst";

// 학부모 연락 검색 화면.
//
// 지금 화면들은 **최근 것만** 보여줍니다. 그런데 학부모 연락은 대개 **나중에** 필요해집니다 -
// 상담 전에, 같은 일이 또 생겼을 때, "지난번에 뭐라고 하셨죠?"라고 물어볼 때.
//
// 새로 저장하는 것은 없습니다. 이미 들어와 있는 것을 찾을 수 있게 할 뿐입니다.

export type FoundInquiry = {
  id: string;
  received_at: string;
  service_date: string | null;
  kind: string | null;
  status: string | null;
  source: string;
  source_url: string | null;
  source_chat_id: string | null;
  channel_label: string | null;
  matched_name: string | null;
  ai_student_name: string | null;
  summary: string | null;
  raw_text: string | null;
  inquiry_type: string | null;
  answered_at: string | null;
  answered_by: string | null;
};

const KIND_STYLE: Record<string, string> = {
  픽업: "bg-blue-50 text-blue-700",
  문의: "bg-amber-50 text-amber-700",
  기타: "bg-slate-100 text-slate-500",
};

/** 찾은 낱말에 표시를 합니다. 긴 글에서 어디가 걸렸는지 눈으로 못 찾으면 검색이 반쪽입니다. */
function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-yellow-200 px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function InquirySearchClient({
  rows,
  total,
  pageSize,
  q,
  kind,
  from,
  to,
  error,
  toddleBase,
}: {
  rows: FoundInquiry[];
  total: number;
  pageSize: number;
  q: string;
  kind: string;
  from: string;
  to: string;
  error: string | null;
  toddleBase: string | null;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(q);
  const [open, setOpen] = useState<FoundInquiry | null>(null);

  function search(next: Partial<{ q: string; kind: string; from: string; to: string }>) {
    const p = new URLSearchParams();
    const v = { q: term, kind, from, to, ...next };
    if (v.q) p.set("q", v.q);
    if (v.kind) p.set("kind", v.kind);
    if (v.from) p.set("from", v.from);
    if (v.to) p.set("to", v.to);
    router.push(`/work/inquiry-search?${p.toString()}`);
  }

  function toddleUrl(r: FoundInquiry): string | null {
    if (r.source_url) return r.source_url;
    if (toddleBase && r.source_chat_id) return `${toddleBase}/messaging/${r.source_chat_id}`;
    return null;
  }

  const searched = !!(q || kind || from || to);

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-1 text-lg font-bold text-slate-800">🔍 학부모 연락 검색</h1>
      <p className="mb-3 text-[11px] text-slate-400">
        토들·구글챗으로 들어온 학부모 연락 전체에서 찾습니다. 원문·요약·학생 이름·채팅방 이름을 한 번에 봅니다.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search({ q: term });
        }}
        className="mb-3 flex flex-wrap items-center gap-1.5"
      >
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="이름 · 단어 · 문장 일부"
          className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-700">
          찾기
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {(["", "픽업", "문의", "기타"] as const).map((k) => (
          <button
            key={k || "all"}
            type="button"
            onClick={() => search({ kind: k })}
            className={
              "rounded-lg px-2 py-1 text-xs font-semibold " +
              (kind === k ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")
            }
          >
            {k || "전체"}
          </button>
        ))}
        <input
          type="date"
          defaultValue={from}
          onChange={(e) => search({ from: e.target.value })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        />
        <span className="text-xs text-slate-400">~</span>
        <input
          type="date"
          defaultValue={to}
          onChange={(e) => search({ to: e.target.value })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        />
      </form>

      {error && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          찾지 못했습니다: {error}
        </p>
      )}

      {!searched ? (
        // 열자마자 최근 것을 쏟아부으면 "찾으러 온 사람"이 그걸 훑다가 원래 찾던 것을 잊습니다.
        <p className="py-12 text-center text-sm text-slate-400">
          찾을 말을 넣고 <b>찾기</b>를 누르세요.
          <br />
          <span className="text-xs">학생 이름, 기억나는 단어, 문장 일부 무엇이든 됩니다.</span>
        </p>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">찾은 것이 없습니다.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {total}건 중 {rows.length}건
            {total > pageSize && (
              <span className="ml-1 text-slate-400">· 더 좁히려면 기간이나 분류를 함께 쓰세요</span>
            )}
          </p>
          <div className="divide-y divide-slate-100 overflow-hidden g-panel-solid">
            {rows.map((r) => {
              const who = r.matched_name ?? r.ai_student_name ?? r.channel_label ?? "이름 없음";
              const body = r.raw_text ?? r.summary ?? "";
              return (
                <button
                  key={r.id}
                  onClick={() => setOpen(r)}
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-slate-50"
                >
                  <span
                    className={
                      "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " +
                      (KIND_STYLE[r.kind ?? "기타"] ?? KIND_STYLE.기타)
                    }
                  >
                    {r.kind ?? "기타"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                      <b className="text-sm text-slate-800">{highlight(who, q)}</b>
                      {r.inquiry_type && <span className="text-[11px] text-slate-400">{r.inquiry_type}</span>}
                      <span className="text-[11px] text-slate-400">
                        {r.received_at.slice(0, 10)} · {timeAgo(r.received_at)}
                      </span>
                      {r.answered_at && <span className="text-[11px] text-emerald-600">✓ 처리됨</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">
                      {body ? highlight(body.slice(0, 160), q) : <i className="text-slate-300">원문 없음</i>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <b className="text-base text-slate-800">{open.matched_name ?? open.ai_student_name ?? "이름 없음"}</b>
              <span className="text-xs text-slate-400">
                {open.kind} · {open.source} · {open.received_at.slice(0, 16).replace("T", " ")}
              </span>
            </div>
            {open.summary && <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{open.summary}</p>}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
              {open.raw_text ?? <i className="text-slate-400">원문이 저장되지 않은 건입니다.</i>}
            </p>
            <div className="mt-3 flex items-center gap-2">
              {toddleUrl(open) && (
                <a
                  href={toddleUrl(open)!}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  ↗ 토들에서 보기
                </a>
              )}
              <button onClick={() => setOpen(null)} className="ml-auto rounded-lg px-2.5 py-1 text-xs text-slate-400">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
