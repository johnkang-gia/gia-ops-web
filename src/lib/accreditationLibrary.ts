import type { SupabaseClient } from "@supabase/supabase-js";
import { readAll } from "@/lib/financeFetch";
import { todayKst } from "@/lib/kst";

/**
 * **인증 증거 — 도서관(장서·점검·이용).**
 *
 * 도서관 앱 화면은 모두 한국어이고 화면 안에만 있습니다. 그대로는 심사단에게 못 냅니다. 여기서 같은 표(lib_*)를 읽어
 * 영문 한 장으로 꺼냅니다. 다른 증거들과 같은 원칙입니다 - 세는 규칙은 하나만 두고, 화면은 인쇄만 합니다.
 *
 * **학생 이름·번호는 담지 않습니다.** 외부 기관과 드라이브로 공유되는 자료이므로 반 단위·숫자로만 적습니다.
 *
 * ── 이 자료가 말하는 것 ─────────────────────────────────────────────────────
 * 세 가지입니다. ① 무엇을 얼마나 가지고 있나(장서) ② 그것이 실제로 어디 있는지 아나(점검) ③ 아이들이 쓰고 있나(이용).
 * 심사단이 도서관에서 보는 것은 대개 ①뿐인데, 인증이 묻는 것은 ③입니다. 그래서 세 번째를 비워 두지 않도록 숫자를
 * 그대로 드러냅니다 - 적으면 적은 대로 보여야 다음 계획이 나옵니다.
 */

/** 색 라벨 등급의 영문 표기. 책등에 실제로 붙어 있는 색입니다. */
export const LEVEL_EN: Record<number, string> = {
  2: "Level 2 (Orange)",
  3: "Level 3 (Grey)",
  4: "Level 4 (Green)",
  5: "Level 5 (Yellow)",
  6: "Level 6 (Red)",
};
export const levelEn = (n: number | null | undefined) => (n == null ? "Not yet levelled" : LEVEL_EN[n] ?? `Level ${n}`);

type BookRow = {
  id: string;
  title: string;
  isbn: string | null;
  label_level: number | null;
  total_copies: number | null;
  location_id: string | null;
  series: string | null;
  created_at: string | null;
};
type CheckRow = { id: string; book_id: string; location_id: string; copies: number; checked_at: string | null };
type LoanRow = { book_id: string | null; student_no: string | null; student_class: string | null; borrowed_at: string | null; returned_at: string | null; status: string | null };
type LocRow = { id: string; code: string; sort_order: number | null; label_level: number | null; checked_done_at: string | null };

/** 한국 날짜(YYYY-MM-DD). 빌린 시각은 UTC 로 저장되므로 그대로 자르면 밤 대출이 옆날로 넘어갑니다. */
const kstDay = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const kstMonth = (ts: string) => kstDay(ts).slice(0, 7);

/** 최근 N개월의 달 이름. 빈 달도 자리를 차지해야 «쉰 달»이 보입니다. */
function recentMonths(n: number, today: string) {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function loadLibrary(supabase: SupabaseClient) {
  const today = todayKst();

  const [booksRes, checksRes, loansRes, locsRes, cardsRes, fixesRes, snapsRes] = await Promise.all([
    readAll<BookRow>((from, to) =>
      supabase
        .from("lib_books")
        .select("id,title,isbn,label_level,total_copies,location_id,series,created_at")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    readAll<CheckRow>((from, to) =>
      supabase
        .from("lib_shelf_check")
        .select("id,book_id,location_id,copies,checked_at")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    readAll<LoanRow>((from, to) =>
      supabase
        .from("lib_loans")
        .select("book_id,student_no,student_class,borrowed_at,returned_at,status")
        .order("borrowed_at", { ascending: true })
        .range(from, to)
    ),
    readAll<LocRow>((from, to) =>
      supabase
        .from("lib_locations")
        .select("id,code,sort_order,label_level,checked_done_at")
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true })
        .range(from, to)
    ),
    supabase.from("lib_card_issues").select("id", { count: "exact", head: true }),
    supabase.from("lib_holdings_fix").select("id", { count: "exact", head: true }),
    supabase
      .from("lib_stat_snapshots")
      .select("taken_on,titles,copies,with_level,with_shelf,bins_done,bins,check_copies,loans_12m,borrowers_12m,never_borrowed,note")
      .order("taken_on", { ascending: true })
      .limit(24),
  ]);

  const books = booksRes.rows;
  const checks = checksRes.rows;
  const loans = loansRes.rows;
  const locations = locsRes.rows;

  // ── ① 장서 ────────────────────────────────────────────────────────────────
  const copies = books.reduce((n, b) => n + (b.total_copies ?? 0), 0);
  const withIsbn = books.filter((b) => b.isbn).length;
  const withLevel = books.filter((b) => b.label_level != null).length;
  const withShelf = books.filter((b) => b.location_id).length;
  const withSeries = books.filter((b) => (b.series ?? "").trim()).length;

  const levelMap = new Map<number | null, { titles: number; copies: number }>();
  for (const b of books) {
    const slot = levelMap.get(b.label_level ?? null) ?? { titles: 0, copies: 0 };
    slot.titles += 1;
    slot.copies += b.total_copies ?? 0;
    levelMap.set(b.label_level ?? null, slot);
  }
  const byLevel = [...levelMap.entries()]
    .map(([level, v]) => ({ level, label: levelEn(level), ...v }))
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));

  /*
    장서를 언제 만들었는지. "1,045종이 10월 한 달에 등록됐다"는 사실 자체가 증거입니다 -
    전수 목록화를 이번에 해냈다는 뜻이고, 심사단이 보는 '개선 노력'이 바로 그것입니다.
  */
  const addedMap = new Map<string, number>();
  for (const b of books) if (b.created_at) addedMap.set(kstMonth(b.created_at), (addedMap.get(kstMonth(b.created_at)) ?? 0) + 1);
  const added = [...addedMap.entries()].map(([month, n]) => ({ month, n })).sort((a, b) => a.month.localeCompare(b.month));

  // ── ② 책장 점검 ──────────────────────────────────────────────────────────
  const perBin = new Map<string, { titles: number; copies: number; last: string | null }>();
  for (const c of checks) {
    const slot = perBin.get(c.location_id) ?? { titles: 0, copies: 0, last: null };
    slot.titles += 1;
    slot.copies += c.copies;
    if (c.checked_at && (!slot.last || c.checked_at > slot.last)) slot.last = c.checked_at;
    perBin.set(c.location_id, slot);
  }
  const bins = locations.map((l) => ({
    code: l.code,
    level: l.label_level,
    titles: perBin.get(l.id)?.titles ?? 0,
    copies: perBin.get(l.id)?.copies ?? 0,
    last: perBin.get(l.id)?.last ?? null,
    done: Boolean(l.checked_done_at),
  }));
  const binsStarted = bins.filter((b) => b.titles > 0).length;
  const binsDone = bins.filter((b) => b.done).length;
  const countedCopies = checks.reduce((n, c) => n + c.copies, 0);
  const lastCheck = checks.reduce<string | null>((a, c) => (c.checked_at && (!a || c.checked_at > a) ? c.checked_at : a), null);

  // ── ③ 이용 ───────────────────────────────────────────────────────────────
  const months = recentMonths(12, today);
  const monthMap = new Map(months.map((m) => [m, 0]));
  for (const l of loans) {
    if (!l.borrowed_at) continue;
    const m = kstMonth(l.borrowed_at);
    if (monthMap.has(m)) monthMap.set(m, (monthMap.get(m) ?? 0) + 1);
  }
  const byMonth = months.map((m) => ({ month: m, n: monthMap.get(m) ?? 0 }));

  const since = new Date(new Date(`${today}T00:00:00+09:00`).getTime() - 365 * 86400000)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const recent = loans.filter((l) => l.borrowed_at && kstDay(l.borrowed_at) >= since);
  const borrowers = new Set(recent.map((l) => l.student_no).filter(Boolean)).size;
  const outNow = loans.filter((l) => l.status === "대출중" && !l.returned_at).length;
  const everBorrowed = new Set(loans.map((l) => l.book_id).filter(Boolean));
  const neverBorrowed = books.filter((b) => !everBorrowed.has(b.id)).length;

  const classMap = new Map<string, { loans: number; readers: Set<string> }>();
  for (const l of recent) {
    const key = (l.student_class ?? "").trim() || "Unassigned";
    const slot = classMap.get(key) ?? { loans: 0, readers: new Set<string>() };
    slot.loans += 1;
    if (l.student_no) slot.readers.add(l.student_no);
    classMap.set(key, slot);
  }
  const byClass = [...classMap.entries()]
    .map(([name, v]) => ({ name, loans: v.loans, readers: v.readers.size }))
    .sort((a, b) => b.loans - a.loans || a.name.localeCompare(b.name));

  const titleOf = new Map(books.map((b) => [b.id, b]));
  const topMap = new Map<string, number>();
  for (const l of recent) if (l.book_id) topMap.set(l.book_id, (topMap.get(l.book_id) ?? 0) + 1);
  const topTitles = [...topMap.entries()]
    .map(([id, n]) => ({ n, title: titleOf.get(id)?.title ?? "(removed)", level: titleOf.get(id)?.label_level ?? null }))
    .sort((a, b) => b.n - a.n || a.title.localeCompare(b.title))
    .slice(0, 10);

  return {
    today,
    notice: [booksRes, checksRes, loansRes, locsRes].map((r) => r.error).filter(Boolean).join(" / ") || null,
    collection: { titles: books.length, copies, withIsbn, withLevel, withShelf, withSeries, byLevel, added },
    inventory: {
      bins: bins.length,
      binsStarted,
      binsDone,
      rows: checks.length,
      countedCopies,
      lastCheck,
      holdingsFixes: fixesRes.count ?? 0,
      list: bins,
    },
    usage: {
      cards: cardsRes.count ?? 0,
      loansTotal: loans.length,
      loans12m: recent.length,
      borrowers,
      outNow,
      neverBorrowed,
      byMonth,
      byClass,
      topTitles,
      since,
    },
    snapshots: (snapsRes.data ?? []) as {
      taken_on: string;
      titles: number;
      copies: number;
      with_level: number;
      with_shelf: number;
      bins: number;
      bins_done: number;
      check_copies: number;
      loans_12m: number;
      borrowers_12m: number;
      never_borrowed: number;
      note: string | null;
    }[],
  };
}

export type LibraryEvidence = Awaited<ReturnType<typeof loadLibrary>>;
