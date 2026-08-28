"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { notifyOpsBoardRefresh, OPS_REFRESH_CHANNEL, OPS_REFRESH_EVENT } from "@/lib/opsRefresh";
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
  /** 명부와 연결된 학생. 이름을 눌러 통합 프로필로 가기 위해 씁니다. */
  student_id?: string | null;
  /** 토들 채팅방 id. source_url이 비어 있을 때 주소를 되살리는 데 씁니다. */
  source_chat_id?: string | null;
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

// 날짜 구분선.
//
// 담당자 요청: "학부모 문의사항 날짜별로 구분선 줘서 구별할 수 있게 해줘. 지금은 옆에
// 시간·날짜가 너무 비슷해서 제대로 구분이 안 될 수도 있을 거 같아."
//
// 맞는 지적입니다. 줄 끝의 작은 회색 글씨만으로는 "어제 온 것"과 "오늘 온 것"이 한눈에
// 안 갈립니다. 출결·픽업은 **날짜를 잘못 읽으면 아이가 잘못된 날 차를 타는** 문제라,
// 날짜 경계는 눈에 띄어야 합니다.
// 라벨도 묶기와 **같은 시간대(한국)**로 판단해야 합니다. 서버·브라우저 시간대가 무엇이든
// 학교가 쓰는 날짜는 하나입니다.
function dayLabel(iso: string): string {
  const key = seoulDayKey(iso);
  const todayKeyStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const yestKeyStr = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  if (key === todayKeyStr) return "오늘";
  if (key === yestKeyStr) return "어제";
  // key는 'YYYY-MM-DD'. 정오로 만들어 시간대 경계에서 하루가 밀리지 않게 합니다.
  const d = new Date(`${key}T12:00:00+09:00`);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일 (${wd})`;
}

function DayDivider({ iso, count }: { iso: string; count: number }) {
  const isToday = dayLabel(iso) === "오늘";
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-0.5 py-1 backdrop-blur">
      <span
        className={
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " +
          (isToday ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")
        }
      >
        {dayLabel(iso)}
      </span>
      <span className="shrink-0 text-[10px] text-slate-400">{count}건</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

// 정렬된 목록을 날짜별로 묶습니다. 정렬 자체는 그대로 두고 경계만 찾습니다 -
// "답 안 한 것 먼저"라는 기존 순서를 날짜가 흔들면 안 되기 때문에, 그 순서 안에서
// 날짜가 바뀌는 지점에만 선을 넣습니다.
// 한국 날짜 키. `received_at`은 UTC ISO 문자열이라 앞 10글자를 자르면 **UTC 날짜**가 나옵니다.
//
// 이게 담당자가 본 문제의 원인입니다. 아침 8시(KST)에 온 문의는 UTC로 전날 23시라, 묶기는
// 전날로 묶이는데 라벨(dayLabel)은 한국 시각으로 읽어 "오늘"이라고 적혔습니다. 그래서
// '오늘' 구분선 아래에 수요일 것이 들어앉았습니다. 두 곳이 서로 다른 시간대를 보고 있었습니다.
//
// 'sv-SE' 로캘은 YYYY-MM-DD 형태를 돌려줘서 날짜 키로 쓰기 좋습니다.
function seoulDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function withDayDividers<T extends { id: string; received_at: string }>(list: T[]) {
  const out: { key: string; divider?: { iso: string; count: number }; row?: T }[] = [];
  const counts = new Map<string, number>();
  for (const r of list) {
    const k = seoulDayKey(r.received_at);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let last: string | null = null;
  for (const r of list) {
    const k = seoulDayKey(r.received_at);
    if (k !== last) {
      out.push({ key: `d-${k}`, divider: { iso: r.received_at, count: counts.get(k) ?? 0 } });
      last = k;
    }
    out.push({ key: r.id, row: r });
  }
  return out;
}

// "이 건은 끝났는가"의 기준 하나.
//
// answered_at만 보면 **기계가 답글을 찾아 표시한 것까지 끝난 것으로 칩니다.** 그러면 아직
// 아무도 확인하지 않은 판단이 회색으로 흐려지고, 급한 것 표시(●)도 사라집니다.
// 담당자: "왜 글들 회색으로 처리되었어?" - 원인이 이것입니다.
//
// 끝난 것은 **사람이 체크한 것**뿐입니다.
export function isDone(r: { answered_at: string | null; answered_via?: string | null }): boolean {
  return !!r.answered_at && r.answered_via !== "답글";
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
  // 분류 탭(요청: "학부모 문의사항을 탭으로 쪼개서 지금 분류한 방법으로 분류한대로 볼 수 있게").
  // AI가 이미 inquiry_type으로 나눠놓은 값을 그대로 씁니다 - 새 분류를 만들지 않습니다.
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  // 영어로 온 이름을 한글로 바꾸기 위한 명부. 요청: "영어이름으로 문의를 올렸다면 학생명부와
  // 대조후에 한글이름으로 올려줘". 한 번만 읽어 재사용합니다.
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  // 토들 원문 주소.
  //
  // 담당자: "학부모 문의사항에서 눌러서 토들에서 보기 버튼 만들어줘."
  //
  // 버튼은 이미 있었는데 **source_url이 비어 있는 줄에는 안 떴습니다.** 그 칸은 8월 24일에
  // 생겼고, 수집기가 주소를 못 읽은 경우에도 비어 있습니다. 다행히 방 id(source_chat_id)는
  // 처음부터 저장하고 있었고, 토들 주소는 "학교 주소 + /messaging/ + 방 id" 형태입니다.
  // 학교 주소는 모든 줄이 같으므로, 주소가 있는 줄 하나에서 뽑아 나머지에 그대로 씁니다.
  // 학교 주소를 저장해 둡니다. 화면에 뜬 줄에서만 찾으면, 그 줄들에 주소가 하나도 없을 때
  // 버튼이 통째로 사라집니다(문의만 걸러 보면 실제로 그럴 수 있습니다). 그래서 화면 밖까지
  // 포함해 **주소가 있는 가장 최근 기록 하나**를 따로 읽어 받쳐둡니다.
  const [dbBase, setDbBase] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const { data } = await createClient()
        .from("pickup_requests")
        .select("source_url")
        .not("source_url", "is", null)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const m = ((data?.source_url as string | null) ?? "").match(/^(https:\/\/[^/]+\/platform\/[^/]+)/);
      if (m) setDbBase(m[1]);
    })();
  }, []);

  const toddleBase = useMemo(() => {
    for (const r of rows) {
      const m = (r.source_url ?? "").match(/^(https:\/\/[^/]+\/platform\/[^/]+)/);
      if (m) return m[1];
    }
    return dbBase;
  }, [rows, dbBase]);

  const toddleUrlOf = useCallback(
    (r: Inquiry): string | null => {
      if (r.source_url) return r.source_url;
      if (toddleBase && r.source_chat_id) return `${toddleBase}/messaging/${r.source_chat_id}`;
      return null;
    },
    [toddleBase]
  );

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

    // 표 구독과 **별개로** 서버 방송도 듣습니다.
    //
    // 토들 수집기가 새 문의를 넣는 것은 서버에서 일어나는 일이고, 표 구독은 발행목록이나
    // RLS가 어긋나면 조용히 아무 일도 안 합니다(실제로 그래서 새로고침해야만 떴습니다).
    // 방송은 표 권한과 무관해서, 표 구독이 막혀도 이쪽이 화면을 깨웁니다.
    const refresh = supabase
      .channel(OPS_REFRESH_CHANNEL)
      .on("broadcast", { event: OPS_REFRESH_EVENT }, () => load())
      .subscribe();

    // 다른 창을 보다 돌아왔을 때도 한 번 새로 부릅니다 - 잠깐 끊긴 사이의 것을 놓치지 않도록.
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(refresh);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const filtered = useMemo(() => {
    let list = mineOnly ? rows.filter((r) => r.homeroom_email === currentUserEmail) : rows;
    // 자동으로 감지된 답글은 **숨기지 않습니다.**
    //
    // 담당자: "처리됨이 되어도 목록에는 나오게, 대신 처리됐다는 초록색 체크로 띄워줘.
    //          일단 제대로 체크가 되었나 우리가 다시 한번 보고 업무보드에서 체크해서 없앨게."
    //
    // 맞는 순서입니다. 답글 감지는 **기계의 판단**입니다. 선생님이 "네~"라고 한 것을 답으로
    // 셌을 수도 있고, 다른 이야기에 단 댓글을 셌을 수도 있습니다. 그걸 사람이 확인하기도
    // 전에 목록에서 빼버리면, 틀렸을 때 알아챌 방법이 없습니다.
    //
    // 그래서 **사람이 직접 완료 처리한 것만** 숨깁니다(answered_via='수동').
    // 기계가 감지한 것(answered_via='답글')은 초록 체크를 달고 목록에 남습니다.
    if (!showDone) list = list.filter((r) => !isDone(r));
    if (typeFilter) list = list.filter((r) => (r.inquiry_type ?? "기타") === typeFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.matched_name, r.ai_student_name, r.channel_label, r.summary, r.raw_text, r.inquiry_type]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return list;
  }, [rows, mineOnly, currentUserEmail, showDone, query, typeFilter]);

  // 이미 답변돼서 목록에서 빠진 건수. 숨긴 것이지 없는 것이 아니라는 걸 알려주는 데 씁니다.
  const doneCount = useMemo(() => {
    const base = mineOnly ? rows.filter((r) => r.homeroom_email === currentUserEmail) : rows;
    return base.filter(isDone).length;
  }, [rows, mineOnly, currentUserEmail]);

  // 분류 탭에 붙는 건수 - 분류 필터 자체는 빼고 센 값이라, 탭을 눌러도 다른 탭 숫자가
  // 변하지 않습니다("출결 3건"이 출결 탭에 들어가면 사라지는 일이 없습니다).
  const typeCounts = useMemo(() => {
    const base = (mineOnly ? rows.filter((r) => r.homeroom_email === currentUserEmail) : rows).filter(
      (r) => showDone || !isDone(r)
    );
    const m = new Map<string, number>();
    for (const r of base) {
      const k = r.inquiry_type ?? "기타";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    // 실제로 들어온 분류만, 많은 순으로 보여줍니다 - 늘 비어 있는 탭은 자리만 차지합니다.
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, mineOnly, currentUserEmail, showDone]);
  // 답 안 한 것 먼저, 그 안에서 긴급한 것 먼저. 목록을 훑을 때 손댈 것이 위에 있어야 합니다.
  // 담당자: "어차피 신규 메시지를 맨 위로 해서 아래로 정렬되는 거니까 그냥 요일별로
  //          정렬되도록 해줘."
  //
  // 예전에는 "답 안 한 것 먼저 → 급한 것 먼저 → 최신순" 세 단계로 세웠습니다. 그러면 어제
  // 답 안 한 건이 오늘 온 건보다 위로 올라가서, **날짜 구분선이 오르내립니다** - 오늘 칸
  // 아래에 수요일 것이 섞여 보이던 게 이것 때문입니다. 날짜로만 세우면 구분선이 한 방향으로
  // 흐르고 눈이 따라가기 쉽습니다. 답 안 한 건은 위쪽 '미답변 N건' 숫자와 줄의 색으로
  // 이미 드러나므로 순서까지 흔들 이유가 없습니다.
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.received_at.localeCompare(a.received_at)),
    [filtered]
  );
  const openCount = filtered.filter((r) => !isDone(r)).length;
  const urgentCount = filtered.filter((r) => !isDone(r) && r.urgency === "높음").length;

  async function markAnswered(row: Inquiry, done: boolean) {
    setBusy(true);
    const supabase = createClient();
    // 사람이 누른 것은 반드시 answered_via='수동'으로 남깁니다.
    //
    // 이 칸 하나가 "기계가 답글을 봤다"와 "사람이 확인했다"를 가릅니다. 목록에서 내려도 되는
    // 것은 뒤쪽뿐입니다. 앞쪽은 아직 맞는지 아무도 안 본 판단입니다.
    const patch = done
      ? { answered_at: new Date().toISOString(), answered_by: currentUserEmail, answered_via: "수동" }
      : { answered_at: null, answered_by: null, answered_via: null };
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("pickup_requests").update(patch).eq("id", row.id);
    setBusy(false);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      load();
      return;
    }
    // 사무실 벽면 모니터(운영 대시보드)에서도 바로 사라지도록 신호를 보냅니다 - 폴링을
    // 기다리면 이미 처리한 문의가 화면에 남아 다른 사람이 또 처리하려 들 수 있습니다.
    void notifyOpsBoardRefresh();
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

  // ── 문의 자리에서 바로 셔틀 출결 처리(요청 1) ────────────────────────────────
  //
  // "오늘 지호 결석해요" 같은 문의를 읽고 나서 [셔틀 → 하원 체크표]로 가서 다시 찾아 체크하고
  // 돌아오는 왕복을 없앱니다. 여기서 누르면 하원 체크표가 쓰는 표(shuttle_boardings)에 같은
  // 모양으로 기록되므로, 체크표·안내보드·도착체크·운영 대시보드에 그대로 반영됩니다.
  const [acted, setActed] = useState<Record<string, string>>({});

  async function attendanceAction(r: Inquiry, action: "결석" | "픽업" | "탑승") {
    const studentName = toKoreanDisplayName(r.matched_name ?? r.ai_student_name, r.channel_label, roster) ?? r.matched_name ?? r.ai_student_name;
    if (!studentName) {
      notify("학생 이름을 확정하지 못했습니다. 문의를 열어 이름을 확인해주세요.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/work/attendance-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentName, action, inquiryId: r.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        notify(json.error ?? "처리하지 못했습니다.", "error");
        return;
      }
      if (json.ok === false) {
        // 셔틀 배정이 없는 학생 - 조용히 성공한 척하지 않고 그대로 알립니다.
        notify(json.message ?? "셔틀 배정을 찾지 못했습니다.", "error");
        return;
      }
      setActed((p) => ({ ...p, [r.id]: action }));
      notify(`${json.studentName} · ${action} 처리했습니다(하원 체크표에 반영됨).`, "success");
      load();
      // 이 처리도 문의를 완료로 넘기므로, 벽면 모니터에서도 바로 사라지게 신호를 보냅니다.
      void notifyOpsBoardRefresh();
    } finally {
      setBusy(false);
    }
  }

  // 출결·차량 관련 문의에만 버튼을 답니다. 학습 상담 같은 문의에 [결석] 버튼이 붙으면
  // 잘못 누를 위험만 커집니다.
  const ATTENDANCE_TYPES = new Set(["출결", "차량·하원"]);
  function isAttendanceInquiry(r: Inquiry): boolean {
    if (r.inquiry_type && ATTENDANCE_TYPES.has(r.inquiry_type)) return true;
    // 분류가 비었거나 '기타'로 온 경우를 위한 보조 판단(원문에 출결 낱말이 있으면).
    const t = `${r.summary ?? ""} ${r.raw_text ?? ""}`;
    return /결석|안 ?가|안 ?와|픽업|데리러|하원|지각|조퇴|absent|pick ?up|late/i.test(t);
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
        (isDone(r) ? " opacity-40" : "")
      }
    >
      {/* 요청: "체크박스를 만들어서 체크를 하면 대시보드, 학부모 문의에서 빼주고" */}
      <input
        type="checkbox"
        checked={isDone(r)}
        disabled={busy}
        onChange={(e) => markAnswered(r, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-emerald-500"
        title={
          r.answered_via === "답글"
            ? "토들에 답글이 달린 것을 자동으로 찾았습니다. 맞는지 보고 체크하면 목록에서 내려갑니다."
            : r.answered_at
              ? "처리 취소"
              : "처리 완료로 표시(기록에는 남습니다)"
        }
      />
      <button type="button" onClick={() => setDetail(r)} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left">
      {r.urgency === "높음" && !isDone(r) && <span className="shrink-0 text-red-500">●</span>}
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
      {!isDone(r) && r.reply_status === "pending" && (
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
      {/* 목록에서 바로 토들 원문으로. 담당자: "메시지 내용과 함께 토들에서 보기 버튼."
          예전에는 상세 창을 한 번 더 열어야 이 버튼이 보였습니다. 답을 하려면 어차피 토들로
          가야 하는데, 한 번 더 누르게 할 이유가 없습니다. */}
      {toddleUrlOf(r) && (
        <a
          href={toddleUrlOf(r)!}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 transition hover:bg-slate-800 hover:text-white"
          title="토들에서 이 대화 열기"
        >
          토들 ↗
        </a>
      )}

      {/* 출결 원클릭(요청 1) - 셔틀 화면으로 넘어가지 않고 여기서 바로 하원 체크표에 반영합니다.
          출결·차량 문의에만 붙습니다(학습 상담에 [결석] 버튼이 있으면 오조작만 늘어납니다). */}
      {!isDone(r) && isAttendanceInquiry(r) && (
        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {acted[r.id] ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">🚌 {acted[r.id]}</span>
          ) : (
            (
              [
                ["결석", "bg-red-50 text-red-600 hover:bg-red-100"],
                ["픽업", "bg-sky-50 text-sky-600 hover:bg-sky-100"],
                ["탑승", "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"],
              ] as const
            ).map(([label, cls]) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => attendanceAction(r, label)}
                title={`${studentOf(r)} 학생을 오늘 하원 ${label}(으)로 바로 처리합니다 - 셔틀 체크표에 반영됩니다`}
                className={"rounded px-1.5 py-0.5 text-[10px] font-bold transition disabled:opacity-40 " + cls}
              >
                {label}
              </button>
            ))
          )}
        </div>
      )}
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
            {/* 숨긴 개수를 함께 보여줍니다.
                담당자: "업무보드에 10건이 안 보여, 노유겸만 떠 있어."
                실제로는 10건이 들어와 있었고, 선생님이 토들에서 답을 다신 9건이 자동으로
                '처리됨'이 되어 조용히 빠진 것이었습니다. 목록이 스스로 줄어드는데 그 사실을
                말해주지 않으면, 사람은 **수집이 안 된다고 생각합니다.** 숫자를 붙이면
                "숨긴 것이지 없는 것이 아니다"가 한눈에 보입니다. */}
            {!showDone && doneCount > 0 && (
              <span className="ml-1 rounded-full bg-slate-200 px-1 text-[9px] font-bold text-slate-600">+{doneCount}</span>
            )}
          </button>
          {!full && (
            <button type="button" onClick={() => setExpanded(true)} className="text-[10px] font-medium text-blue-400 hover:underline">
              전체보기 →
            </button>
          )}
        </div>
      </div>

      {/* 분류 탭(요청 2). AI가 매긴 inquiry_type 그대로입니다. 실제로 들어온 분류만 뜹니다. */}
      {typeCounts.length > 1 && (
        <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setTypeFilter(null)}
            className={
              "rounded-full px-2 py-0.5 text-[10px] font-bold transition " +
              (typeFilter === null ? "bg-slate-700 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
            }
          >
            전체 {typeCounts.reduce((s, [, n]) => s + n, 0)}
          </button>
          {typeCounts.map(([t, n]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className={
                "rounded-full px-2 py-0.5 text-[10px] font-bold transition " +
                (typeFilter === t ? (TYPE_STYLE[t] ?? "bg-slate-200 text-slate-700") + " ring-1 ring-current" : "bg-black/5 text-slate-500 hover:bg-black/10")
              }
            >
              {t} {n}
            </button>
          ))}
        </div>
      )}

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
          {withDayDividers(sorted).map((it) =>
            it.divider ? (
              <DayDivider key={it.key} iso={it.divider.iso} count={it.divider.count} />
            ) : (
              <Row key={it.key} r={it.row!} full={full} />
            )
          )}
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
                    {withDayDividers(sorted).map((it) =>
                      it.divider ? (
                        <DayDivider key={it.key} iso={it.divider.iso} count={it.divider.count} />
                      ) : (
                        <Row key={it.key} r={it.row!} full />
                      )
                    )}
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
                    {/* 이름은 이미 명부와 연결돼 있는데 누를 수가 없었습니다. 문의를 읽다가
                        "이 아이가 누구더라" 싶을 때 바로 통합 프로필로 갑니다. */}
                    {detail.student_id ? (
                      <a
                        href={`/students/${detail.student_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-bold text-blue-600 hover:underline"
                        title="이 학생의 통합 프로필 열기"
                      >
                        {studentOf(detail)} ↗
                      </a>
                    ) : (
                      <span className="text-sm font-bold text-slate-800">{studentOf(detail)}</span>
                    )}
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
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* 상세 창 맨 위에도 둡니다. 문의를 읽은 다음 하는 일이 거의 항상 "토들에서
                      답하기"라, 아래로 스크롤해서 찾게 하면 안 됩니다. */}
                  {toddleUrlOf(detail) && (
                    <a
                      href={toddleUrlOf(detail)!}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700"
                    >
                      토들에서 열기 ↗
                    </a>
                  )}
                  <button onClick={() => setDetail(null)} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">
                    ✕
                  </button>
                </div>
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
                {toddleUrlOf(detail) && (
                  // 토들 원문으로. 여는 사람의 토들 로그인으로 열리므로, 그 방 멤버인
                  // 선생님은 바로 열리고 아니면 토들이 권한 없다고 막습니다.
                  <a
                    href={toddleUrlOf(detail)!}
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
