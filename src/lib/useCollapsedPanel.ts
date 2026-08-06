"use client";

import { useEffect, useRef, useState } from "react";

// 요청: "좁게 사용하는 사람들이 있기 때문에... 목록이나 AI제안 탭을 접고 펼 수 있게 해주고,
// 개인별로 접은 부분 기억해서 다시 그 페이지로 돌아가도 계속 접혀있도록". 사건기록/회의/AI매뉴얼
// 등 3단 레이아웃 화면들이 공통으로 쓸 수 있는 훅입니다. localStorage에 저장하되, 키에 로그인
// 이메일을 포함시켜 "같은 브라우저를 여러 명이 같이 쓰는 상황"에서도 사람별로 접힘 상태가 섞이지
// 않게 합니다(서버 DB가 아니라 이 브라우저 안에서만 기억됩니다 - 기기를 바꾸면 초기화됩니다).
export function useCollapsedPanel(page: string, panel: string, email: string) {
  const storageKey = `gia-ops-collapsed:${page}:${panel}:${email || "anon"}`;
  const [collapsed, setCollapsed] = useState(false);
  // 첫 렌더는 서버와 동일하게 항상 "펼침"으로 시작해야 hydration 불일치가 안 생기므로, 저장된
  // 값은 마운트 후 이펙트에서 읽어와 반영합니다.
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "1") setCollapsed(true);
      else if (raw === "0") setCollapsed(false);
    } catch {
      // 저장된 값을 못 읽어도 기본값(펼침)으로 계속 진행
    }
    hydratedRef.current = true;
    // storageKey가 바뀌면(예: 로그인 사용자가 바뀌면) 그 사람 기준 값을 다시 읽어옵니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      // 저장 실패는 무시(다음 방문 때 기본값으로 보일 뿐, 기능 자체엔 영향 없음)
    }
  }, [collapsed, storageKey]);

  return [collapsed, setCollapsed] as const;
}
