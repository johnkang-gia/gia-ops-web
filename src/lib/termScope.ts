import { cookies } from "next/headers";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Term } from "@/lib/types";

// 지금 **보고 있는** 학기.
//
// 진행중인 학기(getCurrentTerm)와는 다릅니다. 지난 학기 자료를 열어볼 수 있어야 하는데,
// 그 선택이 화면을 옮겨도 유지되어야 합니다. 그래서 쿠키에 담습니다 - 서버에서 그리는
// 화면들도 같은 값을 읽어야 하기 때문입니다(브라우저 저장소는 서버가 못 읽습니다).
//
// 고른 학기가 없거나 지워졌으면 진행중인 학기로 돌아갑니다. 빈 화면을 보여주는 것보다
// 지금 학기를 보여주는 편이 낫습니다.

export const TERM_COOKIE = "gia_term";

export type TermScope = {
  /** 지금 보고 있는 학기. 학기가 하나도 없으면 null. */
  term: Term | null;
  /** 고르개에 보여줄 목록(최근 학기부터). */
  terms: Term[];
  /** 지난 학기를 열어보고 있는가. 고치면 안 되는 기록이라는 뜻입니다. */
  isPast: boolean;
};

export const getTermScope = cache(async (): Promise<TermScope> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("terms")
    .select("*")
    .order("status")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) console.error("[학기] 목록을 읽지 못했습니다:", error.message);

  const terms = ((data as Term[] | null) ?? []).filter(Boolean);
  if (terms.length === 0) return { term: null, terms: [], isPast: false };

  const running = terms.find((t) => t.status === "진행중") ?? terms[0];
  const picked = (await cookies()).get(TERM_COOKIE)?.value ?? "";
  const term = terms.find((t) => t.id === picked) ?? running;
  return { term, terms, isPast: term.status !== "진행중" };
});

/** 화면에서 학기를 걸 때 쓰는 값. 학기가 없으면 거르지 않습니다(자료가 통째로 사라지는 것보다 낫습니다). */
export async function scopedTermId(): Promise<string | null> {
  return (await getTermScope()).term?.id ?? null;
}

/**
 * 질의에 학기를 겁니다.
 *
 * 학기가 없으면(학기 표가 아직 비었거나 마이그레이션 전) **거르지 않습니다.** 자료가 통째로
 * 사라진 화면을 보여주는 것보다, 학기 구분 없이 다 보여주는 편이 낫습니다.
 *
 * `term_id` 가 비어 있는 옛 줄도 함께 보여줍니다 - 학기를 붙이기 전에 쌓인 기록입니다.
 */
export function termScoped<T extends { or(f: string): T }>(query: T, termId: string | null): T {
  if (!termId) return query;
  return query.or(`term_id.eq.${termId},term_id.is.null`);
}
