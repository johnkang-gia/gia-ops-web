import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import Script from "next/script";
import { Suspense } from "react";
import { SITE_CHECK_COLLECTOR } from "@/lib/siteCheck";

export const metadata: Metadata = {
  title: "GIA 운영",
  description: "GIA 학교 운영 자동화 시스템",
  // manifest는 여기(전체 앱 루트)가 아니라 (dashboard)/layout.tsx에서만 붙입니다. iOS
  // Safari는 16.4부터 "홈 화면에 추가"할 때 manifest.json의 start_url을 따라가는데, 이 파일이
  // 루트에 있으면 안내보드·도착체크·파일럿 체크인 같은 로그인 없는 토큰 링크(/shuttle-board,
  // /shuttle-arrival, /shuttle-pilot 등)를 홈 화면에 추가해도 그 링크가 아니라 앱 메인
  // (start_url="/home")으로 등록돼버립니다(요청: "이 링크 그대로는 아이콘 등록이 안돼"). 로그인
  // 사용자가 쓰는 (dashboard) 영역에만 manifest를 둬서, 토큰 링크는 지금 보고 있는 그 주소
  // 그대로 홈 화면에 등록됩니다.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gia-bg text-slate-900">
        {/* 개발자 사이트 점검이 숨은 틀로 열 때만 켜지는 기록기(오류·멈춤). 사람이 여는 화면에서는
            첫 줄에서 바로 끝나 아무 일도 하지 않습니다. 화면이 그려지기 전에 붙어야 첫 오류까지 잡으므로
            beforeInteractive 입니다. <head> 에 손으로 <script> 를 넣지 않습니다 - 하이드레이션이 어긋납니다. */}
        <Script id="gia-site-check-collector" strategy="beforeInteractive">
          {SITE_CHECK_COLLECTOR}
        </Script>
        {children}
        {/* 바깥 도구도 경계 안에 둡니다. 어긋나면 이것만 다시 그리고 화면 전체는 그대로입니다. */}
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
        <Suspense fallback={null}>
          <SpeedInsights />
        </Suspense>
      </body>
    </html>
  );
}
