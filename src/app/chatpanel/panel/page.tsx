import type { Metadata } from "next";
import ChatPanelShell from "@/components/common/ChatPanelShell";

export const metadata: Metadata = { title: "GIA 구글챗 패널", robots: { index: false } };

/**
 * 구글챗 패널 확장이 크롬 사이드패널 안에 끼워 넣는 화면입니다. 로그인 없이 열립니다(middleware isAuthRoute) -
 * 도구 줄과 chat.google.com iframe 뿐이라 자료가 없습니다. 확장은 머리글(X-Frame-Options)을 벗겨 주고, 화면은
 * 여기서 그리므로 **화면을 고쳐도 확장을 다시 깔지 않습니다.**
 */
export default function ChatPanelPage() {
  return <ChatPanelShell />;
}
