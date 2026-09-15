import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { todayKst, kstDateOffset } from "@/lib/kst";
import { isNoteKind, type DayNote } from "@/lib/studentDayNotes";

/**
 * **오늘 이 아이에 대해 알아야 할 것** 창구.
 *
 * ── 이름은 서버가 명부에서 찾습니다 ────────────────────────────────────────
 *
 * 화면이 보낸 이름을 그대로 저장하지 않습니다. 김재이가 셋인데(CLAUDE.md §2-4-1) 이름을
 * 믿으면 어느 아이인지 서버는 끝내 모르고, 나중에 「이 약 누구 거지」를 되짚을 수 없습니다.
 * **번호만 받고 이름은 명부에서 읽습니다.** 번호가 명부에 없으면 저장하지 않고 그대로
 * 알립니다 - 조용히 넘기면 아무 아이에게도 안 붙은 줄이 남습니다.
 *
 * ── 앞날 며칠까지 ──────────────────────────────────────────────────────────
 *
 * 기본은 오늘부터 이레입니다. 「다음 주 수요일 병원」을 미리 적을 수 있어야 하고, 그보다
 * 먼 것은 이 칸이 아니라 학사일정·업무에 적는 편이 맞습니다.
 */

export const dynamic = "force-dynamic";

const AHEAD_DAYS = 7;
const MAX_CONTENT = 300;

type Row = {
  id: string;
  student_id: string;
  student_name: string;
  on_date: string;
  kind: string;
  content: string;
  created_by_name: string | null;
  created_at: string;
};

function toNote(r: Row, nameById: Map<string, string>): DayNote {
  return {
    id: r.id,
    studentId: r.student_id,
    // 명부의 지금 이름이 먼저입니다. 적을 때의 이름을 그대로 쓰면 개명·오타가 영영 남습니다.
    // 명부에서 사라진 아이(전학)만 그날 적힌 이름으로 보여줍니다.
    studentName: nameById.get(r.student_id) ?? r.student_name,
    onDate: r.on_date,
    kind: isNoteKind(r.kind) ? r.kind : "기타",
    content: r.content,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  };
}

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createClient();
  const today = todayKst();
  const until = kstDateOffset(AHEAD_DAYS);

  const { data, error } = await supabase
    .from("student_day_notes")
    .select("id, student_id, student_name, on_date, kind, content, created_by_name, created_at")
    .is("deleted_at", null)
    .gte("on_date", today)
    .lte("on_date", until)
    .order("on_date")
    .order("created_at");

  if (error) return NextResponse.json({ error: `특이사항을 읽지 못했습니다: ${error.message}` }, { status: 500 });

  const rows = (data as Row[] | null) ?? [];
  const nameById = await loadNames(supabase, rows.map((r) => r.student_id));
  return NextResponse.json({ today, notes: rows.map((r) => toNote(r, nameById)) });
}

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { studentId?: string; onDate?: string; kind?: string; content?: string }
    | null;
  if (!body) return NextResponse.json({ error: "보낸 내용을 읽지 못했습니다." }, { status: 400 });

  const studentId = (body.studentId ?? "").trim();
  const content = (body.content ?? "").trim();
  const onDate = (body.onDate ?? "").trim() || todayKst();
  const kind = isNoteKind(body.kind) ? body.kind : "기타";

  if (!studentId) return NextResponse.json({ error: "학생을 먼저 고르세요." }, { status: 400 });
  if (!content) return NextResponse.json({ error: "무엇을 해야 하는지 적어주세요." }, { status: 400 });
  if (content.length > MAX_CONTENT) return NextResponse.json({ error: `내용은 ${MAX_CONTENT}자까지입니다.` }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return NextResponse.json({ error: "날짜 모양이 올바르지 않습니다." }, { status: 400 });

  const supabase = await createClient();

  // 번호가 진짜 명부에 있는 아이인지 확인합니다. 화면에서 고른 것이라도 그 사이 전학 갈 수
  // 있고, 없는 번호로 들어간 줄은 어느 화면에도 안 뜨면서 표에만 남습니다.
  const { data: student, error: stuErr } = await supabase
    .from("wr_students_basic")
    .select("id, name")
    .eq("id", studentId)
    .maybeSingle();
  if (stuErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${stuErr.message}` }, { status: 500 });
  if (!student) return NextResponse.json({ error: "명부에 없는 학생입니다. 다시 골라주세요." }, { status: 400 });

  const { data, error } = await supabase
    .from("student_day_notes")
    .insert({
      student_id: studentId,
      student_name: (student as { name: string }).name,
      on_date: onDate,
      kind,
      content,
      created_by: me.email,
      created_by_name: me.name || me.email,
    })
    .select("id, student_id, student_name, on_date, kind, content, created_by_name, created_at")
    .single();

  if (error) return NextResponse.json({ error: `저장하지 못했습니다: ${error.message}` }, { status: 500 });
  return NextResponse.json({ note: toNote(data as Row, new Map()) });
}

/**
 * 잘못 적은 줄 내리기. **지우지 않고 내립니다** - 「없었다」와 「아니라고 판단했다」는
 * 다른 말이라, 나중에 「그 약 얘기 어디 갔지」를 되짚을 수 있어야 합니다.
 */
export async function PATCH(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = (body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "무엇을 내릴지 알 수 없습니다." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_day_notes")
    .update({ deleted_at: new Date().toISOString(), deleted_by: me.email })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");

  if (error) return NextResponse.json({ error: `내리지 못했습니다: ${error.message}` }, { status: 500 });
  // 이미 내려간 줄이면 고쳐진 것이 없습니다. 「됐습니다」로 답하면 화면에서는 사라졌다가
  // 다음 갱신에 다시 나타나고, 사람은 무엇이 맞는지 알 수 없습니다.
  if (!data || data.length === 0) return NextResponse.json({ error: "이미 내려간 줄입니다." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** 명부의 지금 이름. 한 번에 읽습니다 - 줄마다 읽으면 스무 줄에 스무 번 왕복합니다. */
async function loadNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("wr_students_basic").select("id, name").in("id", unique);
  return new Map(((data as { id: string; name: string }[] | null) ?? []).map((s) => [s.id, s.name]));
}
