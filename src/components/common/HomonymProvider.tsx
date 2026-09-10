"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * **동명이인 뱃지를 자료에서 나오게 합니다** — 화면마다 붙이지 않습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 「같은 이름이 여럿이면 반을 함께 적는다」는 규칙은 이미 있었습니다(`studentLabel`).
 * 그런데 그 규칙을 쓰려면 화면이 **명부를 따로 읽어서 표를 만들어 넘겨야** 했습니다.
 * 학생 이름을 그리는 자리가 36개 파일에 흩어져 있고, 새 화면을 만들 때마다 그 준비를
 * 다시 해야 하니 **대부분의 화면이 그냥 이름만 그렸습니다.**
 *
 * 그래서 김재이가 어떤 화면에서는 「김재이(G2C)」로 뜨고 어떤 화면에서는 그냥 「김재이」로
 * 떴습니다. 보는 사람은 뒤쪽 화면에서 **이미 정해진 이름이라고 믿습니다** - 셋 중 누구인지
 * 물어볼 생각조차 안 하게 됩니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 겹치는 이름 목록을 **로그인 영역 전체에 한 번** 깔아 둡니다. 화면은 아무 준비 없이
 * `<Who id={…} name={…} />` 만 쓰면 됩니다. 준비할 것이 없으면 빠뜨릴 것도 없습니다.
 *
 * 명부 전체가 아니라 **겹치는 이름과 그 아이들의 반만** 담습니다. 137명 전부를 모든 화면에
 * 딸려 보내면 첫 화면이 느려지는데, 실제로 필요한 것은 겹치는 몇 이름뿐입니다.
 */

export type HomonymEntry = {
  /** 학생 번호 → 학년·반. **번호로 찾습니다** - 이름으로 찾으면 셋이 한 칸을 나눠 씁니다. */
  byId: Record<string, string>;
  /** 겹치는 이름(공백 뗀 꼴). 이 이름일 때만 뱃지를 붙입니다. */
  names: string[];
};

const EMPTY: HomonymEntry = { byId: {}, names: [] };

const Ctx = createContext<HomonymEntry>(EMPTY);

export function HomonymProvider({ value, children }: { value: HomonymEntry; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHomonyms(): HomonymEntry {
  return useContext(Ctx);
}

/** 이름 앞뒤·가운데 공백을 뗍니다. 「김 재이」와 「김재이」는 같은 사람으로 적혀 옵니다. */
export function normName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, "").trim();
}

/** 「김재이(G2A)」처럼 괄호로 반이 적혀 온 이름에서 괄호를 뗍니다. */
function bare(raw: string): string {
  const m = raw.match(/^([^（(]*)[（(]/);
  return (m ? m[1] : raw).trim();
}

/**
 * **학생 이름 한 칸.** 겹치는 이름이면 옆에 반 뱃지가 붙습니다.
 *
 * 겹치지 않는 이름에는 아무것도 안 붙습니다 - 137명 전부에 반을 붙이면 화면이 글자로 차고,
 * 정작 구분이 필요한 이름이 묻힙니다.
 *
 * 번호가 없으면 「누구?」라고 적습니다. 겹치는 이름인데 누구인지 안 정해진 상태이고,
 * **엉뚱한 반을 적는 것보다 모른다고 적는 편이 낫습니다.**
 */
export function Who({
  id,
  name,
  className = "",
  badgeClassName = "",
}: {
  id?: string | null;
  name?: string | null;
  className?: string;
  badgeClassName?: string;
}) {
  const { byId, names } = useHomonyms();
  const raw = String(name ?? "").trim();
  if (!raw) return null;

  const shown = bare(raw);
  if (!names.includes(normName(shown))) return <span className={className}>{raw}</span>;

  const where = id ? byId[id] : undefined;
  return (
    <span className={"inline-flex items-baseline gap-1 " + className}>
      <span>{shown}</span>
      <span
        className={
          "shrink-0 rounded px-1 text-[9px] font-bold leading-[1.5] " +
          (where ? "bg-slate-200 text-slate-600 " : "bg-red-100 text-red-600 ") +
          badgeClassName
        }
        title={
          where
            ? `같은 이름이 여러 명이라 ${where}을 함께 적습니다`
            : "같은 이름이 여러 명인데 누구인지 정해지지 않았습니다. 학생을 연결해주세요."
        }
      >
        {where ?? "누구?"}
      </span>
    </span>
  );
}
