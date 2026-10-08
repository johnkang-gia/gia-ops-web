import ConsultRoomTabletClient from "@/components/consult/ConsultRoomTabletClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "상담실" };

/**
 * 상담실 태블릿·QR 화면 — 로그인 없이 엽니다. 자료와 단추는 `/api/consult/room/[token]` 이
 * 그 방 하나에 대해서만 처리합니다.
 */
export default async function ConsultRoomPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConsultRoomTabletClient token={token} />;
}
