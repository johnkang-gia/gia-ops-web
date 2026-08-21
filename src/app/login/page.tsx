import Image from "next/image";
import { Suspense } from "react";
import { getLang } from "@/lib/langServer";
import { LanguageProvider } from "@/components/common/LanguageProvider";
import LanguageToggle from "@/components/common/LanguageToggle";
import LoginForm from "@/components/auth/LoginForm";

// 로그인 화면도 한국어/영어로 완전히 바뀝니다(요청: "가입할때 교사도 가입해야하니까 가입하는것도
// 영어병기 해주고"). 원어민 교사는 앱을 처음 만나는 순간이 이 화면이라, 여기서부터 영어로
// 읽히지 않으면 가입 자체를 못 합니다. 언어 선택은 쿠키에 저장되어 가입·온보딩·앱 내부까지
// 그대로 이어집니다.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const lang = await getLang();

  return (
    <LanguageProvider initialLang={lang}>
      <main className="gia-navy-panel flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-3 flex justify-end">
            <LanguageToggle variant="plain" />
          </div>
          <div className="rounded-2xl bg-white p-8 shadow-2xl">
            <Image
              src="/logo-login.png"
              alt="GIA Micro Lab"
              width={570}
              height={288}
              priority
              className="mx-auto mb-4 h-24 w-auto"
            />
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </main>
    </LanguageProvider>
  );
}
