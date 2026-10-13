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
  "/dev/inspect",
  "/dev/usage",
  "/documents",
  "/documents/new",
  "/events",
  "/finance",
  "/finance/invoices",
  "/finance/items",
  "/finance/payments",
  "/finance/plans",
  "/finance/import",
  "/finance/monthly",
  "/finance/monthly/students",
  "/finance/rounds",
  "/finance/alltalk-sync",
  "/finance/send",
  "/finance/unpaid",
  "/finance/prepaid",
  "/finance/approvals",
  "/finance/revenue",
  "/finance/accounts",
  "/finance/promotion",
  "/finance/ledger",
  "/finance/receipts",
  "/finance/tuition",
  "/home",
  "/inquiries",
  "/manuals",
  "/meetings",
  "/meetings/report",
  "/my-class",
  "/consult",
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
  "/school/consult",
  "/school/library",
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
export const READONLY_APIS: string[] = ["/api/admin/pending-signups"];

export type Verdict = "정상" | "느림" | "오류" | "안 열림" | "없는 화면" | "로그인으로 튕김" | "권한 막힘" | "잘림" | "먹통" | "화면 오류";

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
  const broken = brokenMark(input.body);
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

/**
 * **글자가 들어 있다고 오류는 아닙니다.**
 *
 * `/changelog` 가 「오류」로 잡혔습니다. 실제로는 멀쩡했고, **버전 기록 본문에 「Application
 * error」라는 말이 적혀 있었을 뿐**입니다 - 이 점검기를 만들면서 「화면 안에 Application
 * error 같은 글자가 있으면 잡습니다」라고 적어 둔 그 문장이었습니다. 검사기가 자기 설명을
 * 읽고 자기를 고장 났다고 말한 셈입니다.
 *
 * 헛걸리는 검사는 사람이 무시하게 되고, 무시당하는 검사는 없는 것과 같습니다(CLAUDE.md 1).
 *
 * ── 이제 두 갈래로 봅니다 ───────────────────────────────────────────────────
 *
 *   ① **우리 오류 화면**은 자국을 남깁니다(`data-app-error="1"`, `ErrorScreen`).
 *      글이 아니라 속성이라 본문에 우연히 들어갈 수 없습니다. 이게 제일 확실합니다.
 *   ② 우리 오류 화면조차 못 뜬 경우에는 Next 기본 화면이 뜹니다. 그 화면은 **거의 비어
 *      있고** 문장이 맨 앞에 옵니다 - 그래서 앞부분에 있고 본문이 짧을 때만 오류로 봅니다.
 *      메뉴와 목록이 잔뜩 실린 화면에 그 글자가 섞여 있다면 그건 글입니다.
 */
const APP_ERROR_MARK = 'data-app-error="1"';
const ERROR_HEAD_CHARS = 4000;
const ERROR_MAX_BODY = 40000;

export function brokenMark(body: string): string | null {
  if (body.includes(APP_ERROR_MARK)) return "화면을 불러오는 중 문제가 생겼습니다";
  const hit = ERROR_MARKS.find((m) => body.slice(0, ERROR_HEAD_CHARS).includes(m));
  if (!hit) return null;
  // 내용이 잔뜩 실린 화면이면 오류 화면이 아닙니다.
  if (body.length > ERROR_MAX_BODY) return null;
  return hit;
}

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
  // 상담 행사마다 화면이 하나씩 생깁니다.
  "/school/consult/",
  "/staff/",
  "/weekly-report/students/",
  "/attendance/students/",
  "/finance/statement/",
  "/finance/invoices/",
  // `/finance/monthly/2026-09` — 달이 주소에 들어갑니다. 달마다 화면을 등록할 수는 없습니다.
  "/finance/monthly/",
  // 올린 묶음마다 검수 화면이 하나씩 생깁니다.
  "/finance/import/",
  "/ops/",
  "/meetings/",
  "/events/",
  "/documents/",
  "/manuals/",
  "/proposals/",
  "/records/",
  "/school/documents/",
  // 운영 대시보드의 토큰 링크. `/ops-board` 화면이 만들어 둔 링크 목록을 그대로 그리는데,
  // 그 링크들이 여기 없어서 **있는 화면인데 「끊긴 링크」로 잡혔습니다.** 헛걸리는 검사는
  // 사람이 무시하게 되고, 무시당하는 검사는 없는 것과 같습니다(CLAUDE.md §1).
  "/ops-board/",
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

// ── 화면이 잘려 있는가(스크롤이 안 되는 화면) ─────────────────────────────────
//
// 위의 점검은 서버에서 HTML 을 받아 보므로 **화면이 열린다**까지만 압니다. 하원수단 화면은
// 잘 열렸고 오류도 없었는데, 본문이 화면 높이에 갇혀 있어서 아래쪽에 아예 손이 닿지 않았습니다.
// 그건 실제로 그려 봐야만 압니다. 그래서 점검 화면이 각 화면을 **숨은 틀(iframe)** 에 열어 그린
// 뒤 잽니다 - 부르는 사람의 로그인이 그대로 따라가므로 그 사람이 보는 화면과 같습니다.

/** 점검용 틀의 이름. 이용 기록은 이 이름의 틀에서 온 것을 세지 않습니다. */
export const SITE_CHECK_FRAME = "gia-site-check";

/** 이만큼 넘게 가려져 있으면 «잘림»입니다. 몇 px 짜리는 그림자·테두리라 사람이 못 느낍니다. */
export const CLIP_PX = 24;

export type ClipHit = { where: string; hiddenPx: number };

/**
 * **넘치는데 굴릴 수 없는 상자**를 찾습니다.
 *
 * 세로 넘침을 숨긴(`overflow-y: hidden/clip`) 상자인데 안의 내용이 상자보다 크면, 그 차이만큼은
 * 어떤 방법으로도 볼 수 없습니다 - 안쪽에 스크롤 칸이 있었다면 내용이 그 칸 안에서 굴러 상자
 * 높이를 넘지 않았을 것이기 때문입니다. 그래서 «안쪽에 스크롤이 있나»를 따로 찾지 않고 넘친
 * 양만 봅니다.
 *
 * 보는 상자는 본문(<main>)과 그 바깥 껍데기, 그리고 본문 안의 큰 상자(높이 300px 이상)입니다.
 * 작은 상자까지 보면 말줄임·접힌 펼침 같은 **일부러 자른 것**이 다 걸립니다. 일부러 자른 큰
 * 상자는 `data-clip-ok` 를 답니다.
 */
export function findClipped(doc: Document): ClipHit[] {
  const win = doc.defaultView;
  if (!win) return [];
  const main = doc.querySelector("main");
  if (!main) return [];
  const boxes = new Set<Element>();
  for (let el: Element | null = main; el && el !== doc.documentElement; el = el.parentElement) boxes.add(el);
  main.querySelectorAll("*").forEach((el) => {
    if ((el as HTMLElement).clientHeight >= 300) boxes.add(el);
  });
  const hits: ClipHit[] = [];
  for (const el of boxes) {
    if (el.closest("[data-clip-ok]")) continue;
    // 지도 라이브러리가 만든 상자(이름표 없이 위치만 박힌 div)는 일부러 넘치게 그립니다. 굴릴 대상이 아닙니다.
    if (isMapInternal(el as HTMLElement)) continue;
    const oy = win.getComputedStyle(el).overflowY;
    if (oy !== "hidden" && oy !== "clip") continue;
    const box = el as HTMLElement;
    if (box.clientHeight === 0) continue;
    const hidden = box.scrollHeight - box.clientHeight;
    if (hidden > CLIP_PX) hits.push({ where: describeBox(box), hiddenPx: hidden });
  }
  // 바깥 상자가 잘렸으면 안쪽도 함께 잘려 보입니다. 가장 많이 가린 것 하나가 원인에 가깝습니다.
  return hits.sort((a, b) => b.hiddenPx - a.hiddenPx).slice(0, 3);
}

function isMapInternal(el: HTMLElement): boolean {
  if (el.closest(".leaflet-container, [data-map], .gm-style")) return true;
  // 카카오 지도 등은 클래스 없이 style 로만 자리를 잡은 div 를 겹겹이 만듭니다.
  for (let e: HTMLElement | null = el, i = 0; e && i < 4; e = e.parentElement, i++) {
    if (!e.getAttribute("class") && (e.getAttribute("style") ?? "").includes("position")) return true;
  }
  return false;
}

function describeBox(el: HTMLElement): string {
  if (el.tagName === "MAIN") return "본문(main)";
  const heading = el.querySelector("h1, h2, h3")?.textContent?.trim().slice(0, 20);
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${heading ? ` (「${heading}」)` : ""}`;
}

// ── 그려 본 화면의 종합 진찰 ─────────────────────────────────────────────────
//
// 아침에 점검을 돌려 「모두 정상」을 봤는데 낮에 «스크롤이 안 된다», «눌러도 반응이 없다»가
// 나왔습니다. 서버에서 받아 보는 점검은 화면이 **열리는가**까지만 알고, 사람이 실제로 쓰는
// 모습(굴리기·누르기)은 그려 봐야만 압니다. 그래서 숨은 틀에 그린 화면을 여러 방향으로 진찰합니다.
//
//   잘림      — 세로·가로로 넘치는데 굴릴 수 없는 상자, 페이지 전체 스크롤이 잠긴 것
//   먹통      — 화면을 덮은 투명 막, 다른 것에 가려 안 눌리는 단추, 끝나지 않는 로딩,
//               화면이 오래 멈추는 무거운 작업
//   화면 오류 — 화면 안에서 난 자바스크립트 오류, 오류 화면, 아무것도 안 그려진 빈 화면
//
// 단추는 **누르지 않습니다**(저장·발송이 실제로 일어납니다). 대신 «눌리는 자리에 그 단추가 맨
// 위에 있는가»를 봅니다 - 먹통의 대부분은 투명한 막이 위를 덮고 있는 경우입니다.

/**
 * 점검용 틀 안에서만 켜지는 기록기(root layout 의 <head> 에 들어갑니다). 화면이 그려지기 **전에**
 * 붙어야 첫 오류·첫 멈춤까지 잡습니다. 점검용 틀이 아니면 아무것도 하지 않습니다.
 */
export const SITE_CHECK_COLLECTOR = `(function(){try{if(window.name!=="${SITE_CHECK_FRAME}")return;var g=window.__giaCheck={errors:[],warns:[],longest:0,blocked:0};
function cut(x){return String(x==null?"":x).slice(0,220)}
addEventListener("error",function(e){if(e&&e.target&&e.target!==window&&e.target.tagName){g.warns.push("불러오지 못함: "+cut(e.target.src||e.target.href));return}g.errors.push(cut((e&&(e.message||(e.error&&e.error.message)))||"오류"))},true);
addEventListener("unhandledrejection",function(e){var r=e&&e.reason;g.errors.push("처리 안 된 오류: "+cut((r&&r.message)||r))});
var ce=console.error;console.error=function(){try{var m=Array.prototype.map.call(arguments,function(a){return a&&a.message?a.message:String(a)}).join(" ");(/Minified React error|Hydration|hydrat/i.test(m)?g.errors:g.warns).push(cut(m))}catch(_){}return ce.apply(console,arguments)};
if(window.PerformanceObserver){new PerformanceObserver(function(l){l.getEntries().forEach(function(t){g.blocked+=Math.max(0,t.duration-50);if(t.duration>g.longest)g.longest=t.duration})}).observe({type:"longtask",buffered:true})}}catch(_){}})();`;

export type RenderIssue = { kind: "잘림" | "먹통" | "화면 오류"; text: string };

type Collected = { errors: string[]; warns: string[]; longest: number; blocked: number };

/** 화면이 이만큼 한 번에 멈추면 사람은 «눌렀는데 반응이 없다»고 느낍니다. */
export const FREEZE_MS = 1500;
/** 자바스크립트 오류 중 화면과 무관한 잡음. 여기 넣을 때는 왜 무관한지 확신이 있어야 합니다. */
const ERROR_NOISE = [/ResizeObserver loop/i, /Script error\.?$/i];

const LOADING_TEXT = /불러오는 중|로딩 중|Loading\.\.\./;

/** 지금 화면에 «끝나지 않은 로딩»이 보이는가. 뱅글이·「불러오는 중」 글자. */
export function stillLoading(doc: Document): boolean {
  const main = doc.querySelector("main");
  if (!main) return false;
  const spin = [...main.querySelectorAll(".animate-spin, [aria-busy='true']")].some((el) => (el as HTMLElement).offsetParent !== null);
  return spin || LOADING_TEXT.test((main as HTMLElement).innerText.slice(0, 3000));
}

export function inspectRendered(doc: Document): RenderIssue[] {
  const win = doc.defaultView;
  if (!win) return [];
  const issues: RenderIssue[] = [];
  const g = (win as unknown as { __giaCheck?: Collected }).__giaCheck;

  // ── 화면 오류 ───────────────────────────────────────────────────────────
  if (doc.querySelector('[data-app-error="1"]')) issues.push({ kind: "화면 오류", text: "화면에 「문제가 생겼습니다」 오류 화면이 떠 있습니다" });
  const errs = (g?.errors ?? []).filter((e) => !ERROR_NOISE.some((n) => n.test(e)));
  // 오류마다 한 줄씩. 같은 오류가 여러 화면에 나면 점검 화면이 «공통 문제»로 한데 모읍니다.
  for (const e of [...new Set(errs.map((x) => x.replace(/;?\s*visit https?:\/\/\S+.*$/i, "").trim()))].slice(0, 3)) {
    issues.push({ kind: "화면 오류", text: `화면 안 오류: ${e}` });
  }
  const main = doc.querySelector("main") as HTMLElement | null;
  if (!main) issues.push({ kind: "화면 오류", text: "본문(main)이 그려지지 않았습니다" });
  else if (main.innerText.trim().length < 5 && !main.querySelector("img, svg, canvas, iframe, table")) {
    issues.push({ kind: "화면 오류", text: "본문이 비어 있습니다(아무것도 그려지지 않음)" });
  }

  // ── 잘림 ────────────────────────────────────────────────────────────────
  for (const h of findClipped(doc)) issues.push({ kind: "잘림", text: `${h.where}에서 ${h.hiddenPx}px 가 가려져 굴려도 안 보입니다` });
  if (main && win.getComputedStyle(main).overflowX === "hidden" && main.scrollWidth - main.clientWidth > CLIP_PX * 2) {
    issues.push({ kind: "잘림", text: `본문 오른쪽 ${main.scrollWidth - main.clientWidth}px 가 잘려 옆으로도 굴릴 수 없습니다` });
  }
  // 창(모달)이 닫히면서 페이지 스크롤 잠금을 안 풀고 간 경우. 화면은 멀쩡한데 굴려지지 않습니다.
  for (const el of [doc.documentElement, doc.body]) {
    const st = win.getComputedStyle(el);
    if ((st.overflow === "hidden" || st.overflowY === "hidden") && el.style.overflow === "hidden" && el.scrollHeight - el.clientHeight > CLIP_PX) {
      issues.push({ kind: "잘림", text: `페이지 스크롤이 잠겨 있습니다(${el.tagName.toLowerCase()} 에 overflow:hidden 이 남음)` });
    }
  }

  // ── 먹통 ────────────────────────────────────────────────────────────────
  if (main) {
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    // ① 본문 한가운데를 누르면 무엇이 맞나. 본문 밖의 큰 막이면 화면 전체가 안 눌립니다.
    const r = main.getBoundingClientRect();
    const cx = Math.min(vw - 2, Math.max(2, r.left + r.width / 2));
    const cy = Math.min(vh - 2, Math.max(2, r.top + Math.min(r.height, vh - r.top) / 2));
    const hit = doc.elementFromPoint(cx, cy);
    if (hit && !main.contains(hit) && !hit.contains(main)) {
      const box = (hit as HTMLElement).getBoundingClientRect();
      if (box.width * box.height > vw * vh * 0.5) {
        issues.push({ kind: "먹통", text: `화면을 덮은 막이 있어 본문이 안 눌립니다(덮은 것: ${describeBox(hit as HTMLElement)})` });
      }
    }
    // ② 보이는 단추·링크가 그 자리에서 맨 위에 있는가.
    const clickables = [...main.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [role='button'], input:not([type='hidden']), select, textarea")]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        if (b.width < 4 || b.height < 4 || b.bottom <= 0 || b.top >= vh || b.right <= 0 || b.left >= vw) return false;
        const st = win.getComputedStyle(el);
        return st.visibility !== "hidden" && st.pointerEvents !== "none" && Number(st.opacity) > 0.05;
      })
      .slice(0, 80);
    const blocked: { el: HTMLElement; by: Element }[] = [];
    for (const el of clickables) {
      const b = el.getBoundingClientRect();
      const at = doc.elementFromPoint(Math.min(vw - 1, b.left + b.width / 2), Math.min(vh - 1, b.top + b.height / 2));
      if (!at || el === at || el.contains(at) || at.contains(el)) continue;
      if (at.closest("label")?.contains(el)) continue;
      blocked.push({ el, by: at });
    }
    if (blocked.length >= 3 && blocked.length >= clickables.length * 0.3) {
      issues.push({
        kind: "먹통",
        text: `보이는 단추 ${clickables.length}개 중 ${blocked.length}개가 다른 것에 가려 안 눌립니다(가린 것: ${describeBox(blocked[0].by as HTMLElement)})`,
      });
    }
  }
  if (g && g.longest > FREEZE_MS) {
    issues.push({ kind: "먹통", text: `여는 동안 화면이 ${(g.longest / 1000).toFixed(1)}초 동안 멈췄습니다(그동안 눌러도 반응 없음)` });
  }
  return issues;
}
