import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Adopted } from "@/lib/types";
import { plainTextToHtml } from "@/lib/manualHtml";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const { data: row, error: fetchErr } = await supabase.from("adopted").select("*").eq("id", id).single();
  if (fetchErr || !row) {
    return NextResponse.json({ error: fetchErr?.message || "채택예정 항목을 찾을 수 없습니다." }, { status: 404 });
  }
  const adopted = row as Adopted;
  if (!adopted.specific_text?.trim()) {
    return NextResponse.json({ error: "구체화한 최종 내용이 비어있습니다." }, { status: 400 });
  }

  // 동시접속 안전장치(요청: "동시접속,동시사용환경을 원활하게"): 예전에는 "같은 항목(target_doc+
  // category)이 이미 있는지 조회 → 있으면 update, 없으면 insert"를 클라이언트/서버가 따로 실행했
  //습니다. 서로 다른 채택예정 두 건이 같은 항목에 거의 동시에 발행되면, 둘 다 "아직 없음"으로
  // 읽고 동시에 insert를 시도해 유니크 제약(target_doc, category) 위반으로 한쪽이 발행 실패할 수
  // 있었습니다. upsert_manual_section RPC가 insert ... on conflict do update를 한 번의 원자적
  // 쓰기로 처리하므로, 몇 건이 동시에 발행돼도 항상 안전하게 이어붙여집니다.
  // p_source/p_source_id는 매뉴얼 항목에 원본 사건/회의 기록으로 되돌아갈 수 있는 역참조 링크를
  // 남기고(요청 1번), p_domain은 이 항목이 속한 정책영역(요청 4번)을 매뉴얼 화면에도 넘겨줍니다.
  const { error: upsertErr } = await supabase.rpc("upsert_manual_section", {
    p_target_doc: adopted.target_doc,
    p_category: adopted.category,
    p_addition_html: plainTextToHtml(adopted.specific_text),
    p_source: adopted.source,
    p_source_id: adopted.source_id,
    p_domain: adopted.domain,
  });
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

  const { error: publishErr } = await supabase
    .from("adopted")
    .update({ publish: true, published_at: new Date().toISOString() })
    .eq("id", id);
  if (publishErr) return NextResponse.json({ error: publishErr.message }, { status: 500 });

  // 요청 3번(GIA시스템 자동 매칭, AI 호출 없이 비용 0): 발행된 매뉴얼 문구가 "미보유" 상태인
  // GIA시스템 항목의 이름을 그대로 언급하고 있으면, 단순 포함(substring) 여부만으로 두 기록을
  // 연결해둡니다. 실제로 "보유"로 바꾸는 판단은 사람이 GIA시스템 화면에서 직접 확인 후 하도록,
  // 상태값 자체는 건드리지 않고 참조 링크만 남깁니다.
  const { data: unmatchedSystems } = await supabase
    .from("gia_systems")
    .select("id, name")
    .eq("status", "미보유")
    .is("related_manual_category", null);
  const haystack = `${adopted.category} ${adopted.specific_text}`;
  for (const sys of unmatchedSystems || []) {
    if (sys.name && sys.name.trim().length >= 2 && haystack.includes(sys.name.trim())) {
      await supabase
        .from("gia_systems")
        .update({ related_manual_category: adopted.category, related_manual_target_doc: adopted.target_doc })
        .eq("id", sys.id);
    }
  }

  // GIA시스템 제안이 발행되면, 관리자가 매뉴얼/서류함 등 다른 곳을 따로 갱신할 필요 없이
  // GIA시스템 현황판의 해당 행이 자동으로 "보유"로 바뀝니다(요청 사항: "추가가되면 자동으로
  // 반영"). 이 갱신이 실패해도 매뉴얼 발행 자체는 이미 끝났으므로 에러로 막지 않습니다.
  if (adopted.source === "system" && adopted.system_ref_id) {
    await supabase
      .from("gia_systems")
      .update({ status: "보유", adopted_from_id: adopted.id, adopted_at: new Date().toISOString() })
      .eq("id", adopted.system_ref_id);
  }

  return NextResponse.json({ success: true });
}
