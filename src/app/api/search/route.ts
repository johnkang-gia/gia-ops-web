import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";

export type SearchResult = {
  type: "student" | "incident" | "meeting" | "event" | "task" | "document";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

// 전 화면에서 쓰는 통합 검색 - 학생/사건/회의/행사/업무/서류를 한 번에 찾습니다(요청).
// 이 시스템은 학부모에게는 아무것도 노출되지 않고 전부 교내 관계자 전용이라, 로그인만 확인하면
// 되지만, 교사는 위클리 리포트(학생) 화면만 볼 수 있는 미들웨어 제한과 동일하게 검색 결과도
// 학생으로만 제한합니다(그 외 화면 자체에 접근할 수 없는데 검색으로 우회해서 보이면 안 되므로).
export async function GET(request: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  const like = `%${q}%`;
  const results: SearchResult[] = [];

  const { data: students } = await supabase
    .from("wr_students")
    .select("id, name, name_en, grade, class_name")
    .or(`name.ilike.${like},name_en.ilike.${like},student_no.ilike.${like}`)
    .eq("status", "active")
    .limit(6);
  for (const s of students ?? []) {
    results.push({
      type: "student",
      id: s.id,
      title: s.name_en ? `${s.name} (${s.name_en})` : s.name,
      subtitle: `학생 · ${s.grade ?? "-"}학년 ${s.class_name ?? "-"}`,
      href: `/weekly-report/students/${s.id}`,
    });
  }

  // 교사는 위클리 리포트(학생) 화면만 볼 수 있으므로 나머지 카테고리는 검색하지 않습니다.
  if (me.position === "교사") {
    return NextResponse.json({ results });
  }

  const [{ data: incidents }, { data: meetings }, { data: events }, { data: tasks }, { data: documents }] = await Promise.all([
    supabase.from("incidents").select("id, title, date").ilike("title", like).order("date", { ascending: false }).limit(5),
    supabase.from("meetings").select("id, content, date").ilike("content", like).order("date", { ascending: false }).limit(5),
    supabase.from("events").select("id, name, date").ilike("name", like).order("date", { ascending: false }).limit(5),
    supabase.from("tasks").select("id, title, department, status").ilike("title", like).is("archived_at", null).limit(5),
    supabase.from("school_documents").select("id, name, category").ilike("name", like).limit(5),
  ]);

  for (const i of incidents ?? []) {
    results.push({ type: "incident", id: i.id, title: i.title, subtitle: `사건기록 · ${i.date}`, href: `/records` });
  }
  for (const m of meetings ?? []) {
    results.push({
      type: "meeting",
      id: m.id,
      title: (m.content as string).slice(0, 40),
      subtitle: `회의록 · ${m.date}`,
      href: `/meetings`,
    });
  }
  for (const e of events ?? []) {
    results.push({ type: "event", id: e.id, title: e.name, subtitle: `행사기록 · ${e.date}`, href: `/events` });
  }
  for (const t of tasks ?? []) {
    results.push({ type: "task", id: t.id, title: t.title, subtitle: `업무 · ${t.department ?? "-"} · ${t.status}`, href: `/work` });
  }
  for (const d of documents ?? []) {
    results.push({ type: "document", id: d.id, title: d.name, subtitle: `서류함 · ${d.category ?? "-"}`, href: `/documents` });
  }

  return NextResponse.json({ results });
}
