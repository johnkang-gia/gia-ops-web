import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
