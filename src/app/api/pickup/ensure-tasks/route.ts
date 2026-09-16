import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { kstParts } from "@/lib/shuttleTracking";
import { buildPickupTask } from "@/lib/pickupTask";
import { loadTodayPickups } from "@/lib/pickups";

export const dynamic = "force-dynamic";

/**
 * 오늘 확정된 픽업을 업무보드에 올립니다.
 *
 * 수집기가 새로 받는 건은 그 자리에서 업무가 생기지만, **이미 들어와 있던 건**과 사람이
 * 인박스에서 손으로 확정한 건은 그 길을 안 지납니다. 그래서 픽업 인박스를 열 때 한 번
 * 훑어 빠진 것을 채웁니다.
 *
 * ── 두 번 만들지 않기 ──────────────────────────────────────────────────────
 *
 * 예전에는 `pickup_requests.task_id` 하나만 봤습니다. 그건 **읽을 때** 보는 값이라, 두
 * 사람이 거의 같은 순간에 인박스를 열면 둘 다 「아직 없다」를 읽고 둘 다 만듭니다. 실제로
 * 9월 11일에 「지수 14:20 픽업」이 4밀리초 차이로 두 줄 생겼습니다 - 화면에는 오류가 아니라
 * 「픽업이 두 건」으로 보이고, 사람은 아이를 두 번 데리러 갑니다.
 *
 * 이제 판단을 데이터베이스가 합니다. 업무 줄에 `origin_ref` 로 연락의 번호를 적고 그 값에
 * 유일 색인을 걸어, 동시에 둘이 넣으면 **한 줄만 들어갑니다.** 실패한 쪽은 이미 있는 줄을
 * 찾아 이어 붙입니다 - 실패했다고 연결까지 빠뜨리면 다음번에 또 만들려 듭니다.
 *
 * ── 픽업은 네 갈래로 들어옵니다 ────────────────────────────────────────────
 *
 * 예전에는 **학부모 연락(`pickup_requests`)에서 확정된 것만** 업무로 만들었습니다. 그런데
 * 오늘 픽업인 아이는 그 갈래만으로 정해지지 않습니다.
 *
 *   ① 하원 체크표에서 사람이 픽업으로 찍은 아이
 *   ② 출결내역에서 픽업으로 등록한 아이
 *   ③ 학부모 연락을 확정한 아이
 *   ④ 미리 등록해 둔 하원수단이 픽업인 아이
 *
 * 그래서 업무보드 달력에는 「픽업 2건」인데 오늘 학생 화면에는 6명이 떴습니다. **같은 날
 * 같은 일을 두 화면이 다르게 셌습니다** - 오류로 안 보이고 그냥 다른 숫자로 보이므로,
 * 달력만 보는 사람은 네 명을 없는 것으로 압니다. 픽업은 사람이 교실로 가서 아이를 데려오는
 * 일이라, 업무에 없으면 그 아이는 아무도 안 데리러 갑니다.
 *
 * 이제 **`loadTodayPickups` 한 곳**이 정한 명단 전부를 업무로 만듭니다(CLAUDE.md §2-13 과
 * 같은 규칙 - 하원 명단은 한 곳에서 정합니다).
 */
export async function POST() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = await createClient();
  const today = kstParts(new Date()).iso;

  // 명부를 먼저 읽습니다. 픽업 판정이 학생 번호 → 이름을 물어보고, 만든 업무에 학년·반·
  // 교실을 적어야 「어디로 가야 하나」가 제목에 있습니다.
  const { data: students } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name, class_id, department")
    .eq("is_demo", false)
    .eq("status", "active");
  const { data: classes } = await supabase
    .from("wr_classes")
    .select("id, grade, class_name, room")
    .eq("is_demo", false);

  type S = { id: string; name: string; grade: string | null; class_name: string | null; class_id: string | null; department: string | null };
  type C = { id: string; grade: string | null; class_name: string | null; room: string | null };
  const byId = new Map(((students as S[] | null) ?? []).map((s) => [s.id, s]));
  const clsById = new Map(((classes as C[] | null) ?? []).map((c) => [c.id, c]));

  // **오늘 픽업이 누구인가는 여기서 정하지 않습니다.** 네 갈래를 합치는 규칙은 한 곳에만
  // 있고(`loadTodayPickups`), 오늘 학생·중앙 대시보드·알람이 모두 그것을 씁니다.
  const pickups = await loadTodayPickups(supabase, today, (id) => byId.get(id)?.name ?? null);
  if (pickups.length === 0) return NextResponse.json({ ok: true, created: 0 });

  // 연락에서 온 갈래는 원문·출처·연결을 붙일 수 있습니다. 학생 번호로 찾습니다 - 이름으로
  // 찾으면 김재이 셋이 한 줄을 나눠 씁니다(CLAUDE.md §2-4-1).
  const { data: reqRows } = await supabase
    .from("pickup_requests")
    .select("id, student_id, matched_name, ai_pickup_time, raw_text, summary, source, source_url, task_id, is_demo, kind, status")
    .eq("service_date", today)
    .eq("status", "확정")
    .limit(300);
  type R = {
    id: string; student_id: string | null; matched_name: string | null; ai_pickup_time: string | null;
    raw_text: string | null; summary: string | null; source: string | null; source_url: string | null;
    task_id: string | null; is_demo?: boolean | null;
  };
  const reqByStudent = new Map<string, R>();
  for (const r of ((reqRows as R[] | null) ?? [])) {
    if (r.is_demo || !r.student_id) continue;
    if (!reqByStudent.has(r.student_id)) reqByStudent.set(r.student_id, r);
  }

  /**
   * **날짜가 어디에도 없는 옛 픽업 업무를 메웁니다.**
   *
   * 시각이 없는 픽업은 마감이 안 걸립니다. 그런 줄은 달력의 어느 날에도 안 붙어서 숫자가
   * 조용히 적어졌습니다. 오늘 만드는 줄에는 `start_on` 을 적지만, **이미 있는 줄은 그대로**
   * 남아 오늘 화면에서도 계속 빠집니다 - 고친 뒤에도 안 고쳐진 것처럼 보입니다.
   *
   * 오늘 것만 메웁니다. 지난 날짜는 어느 날이었는지 알 수 없고, 짐작해서 채우면 그 날짜가
   * 사실처럼 굳습니다.
   */
  const { error: fixErr } = await supabase
    .from("tasks")
    .update({ start_on: today })
    .eq("origin", "픽업")
    .is("due_at", null)
    .is("start_on", null)
    .is("deleted_at", null)
    .gte("created_at", `${today}T00:00:00+09:00`);
  if (fixErr) console.error("[픽업→업무] 옛 줄의 날짜를 메우지 못했습니다:", fixErr.message);

  let created = 0;
  const problems: string[] = [];
  for (const p of pickups) {
    const s = p.studentId ? byId.get(p.studentId) : undefined;
    const req = p.studentId ? reqByStudent.get(p.studentId) : undefined;
    // 이미 업무가 붙은 연락은 건너뜁니다. 연락이 없는 갈래(체크표·하원수단)는 아래
    // `origin_ref` 유일 색인이 두 번 만드는 것을 막습니다.
    if (req?.task_id) continue;

    /**
     * **한 아이에 하루 한 줄.** 갈래가 넷이라 열쇠를 갈래별로 두면 같은 아이가 네 줄
     * 생깁니다 - 화면에는 오류가 아니라 「픽업 네 건」으로 보이고, 사람은 네 번 데리러
     * 갑니다. 그래서 열쇠는 **연락 번호(있으면) 또는 학생 번호+날짜**입니다.
     *
     * 학생 번호가 없는 줄(옛 탑승표 이름만 있는 경우)은 이름+날짜로 둡니다. 겹치는 이름이
     * 같은 날 둘 다 픽업이면 한 줄로 합쳐지는데, 그건 두 번 데리러 가는 것보다 낫습니다 -
     * 제목에 이름이 적히므로 사람이 보고 알아챕니다.
     */
    const ref = req?.id ?? (p.studentId ? `pickup:${p.studentId}:${today}` : `pickup:${p.name}:${today}`);

    const cls = s?.class_id ? clsById.get(s.class_id) : undefined;
    const place =
      [s?.grade ? `${s.grade}학년` : null, s?.class_name ?? null, cls?.room ?? null].filter(Boolean).join(" ") || null;

    const payload = buildPickupTask({
      studentName: s?.name ?? req?.matched_name ?? p.name,
      // 시각은 픽업 판정이 이미 갈래별로 골라 왔습니다. 여기서 다시 고르면 두 곳이 어긋납니다.
      pickupTime: p.time ?? req?.ai_pickup_time ?? null,
      serviceDate: today,
      place,
      department: s?.department ?? null,
      // 픽업은 행정실이 나가는 일입니다. 담임을 담당자로 걸면 교실을 비울 수 없는 사람에게
      // 일이 붙습니다. 지금 화면을 연 행정직원이 맡되, 화면에서 바꿀 수 있습니다.
      ownerEmail: me.email,
      assigneeEmails: [me.email],
      // 연락이 없는 갈래는 **왜 픽업인지**를 적어줍니다. 「체크표에서 사람이 찍음」과
      // 「미리 등록한 하원수단」은 나중에 「이 아이가 왜 떴지」를 답하는 유일한 근거입니다.
      rawText: req?.raw_text ?? req?.summary ?? `${p.source}에서 온 픽업입니다 (${p.via}).`,
      sourceLabel: req?.source ?? p.source,
      sourceUrl: req?.source_url ?? null,
    });

    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .insert({ ...payload, origin_ref: ref })
      .select("id")
      .single();

    if (taskErr || !task) {
      // 23505 = 유일 색인에 걸림. **남이 먼저 만들었다는 뜻이고, 그건 정상입니다.**
      // 그 줄을 찾아 연락에 이어 붙입니다 - 여기서 그냥 넘어가면 연결이 빈 채로 남아
      // 다음번에 또 만들려 듭니다.
      if (taskErr?.code === "23505") {
        if (req) {
          const { data: mine } = await supabase
            .from("tasks")
            .select("id")
            .eq("origin_ref", ref)
            .is("deleted_at", null)
            .maybeSingle();
          if (mine?.id) await supabase.from("pickup_requests").update({ task_id: mine.id }).eq("id", req.id);
        }
        continue;
      }
      // 한 건이 실패해도 나머지는 계속 만듭니다. 다만 조용히 넘기지 않고 **화면에도**
      // 돌려줍니다 - 픽업 업무가 통째로 안 생기는 것이 가장 나쁩니다(§5).
      problems.push(`${p.name}(${taskErr?.message ?? "이유 모름"})`);
      continue;
    }
    if (req) await supabase.from("pickup_requests").update({ task_id: task.id }).eq("id", req.id);
    created += 1;
  }

  return NextResponse.json({ ok: true, created, problems });
}
