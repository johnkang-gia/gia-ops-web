// 새 마이그레이션은 **이미 올라간 마지막 마이그레이션보다 뒤**여야 합니다.
//
// 도서관 작업이 「20261131000000」을 올렸는데, 그 사이 운영앱 작업의 「20261201000000」이 먼저 올라가
// 적용돼 있었습니다. 적용기는 «마지막 적용분보다 앞에 끼어든 파일»을 거절하고 전체를 멈춥니다. 그래서 그
// 뒤에 올린 마이그레이션까지 전부 안 걸렸고, 화면에는 오류가 아니라 「칸이 없습니다」로만 보였습니다.
// 두 저장소·두 작업이 같은 폴더에 넣으므로 «ls | tail -1» 을 본 뒤에도 남이 먼저 올릴 수 있습니다.
//
// 여기서는 origin/main 에 이미 있는 파일 중 가장 늦은 것보다 앞선 **새 파일**을 막습니다. git 이 없는
// 곳(배포 서버)에서는 건너뜁니다 - 그곳의 빌드를 막을 이유는 없습니다.
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
const dir = "supabase/migrations";
let remote;
try {
  remote = execSync(`git ls-tree --name-only origin/main ${dir}/`, { stdio: ["ignore", "pipe", "ignore"] })
    .toString().split("\n").map((p) => p.split("/").pop()).filter((f) => f && f.endsWith(".sql"));
} catch {
  console.log("· 마이그레이션 순서 검사 건너뜀 (git origin/main 없음)");
  process.exit(0);
}
const last = remote.sort().at(-1) ?? "";
const remoteSet = new Set(remote);
const bad = readdirSync(dir).filter((f) => f.endsWith(".sql") && !remoteSet.has(f) && f < last);
if (bad.length) {
  console.error(`✗ 이미 올라간 마지막 마이그레이션(${last})보다 앞선 새 파일이 있습니다.\n\n  ${bad.join("\n  ")}\n\n  이름의 시각을 ${last.slice(0, 14)} 보다 뒤로 바꾸세요. 그대로 올리면 자동 적용이 통째로 멈춥니다.`);
  process.exit(1);
}
console.log("✓ 마이그레이션 순서 검사 통과");
