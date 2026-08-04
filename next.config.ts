import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /changelog 페이지가 런타임에 CHANGELOG.md를 fs로 직접 읽습니다(요청: "버전로그 볼 수
  // 있도록"). Vercel의 서버리스 파일 트레이싱은 코드에서 정적으로 import하지 않는 파일은
  // 기본적으로 번들에서 빼버려서, 이 설정이 없으면 로컬(npm run dev/build)에서는 잘 되다가
  // 실제 배포본에서만 파일을 못 찾는 문제가 생길 수 있습니다 - 이 라우트에 한해 명시적으로
  // 포함시킵니다.
  outputFileTracingIncludes: {
    "/changelog": ["./CHANGELOG.md"],
  },
  experimental: {
    // 사이드바 메뉴는 버튼+router.push()로 이동합니다(상태표시줄에 링크 주소가 뜨는 걸
    // 막기 위해 <Link>를 쓰지 않음 - NavLinks.tsx 참고). 이 방식은 Next.js가 <Link>에
    // 기본으로 해주는 "방문했던 화면은 잠시 재사용" 캐싱 혜택을 받지 못해, 메뉴를 오갈
    // 때마다 매번 서버에 새로 요청을 보내 화면 전환이 느려집니다(요청: "메뉴 눌렀을 때
    // 화면 전환이 너무 느려"). staleTimes.dynamic을 켜면 최근에 열어본 화면은 30초 동안
    // 다시 서버에 묻지 않고 캐시를 재사용합니다 - NavLinks.tsx의 router.prefetch() 추가와
    // 함께 적용해야 효과가 있습니다(prefetch로 미리 받아둔 데이터를 이 캐시가 붙잡아 둡니다).
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
