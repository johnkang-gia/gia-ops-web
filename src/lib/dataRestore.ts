import type { SupabaseClient } from "@supabase/supabase-js";
import { BACKUP_TABLES } from "./backupTables";

/**
 * **내려받은 파일로 되돌리기.**
 *
 * ── 되돌리기가 백업보다 어려운 이유 ──────────────────────────────────
 *
 * 백업은 읽기만 하니 잘못돼도 파일 하나가 이상해질 뿐입니다. 되돌리기는 **지금 살아 있는
 * 자료를 덮어씁니다.** 잘못 누르면 사고를 수습하려다 더 큰 사고를 냅니다.
 *
 * 그래서 이 파일은 세 가지를 지킵니다.
 *
 *   ① **미리 봅니다.** 무엇이 몇 줄 바뀌는지 먼저 세어 보여주고, 사람이 보고 나서 누릅니다.
 *   ② **되돌리기 직전에 지금 상태를 한 벌 남깁니다.** 되돌린 것을 다시 되돌릴 수 있어야
 *      사람이 누를 수 있습니다.
 *   ③ **기본은 덮어쓰기(upsert)입니다 — 지우지 않습니다.** 파일에 있는 줄만 되돌리고,
 *      그 뒤에 새로 생긴 줄은 그대로 둡니다. 「파일과 똑같이 맞추기」는 지우는 일이라
 *      따로 켜야 하고, 무엇이 지워지는지 숫자로 먼저 보여줍니다.
 *
 * ── 순서 ─────────────────────────────────────────────────────────────
 *
 * 표에는 딸린 관계가 있습니다. 청구서 내역은 청구서가 있어야 들어가고, 학생에 딸린 것들은
 * 학생이 있어야 들어갑니다. 순서를 안 지키면 **절반만 들어간 채 실패합니다** - 그게 가장
 * 나쁜 상태입니다. 원래 상태도 아니고 되돌린 상태도 아니니까요.
 */

/**
 * 넣는 순서. **부모가 먼저입니다.**
 *
 * 여기 없는 표는 이 목록 뒤에 원래 순서대로 붙습니다 - 새 표를 만들고 여기 안 적어도
 * 되돌리기가 멈추지는 않되, 딸린 표라면 여기 적어야 합니다.
 */
const PARENT_FIRST = [
  // 학교의 뼈대
  "terms",
  "departments",
  "app_users",
  "wr_classes",
  "wr_students",
  "wr_subjects",
  "wr_periods",
  // 학생에 딸린 것
  "wr_enrollments",
  "wr_term_class_snapshots",
  "student_groups",
  "student_group_members",
  "student_apparel_sizes",
  "student_dismissal_plans",
  // 요금 → 학생별 요금 → 청구서 → 내역·수납
  "fee_categories",
  "fee_plans",
  "fee_terms",
  "fee_items",
  "fee_discounts",
  "fee_payment_options",
  "student_fee_enrollments",
  "student_fee_items",
  "student_fee_discounts",
  "invoices",
  "invoice_lines",
  "payments",
  "cash_receipts",
  // 셔틀
  "shuttle_routes",
  "shuttle_stops",
  "shuttle_assignments",
  "shuttle_boardings",
  // 업무 → 코멘트·첨부
  "tasks",
  "task_comments",
  "task_attachments",
  // 학사 규칙 → 항목 → 회의
  "academic_checklist_templates",
  "academic_checklist_items",
  "academic_checklist_meetings",
];

/** 파일에 담긴 표를 **넣어도 되는 순서**로 줄 세웁니다. */
export function restoreOrder(tables: string[]): string[] {
  const has = new Set(tables);
  const first = PARENT_FIRST.filter((t) => has.has(t));
  const rest = BACKUP_TABLES.filter((t) => has.has(t) && !first.includes(t));
  const unknown = tables.filter((t) => !first.includes(t) && !rest.includes(t));
  return [...first, ...rest, ...unknown];
}

export type BackupFile = {
  version: number;
  exportedAt: string;
  appVersion?: string;
  counts?: Record<string, number>;
  errors?: Record<string, string>;
  data: Record<string, unknown[]>;
};

/**
 * 파일이 우리 백업이 맞는지 봅니다.
 *
 * 아무 JSON이나 받아 넣기 시작하면, 알아채는 시점은 이미 절반이 들어간 뒤입니다.
 */
export function validateBackupFile(raw: unknown): { file: BackupFile | null; error: string | null } {
  if (!raw || typeof raw !== "object") return { file: null, error: "JSON 파일이 아닙니다." };
  const f = raw as Partial<BackupFile>;
  if (f.version !== 1) return { file: null, error: "이 앱이 만든 백업 파일이 아닙니다(version 이 1이 아닙니다)." };
  if (!f.data || typeof f.data !== "object") return { file: null, error: "백업 안에 자료(data)가 없습니다." };
  if (!f.exportedAt) return { file: null, error: "언제 만든 백업인지 적혀 있지 않습니다." };

  const tables = Object.keys(f.data);
  if (tables.length === 0) return { file: null, error: "백업이 비어 있습니다." };
  for (const t of tables) {
    if (!Array.isArray((f.data as Record<string, unknown>)[t])) {
      return { file: null, error: `「${t}」의 내용이 목록이 아닙니다. 파일이 깨진 것 같습니다.` };
    }
  }
  return { file: f as BackupFile, error: null };
}

export type TablePlan = {
  table: string;
  /** 파일에 들어 있는 줄 수. */
  inFile: number;
  /** 지금 표에 있는 줄 수. */
  inDb: number;
  /** 지금 표에 없어서 **새로 들어갈** 줄. */
  toAdd: number;
  /** 지금 표에도 있어서 **덮어쓸** 줄. */
  toOverwrite: number;
  /** 파일에 없어서 남는 줄. 「파일과 똑같이 맞추기」를 켜면 이만큼 지워집니다. */
  onlyInDb: number;
  /** id 칸이 없어 되돌릴 수 없는 표. */
  skip: string | null;
};

/**
 * **무엇이 얼마나 바뀌는지** 먼저 셉니다. 저장은 하지 않습니다.
 *
 * 숫자를 보여주지 않고 「복원」만 있는 화면은 아무도 못 누릅니다. 눌러도 되는지 판단할
 * 재료가 없으니까요. 그래서 되돌리기 전에 이 계획을 먼저 보여줍니다.
 */
export async function planRestore(
  supabase: SupabaseClient,
  file: BackupFile,
  tables: string[],
): Promise<TablePlan[]> {
  const out: TablePlan[] = [];

  for (const table of restoreOrder(tables)) {
    const rows = (file.data[table] ?? []) as Record<string, unknown>[];
    const fileIds = new Set(rows.map((r) => String(r?.id ?? "")).filter(Boolean));

    if (rows.length > 0 && fileIds.size === 0) {
      // id 가 없으면 「이 줄이 그 줄인가」를 알 수 없어 덮어쓸 수도, 셀 수도 없습니다.
      out.push({ table, inFile: rows.length, inDb: 0, toAdd: 0, toOverwrite: 0, onlyInDb: 0, skip: "id 칸이 없어 되돌릴 수 없습니다" });
      continue;
    }

    const { data, error } = await supabase.from(table).select("id");
    if (error) {
      out.push({ table, inFile: rows.length, inDb: 0, toAdd: 0, toOverwrite: 0, onlyInDb: 0, skip: `지금 상태를 못 읽었습니다: ${error.message}` });
      continue;
    }
    const dbIds = new Set(((data as { id: string }[] | null) ?? []).map((r) => String(r.id)));

    let overwrite = 0;
    for (const id of fileIds) if (dbIds.has(id)) overwrite += 1;
    let onlyInDb = 0;
    for (const id of dbIds) if (!fileIds.has(id)) onlyInDb += 1;

    out.push({
      table,
      inFile: rows.length,
      inDb: dbIds.size,
      toAdd: fileIds.size - overwrite,
      toOverwrite: overwrite,
      onlyInDb,
      skip: null,
    });
  }

  return out;
}

export type RestoreOutcome = {
  table: string;
  written: number;
  deleted: number;
  error: string | null;
};

/** 한 번에 넣는 줄 수. 너무 크면 요청이 거부되고, 너무 작으면 왕복이 늘어납니다. */
const CHUNK = 500;

/**
 * 실제로 되돌립니다.
 *
 * `wipeMissing` 은 **파일에 없는 줄을 지웁니다.** 기본은 꺼져 있습니다 - 되돌리기를 하는
 * 사람은 이미 사고를 수습하는 중이라, 그 자리에서 또 지우는 선택을 기본값으로 두면 안 됩니다.
 *
 * 표 하나가 실패해도 나머지는 계속합니다. 멈추면 절반만 들어간 채로 끝나는데, 그건 원래
 * 상태도 되돌린 상태도 아닙니다. 대신 **실패한 표를 전부 모아** 사람에게 돌려줍니다.
 */
export async function applyRestore(
  supabase: SupabaseClient,
  file: BackupFile,
  tables: string[],
  opts: { wipeMissing?: boolean } = {},
): Promise<RestoreOutcome[]> {
  const out: RestoreOutcome[] = [];

  for (const table of restoreOrder(tables)) {
    const rows = (file.data[table] ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      out.push({ table, written: 0, deleted: 0, error: null });
      continue;
    }
    if (!rows.every((r) => r && typeof r === "object" && r.id != null)) {
      out.push({ table, written: 0, deleted: 0, error: "id 없는 줄이 있어 건너뛰었습니다" });
      continue;
    }

    let written = 0;
    let failed: string | null = null;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: "id" });
      if (error) {
        failed = error.message;
        break;
      }
      written += chunk.length;
    }

    let deleted = 0;
    if (!failed && opts.wipeMissing) {
      // 파일에 없는 줄 지우기. **되돌리기가 성공한 표에서만** 합니다 - 넣기가 실패했는데
      // 지우기만 성공하면 자료가 통째로 사라집니다.
      const keep = rows.map((r) => String(r.id));
      const { data: extra, error: readErr } = await supabase.from(table).select("id");
      if (readErr) {
        failed = `남은 줄을 못 읽어 지우지 않았습니다: ${readErr.message}`;
      } else {
        const ids = ((extra as { id: string }[] | null) ?? []).map((r) => String(r.id)).filter((id) => !keep.includes(id));
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { error: delErr } = await supabase.from(table).delete().in("id", ids.slice(i, i + CHUNK));
          if (delErr) {
            failed = `지우지 못했습니다: ${delErr.message}`;
            break;
          }
          deleted += Math.min(CHUNK, ids.length - i);
        }
      }
    }

    out.push({ table, written, deleted, error: failed });
  }

  return out;
}
