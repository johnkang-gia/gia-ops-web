// `truncate` 를 flex 상자에 건 자리를 찾습니다.
//
// `truncate` 는 세 가지를 한꺼번에 겁니다: `overflow:hidden` · `text-overflow:ellipsis` ·
// **`white-space:nowrap`**. 앞의 둘은 글자를 자르지만, 마지막 하나는 **자르기 전에 먼저 한
// 줄로 늘어놓습니다.** 그 요소가 flex 상자면 nowrap 이 안쪽으로 퍼져서, 긴 글 하나가 줄 전체의
// 최소 너비가 되고 바깥 칸까지 그만큼 벌어집니다.
//
// 실제로 이런 일이 있었습니다. 학부모 문의 한 건이 1,500자로 들어오자 업무 보드가 9,412px 로
// 늘어났습니다(화면은 1,366px). 출결내역 탭으로 옮기면 돌아왔는데, 긴 글이 그 탭에만 있었기
// 때문입니다. 자료 한 줄이 화면 전체를 밀어낸 것이라 원인을 찾기가 아주 어려웠습니다.
//
// 자를 글은 **flex 상자가 아닌 안쪽 요소**에 걸어야 합니다. 여러 줄이 될 수 있는 글이라면
// `line-clamp-1` 쪽이 낫습니다 - 줄바꿈을 허용한 채 첫 줄만 보여주므로 최소 너비가 낱말
// 하나를 넘지 않습니다.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src");
const CLASS = /className="([^"]*)"/g;
// display 를 flex 로 만드는 것만 봅니다. flex-1 · flex-col 은 상자가 아닙니다.
const FLEX = new Set(["flex", "inline-flex"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const bad = [];
for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // 바로 윗줄에 이유를 적어두면 넘어갑니다.
    if ((lines[i - 1] ?? "").includes("truncate-ok:")) return;
    for (const m of line.matchAll(CLASS)) {
      const cls = m[1].split(/\s+/);
      if (cls.includes("truncate") && cls.some((c) => FLEX.has(c))) {
        bad.push(`  ${path.relative(process.cwd(), file)}:${i + 1}\n    ${m[1].slice(0, 90)}`);
      }
    }
  });
}

if (bad.length > 0) {
  console.error("flex 상자에 truncate 를 걸었습니다:\n");
  console.error(bad.join("\n"));
  console.error(
    "\ntruncate 는 자르기 전에 먼저 한 줄로 늘어납니다. flex 상자에 걸면 그 한 줄이 칸 전체의",
    "\n최소 너비가 되어, 긴 글 한 건이 화면을 옆으로 밀어냅니다(업무 보드가 9,412px 이 된 적이 있습니다).",
    "\n· 상자에서는 떼고 `overflow-hidden` 만 남기세요.",
    "\n· 자를 글은 안쪽 요소에 `truncate` 로, 여러 줄이 될 수 있으면 `line-clamp-1` 로 거세요.",
    "\n· 정말 이대로여야 한다면 바로 윗줄에 `// truncate-ok: 이유` 를 적으세요.\n",
  );
  process.exit(1);
}
console.log("truncate 검사 통과");
