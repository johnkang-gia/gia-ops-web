import OpsBoardClient from "@/components/opsBoard/OpsBoardClient";

export const dynamic = "force-dynamic";

// 사무실 대형 모니터용 통합 운영 대시보드 - 로그인 없이 토큰 링크 하나로 띄워둡니다(요청:
// "큰 모니터에 띄워서 전체가 한눈에 보고 파악할 수 있는 통합 대시보드", 접속은 "로그인 없는
// 전용 링크"). 화면 절반은 CCTV, 나머지 절반에 이 페이지를 띄우는 구성을 전제로 합니다.
export default async function OpsBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // **12초가 지나도 화면이 안 그려지면 그 자리에 이유를 적습니다.**
  //
  // 전자칠판 내장 브라우저는 오래된 엔진이라 앱의 자바스크립트를 아예 못 읽는 경우가 있습니다.
  // 그러면 서버가 보낸 「불러오는 중...」 글자만 영원히 남고, 오류는 어디에도 안 뜹니다 - 보는
  // 사람은 네트워크가 느린 줄 압니다. 이 한 줄은 어떤 브라우저든 읽는 옛 문법(ES5)으로만 적어
  // 두어, 앱이 못 뜨는 바로 그 상황에서도 돌아갑니다. 브라우저 이름과 판을 함께 적으면 어느
  // 기기가 왜 안 되는지 그 자리에서 알 수 있습니다.
  const guard = `(function(){setTimeout(function(){if(window.__opsBoardReady)return;var el=document.getElementById("ops-board-loading");if(!el)return;var ua=navigator.userAgent||"";var m=ua.match(/Chrome\/(\d+)/);var v=m?("Chrome "+m[1]):ua.slice(0,80);el.innerHTML='<div style="text-align:center;line-height:1.6"><div style="font-size:22px;color:#fca5a5">이 브라우저에서는 화면을 그릴 수 없습니다</div><div style="font-size:16px;color:#94a3b8;margin-top:8px">브라우저: '+v+'</div><div style="font-size:14px;color:#64748b;margin-top:8px">크롬 64 이상이 필요합니다. 전자칠판에 크롬을 설치해 그 주소로 열어주세요.</div></div>';},12000);})();`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: guard }} />
      <OpsBoardClient token={token} />
    </>
  );
}
