import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { departmentOf } from "@/lib/department";

// 셔틀 배정(shuttle_assignments)의 이름 문자열을 학생 ID로 승격시킵니다.
//
// ── 이 코드의 유일한 원칙 ────────────────────────────────────────────────────
//
// 담당자 확인: "우리에게는 정확한 초등학교·중고등학교 아이들의 명부가 있어. 이걸 기준으로
// 이외의 모든 명단은 제외. (...) 지금 우리 명단(초등 101명, 중고등 36명)을 **절대적 기준**으로
// 삼고 분류해줘."
//
// 그래서 이 코드는 추측하지 않습니다. **명부에 있으면 우리 학생, 없으면 아닙니다.**
// 반 이름 규칙은 명부에 없는 줄이 "왜" 없는지를 설명하는 데만 씁니다 - 없는 아이를 있다고
// 만들어내지 않습니다.
//
// 반 이름 규칙(담당자 설명):
//   유치부   "4 sparrow"      숫자 + 영단어
//   초등부   "G3A", "G5AB"    G + 학년 + 알파벳 1~2개
//   중고등부 "6TH GRADE"      숫자 + TH/ST/ND/RD + GRADE
//
// 유치부는 연결하지 않습니다. 기사님이 그 정류장에 들르는 이유로만 명단에 있고, 별도
// 프로그램으로 따로 운영하기 때문입니다.
//
// 사용법 (로그인한 채로 브라우저에서 열면 됩니다):
//   GET  /api/shuttle/link-students          → 미리보기. 아무것도 바꾸지 않습니다.
//   GET  /api/shuttle/link-students?apply=1  → 실제로 반영합니다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Student = {
  id: string;
  name: string;
  name_en: string | null;
  grade: string | null;
  department: string | null;
  birth_date: string | null;
  class_name: string | null;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[()（）]/g, "").trim();
}

// "김재이(190510)" 처럼 생일을 붙여 쓴 표기를 나눕니다.
// 같은 학년에 같은 이름이 둘 있을 때 선생님들이 실제로 쓰는 방식입니다.
// (parseHint 로 대체됨 - 괄호 안이 생일 말고 반 코드·부서일 수도 있어서)

function birthKey(d: string | null): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1].slice(2)}${m[2]}${m[3]}` : null;
}

/**
 * 반 이름으로 부서를 읽습니다. 못 읽으면 null.
 *
 * 처음엔 "숫자 + 공백 + 영단어"만 유치부로 봤는데, 실제 데이터는 훨씬 지저분했습니다.
 * 미리보기에서 나온 것들:
 *
 *   "5Falcon"            공백 없음
 *   "Pelican 4"          영단어가 앞
 *   "Emu 7"              영단어가 앞
 *   "7Crane/5Toucan"     두 반을 겹쳐 씀
 *   "Swan/"              잘려 있음
 *   "7 Albatorss"        오타
 *   "6 seahwak/4pelican" 오타 + 겹침
 *
 * 이걸 전부 규칙으로 잡으려 하면 끝이 없습니다. 그래서 뒤집었습니다 -
 * **초등부·중고등부 형식이 아니면서 영문이 들어 있으면 유치부**입니다.
 * 담당자가 알려준 대로 반 이름 형식은 세 가지뿐이니, 앞의 둘을 정확히 알면 나머지는 전부
 * 유치부입니다. 새 새 이름(유치부 반은 새 이름을 씁니다)이 생겨도 규칙을 안 고쳐도 됩니다.
 */
export function departmentFromClassName(cls: string | null | undefined): "유치부" | "초등부" | "중고등부" | null {
  if (!cls) return null;
  const c = cls.trim();
  if (!c) return null;

  // 중고등부: "6TH GRADE", "7th". 숫자 바로 뒤에 서수 어미가 **단어로 끊겨야** 합니다.
  // (이 조건이 없으면 "5Starling"의 "5St"가 걸립니다.)
  if (/\b\d+\s*(st|nd|rd|th)\b/i.test(c)) return "중고등부";

  // 초등부: G + 학년 + 알파벳 1~2개. "G3A", "G5AB", "G 4 A", "G3J"
  if (/\bg\s*\d+\s*[a-z]{1,2}\b/i.test(c)) return "초등부";

  // 나머지 중 영문이 들어 있으면 유치부(새 이름).
  if (/[a-z]{2,}/i.test(c)) return "유치부";

  return null;
}

/**
 * "김재이(G3J)", "이준서(중등)", "김재이(190510)" 처럼 이름 뒤 괄호에 든 힌트를 읽습니다.
 *
 * 동명이인을 구분하려고 선생님들이 실제로 쓰는 표기입니다. 생일만 쓰는 줄 알았는데
 * 미리보기에서 반 코드와 부서로 구분한 것들이 나왔습니다 - 사람은 그때그때 편한 걸 씁니다.
 */
function parseHint(raw: string): { name: string; birth: string | null; cls: string | null; dept: string | null } {
  const m = raw.match(/^(.*?)[(（]\s*([^)）]+?)\s*[)）]\s*$/);
  if (!m) return { name: raw.trim(), birth: null, cls: null, dept: null };
  const name = m[1].trim();
  const hint = m[2].trim();
  if (/^\d{6}$/.test(hint)) return { name, birth: hint, cls: null, dept: null };
  if (/^g\s*\d+\s*[a-z]{0,2}$/i.test(hint)) return { name, birth: null, cls: hint, dept: null };
  if (/중등|중학|고등|고교/.test(hint)) return { name, birth: null, cls: null, dept: "중고등부" };
  if (/초등/.test(hint)) return { name, birth: null, cls: null, dept: "초등부" };
  return { name, birth: null, cls: null, dept: null };
}

// 한 칸에 이름이 둘 들어 있는 경우("김서준 김서연", "김서준/김서연")를 나눕니다.
// 담당자 확인: "이름은 두 개인데 반이 한 개만 적힌 경우". 먼저 통째로 대조해보고, 안 되면
// 쪼개서 각각 대조합니다 - 통째로 맞는 이름을 괜히 쪼개지 않기 위해서입니다.
function splitNames(raw: string): string[] {
  const parts = raw.split(/[,/·|]|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  // 구분자가 없으면 공백으로. 한글 이름 2~4자가 둘 이상 붙어 있을 때만 쪼갭니다.
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length >= 2 && tokens.every((t) => /^[가-힣]{2,4}$/.test(t))) return tokens;
  return [raw.trim()];
}

export async function GET(req: NextRequest) {
  const userDb = await createClient();
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  const db = createServiceClient(url, key, { auth: { persistSession: false } });

  const apply = req.nextUrl.searchParams.get("apply") === "1";

  const [{ data: studentRows }, { data: rows }] = await Promise.all([
    // **재학 중인 학생만** 명부로 씁니다.
    //
    // 처음엔 이 조건을 빼먹어서 454행 중 292명이 대조 대상으로 잡혔습니다. 실제 명부는 137명
    // (초등 101 + 중고등 36)인데, 지난 학기 학생과 중복 행까지 섞여 들어간 것입니다.
    // 그 상태로 연결했다면 셔틀 배정이 **이미 나간 학생에게 붙었을** 수 있습니다.
    // 미리보기로 돌려서 다행이었습니다.
    db.from("wr_students")
      .select("id, name, name_en, grade, department, birth_date, class_name, status")
      .eq("is_demo", false)
      .eq("status", "active"),
    // 칸을 콕 집지 않고 전부 가져옵니다 - 이 표는 마이그레이션 밖에서 만들어져서 어떤 칸이
    // 있는지 코드로 확신할 수 없습니다. 아래 debug에 실제 칸 목록을 함께 돌려줍니다.
    db.from("shuttle_assignments").select("*").is("student_id", null),
  ]);

  const all = (studentRows ?? []) as Student[];

  // ── 명부 = 절대 기준 ──────────────────────────────────────────────────────
  // 초등부·중고등부만 대조 대상입니다. 유치부는 명부에 있더라도 연결하지 않습니다.
  const roster = all.filter((s) => {
    const d = departmentOf({ department: s.department, grade: s.grade }) ?? departmentFromClassName(s.class_name);
    return d === "초등부" || d === "중고등부";
  });

  const byName = new Map<string, Student[]>();
  const add = (k: string, s: Student) => {
    if (!k) return;
    byName.set(k, [...(byName.get(k) ?? []), s]);
  };
  for (const s of roster) {
    add(norm(s.name ?? ""), s);
    if (s.name_en) add(norm(s.name_en), s);
  }

  const linked: { id: string; raw: string; to: string; name: string }[] = [];
  const kinder: { id: string; raw: string; cls: string | null; stopId: string | null }[] = [];
  const review: { id: string; raw: string; cls: string | null; when: string | null; stopId: string | null; why: string; candidates?: string[] }[] = [];
  // 퇴소: 유치부도 아닌데 명부에 없는 아이.
  //
  // 담당자 확인: "유치부도 아닌데 이름이 명단에 없는 아이들은 퇴소한 아이들로 넘겨줘."
  // 명부가 절대 기준이므로, 유치부 반이 아닌데 명부에 없다면 답은 하나뿐입니다 - 나간 아이입니다.
  // '확인필요'로 두면 아무도 손대지 않은 채 영영 남습니다. 사실을 그대로 적어두는 편이 낫습니다.
  const left: { id: string; raw: string; when: string | null }[] = [];

  // 이 표에서 반 이름이 들어 있을 만한 칸을 찾습니다(이름을 모르므로 후보를 훑습니다).
  // 반 이름이 든 칸. 실제 칸 이름은 class_raw 였습니다("반 이름을 적힌 그대로 담는다"는 뜻).
  // 처음에 후보 목록에 넣지 않아서 반 정보를 하나도 못 읽었고, 그래서 유치부가 0건으로 나왔습니다.
  const sample = (rows ?? [])[0] as Record<string, unknown> | undefined;
  const classKey = sample
    ? ["class_raw", "class_name", "class_label", "class", "grade_label", "homeroom", "grade"].find((k) => k in sample) ?? null
    : null;

  for (const r of (rows ?? []) as Record<string, unknown>[]) {
    const id = r.id as string;
    const raw = ((r.student_name_raw as string | null) ?? "").trim();
    const cls = classKey ? ((r[classKey] as string | null) ?? null) : null;
    // 언제 만들어진 줄인지. 남은 것들이 전부 오래된 날짜면 **지난 학기 배정**이라는 뜻이라,
    // 이름을 아무리 들여다봐도 명부에 없는 게 당연합니다. 그 판단을 숫자로 하기 위해 함께 냅니다.
    const when = ((r.created_at as string | null) ?? null)?.slice(0, 10) ?? null;
    const stopId = (r.stop_id as string | null) ?? null;
    const clsDept = departmentFromClassName(cls);

    if (!raw) {
      review.push({ id, raw: "(이름 없음)", cls, when, stopId, why: "이름 칸이 비어 있습니다" });
      continue;
    }

    // 반 이름이 유치부면 명부를 볼 것도 없습니다.
    if (clsDept === "유치부") {
      kinder.push({ id, raw, cls, stopId });
      continue;
    }

    // 통째로 → 안 되면 쪼개서. 여러 명이 나오면 첫 명만 연결하고 나머지는 사람에게 넘깁니다
    // (한 줄에 두 아이를 넣는 것은 이 표 구조로는 표현할 수 없습니다).
    const candidatesRaw = [raw, ...splitNames(raw).filter((n) => n !== raw)];
    let hit: Student | null = null;
    let ambiguous: Student[] | null = null;

    for (const cand of candidatesRaw) {
      const { name, birth, cls: hintCls, dept: hintDept } = parseHint(cand);
      let hits = byName.get(norm(name)) ?? [];

      // 괄호 힌트로 좁힙니다. 좁혀서 하나도 안 남으면 힌트가 틀린 것이니 원래대로 둡니다
      // (엉뚱한 학생에게 붙이는 것보다, 사람에게 넘기는 편이 낫습니다).
      const narrow = (fn: (s: Student) => boolean) => {
        const n = hits.filter(fn);
        if (n.length > 0) hits = n;
      };
      if (hits.length > 1 && birth) narrow((s) => birthKey(s.birth_date) === birth);
      if (hits.length > 1 && hintCls) narrow((s) => norm(s.class_name ?? "") === norm(hintCls));
      // 반 코드가 명부의 반 이름과 표기가 달라 못 맞출 때가 있습니다("G3J" vs 명부 표기).
      // 그래도 **학년**은 읽을 수 있습니다 - G3J의 3. 학년만으로도 대개 한 명으로 좁혀집니다.
      if (hits.length > 1 && hintCls) {
        const g = hintCls.match(/\d+/)?.[0];
        if (g) narrow((s) => (s.grade ?? "").replace(/[^0-9]/g, "") === g);
      }
      if (hits.length > 1 && hintDept) {
        narrow((s) => (departmentOf({ department: s.department, grade: s.grade }) ?? departmentFromClassName(s.class_name)) === hintDept);
      }

      if (hits.length === 1) { hit = hits[0]; break; }
      if (hits.length > 1) { ambiguous = hits; break; }
    }

    if (hit) {
      linked.push({ id, raw, to: hit.id, name: hit.name });
      continue;
    }
    if (ambiguous) {
      review.push({
        id, raw, cls, when, stopId,
        why: `같은 이름이 ${ambiguous.length}명 - 생일이나 학년을 함께 적어주세요`,
        candidates: ambiguous.map((s) => `${s.name}${s.grade ? `(${s.grade})` : ""}${s.birth_date ? ` ${s.birth_date}` : ""}`),
      });
      continue;
    }

    // 명부에 없습니다. 반 이름이 유치부 형식이면 유치부, 아니면 사람이 봐야 합니다.
    if (clsDept === null && cls) {
      review.push({ id, raw, cls, when, stopId, why: `명부에 없음 · 반 이름을 읽을 수 없음 ("${cls}")` });
    } else {
      left.push({ id, raw, when });
    }
  }

  // 명부 인원 검산 - 초등 101 + 중고등 36 = 137.
  //
  // 명부가 흐트러진 채로 연결하면 셔틀 배정이 엉뚱한 학생(지난 학기·중복 행)에 붙습니다.
  // 그건 조용히 잘못되는 종류라, **숫자가 안 맞으면 반영을 아예 막습니다.**
  const 초등 = roster.filter((s) => (departmentOf({ department: s.department, grade: s.grade }) ?? departmentFromClassName(s.class_name)) === "초등부").length;
  const 중고등 = roster.length - 초등;
  const 명부정상 = roster.length === 137;

  if (apply && !명부정상) {
    return NextResponse.json(
      {
        ok: false,
        error: "명부 인원이 기대(137명)와 다릅니다. 명부를 먼저 정리해야 합니다.",
        명부기준: { 대조대상: roster.length, 초등부: 초등, 중고등부: 중고등, 기대: 137 },
        안내: "지난 학기 학생이나 중복 행이 status='active'로 남아 있을 수 있습니다. 이 상태로 연결하면 셔틀 배정이 엉뚱한 학생에게 붙습니다.",
      },
      { status: 409 },
    );
  }

  if (apply) {
    for (const l of linked) {
      await db.from("shuttle_assignments").update({ student_id: l.to, unlinked_reason: null }).eq("id", l.id);
    }
    for (let i = 0; i < left.length; i += 100) {
      await db.from("shuttle_assignments").update({ unlinked_reason: "퇴소" })
        .in("id", left.slice(i, i + 100).map((k) => k.id));
    }
    for (let i = 0; i < kinder.length; i += 100) {
      await db.from("shuttle_assignments").update({ unlinked_reason: "유치부" })
        .in("id", kinder.slice(i, i + 100).map((k) => k.id));
    }
  }

  return NextResponse.json(
    {
      ok: true,
      mode: apply ? "반영함" : "미리보기 (아무것도 바꾸지 않았습니다)",
      명부기준: {
        대조대상: roster.length,
        초등부: 초등,
        중고등부: 중고등,
        기대: 137,
        판정: 명부정상 ? "✅ 명부 정상" : `⚠️ 기대와 ${roster.length - 137 > 0 ? "+" : ""}${roster.length - 137}명 차이 — 반영이 막힙니다`,
        재학중_전체행: all.length,
      },
      요약: {
        대상: rows?.length ?? 0,
        연결됨: linked.length,
        유치부표시: kinder.length,
        퇴소표시: left.length,
        확인필요: review.length,
      },
      연결_예시: linked.slice(0, 15).map((l) => `${l.raw} → ${l.name}`),
      유치부_반이름: [...new Set(kinder.map((k) => k.cls ?? "(반 없음)"))].sort(),
      // 남은 74건이 유치부인지 판단할 단서.
      //
      // 같은 정류장에 이미 유치부로 확정된 줄이 있다면, 반 칸만 비어 있을 뿐 그 아이도
      // 유치부일 가능성이 큽니다(기사님이 그 정류장에 들르는 이유가 같으니까요).
      // 반대로 초등·중고등 아이만 서는 정류장에 섞여 있다면 이름 표기 문제일 수 있습니다.
      정류장_단서: (() => {
        const kinderStops = new Set(kinder.map((k) => k.stopId).filter(Boolean));
        const linkedStops = new Set(
          (rows ?? []).filter((r) => linked.some((l) => l.id === (r as Record<string, unknown>).id))
            .map((r) => (r as Record<string, unknown>).stop_id as string | null).filter(Boolean),
        );
        let 유치부정류장 = 0, 우리학생정류장 = 0, 둘다 = 0, 알수없음 = 0;
        for (const v of review) {
          const k = v.stopId ? kinderStops.has(v.stopId) : false;
          const l = v.stopId ? linkedStops.has(v.stopId) : false;
          if (k && l) 둘다++; else if (k) 유치부정류장++; else if (l) 우리학생정류장++; else 알수없음++;
        }
        return { 유치부만_서는_정류장: 유치부정류장, 우리학생만_서는_정류장: 우리학생정류장, 둘다_서는_정류장: 둘다, 판단불가: 알수없음 };
      })(),
      // 남은 것들이 언제 만들어진 줄인지 한눈에. 전부 오래된 날짜면 지난 학기 배정이라
      // 이름을 들여다볼 것이 아니라 정리 대상입니다.
      확인필요_생성일_분포: Object.entries(
        review.reduce<Record<string, number>>((acc, r) => {
          const k = r.when?.slice(0, 7) ?? "(모름)";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
      ).sort(),
      퇴소_이름들: [...new Set(left.map((l) => l.raw))].sort(),
      확인필요_목록: review.slice(0, 150),
      debug: {
        반칸으로_쓴_컬럼: classKey,
        shuttle_assignments_컬럼: sample ? Object.keys(sample) : [],
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
