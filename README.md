# GIA 운영 (gia-ops-web)

GIA 학교 운영 자동화 시스템의 Supabase + Vercel 버전. 구글 시트/구글 문서 없이 완전히 독립적으로
동작하는 Next.js 앱입니다.

- 사건/행사/회의 기록을 Supabase Postgres에 저장하고, Realtime으로 여러 사람이 동시에 봐도
  자동으로 화면이 갱신됩니다.
- Google 로그인(giamicro.com 도메인 제한) + PIN 2차 보안 확인.
- AI 제안 워크플로우: 사건/행사/회의를 Claude로 분석 → 제안함 검토(승인/보류/삭제) → 채택예정에서
  구체화 → 발행하면 매뉴얼에 반영.
- 매뉴얼("GIA 운영계획안"/"GIA 실무자매뉴얼")은 더 이상 구글 문서가 아니라 앱 안의 데이터로
  누적되고, 그 자리에서 인쇄용 PDF로 바로 생성됩니다(한글 폰트 내장).

아직 이전하지 않은 기능(구글 시트 버전이 계속 담당): 오류로그/개발자 대시보드/AI 사용량 로그,
학생 이름 통합 검색, 행사 사진 업로드. 함께 전달된 이전 가이드 문서의 "다음 단계" 항목을 참고하세요.

## 시작하기

```bash
npm install
cp .env.local.example .env.local   # 값을 Supabase 프로젝트 설정에 맞게 채우기
npm run dev
```

## 폴더 구조

- `src/app` - 페이지(App Router). `(dashboard)` 그룹 안에 홈/사건/행사/회의/제안함/채택예정/매뉴얼
  화면이 있습니다.
- `src/app/api` - 서버 전용 라우트: PIN 확인, AI 스캔(Claude 호출), 제안 승인/보류/삭제, 채택예정
  발행, 매뉴얼 PDF 생성.
- `src/lib/supabase` - 브라우저/서버/미들웨어용 Supabase 클라이언트.
- `src/lib/useRealtimeTable.ts` - 목록을 Supabase Realtime으로 구독하는 공용 훅.
- `src/lib/ai` - 기존 .gs 파일의 AI 프롬프트/법령 참고자료를 그대로 옮긴 것 + Claude API 호출 함수.
- `src/lib/pinCookie.ts` - PIN 2차 보안 쿠키 서명/검증.
- `src/assets/fonts` - PDF 생성에 쓰이는 한글 폰트(Pretendard) 내장 파일.
- `src/proxy.ts` - 로그인 세션 확인 + giamicro.com 도메인 검사 + PIN 확인(Next.js 16의 미들웨어).
- `supabase/schema.sql` - Supabase에 붙여넣고 실행할 테이블/보안규칙(RLS)/실시간 설정 전체.
- `scripts/migrate-from-export.mjs` - 구글 시트에서 내보낸 JSON을 Supabase로 옮기는 스크립트.

자세한 설치·배포·데이터 이전·AI 워크플로우 사용법은 함께 전달된
`GIA_Supabase_Vercel_이전가이드.md` 문서를 따라 하세요.
