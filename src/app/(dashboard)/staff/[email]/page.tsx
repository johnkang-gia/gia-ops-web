import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser, isAdminUser, isDeveloperEmail } from "@/lib/roles";
import type { AppUser, StaffAssignment, Task, WrClass } from "@/lib/types";
import StaffProfileClient from "@/components/staff/StaffProfileClient";

export const dynamic = "force-dynamic";

export default async function StaffProfilePage({ params }: { params: Promise<{ email: string }> }) {
  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase().trim();
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  if (!isStaffOrAboveUser(me)) {
    redirect("/home");
  }

  const { data: staffData } = await supabase.from("app_users").select("*").eq("email", email).maybeSingle();
  const staff = staffData as AppUser | null;
  if (!staff || isDeveloperEmail(staff.email)) notFound();

  const [assignmentsRes, termsRes, classesRes, tasksRes] = await Promise.all([
    supabase.from("staff_assignments").select("*").eq("staff_email", email).order("created_at", { ascending: false }),
    supabase.from("terms").select("id, year, term_type").order("start_date", { ascending: false }),
    supabase.from("wr_classes").select("*").eq("is_demo", false).order("grade", { ascending: true }),
    supabase
      .from("tasks")
      .select("*")
      .or(`owner_email.eq.${email},assignee_emails.cs.{${email}}`)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const assignments = (assignmentsRes.data as StaffAssignment[] | null) ?? [];
  const terms = termsRes.data ?? [];
  const classes = (classesRes.data as WrClass[] | null) ?? [];
  const tasks = (tasksRes.data as Task[] | null) ?? [];

  const termLabel = new Map(terms.map((t) => [t.id, `${t.year} ${t.term_type}`]));
  const classLabel = new Map(classes.map((c) => [c.id, `${c.grade ?? ""}학년 ${c.class_name ?? ""}반`]));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/staff" className="mb-3 inline-block text-xs text-slate-400 hover:text-slate-600">
        ← 교직원 검색으로
      </Link>
      <StaffProfileClient
        staff={staff}
        assignments={assignments}
        tasks={tasks}
        terms={terms}
        classes={classes}
        termLabel={Object.fromEntries(termLabel)}
        classLabel={Object.fromEntries(classLabel)}
        viewerIsAdmin={isAdminUser(me)}
      />
    </div>
  );
}
