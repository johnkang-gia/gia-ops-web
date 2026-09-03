// 학생 이름 대조를 새로 만든 자리를 찾습니다.
//
// 이 판단이 여섯 파일에 흩어져 있었고, 이번 주에 난 오류가 전부 거기서 나왔습니다.
//
//   사진 : `고서윤` 이 안 맞음 (맥의 자모 분리)
//   출결 : `이예나 셔틀 안탑니다` 가 통째로 무시됨
//   동승 : `하임이` 가 임하임인지 정하임인지 못 가림
//   문의 : `김재이` 셋 중 누구인지 표시 안 됨
//
// **한 곳을 고쳐도 나머지 다섯은 그대로였습니다.** 부서 판정을 한 곳으로 모으고 검사기를
// 붙였던 것과 같은 문제입니다. 이름도 `src/lib/studentName.ts` 하나만 씁니다.
//
// 옮기는 중이라 아직 남아 있는 자리는 아래 ALLOW 에 적어두고, 하나씩 지워갑니다.
// **ALLOW 를 늘리지 마세요.** 줄어드는 목록이어야 합니다.
import fs from "node:fs";
import path from "node:path";

const HOME = "src/lib/studentName.ts";
// 이름을 맞대는 일을 하는 함수 이름들. 이 이름으로 새로 만들면 잡힙니다.
const NAMES = [
  "normalizeName", "matchStudent", "findBySurface", "surfaceForms",
  "nameForms", "nameSurfaces", "surfacesOf", "displayName", "isHomonym", "studentLabel",
];

// 아직 못 옮긴 자리. 옮길 때마다 여기서 지웁니다.
const ALLOW = new Map([
  ["src/lib/pickupParse.ts", "픽업·문의 대조. studentName 으로 옮기는 중 - 인박스 전체가 여기에 걸려 있어 한 번에 못 바꿉니다."],
  ["src/lib/passportPhoto.ts", "사진 파일명 대조. 파일명에는 반 힌트가 (G3J) 처럼 붙어 와서 규칙이 조금 다릅니다."],
  ["src/lib/attendanceIntent.ts", "출결 문장 안의 이름 표기. 문장 쪼개기와 얽혀 있어 함께 옮겨야 합니다."],
  ["src/lib/rideAlong.ts", "동승 요청. studentName 으로 옮기는 중."],
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const bad = [];
for (const file of walk("src")) {
  const rel = path.relative(process.cwd(), file);
  if (rel === HOME || ALLOW.has(rel)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if ((lines[i - 1] ?? "").includes("name-ok:")) return;
    const m = line.match(new RegExp(`function\\s+(${NAMES.join("|")})\\b`));
    if (m) bad.push(`  ${rel}:${i + 1}  ${m[1]}`);
  });
}

if (bad.length > 0) {
  console.error("학생 이름 대조를 새로 만들었습니다:\n");
  console.error(bad.join("\n"));
  console.error(
    "\n이름 대조는 `src/lib/studentName.ts` 한 곳만 씁니다.",
    "\n여섯 곳에 흩어져 있던 탓에, 한 곳을 고쳐도 나머지에서 같은 오류가 계속 났습니다.",
    "\n· 찾기: findByName(표기, 명부)   · 좁히기: narrowBy(후보, {grade, className})",
    "· 화면 표기: displayName(학생, 명부)",
    "\n정말 따로 만들어야 한다면 바로 윗줄에 `// name-ok: 이유` 를 적으세요.\n",
  );
  process.exit(1);
}
console.log(`학생 이름 검사 통과 (아직 옮기지 못한 자리 ${ALLOW.size}곳)`);
