# CHANGELOG

이 파일은 `gia-ops-web`의 버전별 변경 이력을 기록합니다. 버전 번호는 `package.json`의
`version` 값과 항상 일치시킵니다. 업데이트할 때마다 이 파일 맨 위에 새 항목을 추가하고,
같은 내용을 GitHub Desktop의 커밋 Summary/Description에도 그대로 사용하면 됩니다.

## v0.21.0 - 2026-07-31

할 일 입력 확대 + 날짜별 기록 저장 + 업무 히스토리(달력) 메뉴 신설:

- 홈 화면 할 일 입력창을 더 크게(글자 크기/여백 확대)
- 할 일마다 "날짜(for_date)"가 함께 저장됨. 기본은 오늘 날짜이고, 필요하면 다른 날짜로 바꿔서
  미리 등록할 수도 있음. 홈 위젯은 "오늘 할 일"만 보여주고, 지난 날짜에 적었던 할 일은 사라지지
  않고 날짜별로 계속 쌓임
- 사이드바 "실무자매뉴얼" 아래에 "업무히스토리" 메뉴 신설. 달력에서 날짜를 누르면 그 날 기록한
  할 일 목록을 볼 수 있음. 할 일이 있는 날짜는 점으로 표시되고(주황=아직 안 끝난 일 있음,
  초록=그날 할 일 모두 완료), 대한민국 공휴일도 함께 표시됨
- 알림 시간 설정 UI도 날짜+시간을 분리해서 더 명확하게 정리(선택한 날짜의 그 시간에 알림)

```sql
-- ===== 26. 할 일에 날짜(for_date) 추가 - 업무 히스토리(달력) 조회용 =====
alter table todos add column if not exists for_date date not null default current_date;
create index if not exists todos_user_date_idx on todos(user_email, for_date);
```

## v0.20.1 - 2026-07-31

홈 화면 상단 정리(DB 변경 없음):

- "홈" 제목 글씨를 없앰(학기 표시와 함께 있을 때 어울리지 않는다는 피드백 반영)
- 학기 표시를 파란 버튼(알약 모양) 스타일에서, 페이지 제목처럼 보이는 큰 글씨 + 아래 짧은
  포인트 라인으로 변경 - 클릭 가능한 버튼처럼 보이지 않도록 정리

## v0.20.0 - 2026-07-31

홈 화면 왼쪽에 개인 할 일 목록 + 시간 알림 기능 신설:

- 홈 화면 맨 왼쪽에 "✅ 할 일" 위젯 추가. 할 일을 적고, 원하면 날짜·시간을 함께 설정할 수
  있음. 체크박스로 완료 처리, ✕ 버튼으로 삭제 가능. 다른 기록(사건/회의 등)과 달리 이 할 일은
  본인 것만 보이는 개인용 목록임(DB에서 본인 이메일로 접근 제한)
- 설정한 시간이 되면 팝업으로 알려줌: (1) 브라우저 알림 허용 시 OS 알림 센터에도 뜨는 네이티브
  알림, (2) 앱을 켜둔 화면 오른쪽 아래에 뜨는 인앱 팝업(완료 처리/닫기 버튼 포함) - 홈 화면이
  아니어도 앱의 다른 어떤 화면에 있든 뜸. 할 일 위젯의 "🔔 알림 켜기" 버튼을 한 번 눌러 브라우저
  알림을 허용해두면 더 확실하게 받을 수 있음
  - 주의: 이 알림은 브라우저 탭(앱)이 열려 있는 동안에만 동작함. 완전히 브라우저를 꺼두면
    알림이 가지 않음(탭을 열어두거나 최소화만 해두면 정상 동작)

```sql
-- ===== 25. 개인 할 일(todos) - 홈 화면 왼쪽 위젯 =====
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  text text not null,
  due_at timestamptz,
  done boolean not null default false,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists todos_user_email_idx on todos(user_email);

drop trigger if exists todos_set_updated_at on todos;
create trigger todos_set_updated_at
  before update on todos
  for each row execute function set_updated_at();

alter table todos enable row level security;
drop policy if exists "own_todos" on todos;
create policy "own_todos" on todos
  for all using (user_email = (auth.jwt() ->> 'email')) with check (user_email = (auth.jwt() ->> 'email'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'todos'
  ) then
    alter publication supabase_realtime add table todos;
  end if;
end $$;
```

## v0.19.0 - 2026-07-31

홈 학기 표시 강조 + 달력 공휴일/OS 캘린더 연동 + 행사분석 문구 정비(DB 변경 없음):

- 홈 화면 학기 표시를 제목 옆 작은 글씨에서, 제목 아래 중앙의 눈에 띄는 파란 배지("📅 2026
  여름캠프2")로 이동. 학기 표시가 가장 중요한 정보라는 요청 반영
- 달력 위젯에 대한민국 공휴일을 표시함. `@hyunbinseo/holidays-kr` 패키지(우주항공청 공식
  월력요항 기반, 대체공휴일 규정 포함)를 사용해 해당 연도 공휴일 데이터를 불러오고, 공휴일인
  날짜는 빨간색 굵은 글씨로 표시 + 마우스를 올리면 공휴일 이름이 보임(오늘이 공휴일이면 시계
  아래에도 이름이 함께 표시됨)
- 달력의 날짜를 클릭하면 그 날짜로 OS 기본 캘린더 앱이 열리도록 연동:
  - Mac/iOS: Calendar.app을 `calshow:` 링크로 즉시 열어서 해당 날짜로 이동
  - Windows/Android 등: 해당 날짜의 .ics 파일을 다운로드함 - 열어보면(더블클릭) 기본 캘린더
    앱(Outlook/캘린더/구글 캘린더 등)에 바로 추가할 수 있음(웹 표준 "캘린더에 추가" 방식)
- 행사기록 > 정규행사 탭의 "📊 연도별 비교 리포트" 버튼을 "🔍 행사분석 (AI)"로 이름 정비.
  기능은 이미 구현되어 있었음: 같은 이름의 정규행사 과거 기록 전체(좋았던 점/아쉬웠던 점/개선
  제안)를 AI가 분석해서 (1) 이전에 지적된 아쉬운 점이 이후 회차에서 실제로 보완됐는지
  (✅ 개선된 점), (2) 여러 회차에 걸쳐 계속 반복되는 미해결 문제(⚠️ 반복되는 문제), (3) 다음
  회차 준비 시 우선 반영할 제안을 정리해서 보여줌

```sql
-- DB 스키마 변경 없음.
```

## v0.18.0 - 2026-07-31

홈 화면 학기 표시 단순화 + 달력/시계 위젯 + 학기 자동 전환(날짜 기반):

- 홈 화면 상단의 학기 안내 박스(클릭 가능한 카드, "현재 학기:" 라벨, 안내 문구)를 없애고,
  제목 "홈" 옆에 "📅 2026 여름캠프2"처럼 값만 표시. 진행중 학기가 없으면 표시 안 함
- 홈 화면 오른쪽에 실시간 시계 + 이번 달 달력(오늘 날짜 강조, 좌우 화살표로 다른 달도 확인 가능)
  위젯 추가 - 오늘이 며칠인지 한눈에 확인 가능
- 사이드바(로고-이메일 사이)/모바일 상단의 학기 배지 로직 자체는 정상이었음. 다만 학기 배지는
  terms 테이블에 status='진행중'인 행이 실제로 있어야만 나타남 - 학기 메뉴에서 "설정하기/변경"
  버튼으로 한 번 전환해줘야 배지가 뜸. 모바일 헤더에도 학기가 없을 때 "진행중인 학기 없음"
  안내를 추가해 데스크톱과 동일하게 항상 상태를 알 수 있도록 정리
- **학기 자동 전환(신규)**: 학기 등록 폼의 시작일/종료일은 이미 달력(날짜 선택) 입력이었음.
  이제 매일 자정(KST)에 Vercel Cron이 서버의 `/api/cron/term-switch`를 호출해서, 오늘 날짜가
  어떤 학기의 [시작일~종료일] 범위에 들어오면 그 학기를 자동으로 "진행중"으로 켜고, 기존에
  진행중이던 다른 학기는 자동으로 "종료" 처리함. 즉, 학기 등록할 때 시작일/종료일만 정확히
  넣어두면 그날이 되었을 때 사람이 직접 전환할 필요 없이 자동으로 바뀜
  - 배포 후 한 번만 설정하면 됨: (1) 터미널에서 `openssl rand -hex 32`로 무작위 값 생성 →
    Vercel 프로젝트 Settings → Environment Variables에 `CRON_SECRET`으로 등록,
    (2) 같은 값으로 로컬 `.env.local`에도 `CRON_SECRET=...` 추가(선택, 로컬 테스트용),
    (3) `vercel.json`에 크론 설정을 이미 포함해서 커밋했으므로 GitHub Desktop으로 푸시하면
    Vercel이 자동으로 매일 인식해서 실행함 (Vercel 프로젝트 Cron Jobs 탭에서 실행 이력 확인 가능)

```sql
-- DB 스키마 변경 없음 (terms.start_date/end_date는 이미 date 타입, RLS도 기존 그대로 사용).
-- 단, /api/cron/term-switch는 service_role 키로 동작하므로 .env.local.example에 추가된
-- SUPABASE_SERVICE_ROLE_KEY가 Vercel 환경변수에도 이미 등록되어 있어야 합니다(마이그레이션
-- 스크립트용으로 이미 등록해두었다면 추가 작업 불필요).
```

## v0.17.3 - 2026-07-31

현재 학기 표시에 연도 포함 + 학기 전환 시 연도 선택 가능(DB 변경 없음):

- 홈 화면, 사이드바(로고-이메일 사이) 배지, 학기 메뉴 상단 "현재 학기" 표시를 모두
  `학기 (연도)` → `연도 학기` 형식으로 통일. 예: "2026 여름캠프2"
- 학기 메뉴의 "현재 학기" 변경 드롭다운에 연도 선택 셀렉트를 추가함. 기존에는 항상 올해로만
  전환/생성할 수 있었는데, 이제 작년/올해/내년(및 이미 기록이 있는 다른 연도)을 골라서 그 연도의
  학기/캠프를 진행중으로 설정하거나 새로 만들 수 있음

## v0.17.2 - 2026-07-31

학기 선택 드롭다운이 비어있던 문제 수정(DB 변경 없음):

- "현재 학기" 변경 드롭다운이 이미 저장된 회차 기록에서만 목록을 만들다 보니, 아직 아무 학기도
  등록 안 한 상태에서는 빈 목록으로 보였음. 이제 1학기/2학기/3학기/여름캠프1/여름캠프2/겨울캠프1/
  겨울캠프2 7개 종류가 항상 선택지에 나오고, 올해 기록이 없는 종류를 고르면 그 자리에서 새로
  만들어 바로 진행중으로 설정함(기존 진행중 학기는 자동 종료)

## v0.17.1 - 2026-07-31

학기 상단 선택 기능 + 코드 정리(DB 변경 없음):

- 학기·캠프 화면 맨 위에 "현재 학기" 영역 추가: 지금 진행중으로 설정된 학기가 바로 보이고,
  "변경" 버튼으로 드롭다운에서 아무 회차나 골라 즉시 전환 가능. 전환하면 기존에 진행중이던
  학기는 자동으로 종료 처리되어, 항상 하나만 "현재 학기"로 유지됨(홈/사이드바에 표시되는 값과
  동일한 기준)
- 코드 정리: 아무 데서도 안 쓰이던 중복 페이지(`/incidents`, `/records`와 완전히 같은 내용)를
  제거
- 성능: 사건기록/회의기록/AI매뉴얼 화면 오른쪽의 AI 제안 패널이 실시간 갱신을 구독할 때, 이제
  Supabase 쪽에서 해당 화면과 관련 없는 변경 이벤트는 아예 걸러서 보내도록 필터를 걸어 불필요한
  네트워크 트래픽을 줄이고, 처음 불러올 때도 화면에 실제로 쓰이는 컬럼만 가져오도록 줄여
  응답 속도를 개선

## v0.17.0 - 2026-07-31

문의및건의사항 메뉴 + 개발자 대시보드 + 오류/AI사용량 로깅(DB 변경 있음 - 아래 SQL 실행 필요):

- **문의및건의사항** 메뉴 신설(전 직원): 오류 신고/기능제안/기타를 자유롭게 남기고, 본인이 남긴
  문의와 개발자 답변을 확인할 수 있음
- **개발자 대시보드**(`/dev`, johnkang@giamicro.com 전용): 전체 데이터 현황(테이블별 건수),
  14일 넘게 방치된 제안/채택예정과 3일 넘게 미처리된 오류 문의 알림, 최근 30일 AI 사용량(라우트별
  호출수·실패수·토큰수), 최근 오류 로그 20건을 한 화면에서 확인
  - 개발자 메뉴에서는 문의사항도 전체 조회 + 상태변경(접수/처리중/완료) + 답변 작성 가능
- **오류 로깅**: 지금까지 API 오류가 기록되지 않던 것을 모든 AI 관련 API 라우트(16개)에서
  자동으로 `error_logs`에 남기도록 구현
- **AI 사용량 로깅**: `callClaudeJson` 호출마다 라우트명·모델·입력/출력 토큰수·성공여부를
  `ai_usage_logs`에 자동 기록(비용/사용 패턴 모니터링용)
- **Vercel Analytics + Speed Insights** 연동: 배포하면 별도 설정 없이 실제 사용자 페이지
  로딩 속도가 Vercel 대시보드에 자동으로 수집됨(무료 도구)
- **DB 변경 필요**: `inquiries`/`error_logs`/`ai_usage_logs` 테이블과 `is_developer()` 함수
  추가 (아래 SQL을 Supabase SQL Editor에서 실행)

```sql
create or replace function is_developer()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'johnkang@giamicro.com', false);
$$;

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,
  category text not null,
  title text not null,
  content text not null,
  status text not null default '접수',
  reporter_email text not null,
  developer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  message text not null,
  stack text,
  user_email text,
  created_at timestamptz not null default now()
);

create table if not exists ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

alter table inquiries enable row level security;
alter table error_logs enable row level security;
alter table ai_usage_logs enable row level security;

drop policy if exists "giamicro_insert_inquiries" on inquiries;
create policy "giamicro_insert_inquiries" on inquiries
  for insert with check (is_giamicro_user() and reporter_email = (auth.jwt() ->> 'email'));

drop policy if exists "self_select_inquiries" on inquiries;
create policy "self_select_inquiries" on inquiries
  for select using (reporter_email = (auth.jwt() ->> 'email'));

drop policy if exists "developer_manage_inquiries" on inquiries;
create policy "developer_manage_inquiries" on inquiries
  for all using (is_developer()) with check (is_developer());

drop policy if exists "giamicro_insert_error_logs" on error_logs;
create policy "giamicro_insert_error_logs" on error_logs
  for insert with check (is_giamicro_user());

drop policy if exists "developer_manage_error_logs" on error_logs;
create policy "developer_manage_error_logs" on error_logs
  for all using (is_developer()) with check (is_developer());

drop policy if exists "giamicro_insert_ai_usage_logs" on ai_usage_logs;
create policy "giamicro_insert_ai_usage_logs" on ai_usage_logs
  for insert with check (is_giamicro_user());

drop policy if exists "developer_manage_ai_usage_logs" on ai_usage_logs;
create policy "developer_manage_ai_usage_logs" on ai_usage_logs
  for all using (is_developer()) with check (is_developer());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inquiries'
  ) then
    alter publication supabase_realtime add table inquiries;
  end if;
end $$;
```

## v0.16.0 - 2026-07-31

사건 AI 자동채우기 복원 + 학기 자동 연결 + 작성자 자동 입력(DB 변경 있음 - 아래 SQL 실행 필요):

- **사건기록 AI 자동채우기**: 상세 내용(경위)란에 두서없이 적고 "🧹 AI로 채우기"를 누르면 날짜·
  제목·잘된 점·부족했던 점·보완점을 AI가 원문에서 찾아 자동으로 채워줌(원문에 없는 내용은 억지로
  지어내지 않고 비워둠 - 없어졌던 예전 기능을 새 화면 구조에 맞게 복원)
- **담당자 자동 입력**: 새 사건을 작성할 때 담당자(작성자) 칸에 로그인한 계정 이메일이 자동으로
  채워짐(직접 수정 가능)
- **학기 자동 연결**: 학기 메뉴에서 어떤 학기/캠프를 "진행중"으로 등록해두면, 그 기간에 새로
  작성하는 사건·회의 기록이 자동으로 그 학기에 연결됨. 학기 메뉴에서 회차를 펼치면 그 기간에
  쌓인 사건/회의 기록을 목록으로 바로 확인 가능
- 홈 화면 상단에 "현재 학기" 카드 추가(진행중인 학기가 없으면 등록 안내 표시)
- 사이드바(PC)와 상단 헤더(모바일) 로고와 로그인 계정 사이에 현재 학기 배지 표시, 누르면 학기
  메뉴로 이동
- **DB 변경 필요**: `incidents`/`meetings` 테이블에 `term_id` 컬럼 추가 (아래 SQL을 Supabase
  SQL Editor에서 실행)

```sql
alter table incidents add column if not exists term_id uuid references terms(id) on delete set null;
alter table meetings add column if not exists term_id uuid references terms(id) on delete set null;
create index if not exists incidents_term_id_idx on incidents(term_id);
create index if not exists meetings_term_id_idx on meetings(term_id);
```

## v0.15.0 - 2026-07-31

화면 폭 자동 조정 + 사건/회의/AI매뉴얼 3단 통합 작업화면(DB 변경 없음):

- 모니터가 넓을 때 본문이 가운데에 좁게 몰려 여백이 과하게 남던 문제 수정. 3단 작업화면으로
  바뀐 사건기록/회의기록/AI매뉴얼은 화면 너비에 맞춰 자동으로 늘어나고, 나머지 목록형 화면
  (채택예정/학기/행사/실무자매뉴얼/제안함/매뉴얼/서류함/사용자 관리/홈)도 좀 더 넓게 조정
- **사건기록**: 기존에는 "+새로 입력"을 눌러야 입력칸이 나타났는데, 이제 왼쪽에 지금까지
  기록한 사건 목록이 항상 보이고 가운데에 입력폼이 항상 떠 있어 바로 적고 저장할 수 있음.
  오른쪽에는 이 사건들에서 나온 AI 제안(검토대기)과 채택예정 항목이 함께 표시되어 승인·수정·
  발행까지 이 화면에서 끝낼 수 있음(제안함/채택예정 메뉴를 오갈 필요 없음)
- **회의기록**: 왼쪽에 날짜별 회의 목록, 가운데에 지금까지 쓰던 채팅 작성창(텍스트/음성파일
  업로드/라이브 녹음 모두 그대로)이 항상 떠 있음. 저장하면 오른쪽 AI 제안 패널에 검토대기·
  채택예정 항목이 바로 나타남
- **AI 매뉴얼**: 왼쪽에 지금까지 작성한 이력이 쌓여서 클릭하면 다시 불러올 수 있고, 가운데
  입력폼과 오른쪽 AI 제안 패널(검토대기/채택예정)이 함께 있음
- 사건/회의를 저장하는 즉시 그 건만 AI가 바로 분석하도록 스캔 API를 확장(기존에는 5건 단위
  일괄 분석만 있어서, 방금 쓴 글이 오른쪽에 뜨기까지 다른 미분석 기록이 쌓이길 기다려야 했음)
- 클릭 반응 속도: 지난 버전(미들웨어 캐싱, 브라우저 클라이언트 재사용)에 이어, 이번 3단
  작업화면으로 사건/회의/AI매뉴얼-제안함-채택예정 사이 페이지 이동 자체가 크게 줄어 체감
  반응속도가 개선됨

## v0.14.2 - 2026-07-31

음성 인식률 개선(라이브 녹음/음성 파일 업로드 공통 적용, DB 변경 없음):

- 모델을 whisper-large-v3-turbo -> whisper-large-v3(전체 모델)로 변경 - 무료 한도는 동일한데
  인식 정확도가 더 좋음
- 언어를 자동감지 대신 한국어(ko)로 명시 - 특히 짧은 구간에서 자동감지가 흔들리는 문제 개선
- GIA 관련 용어(부이사장, 실장, 플리마켓, 구글폼 등)를 미리 알려주는 프롬프트를 추가해 고유
  용어 인식률 개선
- 라이브 녹음의 마이크 설정에 에코 제거/노이즈 억제/자동 게인을 명시적으로 켜고, 녹음
  비트레이트를 높여 음질 개선
- 라이브 녹음 구간 길이를 45초 -> 60초로 늘려 문장이 구간 경계에서 잘리는 빈도를 줄임(대신
  화면 갱신 주기는 약간 느려짐)

## v0.14.1 - 2026-07-31

- 음성 인식(STT) 서비스를 OpenAI(유료, 카드 등록 필요)에서 Groq 무료 티어로 변경 - 신용카드
  등록 없이 가입만으로 하루 2,000건/시간당 오디오 7,200초까지 무료 사용 가능(학교 회의록
  용도로는 충분한 한도). 음성 파일 업로드, 회의 라이브 녹음 모두 이 무료 한도로 동작
- **필요 환경변수 변경**: `OPENAI_API_KEY` 대신 `GROQ_API_KEY`를 Vercel에 추가해야 함
  (아래 가입 가이드 참고)

## v0.14.0 - 2026-07-31

- 회의를 "자료 기록" 그룹 안에서 독립 메뉴("회의기록")로 분리(기존 기록함은 이제 사건만 다룸,
  라벨도 "사건기록"으로 명확히 함)
- 회의록 채팅에 "🔴 회의 시작" 라이브 녹음 기능 추가: 누르면 마이크 녹음이 시작되고, 약 45초
  구간마다 자동으로 텍스트로 바뀌어 채팅에 전송되면서 정리본이 회의 진행 중에 계속 갱신됨.
  "⏹️ 회의 종료"를 누르면 녹음이 멈추고 마지막 구간까지 반영됨(진짜 초 단위 실시간 스트리밍은
  아니고 약 45초 지연으로 갱신되는 방식이며, 라이브 녹음 원본 파일은 저장하지 않고 텍스트만
  남김 - 파일을 올리는 방식은 기존처럼 원본이 저장되어 재생 가능)
- DB 변경 없음(기존 회의록 채팅/음성 기능 인프라를 그대로 재사용)

## v0.13.0 - 2026-07-31

- 회의록 "새로 입력"이 채팅 형식으로 바뀜: 두서없이 적은 회의 메모를 그대로 붙여넣으면 AI가
  애매한 부분(예: "시간 아침에 바꿔줘야 함" -> "원래 몇 시였고 왜 바꾸나요?")을 대화로 되물으면서
  정식 회의록을 실시간으로 정리. 화면에 정리 중인 초안이 계속 갱신되어 보이고, 준비됐다 싶으면
  언제든 "회의록으로 저장" 가능(대화 내용도 함께 저장되어 나중에 참고 가능)
- 채팅에 회의 녹음 음성 파일을 올릴 수 있음 - 자동으로 텍스트로 바뀐 뒤 같은 대화형 정리 과정을
  시작함(OpenAI 음성 인식 API 사용, Claude API는 오디오 입력을 지원하지 않아 이 부분만 별도
  서비스 이용 - 분당 약 0.003달러로 저렴함). 저장된 회의록에서 녹음 파일을 다시 들어볼 수 있음
- DB: `meetings` 테이블에 `source_chat`(jsonb, 대화 기록) / `audio_path`(녹음 파일 경로)
  컬럼 추가, `meeting-audio` 비공개 Storage 버킷 + RLS 정책 추가 (Supabase SQL Editor에서
  schema.sql "22. 회의록 대화형 작성 + 음성 녹음 업로드" 블록 실행 필요)
- **배포 전 필수**: Vercel 프로젝트 환경변수에 `OPENAI_API_KEY`를 새로 추가해야 음성 변환
  기능이 동작합니다(OpenAI 플랫폼에서 발급). 텍스트 붙여넣기 채팅 기능은 기존 환경변수만으로도
  바로 동작합니다.

## v0.12.0 - 2026-07-31

- AI 예상 문의/컴플레인 제안: 카테고리명만으로 중복을 걸러내던 것을, 기존 실무자매뉴얼에 이미
  규정된 내용과 검토 대기 중인 예상 문의의 실제 본문까지 AI에게 함께 보여줘서, 항목명이 달라도
  이미 다뤄진 주제는 자동으로 걸러내도록 개선
- 채택예정에 "AI 검증" 기능 추가: 실무자가 GIA 실정에 맞게 구체화한 최종 문구를 AI가 비판적으로
  분석해서 예상 후속 문의/컴플레인, 조항의 맹점·허점, 구체적인 보완 제안을 짚어줌. 이 내용을
  반영해서 수정한 뒤 다시 "AI 검증"을 눌러 재검증받을 수 있고(검증 횟수 누적 표시), 검증 이후
  내용을 수정하면 "다시 검증해보세요" 안내가 뜸 - 여러 차례 검증을 거쳐 보완된 안건을 발행하는
  흐름을 지원
- DB: `adopted` 테이블에 `review_result`(jsonb) / `review_count` / `last_reviewed_at` 컬럼
  추가 (Supabase SQL Editor에서 schema.sql "21. 채택예정 AI 비판적 검증" 블록 실행 필요)

## v0.11.0 - 2026-07-30

성능 개선(기능 변화 없음, DB 마이그레이션 불필요) - 화면 이동/버튼 클릭 반응 속도 개선:

- 브라우저 Supabase 클라이언트를 페이지 로드당 1개만 만들어 재사용하도록 변경(기존에는 버튼을
  누르거나 목록을 구독할 때마다 매번 새 클라이언트를 새로 만들어서, 그때마다 세션을 다시 읽고
  내부 잠금을 새로 잡는 지연이 있었음) - 특히 저장/발행 등 버튼 클릭 반응 속도에 가장 크게 기여
- 로그인 승인 여부 확인을 매 페이지 이동마다 DB에서 조회하던 것을, 한 번 확인되면 5분 동안은
  서명된 쿠키만으로 빠르게 통과시키도록 변경(페이지를 옮길 때마다 있었던 네트워크 왕복 1회를
  대부분의 경우 제거) - 관리자가 승인을 취소/차단해도 최대 5분 이내에는 반영됨(실제 데이터
  접근은 항상 Supabase 행 단위 보안(RLS)이 별도로 검사하므로 안전에는 영향 없음)
- 세션 검증을 getUser()에서 getClaims()로 교체(프로젝트가 최신 비대칭 서명키를 쓰는 경우 매
  요청 인증 서버 왕복 없이 로컬 검증되어 더 빠름, 그렇지 않아도 기존과 동일하게 동작)
- 홈/기록함 등 서버 페이지의 여러 DB 조회는 이미 병렬(Promise.all)로 처리되고 있어 추가로
  손볼 부분이 없었음(점검만 진행)

## v0.10.0 - 2026-07-30

- 행사기록: 정규행사(매년 반복되는 행사)와 일시적행사(한 번뿐인 행사)를 구분해서 입력.
  정규행사는 행사명별로 탭이 생기고, 그 안에서 회차별 이력·AI 연도별 비교 리포트·행사 사진을
  모아 관리. 일시적행사는 "이런 행사가 있었다" 정도로 가볍게 기록만 해두고 나중에 비슷한
  행사를 할 때 참고
- 행사/학기 사진을 실제로 업로드해서 보관(비공개 Storage 버킷, giamicro.com 로그인
  사용자만 조회/업로드/삭제 가능 - 아동이 포함된 사진일 수 있어 비공개로 유지)
- "학기" 메뉴 신설(행사 옆): 1~3학기, 여름캠프1·2, 겨울캠프1·2를 회차별로 기록. 학기가
  진행되는 동안 나온 회의록 내용은 회의록 AI 분류를 통해 해당 학기의 "개선 제안"란에 자동으로
  누적되고, AI 회차별 비교 리포트로 다음 같은 학기·다음 연도 운영에 참고할 수 있음
- 회의록 AI 분류의 "행사/학기 참고" 카테고리를 확장해서, 특정 행사뿐 아니라 특정 학기/캠프에
  대한 회고도 자동으로 구분해서 매칭되는 학기 기록에 붙여줌
- DB: `events` 테이블에 `kind`(정규/일시적) · `photo_paths` 컬럼 추가, `terms`(학기) 테이블
  신설, `event-photos` 비공개 Storage 버킷 + RLS 정책 추가 (Supabase SQL Editor에서
  schema.sql "18~20" 블록 실행 필요)

## v0.9.0 - 2026-07-30

- 행사기록을 기록함에서 분리해 독립 메뉴로 노출(기록함은 이제 사건·회의만 다룸) - 행사는
  매뉴얼 제작용 자료가 아니라 반복 행사를 중복 없이 기록하고 다음 행사 준비에 참고하는
  목적이 달라 별도로 뺐습니다
- 사이드바 메뉴를 목적별로 그룹화: [홈/실무자매뉴얼] · [자료 기록: 기록함·AI매뉴얼] ·
  [행사] · [제안·발행: 제안함·채택예정] · [문서함: 매뉴얼·서류함] · [관리: 사용자 관리]
- 회의록 AI 분석에 "행사/학기 참고" 분류 추가: 특정 행사나 학기에 대한 회고·개선 아이디어는
  매뉴얼 제안으로 만들지 않고, 이름이 비슷한 행사 기록의 "개선 제안"에 자동으로 붙여서
  다음번 같은 행사 열릴 때 AI 비교 리포트에 바로 반영되도록 함(매칭되는 행사가 없으면
  회의록의 확정 기록에 메모로 남김)

## v0.8.0 - 2026-07-30

- "실무자매뉴얼" 전용 메뉴 신설(홈 바로 다음 위치) - 학부모 문의/컴플레인 응대용 매뉴얼을
  검색해서 바로 찾아볼 수 있는 화면. 항목명·내용 통합 검색 지원
- AI가 학부모 문의/컴플레인을 미리 예상해서 권장 응대 문구와 함께 제안함에 자동 등록(제안함에
  "예상 문의/컴플레인" 탭 추가), 학비/환불·안전·급식·소통 등 국제학교에서 흔한 주제를 폭넓게 고려
- 워크플로우 정리: AI 제안 → 실무자 회의로 GIA 실정에 맞게 수정 후 승인(발행예정) → 이 단계에서
  AI가 실무자가 수정한 문구를 다시 한번 깔끔한 규정 문구로 정리해서 채택예정에 반영 → 실무자
  확인 후 발행 → 실무자매뉴얼에 카테고리로 반영 (기존 제안함/채택예정 화면 그대로 재사용)
- DB: `proposals.source` 체크 제약에 `complaint` 값 허용 추가 (Supabase SQL Editor에서
  schema.sql "17. AI 예상 문의/컴플레인 제안" 블록 실행 필요)

## v0.7.0 - 2026-07-30

- 서류함 메뉴 신설: GIA 같은 대안교육기관이 갖추면 좋은 서류를 AI가 추천해서 목록으로 만들고,
  각 서류별로 "AI 초안 만들기"로 바로 다듬어 쓸 수 있는 초안을 생성, 준비 상태(필요/준비중/
  보유/만료임박/해당없음)를 관리
- 홈 대시보드에 "반복되는 사건 유형" 경고 추가: 최근 90일 내 같은 유형 사건이 3건 이상 발생하면
  자동으로 표시(AI 호출 없이 순수 집계라 비용 없음)
- 행사 기록에 "연도별 비교 리포트" 추가: 같은 이름의 과거 행사 기록 2건 이상이 있으면 AI가
  개선된 점/반복되는 문제/다음 행사 제안을 요약
- 매뉴얼(학부모용 운영계획안)에 "FAQ 자동 생성" 추가: 전체 내용을 바탕으로 학부모가 궁금해할
  질문/답변을 AI가 만들고, 검토 후 매뉴얼의 "자주 묻는 질문" 항목으로 반영
- 매뉴얼 항목에 "서명 필요" 표시 기능 추가(환불 규정, 안전 수칙 등 학부모용 항목 한정) - 체크해두면
  PDF로 출력할 때 그 항목 뒤에 학생명/보호자 성명/서명/날짜를 적을 수 있는 서명란이 자동으로
  들어감(앱은 내부 인원만 쓰므로 전자서명 대신 배포용 문서에 서명란을 넣는 방식)
- DB: `documents` 테이블 신설, `manual_sections.requires_signature` 컬럼 추가
  (Supabase SQL Editor에서 schema.sql "15. 서류함" / "16. 매뉴얼 항목 서명 필요 여부" 블록 실행 필요)

## v0.6.0 - 2026-07-30

- AI 매뉴얼 작성 시 어느 문서(학부모용 운영계획안/실무자매뉴얼)에 반영할지 사람이 미리 고르지
  않고 AI가 내용을 보고 직접 판단(차량 탑승·아동 인계·환불 규정처럼 학부모도 알아야 하는
  내용은 두 문서 모두에, 교사 채용 기준처럼 내부용 절차는 실무자매뉴얼에만 반영)
- 판단 이유를 화면에 함께 표시해서 왜 그렇게 분류됐는지 확인 가능
- 사건/행사 AI 분석에서도 같은 로직 적용 - "두 문서 모두 해당"으로 판단되면 자동으로 두 건의
  제안을 각각 만들도록 기존 버그 수정(이전에는 "둘다"라는 문자열이 그대로 저장되어 매뉴얼
  화면 어디에도 반영되지 않는 상태였음)
- AI 비용 절감: 맞춤법 정리·회의 내용 분류처럼 실수해도 검토 단계에서 바로 잡을 수 있는 작업은
  저렴한 모델(Haiku)로 전환, 학부모 공지·법적 판단처럼 리스크가 큰 작업만 고품질 모델(Sonnet)
  유지 - 기존 prompt caching과 함께 적용되어 비용이 추가로 절감됨
- DB: `manual_drafts.target_doc`을 NULL 허용으로 변경(AI 판단 전에는 비어있음. Supabase SQL
  Editor에서 schema.sql "14. AI 매뉴얼: 대상 문서 AI 자동 판단" 블록 실행 필요)

## v0.5.0 - 2026-07-30

- 로그인 승인제 도입: giamicro.com 계정이면 누구나 로그인은 되지만, 관리자가 승인해야만
  대시보드에 들어갈 수 있음(승인 전에는 "승인 대기" 화면). 퇴사자 등 접근 차단도 즉시 가능
- 권한을 개발자/관리자 2단계로 구분: 개발자(johnkang@giamicro.com)는 테이블 상태와 무관하게
  항상 접근 가능, 그 외 승인된 사람은 모두 관리자로서 신규 신청 승인/거절과 기존 사용자 차단 가능
- 새 메뉴 "사용자 관리" 추가: 승인 대기/승인됨/거절됨 목록을 실시간으로 확인하고 처리
- DB: `app_users` 테이블 + `is_app_admin()` 함수 추가, 개발자 계정 자동 승인 시드
  (Supabase SQL Editor에서 schema.sql의 "13. 로그인 승인제" 블록 실행 필요)
- 메뉴/버튼에 마우스를 올렸을 때 손가락 커서와 함께 색이 바뀌도록 통일(이전에는 아무 변화가
  없어 클릭 가능한지 알기 어려웠음), 로고는 색 변화 없이 커서만 바뀌도록 유지

## v0.4.0 - 2026-07-30

- 헤더/사이드바 로고 클릭 시 홈으로 이동하도록 복구(리스트 개편 때 빠졌던 링크 연결)
- 매뉴얼 화면을 "운영계획안"/"실무자매뉴얼" 탭 구조로 개편
- 매뉴얼 항목을 구글독스처럼 서식(굵게·기울임·제목·목록) 적용하며 바로 보고 편집할 수 있는
  리치 텍스트 에디터(Tiptap) 도입 - 새 항목 추가/기존 항목 수정 모두 적용
- 발행(채택예정→매뉴얼) 시 기존 내용과 새 내용을 서식 깨지지 않게 이어붙이도록 병합 로직 개선
- PDF 생성 시 리치 텍스트 내용을 태그 없는 읽기 좋은 텍스트로 자동 변환해서 출력

## v0.3.0 - 2026-07-30

- AI 매뉴얼 메뉴 신설: 규정/매뉴얼 초안을 자유 텍스트로 작성하면 AI가 정식 문구 + 관련 법령까지 찾아
  제안함(AI매뉴얼제안 탭)에 자동 등록, 승인 시 기존 채택예정→발행 흐름 그대로 매뉴얼에 반영
- 회의록 작성/수정 화면에 "🧹 AI로 정리" 버튼 추가 - 두서없이 쓴 회의 메모를 AI가 맞춤법 교정 +
  문어체로 정리(저장 전 미리보기/수정 가능)
- 제안함에 "AI매뉴얼제안" 탭 추가(전체/사건/행사/회의/AI매뉴얼 5개 탭)
- DB: `manual_drafts` 테이블 추가, `proposals.source`에 `manual` 값 허용하도록 제약조건 확장
  (Supabase SQL Editor에서 schema.sql의 "Phase 3" 블록 실행 필요)

## v0.2.0 - 2026-07-30

- 로고 반영: 사이드바/모바일 헤더에 GIA Micro Lab 로고(가로형), 로그인 화면에 크레스트 로고(정방형) 적용
- 홈 대시보드 강화: "기록 현황"(사건/행사/회의) + "처리할 일"(제안함 대기·채택예정 대기·발행된 매뉴얼 항목) 두 그룹으로 확장
- 기록함 메뉴 신설: 기존 사건/행사/회의 3개 메뉴를 "기록함" 하나로 통합하고 탭 + 건수 카드로 전환
- 제안함에 카테고리 탭(전체/사건/행사/회의) 및 분류별 건수 표시 추가

## v0.1.0 - 2026-07-30 (최초 커밋)

- Supabase(Postgres+Auth+Realtime) + Vercel 기반 독립 웹앱으로 최초 구축 (구글 시트/문서 미사용)
- 사건/행사/회의 기록 CRUD + 실시간 동기화
- Google OAuth 로그인(giamicro.com 도메인 제한) + PIN 2차 보안
- AI 제안 워크플로우(스캔 → 제안 → 승인/보류/삭제 → 채택예정 → 발행)
- 매뉴얼(운영계획안/실무자매뉴얼) 앱 내 직접 편집(CRUD) + PDF 생성
- 모바일 반응형 전체 적용
