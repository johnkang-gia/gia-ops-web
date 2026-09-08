#!/usr/bin/env node
/**
 * 열 번째 버전인데 백업 지점이 없으면 빌드할 때 알려줍니다.
 *
 * 백업을 「생각날 때 하는 일」로 두면 안 하게 됩니다. 정작 필요한 순간은 뭔가 크게 잘못된
 * 뒤인데, 그때는 이미 늦습니다. 그래서 열 번마다 눈앞에 띄웁니다.
 *
 * **빌드를 막지는 않습니다.** 백업이 없다고 배포를 못 하게 하면, 급할 때 사람이 검사를
 * 통째로 꺼버립니다. 무시당하는 검사기는 없는 것과 같습니다.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const minor = Number(version.split(".")[1]);

if (!Number.isFinite(minor) || minor % 10 !== 0) process.exit(0);

const tag = `backup-v${version}`;
try {
  execSync(`git rev-parse -q --verify refs/tags/${tag}`, { stdio: "pipe" });
} catch {
  console.log(`\n📦 v${version} — 열 번째 버전입니다. 백업 지점이 아직 없습니다.`);
  console.log(`   커밋한 뒤 한 번만 실행하세요:  npm run backup`);
  console.log(`   깃 태그(${tag})와 backups/ 압축본이 만들어집니다.\n`);
}
