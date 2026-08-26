import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { departmentOf } from "@/lib/department";

// 셔틀 배정(shuttle_assignments)의 이름 문자열을 학생 ID로 승격시킵니다.
//
// 배경: 462줄 중 444줄이 student_name_raw("김서준") 문자열로만 붙어 있습니다. 문자열로는
// 6년을 이을 수 없습니다 - 동명이인·개명·오탈자에 다 끊깁니다.
//
// 유치부는 붙이지 않습니다(담당자 확인): 유치부 아이는 기사님이 그 정류장에 들르는 이유로만
// 명단에 있고, 별도 프로그램으로 따로 운영합니다. 그래서 '연결 실패'가 아니라
// **'유치부라서 연결 안 함'** 으로 명시해 둡니다 - 나중에 누가 봐도 미완성이 아니라 결정임을
// 알 수 있어야 합니다.
//
// 사용법 (로그인한 채로 브라우저에서 열면 됩니다):
//   GET  /api/shuttle/link-students          → 미리보기. 아무것도 바꾸지 않습니다.
//   GET  /api/shuttle/link-students?apply=1  → 실제로 반영합니다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Student = { id: string; name: string; name_en: string | null; grade: string | null; department: string | null; birth_date: string | null };

// 이름 대조용으로 다듬습니다 - 공백·괄호를 없애고 소문자로.
// "김 서준", "김서준 ", "Kim Seojun" 이 서로 다른 이름으로 갈라지지 않게 합니다.
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[()（）]/g, "").trim();
}

// "김재이(190510)" 처럼 생일을 붙여 쓴 표기에서 생일 부분을 떼어냅니다.
// 같은 학년에 같은 이름이 둘 있을 때 선생님들이 실제로 쓰는 방식입니다.
function splitBirthHint(raw: string): { name: string; birth: string | null } {
  const m = raw.match(/^(.*?)[(（]\s*(\d{6})\s*[)）]\s*$/);
  if (m) return { name: m[1].trim(), birth: m[2] };
  return { name: raw.trim(), birth: null };
}

// 생년월일 "2019-05-10" 을 "190510" 으로.
function birthKey(d: string | null): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1].slice(2)}${m[2]}${m[3]}` : null;
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
    db.from("wr_students").select("id, name, name_en, grade, department, birth_date").eq("is_demo", false),
    db.from("shuttle_assignments").select("id, student_id, student_name_raw").is("student_id", null),
  ]);

  const students = (studentRows ?? []) as Student[];

  // 이름 → 학생들. 동명이인이 있으면 여러 명이 담깁니다.
  const byName = new Map<string, Student[]>();
  const add = (k: string, s: Student) => {
    if (!k) return;
    const arr = byName.get(k) ?? [];
    arr.push(s);
    byName.set(k, arr);
  };
  for (const s of students) {
    add(norm(s.name ?? ""), s);
    if (s.name_en) add(norm(s.name_en), s);
  }

  const linked: { id: string; raw: string; to: string; name: string; dept: string | null }[] = [];
  const kinder: { id: string; raw: string }[] = [];
  const review: { id: string; raw: string; why: string; candidates?: string[] }[] = [];

  for (const r of rows ?? []) {
    const raw = ((r.student_name_raw as string | null) ?? "").trim();
    if (!raw) {
      review.push({ id: r.id as string, raw: "(이름 없음)", why: "이름 칸이 비어 있습니다" });
      continue;
    }

    const { name, birth } = splitBirthHint(raw);
    let hits = byName.get(norm(name)) ?? [];

    // 생일 힌트가 있으면 그걸로 좁힙니다("김재이(190510)").
    if (hits.length > 1 && birth) {
      const narrowed = hits.filter((s) => birthKey(s.birth_date) === birth);
      if (narrowed.length > 0) hits = narrowed;
    }

    if (hits.length === 0) {
      // 명부에 없는 이름 - 유치부이거나 외부 아이일 가능성이 높습니다.
      // 여기서 자동으로 '유치부'라고 단정하지 않습니다. 사람이 확인해야 합니다.
      review.push({ id: r.id as string, raw, why: "명부에 없는 이름" });
      continue;
    }

    if (hits.length > 1) {
      review.push({
        id: r.id as string,
        raw,
        why: `같은 이름이 ${hits.length}명`,
        candidates: hits.map((s) => `${s.name}${s.grade ? `(${s.grade})` : ""}${s.birth_date ? ` ${s.birth_date}` : ""}`),
      });
      continue;
    }

    const s = hits[0];
    const dept = departmentOf({ department: s.department, grade: s.grade });

    // 유치부는 연결하지 않고 그렇게 표시만 합니다(담당자 요청).
    if (dept === "유치부") {
      kinder.push({ id: r.id as string, raw });
      continue;
    }

    linked.push({ id: r.id as string, raw, to: s.id, name: s.name, dept });
  }

  if (apply) {
    // 연결
    for (const l of linked) {
      await db.from("shuttle_assignments").update({ student_id: l.to, unlinked_reason: null }).eq("id", l.id);
    }
    // 유치부 표시
    for (let i = 0; i < kinder.length; i += 100) {
      await db
        .from("shuttle_assignments")
        .update({ unlinked_reason: "유치부" })
        .in("id", kinder.slice(i, i + 100).map((k) => k.id));
    }
    // 나머지는 '확인필요' 그대로 둡니다.
  }

  return NextResponse.json(
    {
      ok: true,
      mode: apply ? "반영함" : "미리보기 (아무것도 바꾸지 않았습니다)",
      요약: {
        대상: rows?.length ?? 0,
        연결됨: linked.length,
        유치부표시: kinder.length,
        확인필요: review.length,
      },
      확인필요_목록: review.slice(0, 200),
      유치부_이름들: [...new Set(kinder.map((k) => k.raw))].sort(),
      연결_예시: linked.slice(0, 20).map((l) => `${l.raw} → ${l.name}${l.dept ? ` (${l.dept})` : ""}`),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
