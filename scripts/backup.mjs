#!/usr/bin/env node
/**
 * 열 번째 버전마다 **되돌아갈 수 있는 지점**을 남깁니다.
 *
 * 커밋은 이미 전부 남아 있지만, 몇 달 뒤에 「그때 그 상태」를 찾으려면 400개가 넘는 커밋
 * 목록에서 짐작으로 골라야 합니다. 그건 백업이 아닙니다 - 찾을 수 없는 백업은 없는 것과
 * 같습니다. 그래서 열 번마다 이름표를 박아둡니다.
 *
 * 두 벌을 만듭니다. 성격이 다릅니다.
 *
 *   ① **깃 태그** `backup-v0.480.0` — GitHub 에 올라가는 진짜 백업입니다. 다른 컴퓨터에서도
 *      `git checkout backup-v0.480.0` 한 줄로 그때로 돌아갑니다.
 *   ② **압축본** `backups/gia-ops-v0.480.0.zip` — 담당자 컴퓨터에 그대로 남는 사본입니다.
 *      깃을 몰라도 열어볼 수 있고, GitHub 에 못 들어가는 상황에도 남아 있습니다.
 *
 * ②는 ①과 같은 디스크에 있으므로 **혼자서는 백업이 아닙니다.** 둘 다 있어야 합니다.
 *
 * DB(Supabase)는 여기서 받지 않습니다. 서비스 키가 있어야 하고, 학생 개인정보가 담긴
 * 파일을 자동으로 만들어 폴더에 흘려두는 것은 위험이 이득보다 큽니다. Supabase 자체 백업을
 * 쓰고, 표 구조는 `supabase/migrations` 에 이미 전부 들어 있습니다.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `backup-v${version}`;
const zip = `backups/gia-ops-v${version}.zip`;

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const quiet = (cmd) => {
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

// 안 올린 변경이 있는 채로 백업하면, 태그가 가리키는 것과 압축본이 서로 다릅니다.
// 「그때로 돌아갔는데 뭔가 다르다」가 가장 나쁜 백업입니다.
if (sh("git status --porcelain")) {
  console.error("✗ 커밋하지 않은 변경이 있습니다. 먼저 커밋한 뒤 백업하세요.");
  console.error("  태그와 압축본이 서로 다른 상태를 가리키면 백업이 아니라 혼란입니다.");
  process.exit(1);
}

if (!existsSync("backups")) mkdirSync("backups");

if (quiet(`git rev-parse -q --verify refs/tags/${tag}`)) {
  console.log(`· 태그 ${tag} 는 이미 있습니다.`);
} else {
  sh(`git tag -a ${tag} -m "백업 지점 v${version}"`);
  console.log(`✓ 태그 ${tag} 를 만들었습니다.`);
}

if (!quiet(`git push origin ${tag}`)) {
  console.error(`✗ 태그를 GitHub 에 올리지 못했습니다. 직접 올려주세요: git push origin ${tag}`);
  console.error("  올라가지 않은 태그는 이 컴퓨터에만 있습니다 - 그건 백업이 아닙니다.");
  process.exit(1);
}
console.log(`✓ 태그를 GitHub 에 올렸습니다.`);

if (existsSync(zip)) {
  console.log(`· 압축본 ${zip} 은 이미 있습니다.`);
} else {
  sh(`git archive --format=zip -o ${zip} ${tag}`);
  console.log(`✓ 압축본 ${zip}`);
}

console.log(`\n되돌리려면: git checkout ${tag}`);
