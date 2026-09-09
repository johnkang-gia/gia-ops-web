import type { SupabaseClient } from "@supabase/supabase-js";
import { BACKUP_GROUPS, BACKUP_TABLES, BACKUP_PAGE } from "./backupTables";

/**
 * **표를 통째로 읽어 한 덩어리로 만듭니다.** 내려받기와 매일 자동 저장이 같은 함수를 씁니다.
 *
 * 두 곳에서 각자 읽으면 반드시 어긋납니다 - 내려받은 파일에는 있는데 자동 백업에는 없는
 * 표가 생기고, 그 사실은 복구해야 하는 날에야 드러납니다.
 *
 * ── 조용히 실패하지 않습니다 ─────────────────────────────────────────
 *
 * 표 하나를 못 읽었을 때 그 표만 빼고 파일을 만들면, **겉보기에 멀쩡한 백업**이 나옵니다.
 * 열어보기 전에는 무엇이 빠졌는지 알 수 없고, 열어보는 날은 이미 사고가 난 날입니다.
 * 그래서 못 읽은 표는 파일 안에 `errors` 로 남기고, 부르는 쪽이 사람에게 알립니다.
 */

export type ExportResult = {
  /** 파일에 담긴 내용. */
  payload: {
    version: 1;
    exportedAt: string;
    appVersion: string;
    groups: { group: string; tables: string[] }[];
    counts: Record<string, number>;
    /** 못 읽은 표와 그 이유. **비어 있어야 온전한 백업입니다.** */
    errors: Record<string, string>;
    data: Record<string, unknown[]>;
  };
  rows: number;
  failed: string[];
};

/**
 * 한 표를 끝까지 읽습니다. Supabase 는 한 번에 1000줄까지만 주므로 페이지를 넘겨가며 받습니다.
 *
 * 페이지를 안 넘기면 1000줄에서 **조용히 잘립니다.** 학생 137명은 한 번에 들어오지만
 * 출결 기록은 한 학기만 지나도 만 줄이 넘습니다 - 그 백업은 3분의 1만 담고도 정상으로 보입니다.
 */
async function readAll(supabase: SupabaseClient, table: string): Promise<{ rows: unknown[]; error: string | null }> {
  const out: unknown[] = [];
  for (let from = 0; ; from += BACKUP_PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + BACKUP_PAGE - 1);
    if (error) return { rows: out, error: error.message };
    const page = (data as unknown[] | null) ?? [];
    out.push(...page);
    if (page.length < BACKUP_PAGE) break;
    // 터무니없이 큰 표에서 영원히 돌지 않도록. 여기 걸리면 그 표는 백업 대상이 아니라
    // 보관주기를 걸 대상입니다.
    if (out.length > 500_000) return { rows: out, error: "50만 줄이 넘습니다 - 보관주기를 확인해주세요." };
  }
  return { rows: out, error: null };
}

export async function buildExport(supabase: SupabaseClient, appVersion: string): Promise<ExportResult> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const table of BACKUP_TABLES) {
    const { rows, error } = await readAll(supabase, table);
    if (error) {
      errors[table] = error;
      continue;
    }
    data[table] = rows;
    counts[table] = rows.length;
  }

  return {
    payload: {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion,
      groups: BACKUP_GROUPS,
      counts,
      errors,
      data,
    },
    rows: Object.values(counts).reduce((n, v) => n + v, 0),
    failed: Object.keys(errors),
  };
}

/** 파일 이름에 쓸 한국 날짜·시각. `2026-09-09_1430` */
export function stampKst(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())}_${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`;
}
