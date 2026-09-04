import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";

// 새 학기 시작.
//
// 학기가 바뀌면 **지난 학기 것을 지우지 않습니다.** 그때 누가 몇 호차를 탔는지, 무슨 교재를
// 샀는지가 전부 그 학기에 매달려 있습니다. 새 학기를 하나 더 만들고, 필요한 것만 복사해서
// 시작합니다.
//
// 무엇을 복사할지는 학교가 정합니다. 이 학교 기준으로는
//   · 셔틀 노선·정류장 — 정규학기 것을 조금씩 고쳐 씁니다 → 복사
//   · 탑승 배정(아이들) — 캠프는 타는 아이가 달라집니다 → 복사하지 않습니다
//   · 반 편성·명단 — 새로 뽑습니다 → 복사하지 않습니다
//   · 학비외 항목 — 학기마다 다릅니다. 복사할지는 고르게 둡니다

export const dynamic = "force-dynamic";

type Body = {
  termType?: string;
  year?: string;
  startDate?: string | null;
  endDate?: string | null;
  shuttleLabel?: string;
  copyShuttle?: boolean;
  copyFeeItems?: boolean;
};

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 학기 전환은 학교 전체가 따라 움직이는 일이라 관리자만 합니다.
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 학기를 바꿀 수 있습니다." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Body;
  const termType = (b.termType ?? "").trim();
  const year = (b.year ?? "").trim();
  const shuttleLabel = (b.shuttleLabel ?? "").trim() || termType;
  if (!termType || !year) return NextResponse.json({ error: "학기 이름과 연도를 적어주세요." }, { status: 400 });

  const supabase = await createClient();

  const { data: prevRows, error: prevErr } = await supabase
    .from("terms")
    .select("*")
    .eq("status", "진행중")
    .limit(1);
  if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 500 });
  const prev = prevRows?.[0] ?? null;

  const { data: caseId, error: idErr } = await supabase.rpc("next_term_case_id");
  if (idErr) return NextResponse.json({ error: `학기 번호를 만들지 못했습니다: ${idErr.message}` }, { status: 500 });

  // 이전 학기를 먼저 내립니다. 진행중은 하나뿐이라 순서를 지키지 않으면 새 학기가 안 들어갑니다.
  if (prev) {
    const { error } = await supabase.from("terms").update({ status: "종료" }).eq("id", prev.id);
    if (error) return NextResponse.json({ error: `지난 학기를 닫지 못했습니다: ${error.message}` }, { status: 500 });
  }

  const { data: made, error: makeErr } = await supabase
    .from("terms")
    .insert({
      case_id: caseId as unknown as string,
      term_type: termType,
      year,
      start_date: b.startDate || null,
      end_date: b.endDate || null,
      status: "진행중",
      shuttle_label: shuttleLabel,
    })
    .select()
    .single();
  if (makeErr || !made) {
    // 새 학기를 못 만들었으면 이전 학기를 되돌립니다. 진행중인 학기가 하나도 없는 상태가
    // 되면 거의 모든 화면이 빈 채로 뜹니다.
    if (prev) await supabase.from("terms").update({ status: "진행중" }).eq("id", prev.id);
    return NextResponse.json({ error: makeErr?.message ?? "학기를 만들지 못했습니다." }, { status: 500 });
  }

  const copied = { routes: 0, stops: 0, feeItems: 0 };
  const warnings: string[] = [];

  if (b.copyShuttle && prev?.shuttle_label) {
    const { data: routes, error } = await supabase.from("shuttle_routes").select("*").eq("term", prev.shuttle_label);
    if (error) warnings.push(`노선을 읽지 못했습니다: ${error.message}`);
    else {
      for (const r of routes ?? []) {
        const { id: _oldId, created_at: _c, ...rest } = r as Record<string, unknown>;
        const { data: newRoute, error: rErr } = await supabase
          .from("shuttle_routes")
          .insert({ ...rest, term: shuttleLabel, term_id: made.id })
          .select("id")
          .single();
        if (rErr || !newRoute) {
          warnings.push(`${String((r as { route_no?: string }).route_no ?? "")}호 노선을 복사하지 못했습니다: ${rErr?.message ?? ""}`);
          continue;
        }
        copied.routes += 1;

        const { data: stops, error: sErr } = await supabase.from("shuttle_stops").select("*").eq("route_id", _oldId as string);
        if (sErr) {
          warnings.push(`${String((r as { route_no?: string }).route_no ?? "")}호 정류장을 읽지 못했습니다: ${sErr.message}`);
          continue;
        }
        const rows = (stops ?? []).map((s) => {
          const { id: _si, created_at: _sc, ...srest } = s as Record<string, unknown>;
          return { ...srest, route_id: newRoute.id };
        });
        if (rows.length > 0) {
          const { error: insErr } = await supabase.from("shuttle_stops").insert(rows);
          if (insErr) warnings.push(`정류장을 복사하지 못했습니다: ${insErr.message}`);
          else copied.stops += rows.length;
        }
      }
    }
  }

  if (b.copyFeeItems && prev) {
    // active 로 거르지 않습니다. 항목은 끄는 것이 아니라 지웁니다(2026-09) - 남아 있는 줄은
    // 전부 쓰는 것입니다. 거르면 옛 자료에서 넘어온 줄이 조용히 안 넘어옵니다.
    const { data: items, error } = await supabase.from("fee_items").select("*").eq("term_id", prev.id);
    if (error) warnings.push(`학비외 항목을 읽지 못했습니다: ${error.message}`);
    else {
      const rows = (items ?? []).map((i) => {
        const { id: _i, created_at: _c, updated_at: _u, ...rest } = i as Record<string, unknown>;
        return { ...rest, term_id: made.id, created_by: me.email };
      });
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("fee_items").insert(rows);
        if (insErr) warnings.push(`학비외 항목을 복사하지 못했습니다: ${insErr.message}`);
        else copied.feeItems = rows.length;
      }
    }
  }

  return NextResponse.json({ ok: true, term: made, previous: prev, copied, warnings });
}
