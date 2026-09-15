import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import {
  planBackfill,
  type BackfillPlan,
  pickSiblingFromText,
  type BackfillChannel,
  type BackfillRow,
  type OwnerCandidate,
  type SiblingReader,
} from "@/lib/pickupOwner";
import { nameSurfaces, readSiblings } from "@/lib/attendanceIntent";

export const dynamic = "force-dynamic";

/**
 * **지난 연락에 학생 번호를 되짚어 채웁니다.**
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 받는 쪽이 방 연결을 읽어놓고 이름으로 되돌아가는 바람에, 사람이 확인해 둔 방에서 온
 * 연락인데도 학생 번호가 비어 있는 줄이 쌓였습니다. 그 줄은 출결에도, 두 창구 대조에도
 * 못 들어갑니다.
 *
 * 받는 쪽은 고쳤지만(`decideOwner`), **이미 들어와 있는 줄은 저절로 안 고쳐집니다.**
 *
 * ── 미리 보여주고 나서 고칩니다 ─────────────────────────────────────────────
 *
 * `GET` 은 계획만 돌려줍니다 - 몇 줄이 채워지고 몇 줄은 사람이 골라야 하는지. 숫자 없이
 * 「채우기」 단추만 있으면 아무도 못 누릅니다. 눌러도 되는지 판단할 재료가 없으니까요.
 *
 * `POST` 는 **채울 수 있는 줄만** 고칩니다. 형제방처럼 사람이 골라야 하는 줄은 손대지
 * 않습니다 - 둘 중 하나를 기계가 찍으면 오는 아이가 셔틀에서 빠집니다.
 */

async function loadPlan(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [rowsRes, chRes] = await Promise.all([
    supabase
      .from("pickup_requests")
      // **본문을 함께 읽습니다.** 형제방은 방이 하나뿐이라 본문 말고는 누구인지 가릴
      // 재료가 없습니다.
      .select("id, channel_label, channel_id, student_id, matched_name, ai_student_name, raw_text, summary, kind, inquiry_type")
      // **집이 안 붙은 줄도 함께 봅니다.** 학생은 못 정해도 집은 정할 수 있고, 그것만으로도
      // 그 연락이 그 집 아이들 이력에 뜹니다.
      .or("student_id.is.null,channel_id.is.null")
      .eq("is_demo", false),
    // **사람이 확인한 방만** 씁니다. 화면이 제안만 해둔 줄을 쓰면, 기계가 제안한 것이
    // 사람이 확인한 것처럼 굳어집니다.
    supabase
      .from("toddle_channels")
      .select("id, label, confirmed_at, toddle_channel_students(student_id, seq)")
      .not("confirmed_at", "is", null),
  ]);
  if (rowsRes.error) return { error: rowsRes.error.message } as const;
  if (chRes.error) return { error: chRes.error.message } as const;

  type ChRow = { id: string; label: string; toddle_channel_students: { student_id: string; seq: number }[] };
  const chRows = (chRes.data ?? []) as unknown as ChRow[];
  const ids = [...new Set(chRows.flatMap((c) => (c.toddle_channel_students ?? []).map((l) => l.student_id)))];

  const { data: stu, error: sErr } = await supabase
    // demo-ok: 확인된 방이 가리키는 학생 번호로 찍어 읽습니다. 명부를 훑지 않습니다.
    .from("wr_students")
    // **영문명까지 읽습니다.** 「Sunwoo」로만 적어 오는 연락이 있어서, 한글 이름만으로는
    // 형제방에서 누구인지 못 가릅니다.
    .select("id, name, name_en")
    .in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if (sErr) return { error: sErr.message } as const;
  type Stu = { id: string; name: string; name_en: string | null };
  const byId = new Map(((stu ?? []) as Stu[]).map((s) => [s.id, s]));
  const surfacesById = new Map(((stu ?? []) as Stu[]).map((s) => [s.id, nameSurfaces(s.name, s.name_en)]));

  /**
   * 형제방 한 줄을 본문으로 가릅니다. 두 단계입니다.
   *
   * ① **의도로 가릅니다.** 「선우는 등원하고 다현이는 결석」처럼 둘 다 이름이 나오는 글은
   *    이름만으로는 못 가르지만, 결석·픽업 의도가 한 명에게만 있으면 그 아이입니다.
   * ② **이름 나타남으로 가릅니다.** 한 형제의 표기만 본문에 있으면 그 아이입니다.
   *
   * 둘 다 실패하면 **고르지 않습니다.** 형제 중 하나를 기계가 찍으면 오는 아이가 셔틀에서
   * 빠지거나 안 오는 아이가 남습니다 - 하원 시간의 착오는 되돌릴 수 없습니다.
   */
  const readSibling: SiblingReader = (text, candidates) => {
    const withSurfaces = candidates.map((c) => ({ ...c, surfaces: surfacesById.get(c.id) ?? [c.name] }));

    const byIntent = readSiblings(
      text,
      withSurfaces.map((c) => ({ key: c.id, surfaces: [...c.surfaces] })),
    );
    // 형제가 서로 다른 상태면(한 명 등원·한 명 결석) 기계가 제일 자주 뒤집는 자리입니다.
    // 그럴 때는 고르지 않습니다.
    if (byIntent.pick && !byIntent.conflict) {
      const hit = withSurfaces.find((c) => c.id === byIntent.pick!.key);
      if (hit) {
        return { student: { id: hit.id, name: hit.name }, why: `형제방인데 본문이 ${hit.name} 만 ${byIntent.pick.intent}으로 말합니다.` };
      }
    }
    return pickSiblingFromText(text, withSurfaces);
  };

  const channels: BackfillChannel[] = chRows.map((c) => ({
    id: c.id,
    label: c.label,
    // 졸업·전학으로 명부에서 빠진 아이는 뺍니다. 없는 아이를 가리키는 연결은 붙는 순간 틀립니다.
    students: [...(c.toddle_channel_students ?? [])]
      .sort((a, b) => a.seq - b.seq)
      .map((l) => byId.get(l.student_id))
      .filter((x): x is Stu => !!x)
      .map((x) => ({ id: x.id, name: x.name }) satisfies OwnerCandidate),
  }));

  return { plan: planBackfill((rowsRes.data ?? []) as BackfillRow[], channels, readSibling) } as const;
}

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "행정 권한이 필요합니다." }, { status: 403 });

  const supabase = await createClient();
  const r = await loadPlan(supabase);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 500 });

  const { fill, house, ask, skip } = r.plan;
  return NextResponse.json({
    ok: true,
    summary: { fill: fill.length, house: house.length, ask: ask.length, skip: skip.length },
    // 미리 보기용 몇 줄. 전부 내려보내면 화면이 무거워지고, 사람이 확인하는 데는 몇 줄이면 됩니다.
    sample: fill.slice(0, 20),
    // **사람이 골라야 하는 줄은 전부 내려보냅니다.** 이건 미리 보기가 아니라 할 일 목록이라,
    // 앞쪽 몇 줄만 주면 나머지는 영영 아무도 못 봅니다. 지금 4건이고 많아야 수십 건입니다.
    ask,
  });
}

/**
 * **사람이 형제 중 하나를 고릅니다.**
 *
 * 형제방은 방이 하나뿐이라 본문 말고는 가릴 재료가 없고, 본문에 이름이 없으면 기계는
 * 고를 수 없습니다. 그런데 그 글이 출결·하원이면 **누구인지 모르는 채로 둘 수도 없습니다** -
 * 오는 아이가 셔틀에서 빠지거나 안 오는 아이가 남습니다.
 *
 * 그래서 이 창구가 있습니다. 고르는 것은 사람이고, 고른 사실을 남깁니다.
 */
export async function PATCH(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "행정 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { id?: string; studentId?: string } | null;
  const id = body?.id;
  const studentId = body?.studentId;
  if (!id || !studentId) return NextResponse.json({ error: "줄과 학생을 모두 골라야 합니다." }, { status: 400 });

  const supabase = await createClient();

  // **고른 아이가 정말 그 방의 아이인지 확인합니다.** 화면이 보낸 값을 그대로 믿으면,
  // 남의 집 아이를 이 집 연락에 붙일 수 있습니다.
  const { data: row, error: rowErr } = await supabase
    .from("pickup_requests")
    .select("id, channel_id, student_id")
    .eq("id", id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "그 연락을 찾지 못했습니다." }, { status: 404 });
  if ((row as { student_id: string | null }).student_id) {
    return NextResponse.json({ error: "그 사이에 다른 사람이 이미 정했습니다. 새로고침해 주세요." }, { status: 409 });
  }

  const channelId = (row as { channel_id: string | null }).channel_id;
  if (!channelId) return NextResponse.json({ error: "이 연락에는 방이 붙어 있지 않습니다." }, { status: 400 });

  const { data: link, error: linkErr } = await supabase
    .from("toddle_channel_students")
    .select("student_id")
    .eq("channel_id", channelId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
  if (!link) return NextResponse.json({ error: "그 아이는 이 방에 이어져 있지 않습니다." }, { status: 400 });

  const { data: stu } = await supabase
    // demo-ok: 고른 학생 번호로 한 줄만 찍어 읽습니다. 명부를 훑지 않습니다.
    .from("wr_students")
    .select("name")
    .eq("id", studentId)
    .maybeSingle();
  const name = (stu as { name: string } | null)?.name ?? null;

  const { data, error } = await supabase
    .from("pickup_requests")
    .update({
      student_id: studentId,
      matched_name: name,
      // **누가 골랐는지 남깁니다.** 형제 중 하나를 고르는 일은 되돌리기 어려우므로,
      // 나중에 물어볼 사람이 있어야 합니다.
      ai_note: `형제방에서 사람이 ${name ?? "이 아이"} 로 정했습니다 (${me.email})`,
    })
    .eq("id", id)
    // 그 사이에 누가 정했을 수 있습니다. **비어 있는 줄만** 고칩니다.
    .is("student_id", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // 0줄이면 화면에는 성공으로 보이지만 아무것도 안 바뀐 것입니다(CLAUDE.md 5).
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "바뀐 줄이 없습니다. 그 사이에 다른 사람이 정했을 수 있습니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, studentName: name });
}

/**
 * **계획을 실제 표로 내보냅니다.** 화면(POST)과 크론이 같은 함수를 씁니다 - 두 곳에 적으면
 * 반드시 어긋나고, 어긋난 쪽은 「왜 크론은 다르게 채우지」가 됩니다.
 */
export async function applyPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  plan: BackfillPlan,
  by: string,
) {
  let filled = 0;
  let housed = 0;
  const failures: { what: string; error: string }[] = [];

  // ── ① 집 붙이기 ───────────────────────────────────────────────────────
  //
  // 학생이 정해졌든 아니든 붙입니다. 같은 방끼리 묶어 한 번에 - 한 줄씩 보내면 수백 번의
  // 왕복이 되고, 중간에 끊기면 어디까지 갔는지 모릅니다.
  const byChannel = new Map<string, string[]>();
  for (const h of plan.house) byChannel.set(h.channelId, [...(byChannel.get(h.channelId) ?? []), h.id]);
  for (const [channelId, rowIds] of byChannel) {
    const { data, error } = await supabase
      .from("pickup_requests")
      .update({ channel_id: channelId })
      .in("id", rowIds)
      // 그 사이에 붙었을 수 있습니다. **비어 있는 줄만** 고칩니다.
      .is("channel_id", null)
      .select("id");
    if (error) {
      failures.push({ what: `집 ${channelId}`, error: error.message });
      continue;
    }
    housed += (data ?? []).length;
  }

  // ── ② 학생 붙이기 ─────────────────────────────────────────────────────
  const byStudent = new Map<string, string[]>();
  for (const f of plan.fill) byStudent.set(f.studentId, [...(byStudent.get(f.studentId) ?? []), f.id]);
  for (const [studentId, rowIds] of byStudent) {
    const name = plan.fill.find((f) => f.studentId === studentId)?.studentName ?? null;
    const { data, error } = await supabase
      .from("pickup_requests")
      .update({
        student_id: studentId,
        matched_name: name,
        // 되짚어 채웠다는 **사실을 남깁니다.** 나중에 이 줄이 왜 이 아이로 되어 있는지
        // 물어볼 곳이 있어야 합니다.
        ai_note: `사람이 확인한 토들 방 연결로 되짚어 채웠습니다 (${by})`,
      })
      .in("id", rowIds)
      // 그 사이에 누가 손으로 정했을 수 있습니다. **비어 있는 줄만** 고칩니다.
      .is("student_id", null)
      .select("id");
    if (error) {
      failures.push({ what: `학생 ${name ?? studentId}`, error: error.message });
      continue;
    }
    filled += (data ?? []).length;
  }

  return { filled, housed, failed: failures.length, failures: failures.slice(0, 10), stillAsk: plan.ask.length };
}

export { loadPlan };

export async function POST() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "행정 권한이 필요합니다." }, { status: 403 });

  const supabase = await createClient();
  const r = await loadPlan(supabase);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 500 });

  const out = await applyPlan(supabase, r.plan, me.email);
  return NextResponse.json({ ok: true, ...out });
}
