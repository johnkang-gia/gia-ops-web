import ConsultMeClient from "@/components/consult/ConsultMeClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "상담 순서 확인" };

/** 학부모 개인 확인 링크(QR) — 로그인 없이 «내 순서까지 몇 명». 그 예약 하나만 봅니다. */
export default async function ConsultMePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConsultMeClient token={token} />;
}
