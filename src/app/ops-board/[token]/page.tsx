import OpsBoardClient from "@/components/opsBoard/OpsBoardClient";
import { GET as boardGet } from "@/app/api/ops-board/[token]/route";
import type { BoardData } from "@/components/opsBoard/boardShared";

export const dynamic = "force-dynamic";

// 사무실 대형 모니터용 통합 운영 대시보드 - 로그인 없이 토큰 링크 하나로 띄워둡니다(요청:
// "큰 모니터에 띄워서 전체가 한눈에 보고 파악할 수 있는 통합 대시보드", 접속은 "로그인 없는
// 전용 링크"). 화면 절반은 CCTV, 나머지 절반에 이 페이지를 띄우는 구성을 전제로 합니다.
export default async function OpsBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  /**
   * **첫 화면을 서버에서 다 그려 보냅니다.**
   *
   * 전자칠판(CVT) 내장 브라우저는 앱의 자바스크립트를 못 돌리거나 아주 느립니다. 예전에는
   * 자바스크립트가 떠야 비로소 자료를 받아 그렸으므로 그 기기에서는 「불러오는 중」만 남았습니다.
   * 이제 서버가 같은 API 를 직접 불러 자료를 HTML 에 담아 보냅니다 - 자바스크립트가 아예 안
   * 돌아도 그 순간의 보드가 그대로 보입니다. 아래 문지기가 90초마다 새로고침해서 그 화면도
   * 계속 최신으로 유지합니다. 자바스크립트가 되는 보통 브라우저에서는 그 위에 실시간이 얹힙니다.
   */
  let initialData: BoardData | null = null;
  try {
    const res = await boardGet(new Request(`https://ops.local/api/ops-board/${token}`), { params: Promise.resolve({ token }) });
    if (res.ok) initialData = (await res.json()) as BoardData;
  } catch (e) {
    console.error("[운영 대시보드] 서버에서 첫 자료를 못 받았습니다:", e instanceof Error ? e.message : String(e));
  }
  // **앱이 90초 안에 안 뜨면 그 화면을 다시 불러옵니다.**
  //
  // 전자칠판 내장 브라우저는 오래된 엔진이라 앱의 자바스크립트를 아예 못 읽는 경우가 있습니다.
  // 그러면 서버가 보낸 「불러오는 중...」 글자만 영원히 남고, 오류는 어디에도 안 뜹니다 - 보는
  // 사람은 네트워크가 느린 줄 압니다. 이 한 줄은 어떤 브라우저든 읽는 옛 문법(ES5)으로만 적어
  // 두어, 앱이 못 뜨는 바로 그 상황에서도 돌아갑니다. 브라우저 이름과 판을 함께 적으면 어느
  // 기기가 왜 안 되는지 그 자리에서 알 수 있습니다.
  // 어떤 브라우저든 읽는 옛 문법(ES5)으로만 적습니다 - 앱이 못 뜨는 바로 그 상황에서 돌아야 합니다.
  // 서버가 그린 화면이 있으면 조용히 새로고침만 하고, 그것조차 없으면 브라우저 이름과 판을 적어
  // 어느 기기가 왜 안 되는지 그 자리에서 읽을 수 있게 합니다.
  const guard = `(function(){var hasData=${initialData ? "true" : "false"};setTimeout(function(){if(window.__opsBoardReady)return;if(hasData){var tag=document.createElement("div");tag.setAttribute("style","position:fixed;right:8px;bottom:6px;font-size:11px;color:#94a3b8;background:rgba(15,23,42,.7);padding:2px 8px;border-radius:6px;z-index:9999");tag.innerHTML="정적 보기 · 90초마다 새로고침";document.body.appendChild(tag);setTimeout(function(){location.reload();},90000);return;}var el=document.getElementById("ops-board-loading");if(!el)return;var ua=navigator.userAgent||"";var m=ua.match(/Chrome\\/(\\d+)/);var v=m?("Chrome "+m[1]):ua.slice(0,80);el.innerHTML='<div style="text-align:center;line-height:1.6"><div style="font-size:22px;color:#fca5a5">이 브라우저에서는 화면을 그릴 수 없습니다</div><div style="font-size:16px;color:#94a3b8;margin-top:8px">브라우저: '+v+'</div><div style="font-size:14px;color:#64748b;margin-top:8px">60초 뒤 다시 시도합니다.</div></div>';setTimeout(function(){location.reload();},60000);},12000);})();`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: guard }} />
      <OpsBoardClient token={token} initialData={initialData} />
    </>
  );
}
