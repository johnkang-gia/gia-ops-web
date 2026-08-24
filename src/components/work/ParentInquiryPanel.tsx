"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";

// 학부모 문의사항 — 예전 실시간 로그가 있던 자리입니다.
//
// 요청: "지금 실시간 로그자리에 학부모 문의사항탭을 넣고 거기에서 토들에 문의한 내용을 학생과
// 대조해서 분류해서 뜨도록하고, 그부분 클릭하면 바로 토들 메세지 창으로 연결"
//
// 토들 수집기가 가져온 학부모 연락 중 '문의'로 분류된 것만 여기 뜹니다. 학생·담임은 채널
// 이름으로 이미 연결되어 있고, 줄을 누르면 토들의 그 채팅방이 새 창으로 열립니다(여는 사람의
// 토들 로그인으로 열리므로, 그 방 멤버인 선생님만 볼 수 있습니다).
//
// 업무로는 자동 등록하지 않습니다(요청: "문의탭에서만 우선보이고 클릭해서 업무로 등록할 수
// 있도록"). 하루 수십 건이 업무 목록에 쏟아지면 원래 업무가 묻히기 때문입니다.

export type Inquiry = {
  id: string;
  received_at: string;
  channel_label: string | null;
  matched_name: string | null;
  ai_student_name: string | null;
  inquiry_type: string | null;
  summary: string | null;
  urgency: string | null;
  raw_text: string | null;
  source: string;
  source_url: string | null;
  homeroom_email: string | null;
  answered_at: string | null;
  answered_by: string | null;
  task_id: string | null;
  /** 같은 내용이 다른 경로로도 들어왔을 때, 그 경로들. 화면에는 이 줄 하나만 뜹니다. */
  merged_sources: string[] | null;
};

const TYPE_STYLE: Record<string, string> = {
  출결: "bg-amber-50 text-amber-700",
  "수업·학습": "bg-blue-50 text-blue-700",
  "생활·교우": "bg-violet-50 text-violet-700",
  "건강·안전": "bg-red-50 text-red-700",
  "차량·하원": "bg-sky-50 text-sky-700",
  "행사·일정": "bg-emerald-50 text-emerald-700",
  "납부·행정": "bg-slate-100 text-slate-600",
  기타: "bg-slate-100 text-slate-500",
};

function timeAgo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

// 요청: "시간이 나와 요일도나오고 오늘이라면 시간도 나와, 이것들도 크롤링해서 언제문의가
// 온건지도 기록해줘"
//
// 토들 목록과 같은 방식으로 적습니다 - 오늘 온 것은 시각만, 그 전 것은 요일이나 날짜.
// "3시간 전"만 있으면 "오전에 온 건가 점심에 온 건가"를 가늠할 수 없어서, 정확한 시각이
// 필요합니다(특히 하원 픽업은 몇 시에 왔는지가 판단에 직접 영향을 줍니다).
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 7) {
    return `${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

const ROW_HEIGHT = 22;
const VISIBLE_ROWS = 3;

export default function ParentInquiryPanel({
  currentUserEmail,
  /**
   * 넓은 자리에 놓을 때 켭니다.
   *
   * 요청: "출결내역쪽에 학부모 문의사항을 넣어서 더 크게 보게 해주고"
   * 좁은 자리에서는 세 줄만 보여주고 [전체보기]로 창을 띄웠는데, 하루에 열 건 넘게 오는
   * 것을 세 줄로 보는 건 사실상 안 보는 것과 같습니다. 넓은 자리에서는 목록을 그대로
   * 다 펼치고 줄 간격도 넉넉하게 둡니다.
   */
  full = false,
}: {
  currentUserEmail: string;
  full?: boolean;
}) {
  const notify = useToast();
  const [rows, setRows] = useState<Inquiry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Inquiry | null>(null);
  const [busy, setBusy] = useState(false);
  // 내 반 것만 볼지. 담임 선생님은 대개 자기 반만 보면 됩니다.
  const [mineOnly, setMineOnly] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("pickup_requests")
      .select(
        "id, received_at, channel_label, matched_name, ai_student_name, inquiry_type, summary, urgency, raw_text, source, source_url, homeroom_email, answered_at, answered_by, task_id, merged_sources"
      )
      .eq("kind", "문의")
      .order("received_at", { ascending: false })
      .limit(200);
    setRows((data as Inquiry[] | null) ?? []);
  }, []);

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("parent-inquiries")
      .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const filtered = useMemo(
    () => (mineOnly ? rows.filter((r) => r.homeroom_email === currentUserEmail) : rows),
    [rows, mineOnly, currentUserEmail]
  );
  // 답 안 한 것 먼저, 그 안에서 긴급한 것 먼저. 목록을 훑을 때 손댈 것이 위에 있어야 합니다.
  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          Number(!!a.answered_at) - Number(!!b.answered_at) ||
          Number(b.urgency === "높음") - Number(a.urgency === "높음") ||
          b.received_at.localeCompare(a.received_at)
      ),
    [filtered]
  );
  const openCount = filtered.filter((r) => !r.answered_at).length;
  const urgentCount = filtered.filter((r) => !r.answered_at && r.urgency === "높음").length;

  async function markAnswered(row: Inquiry, done: boolean) {
    setBusy(true);
    const supabase = createClient();
    const patch = done
      ? { answered_at: new Date().toISOString(), answered_by: currentUserEmail }
      : { answered_at: null, answered_by: null };
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("pickup_requests").update(patch).eq("id", row.id);
    setBusy(false);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      load();
    }
  }

  async function toTask(row: Inquiry) {
    setBusy(true);
    const res = await fetch("/api/pickup/to-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      notify(json.error ?? "업무로 등록하지 못했습니다.", "error");
      return;
    }
    notify("업무로 등록했습니다.", "success");
    setDetail(null);
    load();
  }

  function studentOf(r: Inquiry) {
    return r.matched_name ?? r.ai_student_name ?? r.channel_label ?? "미확인";
  }

  const Row = ({ r, full }: { r: Inquiry; full?: boolean }) => (
    <button
      type="button"
      onClick={() => setDetail(r)}
      className={
        "flex w-full items-center gap-1.5 truncate rounded px-1 text-left text-[11px] transition hover:bg-black/5 " +
        (full ? "py-1.5" : "py-0.5") +
        (r.answered_at ? " opacity-40" : "")
      }
    >
      {r.urgency === "높음" && !r.answered_at && <span className="shrink-0 text-red-500">●</span>}
      <span className="shrink-0 font-semibold text-slate-700">{studentOf(r)}</span>
      {r.inquiry_type && (
        <span className={"shrink-0 rounded px-1 text-[10px] font-semibold " + (TYPE_STYLE[r.inquiry_type] ?? "bg-slate-100")}>
          {r.inquiry_type}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-slate-500">{r.summary ?? r.raw_text ?? ""}</span>
      {/* 같은 일이 토들·구글챗 양쪽으로 들어온 경우. 한 줄로 묶었다는 것을 보여줍니다 -
          "구글챗에도 올렸는데 왜 여기 없지?" 하고 찾게 되는 것을 막습니다. */}
      {r.merged_sources && r.merged_sources.length > 0 && (
        <span
          className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500"
          title={`같은 내용이 ${r.merged_sources.join(", ")}로도 들어와 하나로 묶었습니다.`}
        >
          +{r.merged_sources.join(",")}
        </span>
      )}
      {r.task_id && <span className="shrink-0 text-[10px] text-blue-500">업무</span>}
      <span className="shrink-0 text-[10px] text-slate-400" title={new Date(r.received_at).toLocaleString("ko-KR")}>
        {whenLabel(r.received_at)}
      </span>
    </button>
  );

  return (
    <div className={"flex min-w-0 flex-1 flex-col " + (full ? "h-full px-2.5 pt-2" : "pl-3")}>
      <div className="mb-1.5 flex w-full shrink-0 items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => !full && setExpanded(true)}
          className={
            "flex items-center gap-1.5 font-bold text-blue-600 " + (full ? "text-sm" : "text-xs hover:underline")
          }
        >
          <span>💬 학부모 문의사항</span>
          {openCount > 0 && (
            <span className={"rounded-full px-1.5 text-[10px] font-bold " + (urgentCount > 0 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700")}>
              {openCount}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMineOnly((v) => !v)}
            className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + (mineOnly ? "bg-blue-100 text-blue-600" : "text-slate-400 hover:bg-black/5")}
            title="내 반 학생의 문의만 보기"
          >
            내 반
          </button>
          {!full && (
            <button type="button" onClick={() => setExpanded(true)} className="text-[10px] font-medium text-blue-400 hover:underline">
              전체보기 →
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className={full ? "text-xs opacity-40" : "text-[11px] opacity-40"}>아직 들어온 문의가 없습니다.</p>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          style={full ? undefined : { maxHeight: ROW_HEIGHT * VISIBLE_ROWS }}
        >
          {sorted.map((r) => (
            <Row key={r.id} r={r} full={full} />
          ))}
        </div>
      )}

      {/* 전체 목록 */}
      {expanded &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setExpanded(false)}>
            <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
                <span className="text-sm font-bold text-slate-800">
                  💬 학부모 문의사항 · 미답변 {openCount}건{urgentCount > 0 ? ` (긴급 ${urgentCount})` : ""}
                </span>
                <button onClick={() => setExpanded(false)} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {sorted.length === 0 ? (
                  <p className="text-xs text-slate-300">아직 들어온 문의가 없습니다.</p>
                ) : (
                  <div className="flex flex-col">
                    {sorted.map((r) => (
                      <Row key={r.id} r={r} full />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 문의 하나 상세 */}
      {detail &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
            <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex shrink-0 items-start justify-between gap-2 border-b border-black/5 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-800">{studentOf(detail)}</span>
                    {detail.inquiry_type && (
                      <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + (TYPE_STYLE[detail.inquiry_type] ?? "bg-slate-100")}>
                        {detail.inquiry_type}
                      </span>
                    )}
                    {detail.urgency === "높음" && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">긴급</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {detail.source} · {new Date(detail.received_at).toLocaleString("ko-KR")}
                    {detail.channel_label ? ` · ${detail.channel_label}` : ""}
                  </p>
                </div>
                <button onClick={() => setDetail(null)} className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">
                  ✕
                </button>
              </div>

              <div className="px-4 py-3">
                {detail.summary && <p className="mb-2 text-xs font-semibold text-slate-700">{detail.summary}</p>}
                {detail.raw_text ? (
                  <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">{detail.raw_text}</p>
                ) : (
                  <p className="text-[11px] text-slate-400">보관 기간이 지나 원문은 지워졌습니다.</p>
                )}

                {detail.answered_at && (
                  <p className="mt-2 text-[11px] text-emerald-600">
                    ✓ {detail.answered_by} 님이 {timeAgo(detail.answered_at)} 답변 완료로 표시
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 border-t border-black/5 px-4 py-3">
                {detail.source_url && (
                  // 토들 원문으로. 여는 사람의 토들 로그인으로 열리므로, 그 방 멤버인
                  // 선생님은 바로 열리고 아니면 토들이 권한 없다고 막습니다.
                  <a
                    href={detail.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white"
                  >
                    토들에서 열기 ↗
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => markAnswered(detail, !detail.answered_at)}
                  disabled={busy}
                  className={
                    "rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 " +
                    (detail.answered_at ? "border border-slate-300 text-slate-500" : "bg-emerald-600 text-white")
                  }
                >
                  {detail.answered_at ? "답변 완료 취소" : "답변 완료"}
                </button>
                {!detail.task_id && (
                  <button
                    type="button"
                    onClick={() => toTask(detail)}
                    disabled={busy}
                    className="ml-auto rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-600 disabled:opacity-50"
                  >
                    + 업무로 등록
                  </button>
                )}
                {detail.task_id && <span className="ml-auto self-center text-[11px] font-semibold text-blue-500">이미 업무로 등록됨</span>}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
