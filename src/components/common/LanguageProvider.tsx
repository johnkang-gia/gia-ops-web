"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, htmlLang, makeT, type Lang, type T } from "@/lib/lang";

// 클라이언트 컴포넌트에서 언어를 읽고 바꾸는 통로입니다.
//
//   const t = useT();
//   <button>{t("저장", "Save")}</button>
//
// 초기값은 서버가 쿠키에서 읽어 prop으로 내려줍니다. 그래야 서버가 그린 HTML과 브라우저의 첫
// 렌더가 같은 언어라서 hydration 경고나 깜빡임이 없습니다.

type LangContextValue = {
  lang: Lang;
  setLang: (next: Lang) => void;
};

const LangContext = createContext<LangContextValue>({ lang: "ko", setLang: () => {} });

export function LanguageProvider({ initialLang, children }: { initialLang: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const router = useRouter();

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      // 쿠키를 직접 씁니다. 서버 액션이나 API를 거치지 않는 이유는, 언어 전환은 화면 반응이
      // 즉각적이어야 하고 실패해도 위험이 없는 취향 설정이기 때문입니다.
      // SameSite=Lax - 외부 사이트에서 넘어올 때도 유지되되 CSRF 위험은 없는 기본값입니다.
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
      // 서버 컴포넌트(페이지 제목, 서버에서 만든 안내문 등)까지 새 언어로 다시 그리도록
      // 새로고침합니다. 전체 페이지를 다시 받아오는 게 아니라 서버 컴포넌트만 갱신되므로
      // 입력 중이던 값이나 스크롤 위치는 그대로 유지됩니다.
      router.refresh();
    },
    [router]
  );

  // <html lang="...">을 지금 언어에 맞춰 둡니다. 루트 레이아웃에서 서버가 정하게 하면 앱 전체가
  // 쿠키를 읽게 되어 정적 렌더링이 풀리므로(로그인 없는 안내보드까지 매번 서버를 타게 됩니다),
  // 값이 틀렸을 때의 영향이 작은 이 속성만 브라우저에서 맞춥니다. 영어 화면에 lang="ko"가
  // 남아 있으면 크롬이 "번역하시겠습니까?"를 계속 띄우고 스크린리더가 한국어로 읽습니다.
  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

export function useT(): T {
  const { lang } = useContext(LangContext);
  return useMemo(() => makeT(lang), [lang]);
}
