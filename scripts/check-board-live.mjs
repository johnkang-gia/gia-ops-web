// 오늘 학생 보드가 **읽는 표**와 **듣는 표**는 같아야 합니다.
//
// ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
//
// 보드는 픽업·결석·특이사항을 여러 표에서 모읍니다. 그런데 화면은 60초 폴링만 했습니다.
// 인박스에서 픽업으로 확정해도 최대 1분 동안 보드에는 없었고, 보드만 보는 사람은 그
// 아이를 모릅니다. 픽업은 놓치면 되돌릴 수 없습니다.
//
// 실시간 구독을 붙이고 나면 다음 실패는 **목록이 어긋나는 것**입니다. 새 갈래를 추가하며
// `studentDayLoad.ts` 에 표를 하나 더 읽게 해놓고 구독 목록에 안 넣으면, 그 화면에서 건
// 픽업만 보드에 안 뜹니다 - 오류가 아니라 「그 아이는 오늘 아무 일 없음」으로 보입니다.
//
// ── 무엇을 보나 ─────────────────────────────────────────────────────────────
//
// `studentDayLoad.ts` 가 `.from("…")` 로 읽는 표 중, 보드에 **줄을 만드는** 표가
// `StudentDayBoard.tsx` 의 `BOARD_LIVE_TABLES` 에 들어 있는지 봅니다. 명부처럼 줄을 만들지
// 않는 표는 `NOT_LIVE` 에 이유와 함께 적습니다.

import { readFileSync } from "node:fs";

/**
 * 보드가 자료를 읽는 자리 전부. `studentDayLoad.ts` 는 갈래를 이 덩어리들에 맡기므로,
 * 거기까지 따라가야 「무슨 표를 읽는가」가 다 보입니다 - 한 겹만 보면 픽업·출결·하원수단이
 * 통째로 빠집니다.
 */
const LOAD_FILES = [
  "src/lib/studentDayLoad.ts",
  "src/lib/pickups.ts",
  "src/lib/attendanceEntries.ts",
  "src/lib/dismissalToday.ts",
];
const BOARD = "src/components/work/StudentDayBoard.tsx";

/** 읽기는 하지만 **보드에 줄을 만들지 않는** 표. 바뀌어도 보드 내용은 안 바뀝니다. */
const NOT_LIVE = {
  wr_students: "명부. 이름·반을 붙이는 데만 씁니다 - 바뀌어도 오늘 할 일이 늘지 않습니다.",
  toddle_channel_students: "이어 둔 방의 아이. 학기 초에 한 번 정하고 하루 중에는 안 바뀝니다.",
  tasks: "업무. 마감이 오늘인 것만 얹는데, 업무는 업무보드 제 칸이 따로 실시간입니다.",
  task_students: "업무↔학생 이음. 위와 같습니다.",
  shuttle_assignments: "배정. 체크표 줄에서 이름을 꺼내는 데만 씁니다 - 오늘 할 일을 만들지 않습니다.",
  attendance_records: "출석부. 등록된 결석은 attendance_entries 로 들어옵니다.",
};

const load = LOAD_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
const board = readFileSync(BOARD, "utf8");

const read = new Set([...load.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]));
const liveBlock = board.match(/BOARD_LIVE_TABLES\s*=\s*\[([\s\S]*?)\]/);
if (!liveBlock) {
  console.error("\n✗ StudentDayBoard.tsx 에서 BOARD_LIVE_TABLES 를 못 찾았습니다.\n");
  process.exit(1);
}
const live = new Set([...liveBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const missing = [...read].filter((t) => !live.has(t) && !(t in NOT_LIVE));
const extra = [...live].filter((t) => !read.has(t));

if (missing.length > 0 || extra.length > 0) {
  console.error("\n✗ 오늘 학생 보드의 「읽는 표」와 「듣는 표」가 어긋납니다.\n");
  for (const t of missing) console.error(`   읽는데 안 들음 — ${t}`);
  for (const t of extra) console.error(`   듣는데 안 읽음 — ${t}`);
  console.error(
    "\n  안 들으면 그 화면에서 건 픽업이 보드에 안 뜨는데, 그건 오류가 아니라" +
      "\n  「그 아이는 오늘 아무 일 없음」으로 보입니다. 픽업은 놓치면 되돌릴 수 없습니다." +
      "\n\n  고치는 법 — StudentDayBoard.tsx 의 BOARD_LIVE_TABLES 에 넣거나," +
      "\n  줄을 만들지 않는 표라면 scripts/check-board-live.mjs 의 NOT_LIVE 에 이유를 적습니다.\n",
  );
  process.exit(1);
}

console.log(`✓ 오늘 학생 실시간 검사 통과 (표 ${live.size}개 — 어느 화면에서 걸어도 보드에 바로 뜹니다)`);
