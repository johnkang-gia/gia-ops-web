import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 클래스 이름을 합칩니다(shadcn 규약).
 *
 * twMerge가 있어야 `cn("px-2", "px-4")` 같은 충돌에서 뒤엣것이 이깁니다 - 그게 없으면
 * 부품에 넣어둔 기본값을 화면에서 덮어쓸 수가 없어, 부품마다 예외 props가 늘어납니다.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
