"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { toKoreanDisplayName, type RosterEntry } from "@/lib/pickupParse";

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
  merged_sources?: string[] | null;
  /** '수동'이면 직원이 체크한 것, '답글'이면 토들에서 답글이 확인된 것. */
  answered_via?: string | null;
  replied_by?: string | null;
  replied_at?: string | null;
  reply_status?: string | null;
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
  // 처리한 것까지 볼지. 요청: "체크를 하면 (...) 빼주고, 대신 문의기록으로 저장해줘
  // 나중에 문의사항 검색할 수 있게" - 지우지 않고 숨겨두었다가 여기서 다시 꺼내 봅니다.
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState("");
  // 영어로 온 이름을 한글로 바꾸기 위한 명부. 요청: "영어이름으로 문의를 올렸다면 학생명부와
  // 대조후에 한글이름으로 올려줘". 한 번만 읽어 재사용합니다.
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("pickup_requests")
      // 칸을 하나씩 적지 않고 전부 가져옵니다.
      //
      // 새 기능을 올리면 코드가 먼저 배포되고 마이그레이션이 조금 뒤에 걸리는 순간이 있습니다.
      // 그 사이에 아직 없는 칸을 콕 집어 달라고 하면 **조회 자체가 실패해 화면이 통째로**
      // 비어버립니다. 실제로 그렇게 깨졌습니다. 전부 달라고 하면 있는 것만 돌아오고,
      // 없는 칸은 undefined로 남아 화면은 그대로 뜹니다.
      .select("*")
      .eq("kind", "문의")
      .order("received_at", { ascending: false })
      .limit(200);
    // 데모 계정 연습용 문의(is_demo)는 실제 행정실 문의 목록에 섞이지 않게 걸러냅니다.
    // 마이그레이션 전(칸이 아직 없음)이라도 undefined는 통과하므로 화면이 깨지지 않습니다.
    setRows(((data as (Inquiry & { is_demo?: boolean })[] | null) ?? []).filter((r) => !r.is_demo));
  }, []);

  useEffect(() => {
    // 명부는 자주 바뀌지 않으므로 처음 한 번만 읽습니다.
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("wr_students")
        .select("id, name, name_en, grade")
        .eq("status", "active")
        .eq("is_demo", false);
      setRoster(
        ((data as { id: string; name: string; name_en: string | null; grade: string | null }[] | null) ?? []).map((s) => ({
          id: s.id,
          name: s.name ?? "",
          name_en: s.name_en ?? null,
          grade: s.grade ?? null,
        }))
      );
    })();
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

  const filtered = useMemo(() => {
    let list = mineOnly ? rows.filter((r) => r.homeroom_email === currentUserEmail) : rows;
    // 처리한 것은 기본으로 숨깁니다. 손댈 것만 남아 있어야 목록이 쓸모 있습니다.
    if (!showDone) list = list.filter((r) => !r.answered_at);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.matched_name, r.ai_student_name, r.channel_label, r.summary, r.raw_text, r.inquiry_type]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return list;
  }, [rows, mineOnly, currentUserEmail, showDone, query]);
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
    // 명부와 대조해 한글 이름으로 바꿉니다. 명부가 아직 안 왔거나 못 찾으면 원래 값을 씁니다.
    return (
      toKoreanDisplayName(r.matched_name ?? r.ai_student_name, r.channel_label, roster) ??
      r.channel_label ??
      "미확인"
    );
  }

  const Row = ({ r, full }: { r: Inquiry; full?: boolean }) => (
    <div
      className={
        "flex w-full items-center gap-1.5 rounded px-1 text-left transition hover:bg-black/5 " +
        (full ? "py-1.5 text-xs" : "py-0.5 text-[11px]") +
        (r.answered_at ? " opacity-40" : "")
      }
    >
      {/* 요청: "체크박스를 만들어서 체크를 하면 대시보드, 학부모 문의에서 빼주고" */}
      <input
        type="checkbox"
        checked={!!r.answered_at}
        disabled={busy}
        onChange={(e) => markAnswered(r, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-emerald-500"
        title={r.answered_at ? "처리 취소" : "처리 완료로 표시(기록에는 남습니다)"}
      />
      <button type="button" onClick={() => setDetail(r)} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left">
      {r.urgency === "높음" && !r.answered_at && <span className="shrink-0 text-red-500">●</span>}
      <span className={"shrink-0 font-semibold text-slate-700 " + (full ? "text-sm" : "")}>{studentOf(r)}</span>
      {/* 요청: "답글달렸다는 표시로 이름 뒤에 초록색 체크표시" */}
      {r.answered_via === "답글" && (
        <span
          className="shrink-0 font-bold text-emerald-500"
          title={r.replied_by ? `${r.replied_by} 선생님이 답글을 다셨습니다` : "이미 답글이 달렸습니다"}
        >
          ✓
        </span>
      )}
      {/* 직원이 답은 했지만 아직 끝나지 않은 건(요청: 해결됐는지 안됐는지 표시). */}
      {!r.answered_at && r.reply_status === "pending" && (
        <span
          className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700"
          title={r.replied_by ? `${r.replied_by} 선생님이 답변 중입니다(아직 미해결)` : "답변 중"}
        >
          답변중
        </span>
      )}
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
    </div>
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
          {/* 처리한 문의는 지우지 않고 남겨둡니다 - "그때 그 학부모가 뭐라고 하셨더라"를
              나중에 찾을 수 있어야 하고, 같은 문의가 반복되면 그것 자체가 신호입니다. */}
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + (showDone ? "bg-emerald-100 text-emerald-600" : "text-slate-400 hover:bg-black/5")}
            title="처리한 문의까지 함께 보기"
          >
            기록
          </button>
          {!full && (
            <button type="button" onClick={() => setExpanded(true)} className="text-[10px] font-medium text-blue-400 hover:underline">
              전체보기 →
            </button>
          )}
        </div>
      </div>

      {/* 넓은 자리에서만 검색창을 둡니다. 좁은 자리에서는 줄 하나가 아깝습니다. */}
      {full && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="학생 이름·내용으로 찾기"
          className="mb-1.5 w-full shrink-0 rounded-lg border border-black/5 bg-white/60 px-2 py-1 text-[11px] outline-none focus:border-blue-300"
        />
      )}

      {sorted.length === 0 ? (
        <p className={full ? "text-xs opacity-40" : "text-[11px] opacity-40"}>
          {query ? "찾는 문의가 없습니다." : showDone ? "기록이 없습니다." : "손댈 문의가 없습니다."}
        </p>
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
