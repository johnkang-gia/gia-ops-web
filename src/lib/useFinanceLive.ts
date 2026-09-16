"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * **돈에 관한 자료가 바뀌면 열려 있는 재무 화면이 함께 바뀝니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 재무는 화면이 여덟 개이고(개요·월별·학비·학비외·미납금·수납·선입금·현금영수증), 한 사람이
 * 고치면 여러 사람이 봅니다. 그런데 고친 사람 화면만 바뀌었습니다.
 *
 * 옆자리에서 열어둔 화면은 **옛 숫자를 그대로 보여줍니다.** 그건 오류로 안 보입니다 - 그냥
 * 다른 금액입니다. 그 숫자로 학부모에게 안내하거나 청구를 돌리면, 어느 쪽이 맞는지는 돈이
 * 두 번 청구된 뒤에야 드러납니다.
 *
 * ── 어떻게 하나 ─────────────────────────────────────────────────────────────
 *
 * 돈에 닿는 표가 바뀌면 **서버가 그 화면을 다시 그립니다**(`router.refresh()`). 화면이 자기
 * 상태를 손으로 고치지 않습니다 - 화면마다 「무엇이 바뀌었으니 무엇을 고친다」를 적으면 그
 * 규칙이 여덟 벌 생기고, 한 벌이 틀리면 그 화면만 다른 답을 합니다.
 *
 * 서버가 다시 읽으면 계산도 서버에서 한 번만 일어납니다(`settlement.ts`). 지금 참인 값이
 * 곧 화면에 뜹니다.
 *
 * ── 걸러내지 않습니다 ───────────────────────────────────────────────────────
 *
 * 구독에 조건을 걸지 않습니다. 화면에 아직 없는 청구서가 새로 생기거나, 보고 있던 줄이
 * 지워지는 것은 조건에 안 걸려 통째로 놓칩니다 - 셔틀에서 같은 실수를 한 적이 있습니다
 * (CLAUDE.md 2-11).
 *
 * ── 한꺼번에 오는 것은 모읍니다 ─────────────────────────────────────────────
 *
 * 청구서를 한 번 만들면 invoices 1줄 + invoice_lines 여러 줄 + payments 1줄이 잇따라
 * 옵니다. 그때마다 다시 그리면 화면이 여러 번 깜빡이고 서버도 여러 번 읽습니다.
 */

/** 돈에 닿는 표. 하나라도 바뀌면 재무 화면은 다시 읽어야 합니다. */
export const FINANCE_TABLES = [
  "invoices",
  "invoice_lines",
  "payments",
  "cash_receipts",
  // 항목·할인은 「얼마를 청구할 것인가」를 정합니다. 여기가 바뀌면 아직 발행 안 한 금액이
  // 전부 달라집니다.
  "fee_items",
  "student_fee_items",
  "fee_plans",
  // 납부 옵션(회차·할인율)이 바뀌면 아직 발행 안 한 학비가 전부 달라집니다.
  "fee_payment_options",
  "fee_discounts",
  "student_fee_discounts",
  "student_fee_enrollments",
] as const;

/**
 * 재무 화면에 답니다. **서버 컴포넌트로 그린 화면에도 붙습니다** - 이 훅은 자기 상태를
 * 갖지 않고 서버에 다시 그리라고만 말하기 때문입니다.
 *
 * @param extra 그 화면에만 필요한 표(예: 학생 명부). 비워도 됩니다.
 */
export function useFinanceLive(extra: readonly string[] = []) {
  const router = useRouter();
  // 목록을 문자열로 굳혀 비교합니다. 배열을 그대로 의존성에 넣으면 부모가 다시 그릴 때마다
  // 새 배열이 되어 구독이 매번 끊겼다 붙습니다.
  const extraKey = extra.join(",");

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      // 300ms 는 사람이 못 느끼는 시간이고, 청구서 한 장이 만드는 줄들은 그 안에 다 옵니다.
      timer = setTimeout(() => router.refresh(), 300);
    };

    const channel = supabase.channel(`finance-live-${extraKey}`);
    for (const table of [...FINANCE_TABLES, ...(extraKey ? extraKey.split(",") : [])]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [router, extraKey]);
}
