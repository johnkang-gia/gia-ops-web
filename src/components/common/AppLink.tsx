"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof Link>;

/**
 * 앱 안의 모든 링크. `next/link` 와 같지만 **화면에 보이는 것만으로 미리 불러오지 않습니다.**
 *
 * `next/link` 는 링크가 화면에 들어오면 그 주소를 미리 불러옵니다. 링크가 몇 개일 때는 좋은데,
 * 학생 조회 한 화면에서 미리 부르기가 124번 나갔습니다(학생 카드 48 + 사이드바 메뉴 전부). 하나하나가
 * 미들웨어의 로그인 확인을 거치므로, 그 사이 정작 그 화면의 사진·자료가 줄을 서서 학생 사진이
 * 다 뜨는 데 26초가 걸렸습니다.
 *
 * 대신 **마우스가 올라가면** 그 하나만 미리 부릅니다. 누르기 직전에 부르므로 옮겨 가는 속도는
 * 거의 같고, 안 누를 링크는 부르지 않습니다. 꼭 미리 불러야 하는 자리는 `prefetch` 를 직접 넘깁니다.
 */
export default function AppLink({ prefetch, onMouseEnter, onFocus, href, ...rest }: Props) {
  const router = useRouter();
  const warm = () => {
    if (prefetch === false) return;
    if (typeof href === "string" && href.startsWith("/")) router.prefetch(href);
  };
  return (
    <Link
      href={href}
      prefetch={prefetch ?? false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}
