import { cache } from "react";
import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, normalizeLang, type Lang, type T } from "@/lib/lang";

// 서버 컴포넌트에서 지금 언어를 읽습니다.
//
//   const t = await getT();
//   <h1>{t("출석부", "Attendance")}</h1>
//
// cache()로 감싸서 한 번의 페이지 렌더링 안에서는 쿠키를 몇 번 읽든 실제 작업은 한 번만
// 일어나게 합니다(getCurrentAppUser와 같은 방식).
export const getLang = cache(async (): Promise<Lang> => {
  const cookieStore = await cookies();
  return normalizeLang(cookieStore.get(LANG_COOKIE)?.value);
});

export async function getT(): Promise<T> {
  return makeT(await getLang());
}
