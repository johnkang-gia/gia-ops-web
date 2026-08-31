import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { todayKst, kstDateOffset } from "@/lib/kst";
import { logApiError } from "@/lib/logging";
import { touchHeartbeat } from "@/lib/heartbeat";
import { genCaseId } from "@/lib/caseId";

// 학사일정 → 업무보드 자동 등록 (요청 ④⑤)
//
// 담당자: "그것이 자동으로 업무로 등록되어서 학사일정을 차질없이 진행할 수 있도록",
//         "이 부분 업무보드랑 연계되어서 해당 주가 되면 업무등록 자동으로 되게 해줘."
//
// 달력에만 적혀 있는 일정은 **달력을 열어본 사람만** 압니다. 업무보드는 매일 보는 곳이니,
// 때가 되면 일정이 스스로 그리로 걸어 들어가야 합니다.
//
// 규칙은 하나입니다: **오늘부터 task_lead_days 안에 닥친 것**만 올립니다.
//   · 너무 일찍 올리면 보드가 몇 달 뒤 일로 가득 차서 오늘 할 일이 묻힙니다.
//   · 너무 늦게 올리면 올라온 순간 이미 늦었습니다.
// 기본값은 7일 — 담당자가 말한 "해당 주가 되면"입니다.
//
// 한 번 올린 것은 다시 안 올립니다(task_id가 채워지면 끝). 업무를 지워도 되살아나지
// 않습니다 - 지운 것은 지운 이유가 있습니다.

export const dynamic = "force-dynamic";

type ItemRow = {
  id: string;
  term_id: string | null;
  title: string;
  description: string | null;
  department: string | null;
  due_date: string;
  end_date: string | null;
  done: boolean;
  task_id: string | null;
  template_id: string | null;
};

type MeetingRow = {
  id: string;
  item_id: string;
  seq: number;
  meet_date: string;
  title: string | null;
  done: boolean;
  task_id: string | null;
};

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
  await touchHeartbeat(supabase, "cron:academic-tasks");

  try {
    const today = todayKst();
    // 가장 넉넉한 lead(30일)까지 한 번에 읽고, 템플릿별 lead로 다시 거릅니다.
    // 템플릿마다 조회를 나누면 쿼리가 수십 번 나갑니다.
    const horizon = kstDateOffset(30);

    const [{ data: tplRows }, { data: itemRows }] = await Promise.all([
      supabase.from("academic_checklist_templates").select("id, auto_task, task_lead_days, department"),
      supabase
        .from("academic_checklist_items")
        .select("id, term_id, title, description, department, due_date, end_date, done, task_id, template_id")
        .is("task_id", null)
        .eq("done", false)
        .gte("due_date", today)
        .lte("due_date", horizon)
        .limit(500),
    ]);

    const tpl = new Map(
      ((tplRows ?? []) as { id: string; auto_task: boolean; task_lead_days: number; department: string | null }[]).map(
        (t) => [t.id, t]
      )
    );
    const items = (itemRows ?? []) as ItemRow[];

    // ── 항목 → 업무 ──────────────────────────────────────────────
    const madeItems: { itemId: string; taskId: string; title: string }[] = [];
    for (const it of items) {
      const t = it.template_id ? tpl.get(it.template_id) : null;
      // 손으로 더한 항목(템플릿 없음)도 올립니다 - 기본 7일.
      if (t && !t.auto_task) continue;
      const lead = t?.task_lead_days ?? 7;
      if (it.due_date > kstDateOffset(lead)) continue;

      const range = it.end_date && it.end_date !== it.due_date ? ` (${it.due_date}~${it.end_date})` : "";
      const { data: task, error: tErr } = await supabase
        .from("tasks")
        .insert({
          case_id: genCaseId("TSK"),
          title: `[학사일정] ${it.title}`.slice(0, 80),
          description:
            (it.description ? `${it.description}\n\n` : "") +
            `학사일정에서 자동으로 등록된 업무입니다${range}. 완료하면 학사일정 달력에도 함께 표시됩니다.`,
          status: "예정",
          priority: "보통",
          department: it.department ?? t?.department ?? null,
          // 담당자는 비워둡니다. 시스템이 만든 업무라 주인이 없고, 보드에서 사람이 집어
          // 갑니다. 아무나 한 명을 넣으면 그 사람만의 일이 되어 오히려 안 굴러갑니다.
          //
          // 기간이 있으면 **끝나는 날**이 마감입니다. 시작일을 마감으로 두면 첫날부터
          // 늦은 업무가 됩니다.
          due_at: `${it.end_date ?? it.due_date}T23:59:59+09:00`,
          position: Date.now(),
          term_id: it.term_id,
          origin_mode: "전체",
        })
        .select("id")
        .single();
      if (tErr || !task) continue;
      await supabase
        .from("academic_checklist_items")
        .update({ task_id: task.id, task_created_at: new Date().toISOString() })
        .eq("id", it.id);
      madeItems.push({ itemId: it.id, taskId: task.id as string, title: it.title });
    }

    // ── 회의 → 업무 ──────────────────────────────────────────────
    // 회의는 "그 주에 모이는 것"이라 미리 올릴 이유가 없습니다. 7일로 고정합니다.
    const { data: meetRows } = await supabase
      .from("academic_checklist_meetings")
      .select("id, item_id, seq, meet_date, title, done, task_id")
      .is("task_id", null)
      .eq("done", false)
      .gte("meet_date", today)
      .lte("meet_date", kstDateOffset(7))
      .limit(300);

    const meetings = (meetRows ?? []) as MeetingRow[];

    // 회의의 부모 항목을 따로 읽습니다.
    //
    // 위의 items는 "아직 업무로 안 올라간 것"만 담고 있습니다. 부모 항목이 이미 업무로
    // 올라갔으면 거기 없어서, 회의 제목이 "학사일정 2차 회의"처럼 무엇에 대한 회의인지
    // 없는 채로 만들어집니다 - 그러면 보드에서 보고도 무슨 회의인지 모릅니다.
    const parentIds = [...new Set(meetings.map((m) => m.item_id))];
    const { data: parentRows } = parentIds.length
      ? await supabase
          .from("academic_checklist_items")
          .select("id, term_id, title, department, due_date, end_date, done, task_id, template_id, description")
          .in("id", parentIds)
      : { data: [] };
    const itemById = new Map(((parentRows ?? []) as ItemRow[]).map((i) => [i.id, i]));
    const madeMeetings: { meetingId: string; taskId: string }[] = [];
    for (const m of meetings) {
      const parent = itemById.get(m.item_id);
      const { data: task, error: tErr } = await supabase
        .from("tasks")
        .insert({
          case_id: genCaseId("TSK"),
          title: `[회의] ${m.title ?? `${parent?.title ?? "학사일정"} ${m.seq}차 회의`}`.slice(0, 80),
          description:
            `학사일정에 딸린 ${m.seq}차 회의입니다. 이 자리에서 한 주 동안 누가 무엇을 맡을지 나누고, ` +
            `다음 회의에서 처리한 일과 결정한 일을 함께 봅니다.`,
          status: "예정",
          priority: "보통",
          department: parent?.department ?? null,
          due_at: `${m.meet_date}T23:59:59+09:00`,
          position: Date.now(),
          term_id: parent?.term_id ?? null,
          origin_mode: "전체",
        })
        .select("id")
        .single();
      if (tErr || !task) continue;
      await supabase
        .from("academic_checklist_meetings")
        .update({ task_id: task.id, task_created_at: new Date().toISOString() })
        .eq("id", m.id);
      madeMeetings.push({ meetingId: m.id, taskId: task.id as string });
    }

    return NextResponse.json({
      ok: true,
      today,
      scannedItems: items.length,
      createdItemTasks: madeItems.length,
      scannedMeetings: meetings.length,
      createdMeetingTasks: madeMeetings.length,
      titles: madeItems.map((m) => m.title),
    });
  } catch (err) {
    await logApiError(supabase, "cron:academic-tasks", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
