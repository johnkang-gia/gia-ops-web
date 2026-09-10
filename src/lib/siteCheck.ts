/**
 * **사이트 점검** — 한 번 눌러 모든 화면을 열어보고 결과를 모읍니다.
 *
 * ── 왜 만드나 ────────────────────────────────────────────────────────
 *
 * 메뉴가 90개를 넘었습니다. 사람이 매일 돌면서 눌러보는 것은 이미 불가능하고, 안 도는
 * 날이 늘면 «어제까지 멀쩡했던 화면»이 언제 깨졌는지 아무도 모르게 됩니다. 화면이 깨져도
 * 그 화면을 여는 사람이 말해주기 전까지는 조용합니다.
 *
 * ── 무엇을 하고 무엇을 안 하나 ──────────────────────────────────────
 *
 * **합니다** — 모든 화면을 실제로 열어봅니다. 안 열리는 화면, 오류가 난 화면, 로그인으로
 * 튕기는 화면, 눈에 띄게 느린 화면을 잡습니다. 그리고 열어본 화면 안의 링크가 실제로
 * 있는 화면을 가리키는지 봅니다 - 메뉴에 있는데 없는 화면으로 가는 단추가 이렇게 잡힙니다.
 *
 * **안 합니다** — 저장·발송·삭제 단추는 누르지 않습니다. 눌러보려면 실제로 저장되고 실제로
 * 나갑니다. 학부모에게 청구서가 나가고 업무가 생기고 출결이 바뀝니다. 점검하려고 만든 것이
 * 사고를 내면 안 됩니다. 그런 단추는 사람이 확인하거나, 따로 시험용 환경에서 눌러야 합니다.
 */

/** 이만큼 걸리면 「느림」으로 봅니다. 사람이 «안 뜨네» 하고 다시 누르기 시작하는 지점입니다. */
export const SLOW_MS = 4000;

/**
 * 점검할 화면. **새 화면을 만들면 여기 넣어야 합니다.**
 *
 * 빠뜨리면 그 화면만 조용히 점검에서 빠지는데, 화면에는 「모두 정상」으로 보입니다.
 * 그래서 빌드가 `scripts/check-site-check.mjs` 로 빠진 화면을 찾아 막습니다.
 */
export const SCREENS: string[] = [
  "/academic-calendar",
  "/academic-calendar/prep",
  "/account",
  "/admin/backups",
  "/admin/dashboard",
  "/admin/education-news",
  "/admin/gia-systems",
  "/admin/integrations",
  "/admin/policy-categories",
  "/admin/schema",
  "/admin/shared-accounts",
  "/admin/users",
  "/adopted",
  "/ai-manual",
  "/attendance",
  "/attendance/calendar",
  "/attendance/status",
  "/changelog",
  "/dev",
  "/dev/ai",
  "/dev/diagnostics",
  "/dev/errors",
  "/documents",
  "/documents/new",
  "/events",
  "/finance",
  "/finance/invoices",
  "/finance/items",
  "/finance/payments",
  "/finance/plans",
  "/finance/receipts",
  "/finance/tuition",
  "/home",
  "/inquiries",
  "/manuals",
  "/meetings",
  "/meetings/report",
  "/my-class",
  "/my-class/office",
  "/ops",
  "/ops-board",
  "/pickup",
  "/pickup/inbox",
  "/proposals",
  "/records",
  "/records/drive",
  "/school",
  "/school/apparel",
  "/school/data-check",
  "/school/documents",
  "/school/documents/reports",
  "/school/duty",
  "/school/groups",
  "/school/import",
  "/school/overview",
  "/school/sheet",
  "/school/timetable",
  "/school/toddle",
  "/shuttle",
  "/shuttle/capacity",
  "/shuttle/checklist",
  "/shuttle/checklist/roster",
  "/shuttle/gps",
  "/shuttle/history",
  "/shuttle/live",
  "/shuttle/overview",
  "/shuttle/pilot",
  "/shuttle/regions",
  "/shuttle/routes",
  "/shuttle/stop-times",
  "/shuttle/students",
  "/shuttle/track-test",
  "/staff",
  "/staff-manual",
  "/students",
  "/students/photos",
  "/terms",
  "/weekly-report",
  "/weekly-report/admin/class-roster",
  "/weekly-report/admin/classes",
  "/weekly-report/admin/stats",
  "/weekly-report/admin/students",
  "/weekly-report/admin/subjects",
  "/weekly-report/homeroom",
  "/weekly-report/print",
  "/weekly-report/students",
  "/weekly-report/subjects",
  "/work",
  "/work/dismissal",
  "/work/history",
  "/work/inquiry-search",
  "/work/report",
  "/work/trash",
];

/**
 * 읽기만 하는 창구. 눌러도 아무것도 안 바뀌는 것만 넣습니다.
 *
 * 저장·발송하는 창구는 **넣지 않습니다.** 점검이 실제 자료를 만들면 그건 점검이 아닙니다.
 */
export const READONLY_APIS: string[] = [
  "/api/admin/pending-signups",
  "/api/finance/export/alltalkpay?dryRun=1",
];

export type Verdict = "정상" | "느림" | "오류" | "안 열림" | "없는 화면" | "로그인으로 튕김" | "권한 막힘";

export type CheckResult = {
  path: string;
  status: number | null;
  ms: number;
  verdict: Verdict;
  /** 사람이 읽고 무엇을 해야 할지 알 수 있는 한 줄. */
  note: string;
  /** 이 화면 안에서 없는 곳을 가리키는 링크. */
  deadLinks: string[];
};

/** 화면 하나의 판정. 상태·시간·본문을 함께 봅니다 - 200 인데 오류 화면인 경우가 있습니다. */
export function verdictOf(input: {
  status: number | null;
  ms: number;
  finalUrl: string | null;
  body: string;
  failed?: string | null;
}): { verdict: Verdict; note: string } {
  if (input.failed) return { verdict: "안 열림", note: input.failed };
  const s = input.status ?? 0;
  // 로그인 화면으로 끌려갔으면 세션이 안 따라간 것입니다. 200 이라 그냥 두면 «정상»으로 보입니다.
  if (input.finalUrl && /\/login(\?|$)/.test(input.finalUrl)) {
    return { verdict: "로그인으로 튕김", note: "세션이 따라가지 않았습니다" };
  }
  if (s === 404) return { verdict: "없는 화면", note: "그런 주소가 없습니다" };
  if (s === 401 || s === 403) return { verdict: "권한 막힘", note: `개발자 계정인데 ${s} 로 막혔습니다` };
  if (s >= 500) return { verdict: "오류", note: `서버가 ${s} 로 답했습니다` };
  if (s >= 400) return { verdict: "오류", note: `${s} 로 답했습니다` };
  // 200 인데 오류 화면인 경우. Next 는 오류를 200 짜리 화면으로 그려줄 때가 있습니다.
  const broken = ERROR_MARKS.find((m) => input.body.includes(m));
  if (broken) return { verdict: "오류", note: `화면에 「${broken}」 가 떠 있습니다` };
  if (input.ms > SLOW_MS) return { verdict: "느림", note: `${(input.ms / 1000).toFixed(1)}초 걸렸습니다` };
  return { verdict: "정상", note: "" };
}

/** 200 으로 돌아왔지만 실제로는 깨진 화면임을 알려주는 글자들. */
const ERROR_MARKS = [
  "Application error",
  "Internal Server Error",
  "일시적인 문제가 발생",
  "문제가 발생했습니다",
  "Unhandled Runtime Error",
];

/** 화면 안의 앱 내부 링크를 모읍니다. 바깥 주소·앵커·파일은 뺍니다. */
export function collectLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const p = m[1].replace(/\/$/, "") || "/";
    if (/\.(png|jpg|jpeg|svg|ico|css|js|json|webmanifest|txt|pdf)$/i.test(p)) continue;
    if (p.startsWith("/_next") || p.startsWith("/api")) continue;
    out.add(p);
  }
  return [...out];
}

/**
 * 없는 곳을 가리키는 링크.
 *
 * `/students/1234` 처럼 값이 들어가는 주소는 앞부분만 보고 통과시킵니다 - 여기서 학생 번호가
 * 맞는지까지 보려 들면 헛걸림만 늘고, 헛걸리는 검사는 사람이 무시하게 됩니다.
 */
export function deadLinks(links: string[], known: string[]): string[] {
  const set = new Set(known);
  const prefixes = DYNAMIC_PREFIXES;
  return links.filter((p) => {
    if (set.has(p)) return false;
    if (prefixes.some((pre) => p.startsWith(pre))) return false;
    return !OUTSIDE_DASHBOARD.some((pre) => p === pre || p.startsWith(pre + "/"));
  });
}

/** 값이 들어가는 주소. 뒤에 무엇이 붙든 그 화면은 있습니다. */
const DYNAMIC_PREFIXES = [
  "/students/",
  "/staff/",
  "/weekly-report/students/",
  "/attendance/students/",
  "/finance/statement/",
  "/finance/invoices/",
  "/ops/",
  "/meetings/",
  "/events/",
  "/documents/",
  "/manuals/",
  "/proposals/",
  "/records/",
  "/school/documents/",
];

/** 로그인 영역 밖의 화면들(로그인·안내보드·도착체크 등). 여기서는 판정하지 않습니다. */
const OUTSIDE_DASHBOARD = [
  "/login",
  "/onboarding",
  "/pending",
  "/shuttle-board",
  "/shuttle-arrival",
  "/shuttle-pilot",
  "/s",
  "/b",
  "/d",
];

/** 점검할 것 전부. 화면을 먼저 봅니다 - 사람이 매일 여는 것이 화면입니다. */
export function allTargets(): string[] {
  return [...SCREENS, ...READONLY_APIS];
}

/** 한 번에 보낼 개수. 너무 크게 잡으면 창구가 시간을 넘겨 통째로 실패합니다. */
export const BATCH = 8;
