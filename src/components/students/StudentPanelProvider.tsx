"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

/**
 * **학생 창을 로그인 영역 전체에 한 번 깝니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 한 아이를 보여주는 창이 넷(프로필 · 회계 창 · 학생 하루판 · 관찰기록 프로필)이고, 학생
 * 이름을 그리는 자리 23곳 중 18곳은 눌러도 아무 데도 안 갔습니다. 하원 체크표에서 이름을
 * 보고 그 아이의 미수금을 보려면 회계로 가서 다시 찾아야 했습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * `<Who>` 가 번호를 들고 있으면 누를 수 있고, 누르면 이 창이 열립니다. 화면은 아무 준비도
 * 하지 않습니다 - 준비할 것이 없으면 빠뜨릴 것도 없습니다(HomonymProvider 와 같은 이유).
 *
 * 창 안의 이름은 다시 눌리지 않습니다(`depth`). 창 속에서 창이 열리는 것을 막습니다.
 */
type Ctx = {
  open: (studentId: string, tab?: PanelTab) => void;
  /** 창 안에서는 이름을 눌러도 창이 또 열리지 않게 합니다. */
  inside: boolean;
};

export type PanelTab = "기본" | "출결·픽업" | "회계" | "기록";

// 공급자 밖(로그인 없는 토큰 화면 등)에서는 누를 수 없습니다 - 열 창이 없습니다.
const PanelCtx = createContext<Ctx>({ open: () => {}, inside: true });

const StudentPanel = dynamic(() => import("./StudentPanel"), { ssr: false });

export function StudentPanelProvider({ children, canSeeFinance }: { children: ReactNode; canSeeFinance: boolean }) {
  const [state, setState] = useState<{ id: string; tab: PanelTab } | null>(null);
  const open = useCallback((id: string, tab: PanelTab = "기본") => setState({ id, tab }), []);
  return (
    <PanelCtx.Provider value={{ open, inside: false }}>
      {children}
      {state && (
        <PanelCtx.Provider value={{ open, inside: true }}>
          <StudentPanel studentId={state.id} initialTab={state.tab} canSeeFinance={canSeeFinance} onClose={() => setState(null)} />
        </PanelCtx.Provider>
      )}
    </PanelCtx.Provider>
  );
}

export function useStudentPanel(): Ctx {
  return useContext(PanelCtx);
}
