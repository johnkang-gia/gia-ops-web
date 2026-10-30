import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRevision, parseSince } from "@/lib/boardRevision";
import { setBoardingStatus, type BoardingStatus } from "@/lib/boardingWrite";
import { loadChecklistData } from "@/lib/checklistLoad";
import { applyPersistentNotes } from "@/lib/checklistNotes";
import { effectiveRouteId, isMoved } from "@/lib/shuttleRoute";
import { loadStudents } from "@/lib/students";
import { nameKey } from "@/lib/studentKey";
import { todayKst } from "@/lib/kst";

export const dynamic = "force-dynamic";

/**
 * **모바일 하원 체크표** — 로그인 없이 링크 하나로 엽니다.
 *
 * 하원 시간에 현장에 나가 있는 교직원은 PC 체크표를 볼 수 없습니다. 휴대폰으로 같은 명단을 보고
 * 그 자리에서 픽업·결석을 누르고, 알게 된 것을 메모로 남깁니다.
 *
 * - 열쇠는 도착체크와 같은 `shuttle_arrival_links.token` 입니다. 현장 교직원이 이미 가진 링크라
 *   새 열쇠를 나눠줄 일이 없고, 링크를 닫으면 두 화면이 함께 닫힙니다.
 * - 명단은 PC 체크표와 **같은 함수**(`loadChecklistData` + `applyPersistentNotes`)로 만듭니다.
 *   따로 짜면 한쪽에서 뺀 아이가 다른 쪽에는 타는 아이로 남습니다(CLAUDE.md 2-13).
 * - 로그인이 없어 사람을 알 수 없으므로, 휴대폰에서 적은 이름을 「모바일 체크표(이름)」으로 남깁니다.
 */
function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
type Svc = NonNullable<ReturnType<typeof service>>;

async function loadLink(supabase: Svc, token: string) {
  const { data, error } = await supabase
    .from("shuttle_arrival_links")
    .select("id, label, term, enabled")
    .eq("token", token)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data || !data.enabled) return { error: "유효하지 않거나 종료된 링크입니다." };
  return { link: data as { id: string; label: string; term: string; enabled: boolean } };
}

type MemoRow = {
  id: string;
  content: string;
  author: string | null;
  source: string;
  created_at: string;
  checked_at: string | null;
  checked_by: string | null;
};

async function loadMemos(supabase: Svc, today: string, term: string) {
  const { data, error } = await supabase
    .from("shuttle_day_memos")
    .select("id, content, author, source, created_at, checked_at, checked_by")
    .eq("service_date", today)
    .eq("term", term)
    .is("hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  // 못 읽었으면 「메모 없음」이 아니라 「못 읽음」으로 알립니다(CLAUDE.md 5).
  return { memos: (data as MemoRow[] | null) ?? [], memoError: error?.message ?? null };
}

/** 사람이 적은 이름을 기록용으로 다듬습니다. 비면 「이름 없음」 - 빈 칸보다 그게 정직합니다. */
function authorLabel(raw: unknown) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
  return s || "이름 없음";
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const { link, error } = await loadLink(supabase, token);
  if (error || !link) return NextResponse.json({ error: error ?? "유효하지 않은 링크입니다." }, { status: 403 });
  const term = link.term === "여름캠프2" ? "여름캠프2" : "정규학기";
  const today = todayKst();

  // 메모는 매번 읽습니다(가볍고, 방금 쓴 것이 바로 보여야 합니다). 명단은 번호가 바뀌었을 때만.
  const { memos, memoError } = await loadMemos(supabase, today, term);
  const rev = await checkRevision(supabase, "shuttle", parseSince(req.url), `mobile-checklist:${term}`);
  if (!rev.stale) return NextResponse.json({ unchanged: true, revision: rev.revision, memos, memoError });

  // 동명이인 구분은 명부 전체에서 셉니다. 공용 뷰는 서비스 키에서 비어 나오므로 loadStudents 로.
  const { rows: students, error: stuErr } = await loadStudents(supabase);
  if (stuErr) console.error("[모바일 체크표] 명부를 읽지 못했습니다 — 동명이인 구분이 빠집니다:", stuErr);
  const count = new Map<string, number>();
  for (const s of students) count.set(nameKey(s.name), (count.get(nameKey(s.name)) ?? 0) + 1);
  const homonymNames = new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  const classById = new Map(students.map((s) => [s.id, s.class_name ?? s.grade ?? null]));

  const data = await loadChecklistData(supabase, term, { homonymNames, light: true });
  const routeById = new Map(data.routes.map((r) => [r.id, r]));
  const items = applyPersistentNotes(data.items, data.persistentNotes, routeById, homonymNames, data.today);

  const label = (name: string, id?: string | null) => {
    if (!homonymNames.has(nameKey(name))) return name;
    const where = id ? classById.get(id) : null;
    // 겹치는 이름인데 번호가 없으면 누구인지 모르는 것입니다. 숨기지 않고 「?」로 적습니다(§2-4).
    return `${name}(${where ?? "?"})`;
  };

  const byRoute = new Map<string, typeof items>();
  for (const it of items) {
    const rid = effectiveRouteId(it);
    if (!routeById.has(rid)) continue;
    (byRoute.get(rid) ?? byRoute.set(rid, []).get(rid)!).push(it);
  }

  const routes = data.routes
    .map((r) => {
      const list = byRoute.get(r.id) ?? [];
      return {
        id: r.id,
        routeNo: r.route_no,
        name: r.name,
        driverName: r.driver_name,
        driverPhone: r.driver_phone ?? null,
        vehicleNo: r.vehicle_no ?? null,
        students: list.map((it) => ({
          assignmentId: it.assignmentId,
          studentId: it.studentId ?? null,
          name: label(it.studentName, it.studentId),
          rawName: it.studentName,
          status: it.status,
          riding: it.ridingToday !== false || it.status === "탑승",
          baseRiding: it.baseRiding ?? it.ridingToday !== false,
          moved: isMoved(it) ? (routeById.get(it.homeRouteId)?.route_no ?? null) : null,
          note: it.note,
          individual: !!it.individualPickup,
          plan: it.dismissalPlan ? [it.dismissalPlan.departTime, it.dismissalPlan.label ?? it.dismissalPlan.kind].filter(Boolean).join(" ") : null,
          auto: it.autoSource
            ? {
                kind: it.autoSource.kind,
                source: it.autoSource.source,
                by: it.autoSource.decidedBy,
                text: it.autoSource.rawText.slice(0, 160),
              }
            : null,
        })),
      };
    })
    // 오늘 아무도 안 타는 차는 현장에서 누를 일이 없습니다(도착체크와 같은 기준).
    .filter((r) => r.students.some((s) => s.riding));

  const rideAlongs = data.rideAlongs
    .filter((r) => r.status !== "취소")
    .map((r) => ({
      id: r.id,
      name: r.studentName ?? r.studentSurface ?? "?",
      host: r.hostName ?? r.hostSurface ?? null,
      routeNo: r.routeNo,
      status: r.status,
    }));

  return NextResponse.json({
    label: link.label,
    term,
    today,
    revision: rev.revision,
    routes,
    rideAlongs,
    memos,
    memoError,
  });
}

const STATUSES: BoardingStatus[] = ["예정", "탑승", "결석", "픽업"];

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = service();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const { link, error } = await loadLink(supabase, token);
  if (error || !link) return NextResponse.json({ error: error ?? "유효하지 않은 링크입니다." }, { status: 403 });
  const term = link.term === "여름캠프2" ? "여름캠프2" : "정규학기";
  const today = todayKst();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action as string | undefined;
  const author = authorLabel(body?.author);

  // ── 픽업 · 결석 · 탑승 · 되돌리기 ───────────────────────────────────────
  if (action === "status") {
    const assignmentId = body?.assignmentId as string | undefined;
    const status = body?.status as BoardingStatus | undefined;
    if (!assignmentId || !status || !STATUSES.includes(status)) {
      return NextResponse.json({ error: "어느 아이를 무엇으로 바꿀지가 필요합니다." }, { status: 400 });
    }
    // 이 링크의 학기에 속한 배정인지 확인합니다. 다른 학기 번호를 넣어도 기록되지 않게.
    const { data: asg } = await supabase.from("shuttle_assignments").select("id, stop_id").eq("id", assignmentId).maybeSingle();
    const { data: stop } = asg
      ? await supabase.from("shuttle_stops").select("route_id").eq("id", asg.stop_id as string).maybeSingle()
      : { data: null };
    const { data: route } = stop
      ? await supabase.from("shuttle_routes").select("term").eq("id", stop.route_id as string).maybeSingle()
      : { data: null };
    if (!asg || (route?.term as string | undefined) !== term) {
      return NextResponse.json({ error: "이 링크에서 다룰 수 없는 학생입니다." }, { status: 403 });
    }
    const { data: prev } = await supabase
      .from("shuttle_boardings")
      .select("status")
      .eq("service_date", today)
      .eq("assignment_id", assignmentId)
      .maybeSingle();
    const { error: werr } = await setBoardingStatus(supabase, {
      serviceDate: today,
      term,
      assignmentId,
      studentName: String(body?.studentName ?? "이름 미확인").slice(0, 40),
      status,
      before: (prev?.status as string | undefined) ?? "예정",
      // 로그인이 없는 화면이라 계정을 모릅니다. 자리와 적은 이름을 함께 남깁니다.
      actor: { email: "", name: `모바일 체크표(${author})` },
    });
    if (werr) return NextResponse.json({ error: werr }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── 메모 쓰기 ──────────────────────────────────────────────────────────
  if (action === "memo") {
    const content = String(body?.content ?? "").trim();
    if (!content) return NextResponse.json({ error: "메모 내용이 비어 있습니다." }, { status: 400 });
    if (content.length > 1000) return NextResponse.json({ error: "메모는 1,000자까지 적을 수 있습니다." }, { status: 400 });
    const { data, error: ierr } = await supabase
      .from("shuttle_day_memos")
      .insert({ service_date: today, term, content, author, source: "모바일", link_id: link.id })
      .select("id, content, author, source, created_at, checked_at, checked_by")
      .single();
    if (ierr) return NextResponse.json({ error: `메모를 저장하지 못했습니다: ${ierr.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, memo: data });
  }

  // ── 잘못 쓴 메모 숨기기 ─────────────────────────────────────────────────
  // 지우지 않습니다. 숨긴 사람·때를 남기고 화면에서만 내립니다.
  if (action === "memo_hide") {
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: "어느 메모인지가 필요합니다." }, { status: 400 });
    const { data, error: uerr } = await supabase
      .from("shuttle_day_memos")
      .update({ hidden_at: new Date().toISOString(), hidden_by: `모바일 체크표(${author})` })
      .eq("id", id)
      .eq("service_date", today)
      .eq("source", "모바일")
      .is("hidden_at", null)
      .select("id");
    if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "오늘 모바일에서 쓴 메모만 숨길 수 있습니다." }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action 은 status · memo · memo_hide 중 하나입니다." }, { status: 400 });
}
