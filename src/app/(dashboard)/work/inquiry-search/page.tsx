import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { redirect } from "next/navigation";
import InquirySearchClient, { type FoundInquiry } from "@/components/work/InquirySearchClient";

// 학부모 연락 검색.
//
// 담당자가 채택: "학부모 문의 검색 — 쌓이기만 하고 못 찾습니다.
//                 '작년에 이 학생 뭐라고 했었지'"
//
// 지금 화면은 **최근 것만** 보여줍니다. 인박스는 3일치, 업무보드 목록도 스크롤하면 끝입니다.
// 그런데 학부모 연락은 대개 **나중에** 필요해집니다 - 상담 전에, 같은 일이 또 생겼을 때,
// "지난번에 뭐라고 하셨죠?"라고 물어볼 때.
//
// 새로 저장하는 것은 없습니다. 이미 다 들어와 있는 것을 **찾을 수 있게** 할 뿐입니다.

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

export default async function InquirySearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; from?: string; to?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const kind = sp.kind === "픽업" || sp.kind === "문의" || sp.kind === "기타" ? sp.kind : "";
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : "";
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : "";

  const supabase = await createClient();

  let rows: FoundInquiry[] = [];
  let total = 0;
  let error: string | null = null;

  // 검색어가 없으면 아무것도 읽지 않습니다.
  //
  // 화면을 열자마자 최근 것을 쏟아부으면 "검색하러 온 사람"이 그걸 훑다가 원래 찾던 것을
  // 잊습니다. 그리고 학부모 연락 전체를 이유 없이 화면에 올릴 이유도 없습니다.
  if (q || kind || from || to) {
    let query = supabase
      .from("pickup_requests")
      .select(
        "id, received_at, service_date, kind, status, source, source_url, source_chat_id, channel_label, matched_name, ai_student_name, summary, raw_text, inquiry_type, answered_at, answered_by",
        { count: "exact" }
      )
      .eq("is_demo", false)
      .order("received_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (q) {
      // 원문·요약·학생 이름·채팅방 이름을 한 번에 봅니다. 사람은 어느 칸에 들어 있는지
      // 모른 채 기억나는 단어를 칩니다.
      const like = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
      query = query.or(
        `raw_text.ilike.${like},summary.ilike.${like},matched_name.ilike.${like},ai_student_name.ilike.${like},channel_label.ilike.${like}`
      );
    }
    if (kind) query = query.eq("kind", kind);
    if (from) query = query.gte("received_at", `${from}T00:00:00+09:00`);
    if (to) query = query.lte("received_at", `${to}T23:59:59+09:00`);

    const res = await query;
    error = res.error?.message ?? null;
    total = res.count ?? 0;
    rows = ((res.data ?? []) as FoundInquiry[]) ?? [];
  }

  // 토들 원문으로 돌아가는 주소의 앞부분. 저장된 source_url 하나에서 뽑아 씁니다
  // (하원 체크표와 같은 방식 - 설정 칸을 새로 만들지 않습니다).
  const { data: baseRow } = await supabase
    .from("pickup_requests")
    .select("source_url")
    .not("source_url", "is", null)
    .limit(1)
    .maybeSingle();
  const toddleBase =
    ((baseRow?.source_url as string | null) ?? "").match(/^(https:\/\/[^/]+\/platform\/[^/]+)/)?.[1] ?? null;

  return (
    <InquirySearchClient
      rows={rows}
      total={total}
      pageSize={PAGE_SIZE}
      q={q}
      kind={kind}
      from={from}
      to={to}
      error={error}
      toddleBase={toddleBase}
    />
  );
}
