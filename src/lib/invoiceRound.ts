import { billingMonthOf } from "@/lib/financePeriod";
import { streamOf } from "@/lib/settlement";

/**
 * **청구 회차** — 「10월 학비(261007_1)」.
 *
 * 회차 번호(`invoices.issue_batch`)는 데이터베이스가 넣을 때 붙입니다(발행일 YYMMDD _ 그날 몇 번째
 * 묶음). 화면은 그 번호를 읽어 말로 바꾸기만 합니다 - 화면마다 번호를 매기게 두면 같은 장이
 * 화면마다 다른 회차로 보입니다.
 *
 * 순수 함수입니다.
 */

export type RoundInvoice = {
  issue_batch?: string | null;
  issue_date?: string | null;
  billing_month?: string | null;
  stream?: string | null;
  category?: string | null;
};

/** 회차 번호. 번호가 아직 없는 장(마이그레이션 전)은 발행일로 대신합니다 - 빈칸보다 낫습니다. */
export function roundCode(inv: RoundInvoice): string {
  const b = (inv.issue_batch ?? "").trim();
  if (b) return b;
  const d = (inv.issue_date ?? "").slice(2, 10).replace(/-/g, "");
  return d ? `${d}` : "";
}

/** 「261007_1」 → 「2026.10.07 1차」. 모양이 다르면 그대로 돌려줍니다. */
export function roundText(code: string): string {
  const m = code.match(/^(\d{2})(\d{2})(\d{2})(?:_(\d+))?$/);
  if (!m) return code;
  return `20${m[1]}.${m[2]}.${m[3]}${m[4] ? ` ${m[4]}차` : ""}`;
}

/** 「10월 학비(261007_1)」. 청구월이 없으면 발행일의 달입니다. */
export function roundLabel(inv: RoundInvoice): string {
  const month = billingMonthOf(inv);
  const m = month ? `${Number(month.slice(5))}월 ` : "";
  const code = roundCode(inv);
  return `${m}${streamOf(inv)}${code ? `(${code})` : ""}`;
}
