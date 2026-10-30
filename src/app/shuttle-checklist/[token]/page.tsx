import type { Metadata, Viewport } from "next";
import MobileChecklistClient from "@/components/shuttle/MobileChecklistClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "하원 체크표 (모바일)" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 모바일 하원 체크표 — 로그인 없이 도착체크와 같은 링크 열쇠로 엽니다. 명단과 기록은 클라이언트가
// /api/shuttle/checklist-mobile/[token] 으로 주고받습니다(열쇠 확인은 그 창구가 합니다).
export default async function MobileChecklistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MobileChecklistClient token={token} />;
}
