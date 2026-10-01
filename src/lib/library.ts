import type { SupabaseClient } from "@supabase/supabase-js";
import { todayKst } from "@/lib/kst";

/**
 * **도서관 자료를 운영앱에서 읽는 함수.**
 *
 * 도서관 앱(gia-lib-web)은 별도 앱이지만 DB 는 같습니다. `lib_*` 표와 자물쇠는 이 저장소의
 * 마이그레이션이 만들고, 일반 교직원 계정은 `is_lib_user()` 로 이미 읽을 수 있습니다. 그래서
 * 운영앱은 **읽기만** 합니다 - 대출·반납·카드 발급은 도서관 앱의 일입니다. 두 앱이 같은 표를
 * 고치면 「두 화면이 다른 답」(CLAUDE.md 2-11)이 다시 납니다.
 *
 * 도서관 앱 주소는 환경변수로 둡니다. 비어 있으면 링크를 안 그립니다 - 깨진 링크보다 없는
 * 링크가 낫습니다.
 */
export const LIBRARY_URL = (process.env.NEXT_PUBLIC_LIBRARY_URL ?? "").replace(/\/$/, "");

export type LibLoan = {
  id: string;
  book_id: string;
  student_id: string | null;
  student_no: string;
  student_name: string;
  student_class: string | null;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
  renew_count: number;
  status: "대출중" | "반납완료" | "분실";
  book?: { title: string; author: string | null } | null;
};

export type LibVisit = { id: string; student_id: string | null; student_no: string; student_name: string; kind: "입실" | "퇴실"; visited_at: string };

const LOAN_COLS = "id, book_id, student_id, student_no, student_name, student_class, borrowed_at, due_date, returned_at, renew_count, status, book:lib_books(title, author)";

/** 며칠 연체인가. 0 이면 아직 기한 안입니다. */
export function overdueDays(dueDate: string, today = todayKst()): number {
  const ms = new Date(`${today}T00:00:00+09:00`).getTime() - new Date(`${dueDate}T00:00:00+09:00`).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** 학생 한 명의 도서관 요약 - 프로필 칸에 씁니다. */
export async function loadStudentLibrary(supabase: SupabaseClient, studentId: string) {
  const [loanRes, visitRes] = await Promise.all([
    supabase.from("lib_loans").select(LOAN_COLS).eq("student_id", studentId).order("borrowed_at", { ascending: false }).limit(20),
    supabase.from("lib_visits").select("id, student_id, student_no, student_name, kind, visited_at").eq("student_id", studentId).order("visited_at", { ascending: false }).limit(1),
  ]);
  const loans = ((loanRes.data as unknown as LibLoan[] | null) ?? []);
  const active = loans.filter((l) => l.status === "대출중");
  return {
    error: loanRes.error?.message ?? visitRes.error?.message ?? null,
    active,
    overdue: active.filter((l) => overdueDays(l.due_date) > 0),
    recent: loans.filter((l) => l.status !== "대출중").slice(0, 5),
    lastVisit: ((visitRes.data as LibVisit[] | null) ?? [])[0] ?? null,
  };
}

/** 학교 전체 - 도서관 현황 화면. 오늘 움직인 것과 지금 걸려 있는 것만 읽습니다. */
export async function loadLibraryOverview(supabase: SupabaseClient) {
  const today = todayKst();
  const dayStart = `${today}T00:00:00+09:00`;
  const [activeRes, todayRes, returnedRes, visitRes, cardRes, bookCountRes] = await Promise.all([
    supabase.from("lib_loans").select(LOAN_COLS).eq("status", "대출중").order("due_date"),
    supabase.from("lib_loans").select(LOAN_COLS).gte("borrowed_at", dayStart).order("borrowed_at", { ascending: false }),
    supabase.from("lib_loans").select(LOAN_COLS).gte("returned_at", dayStart).order("returned_at", { ascending: false }),
    supabase.from("lib_visits").select("id, student_id, student_no, student_name, kind, visited_at").gte("visited_at", dayStart).order("visited_at", { ascending: false }),
    supabase.from("lib_card_issues").select("student_no"),
    supabase.from("lib_books").select("id", { count: "exact", head: true }).eq("status", "보유"),
  ]);
  const active = (activeRes.data as unknown as LibLoan[] | null) ?? [];
  const error = [activeRes, todayRes, returnedRes, visitRes, cardRes, bookCountRes].find((r) => r.error)?.error?.message ?? null;
  return {
    error,
    active,
    overdue: active.filter((l) => overdueDays(l.due_date) > 0).sort((a, b) => a.due_date.localeCompare(b.due_date)),
    borrowedToday: (todayRes.data as unknown as LibLoan[] | null) ?? [],
    returnedToday: (returnedRes.data as unknown as LibLoan[] | null) ?? [],
    visitsToday: (visitRes.data as LibVisit[] | null) ?? [],
    cardIssuedNos: new Set((((cardRes.data as { student_no: string }[] | null) ?? [])).map((r) => r.student_no)),
    bookCount: bookCountRes.count ?? 0,
  };
}
