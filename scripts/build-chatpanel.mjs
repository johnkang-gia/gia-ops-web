// public/chatpanel/src/* 를 public/chatpanel/gia-chat-panel.zip 으로 묶습니다 (빌드마다).
//
// 왜 직접 쓰는가: 빌드 기계(Vercel)에 zip 명령이 있다는 보장이 없고, 압축 라이브러리를 하나 더 들이고 싶지 않았습니다.
// zip 은 «저장만(store)» 방식이면 압축 없이도 올바른 파일이라, CRC32 와 머리글만 적으면 됩니다. 결과는 결정적입니다
// (시각을 고정) - 소스가 같으면 zip 바이트도 같아서, 깃에 넣어 두어도 매 빌드 지저분한 변경이 생기지 않습니다.
//
// 압축을 풀면 「GIA구글챗패널/」 폴더 하나가 나옵니다. 크롬은 «폴더»를 불러오므로 폴더째 묶습니다.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = "public/chatpanel/src";
const OUT = "public/chatpanel/gia-chat-panel.zip";
const FOLDER = "GIA구글챗패널/";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
// DOS 시각: 2026-01-01 00:00 고정 (결정적 출력).
const DOS_TIME = u16(0), DOS_DATE = u16(((2026 - 1980) << 9) | (1 << 5) | 1);
const FLAG_UTF8 = 0x0800;

const files = readdirSync(SRC).filter((f) => !f.startsWith(".")).sort();
if (!files.includes("manifest.json")) { console.error("✗ chatpanel: manifest.json 이 없습니다"); process.exit(1); }
const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
for (const key of ["background", "side_panel", "content_scripts", "declarative_net_request"]) {
  if (!manifest[key]) { console.error(`✗ chatpanel: manifest.json 에 ${key} 가 없습니다`); process.exit(1); }
}
for (const f of ["background.js", "bridge.js", "panel.html", "rules.json"]) {
  if (!files.includes(f)) { console.error(`✗ chatpanel: ${f} 가 없습니다`); process.exit(1); }
}

const locals = [], centrals = [];
let offset = 0;
for (const f of files) {
  const data = readFileSync(join(SRC, f));
  const name = Buffer.from(FOLDER + f, "utf8");
  const crc = crc32(data);
  const local = Buffer.concat([u32(0x04034b50), u16(20), u16(FLAG_UTF8), u16(0), DOS_TIME, DOS_DATE, u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
  const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(FLAG_UTF8), u16(0), DOS_TIME, DOS_DATE, u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
  locals.push(local); centrals.push(central); offset += local.length;
}
const cd = Buffer.concat(centrals);
const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
const zip = Buffer.concat([...locals, cd, end]);

mkdirSync("public/chatpanel", { recursive: true });
const prev = existsSync(OUT) ? readFileSync(OUT) : null;
if (!prev || !prev.equals(zip)) writeFileSync(OUT, zip);
// 화면이 버전을 읽도록 같이 적어 둡니다.
writeFileSync("public/chatpanel/version.json", JSON.stringify({ version: manifest.version, files: files.length, bytes: zip.length }) + "\n");
console.log(`✓ chatpanel ${manifest.version}: ${files.length}개 파일 → ${OUT} (${zip.length} bytes${prev && prev.equals(zip) ? ", 변경 없음" : ""})`);
