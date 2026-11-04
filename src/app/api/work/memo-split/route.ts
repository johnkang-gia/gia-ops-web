import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { todayKst } from "@/lib/kst";
import { logApiError } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";
import { loadRoster } from "@/lib/pickupIngest";
import type { RosterEntry } from "@/lib/pickupParse";
import { resolveStudent } from "@/lib/studentMatch";
import { loadAliasIndex } from "@/lib/aliasIndex";

/**
 * 메모장 글을 «한 건씩» 나눕니다.
 *
 * 전화를 받으며 적는 메모는 여러 건이 한 덩어리로 섞입니다(「김OO 어머님 내일 결석 / 2층 프린터 토너 /
 * 이OO 픽업 4시」). 이 자리는 **나누고 갈래만 제안**합니다. 학생을 누구로 볼지는 여기서 정하지 않습니다 -
 * 문의로 보낸 건은 기존 접수 길(`/api/pickup` manual → ingestPickup)이 동명이인 규칙을 거쳐 정합니다.
 * 같은 판단을 두 곳에서 하면 둘이 다른 아이를 고르는 날이 옵니다.
 */

type Dest = "문의" | "업무" | "쪽지";
type Cand = { id: string; name: string; class_name: string | null };
export type MemoItem = {
  text: string;
  title: string;
  dest: Dest;
  /** AI 가 읽은 학생 이름(글자 그대로). 화면에 보여주기만 합니다. */
  studentText?: string | null;
  /** 동명이인 규칙(matchStudent)으로 한 명으로 좁혀졌을 때만 채웁니다. */
  studentId?: string | null;
  /** 좁혀지지 않았을 때 고를 후보(같은 이름의 아이들). */
  candidates?: Cand[];
};

/**
 * 메모 한 건의 학생 태그. 자동으로 붙이되 **번호로 좁혀질 때만** 붙입니다 - 김재이가 셋인 학교에서
 * 이름 글자로 붙이면 엉뚱한 아이가 태그됩니다. 못 좁히면 후보만 주고 사람이 고릅니다.
 */
function tagStudent(name: string | null | undefined, text: string, roster: RosterEntry[], aliases: Map<string, RosterEntry>) {
  const n = (name ?? "").trim();
  if (!n) return { studentId: null, candidates: [] as Cand[] };
  const { student, candidates } = resolveStudent(n, roster, { context: text, aliases });
  if (student) return { studentId: student.id, candidates: [{ id: student.id, name: student.name, class_name: student.class_name ?? null }] };
  return {
    studentId: null,
    candidates: (candidates ?? []).slice(0, 8).map((s) => ({ id: s.id, name: s.name, class_name: s.class_name ?? null })),
  };
}

const SYSTEM = `너는 국제학교 행정실 직원의 전화·업무 메모를 정리한다.
메모를 서로 다른 일 단위로 나눈다. 한 사람(한 학부모·한 학생)에 대한 한 가지 연락은 한 건이다.
각 건마다:
- text: 그 건에 해당하는 원문 문장(원문의 말을 바꾸지 말고 그대로, 필요하면 앞뒤 문장을 붙인다)
- title: 25자 이내 요약(누가·무엇을)
- student: 이 건이 가리키는 학생 이름(메모에 적힌 그대로, 없으면 null). 여러 명이면 첫 번째.
- dest: 학부모·학생에 관한 연락(결석, 픽업, 하원, 아픔, 물건, 상담, 납부 문의 등)이면 "문의",
        직원이 해야 할 내부 일(구매, 수리, 서류, 연락 돌리기)이면 "업무",
        모두가 알면 되는 짧은 알림이면 "쪽지".
나눌 것이 없으면 한 건으로 둔다. 원문에 없는 내용을 지어내지 않는다.
JSON 만 답한다: {"items":[{"text":"...","title":"...","student":"김OO","dest":"문의"}]}`;

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me || !isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const text = String(body?.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "메모가 비어 있습니다." }, { status: 400 });
  if (text.length > 6000) return NextResponse.json({ error: "메모가 너무 깁니다(6,000자까지). 나눠서 등록해 주세요." }, { status: 400 });

  try {
    const raw = (await callClaudeJson(SYSTEM, `[오늘] ${todayKst()}\n\n메모:\n"""\n${text}\n"""`, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 1500,
      route: "memo-split",
    })) as { items?: unknown } | null;
    const sb = await createClient();
    const roster = await loadRoster(sb);
    const aliases = await loadAliasIndex(sb, roster);
    const items: MemoItem[] = (Array.isArray(raw?.items) ? raw.items : [])
      .map((v) => v as Partial<MemoItem> & { student?: string | null })
      .filter((v) => typeof v.text === "string" && v.text.trim())
      .slice(0, 20)
      .map((v) => ({
        text: String(v.text).trim(),
        title: String(v.title ?? v.text).trim().slice(0, 40),
        dest: v.dest === "업무" || v.dest === "쪽지" ? v.dest : "문의",
        studentText: v.student ?? null,
        ...tagStudent(v.student, String(v.text), roster, aliases),
      }));
    // AI 가 아무것도 못 나눴으면 통째로 한 건입니다. 「나눌 수 없음」으로 끝내면 적은 글이 갈 곳이 없습니다.
    if (items.length === 0) items.push({ text, title: text.slice(0, 25), dest: "문의" });
    return NextResponse.json({ ok: true, items, ai: true });
  } catch (err) {
    // AI 가 안 되면 빈 줄 기준으로 나눠 돌려줍니다. 사람이 미리보기에서 고칩니다.
    await logApiError(await createClient(), "work:memo-split", err, me.email);
    const items: MemoItem[] = text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((b) => ({ text: b, title: b.slice(0, 25), dest: "문의" as const }));
    return NextResponse.json({
      ok: true,
      items,
      ai: false,
      note: "AI 나누기에 실패해 빈 줄 기준으로 나눴습니다: " + (err instanceof Error ? err.message.slice(0, 100) : String(err)),
    });
  }
}
