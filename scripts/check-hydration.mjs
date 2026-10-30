// 서버와 브라우저가 «첫 그림»을 다르게 그리는 자리를 막습니다 (React 오류 #418).
//
// `{typeof document !== "undefined" && …}` 는 서버에서는 아무것도 안 그리고 브라우저에서는
// 첫 그림부터 무언가를 그립니다. 그 어긋남이 생기면 React 는 가장 가까운 경계 안을 통째로
// 지우고 다시 그립니다. ToastProvider 가 로그인 영역 전체를 감싸고 이 모양을 쓰고 있어서
// 110개 화면이 매번 사이드바·상단탭·본문을 처음부터 다시 그렸고, 그 사이 누른 것은 사라졌습니다.
//
// 브라우저에서만 그릴 것은 `mounted` 상태(useEffect 에서 true)로 가릅니다. 열린 뒤에만 그리는
// 자리(`{open && typeof document …}`)는 첫 그림이 양쪽 다 «없음»이라 괜찮고, 이 검사에 안 걸립니다.
// 정말 괜찮은 자리라면 바로 위 줄에 `hydration-ok: 이유` 를 적습니다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// 시간대 없는 날짜 글자도 같은 사고를 냅니다. 서버는 UTC, 브라우저는 한국이라
// `new Date(x).toLocaleString("ko-KR")` 는 두 곳에서 아홉 시간 다른 글자가 되고, 그 화면은
// 매번 통째로 다시 그려집니다(백업 화면). 날짜·시각을 글자로 만들 때는 timeZone 을 적습니다.
// 숫자(`n.toLocaleString("ko-KR")`)는 시간대와 상관없어 `new Date(` 가 있는 줄만 봅니다.
const tzPat = /new Date\([^;]*\.toLocale(?:Date|Time)?String\(\s*["']ko-KR["']\s*(?:\)|,\s*\{(?![^}]*timeZone)[^}]*\})/;
const bad = [];
const pat = /\{\s*typeof\s+(document|window)\s*!==\s*["']undefined["']\s*&&/;
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (!pat.test(l) && !tzPat.test(l)) return;
        const above = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
        if (above.includes("hydration-ok")) return;
        bad.push(`${p}:${i + 1}: ${l.trim().slice(0, 100)}`);
      });
    }
  }
}
walk("src");
if (bad.length) {
  console.error("✗ 서버와 브라우저의 첫 그림이 달라지는 자리 (하이드레이션 오류 #418):");
  for (const b of bad) console.error("  " + b);
  console.error("  → mounted 상태로 가르거나, 날짜 글자에는 timeZone: Asia/Seoul 을 적거나, 정말 괜찮으면 위 줄에 `hydration-ok: 이유` 를 적으세요.");
  process.exit(1);
}
console.log("✓ check-hydration");
