"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 브라우저(클라이언트 컴포넌트)에서 쓰는 Supabase 클라이언트.
 * 목록 실시간 구독(Realtime), 폼 제출 등 클라이언트 쪽 동작에 사용합니다.
 *
 * 화면 곳곳(버튼 클릭 핸들러, useEffect 등)에서 createClient()를 그때그때 호출하는데, 매번
 * createBrowserClient()로 새 인스턴스를 만들면 그때마다 세션을 다시 읽고 내부 잠금(navigator
 * locks)을 새로 잡는 과정이 생겨 클릭 반응이 느려집니다. 브라우저에서는 인스턴스를 하나만
 * 만들어 재사용(싱글턴)하도록 캐싱합니다.
 */
let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browserClient;
}
