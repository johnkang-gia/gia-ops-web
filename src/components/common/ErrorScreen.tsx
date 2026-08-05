"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { logApiError } from "@/lib/logging";

// UX 점검에서 나온 지적 보완: 지금까지 앱 전체에 error.tsx가 하나도 없어서, 서버 컴포넌트
// 쪽에서 예외가 나면 Next.js 기본(영문) 크래시 화면이 그대로 뜨고 있었습니다. app/error.tsx와
// (dashboard)/error.tsx 둘 다 이 화면을 그대로 씁니다 - 무슨 화면에서 오류가 났든 "무슨 일이
// 있었는지"보다 "무엇을 하면 되는지"를 먼저 보여주는 게 목적이라, 다시 시도/새로고침 버튼을
// 앞에 두고 기술적인 오류 메시지는 접어서 보여줍니다.
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 크래시 방지 개선(요청: "크러시 방지... 방법들을 제안해줘"): 지금까지는 화면이 깨져도 사용자가
  // 직접 문의및건의사항에 신고해야만 개발자가 알 수 있었습니다. 이 화면이 뜨는 순간 자동으로
  // error_logs에 남겨서, 개발자 대시보드(/dev)의 최근 오류 목록에 신고 없이도 잡히도록 했습니다.
  // 로깅 자체가 실패해도 화면 표시에는 영향이 없고(logApiError가 내부에서 에러를 삼킴), 같은
  // 오류로 리렌더될 때 중복 기록되지 않도록 digest+message 기준으로 한 번만 보냅니다.
  const loggedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = (error.digest ?? "") + "|" + error.message;
    if (loggedKeyRef.current === key) return;
    loggedKeyRef.current = key;
    const supabase = createClient();
    void logApiError(supabase, typeof window !== "undefined" ? window.location.pathname : "unknown", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-3xl">⚠️</div>
      <h1 className="text-base font-bold text-slate-800">화면을 불러오는 중 문제가 생겼습니다</h1>
      <p className="max-w-sm text-sm text-slate-500">
        일시적인 오류일 수 있습니다. 아래 버튼으로 다시 시도해보시고, 계속되면 새로고침하거나
        문의및건의사항으로 알려주세요.
      </p>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2"
        >
          다시 시도
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          새로고침
        </button>
      </div>
      {error?.message && (
        <details className="mt-2 max-w-md text-left text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none">기술적인 오류 내용</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">
            {error.message}
            {error.digest ? `\n(오류 코드: ${error.digest})` : ""}
          </pre>
        </details>
      )}
    </div>
  );
}
