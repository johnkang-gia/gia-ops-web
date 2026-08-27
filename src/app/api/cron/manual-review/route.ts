import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";

// 요청 8번(매뉴얼 정기 리뷰 사이클): daily-backup 크론과 동일한 패턴(Bearer CRON_SECRET +
// 서비스 역할 키)으로 주 1회 실행되어, "오래돼서 한번은 다시 봐야 할" 항목과 "최근 관련 사건이
// 급증했는데 매뉴얼은 그대로인" 항목을 AI 호출 없이 순수 조건 판정만으로 찾아 manual_review_flags에
// 남깁니다. 관리자는 /manuals 화면 상단 배너에서 확인하고 "확인 완료"로 해소합니다.
const STALE_DAYS = 180; // 6개월 이상 안 고쳐졌으면 "오래됨"
const SURGE_WINDOW_DAYS = 90;
const SURGE_THRESHOLD = 5; // 홈 화면 반복패턴(3건)보다 더 급한 신호만 리뷰 대상으로 올림

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    let flagged = 0;

    // 1) 오래됨: 마지막 수정이 STALE_DAYS 이전인 항목.
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleSections } = await supabase
      .from("manual_sections")
      .select("id, category, target_doc, updated_at")
      .lt("updated_at", staleCutoff);
    for (const s of (staleSections as { id: string; category: string; target_doc: string; updated_at: string }[]) ?? []) {
      const { data: existing } = await supabase
        .from("manual_review_flags")
        .select("id")
        .eq("section_id", s.id)
        .eq("reason", "오래됨")
        .eq("resolved", false)
        .maybeSingle();
      if (existing) continue;
      const lastUpdated = s.updated_at.slice(0, 10);
      const { error: insertErr } = await supabase.from("manual_review_flags").insert({
        section_id: s.id,
        reason: "오래됨",
        detail: `[${s.target_doc}] ${s.category} - 마지막 수정: ${lastUpdated} (${STALE_DAYS}일 이상 경과)`,
      });
      if (!insertErr) flagged += 1;
    }

    // 2) 사건급증: 최근 SURGE_WINDOW_DAYS일 내 같은 manual_cat 사건이 SURGE_THRESHOLD건 이상
    // 발생했는데, 그 카테고리의 매뉴얼 항목이 이미 존재하는 경우.
    const surgeCutoff = new Date(Date.now() - SURGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: recentIncidents } = await supabase
      .from("incidents")
      .select("manual_cat")
      .not("manual_cat", "is", null)
      .gte("date", surgeCutoff);
    const counts = new Map<string, number>();
    for (const row of (recentIncidents as { manual_cat: string }[]) ?? []) {
      const key = (row.manual_cat || "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const surgingCategories = Array.from(counts.entries()).filter(([, c]) => c >= SURGE_THRESHOLD);

    if (surgingCategories.length > 0) {
      const { data: matchingSections } = await supabase
        .from("manual_sections")
        .select("id, category, target_doc")
        .in("category", surgingCategories.map(([cat]) => cat));
      for (const s of (matchingSections as { id: string; category: string; target_doc: string }[]) ?? []) {
        const count = counts.get(s.category) || 0;
        const { data: existing } = await supabase
          .from("manual_review_flags")
          .select("id")
          .eq("section_id", s.id)
          .eq("reason", "사건급증")
          .eq("resolved", false)
          .maybeSingle();
        if (existing) continue;
        const { error: insertErr } = await supabase.from("manual_review_flags").insert({
          section_id: s.id,
          reason: "사건급증",
          detail: `[${s.target_doc}] ${s.category} - 최근 ${SURGE_WINDOW_DAYS}일 내 관련 사건 ${count}건 발생, 매뉴얼 최신성 점검 필요`,
        });
        if (!insertErr) flagged += 1;
      }
    }

    await touchHeartbeat(supabase, "cron:manual-review");
    return NextResponse.json({ ok: true, flagged });
  } catch (err) {
    await logApiError(supabase, "cron:manual-review", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
