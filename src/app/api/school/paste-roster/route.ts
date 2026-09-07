import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { selectTolerant } from "@/lib/selectTolerant";
import type { RosterField } from "@/lib/pasteRoster";

// 붙여넣은 명부를 **미리 보고** 넣습니다.
//
// 두 걸음으로 나눈 이유: 명부는 되돌리기 어렵습니다. 이름을 잘못 넣으면 그 아이의 출결과
// 관찰기록이 새 줄에 붙기 시작하고, 그때는 합치기로 정리해야 합니다. 그래서 넣기 전에
// **무엇이 새로 생기고 무엇이 바뀌는지**를 사람이 보게 합니다.

export const dynamic = "force-dynamic";

type Row = { rowNo: number; values: Partial<Record<RosterField, string>> };
type StuRow = {
  id: string; name: string; birth_date: string | null; name_en: string | null;
  grade: string | null; class_name: string | null; student_no: string | null; status: string | null;
  mother_phone?: string | null; father_phone?: string | null; parent_phone?: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, "");

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const rows = (body?.rows as Row[] | undefined) ?? [];
  const apply = body?.apply === true;
  if (rows.length === 0) return NextResponse.json({ error: "넣을 줄이 없습니다." }, { status: 400 });

  const supabase = await createClient();
  const stuRes = await selectTolerant<StuRow>(
    (columns) =>
      supabase.from("wr_students").select(columns).eq("is_demo", false) as unknown as
        PromiseLike<{ data: StuRow[] | null; error: { message: string } | null }>,
    ["id", "name", "birth_date", "name_en", "grade", "class_name", "student_no", "status"],
    ["mother_phone", "father_phone", "parent_phone"],
  );
  if (stuRes.error) return NextResponse.json({ error: stuRes.error }, { status: 500 });
  const existing = stuRes.data;

  type Plan = {
    rowNo: number;
    name: string;
    kind: "새로 등록" | "바뀜" | "그대로" | "확인 필요";
    /** 어느 칸이 어떻게 바뀌는지. 「무엇이 달라지는가」를 못 보여주면 사람이 못 판단합니다. */
    changes: { field: string; from: string; to: string }[];
    reason?: string;
    studentId?: string;
  };
  const plans: Plan[] = [];

  for (const r of rows) {
    const v = r.values ?? {};
    const name = (v.name ?? "").trim();
    if (!name) continue;

    // 짝 찾기: 생년월일이 있으면 **이름+생일**이 가장 확실합니다. 없으면 이름으로만 찾되,
    // 같은 이름이 둘 이상이면 **고르지 않습니다** - 잘못 고르면 남의 기록에 붙습니다.
    const byBirth = v.birth_date
      ? existing.filter((s) => norm(s.name) === norm(name) && s.birth_date === v.birth_date)
      : [];
    const byName = existing.filter((s) => norm(s.name) === norm(name));
    const hit = byBirth[0] ?? (byName.length === 1 ? byName[0] : null);

    if (!hit && byName.length > 1) {
      plans.push({
        rowNo: r.rowNo,
        name,
        kind: "확인 필요",
        changes: [],
        reason: `명부에 「${name}」이(가) ${byName.length}명 있습니다. 생년월일 칸을 함께 붙여넣으면 자동으로 갈립니다.`,
      });
      continue;
    }

    const FIELDS: [RosterField, string, keyof StuRow][] = [
      ["name_en", "영문 이름", "name_en"],
      ["grade", "학년", "grade"],
      ["class_name", "반", "class_name"],
      ["birth_date", "생년월일", "birth_date"],
      ["student_no", "학번", "student_no"],
      ["mother_phone", "어머니 연락처", "mother_phone"],
      ["father_phone", "아버지 연락처", "father_phone"],
      ["parent_phone", "보호자 연락처", "parent_phone"],
    ];

    if (!hit) {
      plans.push({
        rowNo: r.rowNo,
        name,
        kind: "새로 등록",
        changes: FIELDS.filter(([f]) => v[f]).map(([f, label]) => ({ field: label, from: "", to: v[f]! })),
      });
      continue;
    }

    // **비어 있는 칸만 채우지 않습니다** - 시트가 최신이므로 값이 다르면 시트를 따릅니다.
    // 다만 무엇이 덮이는지 전부 보여주고, 시트가 비어 있으면 기존 값을 지우지 않습니다.
    const changes = FIELDS.filter(([f, , col]) => {
      const to = v[f];
      if (!to) return false; // 시트가 비어 있으면 건드리지 않습니다.
      return String(hit[col] ?? "") !== to;
    }).map(([f, label, col]) => ({ field: label, from: String(hit[col] ?? ""), to: v[f]! }));

    plans.push({
      rowNo: r.rowNo,
      name,
      kind: changes.length > 0 ? "바뀜" : "그대로",
      changes,
      studentId: hit.id,
      reason: hit.status && hit.status !== "active" ? `지금 「${hit.status}」 상태입니다 — 넣으면 재학으로 돌아옵니다.` : undefined,
    });
  }

  if (!apply) return NextResponse.json({ ok: true, plans });

  // ── 실제로 넣기 ────────────────────────────────────────────────────────
  const toInsert = plans.filter((p) => p.kind === "새로 등록");
  const toUpdate = plans.filter((p) => p.kind === "바뀜");
  const failed: string[] = [];

  const valueOf = (rowNo: number) => rows.find((r) => r.rowNo === rowNo)?.values ?? {};

  for (const p of toInsert) {
    const v = valueOf(p.rowNo);
    const { error } = await supabase.from("wr_students").insert({
      name: p.name,
      name_en: v.name_en ?? null,
      grade: v.grade ?? null,
      class_name: v.class_name ?? null,
      birth_date: v.birth_date ?? null,
      student_no: v.student_no ?? null,
      mother_phone: v.mother_phone ?? null,
      father_phone: v.father_phone ?? null,
      parent_phone: v.parent_phone ?? null,
      status: "active",
      // 값으로 못박습니다. 필터가 아니라 값이어야 데모 학생과 절대 안 섞입니다.
      is_demo: false,
    });
    if (error) failed.push(`${p.name}(${error.message})`);
  }

  for (const p of toUpdate) {
    const v = valueOf(p.rowNo);
    const patch: Record<string, string> = { status: "active" };
    for (const k of ["name_en", "grade", "class_name", "birth_date", "student_no", "mother_phone", "father_phone", "parent_phone"] as const) {
      if (v[k]) patch[k] = v[k]!;
    }
    const { error } = await supabase.from("wr_students").update(patch).eq("id", p.studentId!);
    if (error) failed.push(`${p.name}(${error.message})`);
  }

  return NextResponse.json({
    ok: true,
    inserted: toInsert.length - failed.length >= 0 ? toInsert.length : 0,
    updated: toUpdate.length,
    // 한 명이 실패해도 나머지는 넣되, **누가 실패했는지 반드시 말합니다.**
    failed,
  });
}
