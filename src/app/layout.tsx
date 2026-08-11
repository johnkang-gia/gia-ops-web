import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

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
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
