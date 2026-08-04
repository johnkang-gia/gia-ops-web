import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GIA 운영",
  description: "GIA 학교 운영 자동화 시스템",
  // 홈 화면에 추가했을 때 브라우저 주소창 없이 앱처럼 열리도록(standalone) 하는 최소 PWA
  // 설정입니다. 오프라인 캐싱(서비스워커)까지는 아직 없고, "설치 가능한 아이콘/이름" 수준입니다.
  manifest: "/manifest.json",
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
