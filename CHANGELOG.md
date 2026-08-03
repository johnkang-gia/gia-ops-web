# CHANGELOG

이 파일은 `gia-ops-web`의 버전별 변경 이력을 기록합니다. 버전 번호는 `package.json`의
`version` 값과 항상 일치시킵니다. 업데이트할 때마다 이 파일 맨 위에 새 항목을 추가하고,
같은 내용을 GitHub Desktop의 커밋 Summary/Description에도 그대로 사용하면 됩니다.

## v0.43.1 - 2026-08-03 (staging)

리포트 작성 화면의 "뱃지 평가 안내" 문구에 영어 병기를 추가했습니다(원어민 교사 대상).

## v0.43.0 - 2026-08-03 (staging)

지난 기능 제안 중 학부모 열람 관련 항목을 제외한 나머지 6건을 반영했습니다.

- 반복 업무: 업무등록 위젯/상세패널에서 매일·매주(요일)·매월(날짜) 반복을 지정하면, 완료
  처리되는 순간 다음 회차가 자동으로 새로 등록됩니다(🔁 뱃지로 표시).
- 업무별 첨부파일: 업무 상세패널에서 파일을 첨부·다운로드·삭제할 수 있습니다.
- 채팅 공지 고정 배너: 이미 있는 메시지 고정(📌) 기능이 이 역할을 하고 있어 별도 개발 없이
  그대로 사용하시면 됩니다.
- 학기 종합 PDF: 리포트 프린트 화면에서 학생+학기를 함께 고르면, 그 학기 동안 발행된 모든
  리포트를 과목별로 모아 하나의 PDF로 볼 수 있습니다.
- 통합 검색: 사이드바(모바일은 상단)에서 학생·사건·회의·행사·업무·서류함을 한 번에 검색합니다.
  교사 계정은 기존 접근 권한과 동일하게 학생 검색 결과만 보입니다.
- 모바일 칸반 상태변경: 업무카드에 드래그 없이 바로 상태를 바꿀 수 있는 드롭다운을 추가해
  터치 환경에서도 편하게 옮길 수 있습니다.

### SQL (Supabase SQL Editor에 실행)

```sql
-- ===== 48. 반복 업무 + 업무별 첨부파일 =====
alter table tasks add column if not exists recurrence jsonb;
alter table tasks add column if not exists recurrence_group_id uuid;

create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  uploader_email text not null,
  file_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

alter table task_attachments enable row level security;

drop policy if exists "giamicro_select_task_attachments" on task_attachments;
create policy "giamicro_select_task_attachments" on task_attachments
  for select using (is_giamicro_user());

drop policy if exists "giamicro_insert_task_attachments" on task_attachments;
create policy "giamicro_insert_task_attachments" on task_attachments
  for insert with check (is_giamicro_user());

drop policy if exists "giamicro_delete_task_attachments" on task_attachments;
create policy "giamicro_delete_task_attachments" on task_attachments
  for delete using (is_giamicro_user());

insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', false)
on conflict (id) do nothing;

drop policy if exists "giamicro_read_task_files" on storage.objects;
create policy "giamicro_read_task_files" on storage.objects
  for select using (bucket_id = 'task-files' and is_giamicro_user());
drop policy if exists "giamicro_write_task_files" on storage.objects;
create policy "giamicro_write_task_files" on storage.objects
  for insert with check (bucket_id = 'task-files' and is_giamicro_user());
drop policy if exists "giamicro_delete_task_files" on storage.objects;
create policy "giamicro_delete_task_files" on storage.objects
  for delete using (bucket_id = 'task-files' and is_giamicro_user());
```

## v0.42.0 - 2026-08-03 (staging)

업무탭 편의성 + 주간 학생 관찰기록 개선 7건을 반영했습니다.

- **업무탭 레이아웃 크기 기억.** 채팅/상황판/칸반 폭·높이를 마우스로 조절하면 이 기기에
  저장되어, 다음에 업무탭에 들어와도 조절한 그대로 유지됩니다.
- **채팅 업무등록 안내를 실시간 로그로 분리.** 채팅으로 업무를 등록하면 "등록됨" 안내와
  확인 내역이 더 이상 채팅에 섞이지 않고, 칸반 오른쪽 위 "🔔 실시간 로그"에만 쌓입니다.
  로그 헤더를 클릭하면 전체 이력을 팝업으로 볼 수 있고, 채팅창은 대화만 깔끔하게 남습니다.
- **채팅 서식 툴바 아이콘화.** 굵게/기울임/취소선/코드 버튼을 글자(B/I/S) 대신 선으로 그린
  작은 아이콘으로 바꿨습니다.
- **주간 학생 관찰기록 영어 병기.** 원어민 교사도 쓰는 화면이라, 메뉴(내 담임반/내 담당과목/
  반별 작성 현황 등)와 리포트 작성창의 평가 항목·뱃지·버튼에 영어를 함께 표시했습니다.
- **학생 이름 한글/영어 줄바꿈 표시.** 학생 카드·목록·리포트창에서 영어 이름이 등록되어
  있으면 한글 이름 아래 줄바꿈으로 함께 보입니다. 관리자 화면(학생 관리)에서 학생별 영어
  이름을 입력·수정할 수 있습니다.
- **관리자/행정직원의 리포트 읽기·수정·삭제 권한.** 학생 프로필 화면에서 관리자/행정직원은
  이제 리포트를 열람만 하는 게 아니라 직접 수정하거나 삭제할 수 있습니다(삭제 버튼은
  관리자/행정직원에게만 보입니다).
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에서 실행해주세요(재실행해도 안전합니다).

```sql
-- ===== 47. 주간 학생 관찰기록 - 영문 이름 + 관리자/행정직원 삭제 권한 =====
alter table wr_students add column if not exists name_en text;

create or replace function is_wr_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    is_app_admin()
    or exists (
      select 1 from app_users
      where email = lower(auth.jwt() ->> 'email')
        and status = 'approved'
        and position = '행정직원'
    );
$$;

drop policy if exists "giamicro_all_wr_reports" on wr_reports;

drop policy if exists "giamicro_select_wr_reports" on wr_reports;
create policy "giamicro_select_wr_reports" on wr_reports
  for select using (is_giamicro_user());

drop policy if exists "giamicro_insert_wr_reports" on wr_reports;
create policy "giamicro_insert_wr_reports" on wr_reports
  for insert with check (is_giamicro_user());

drop policy if exists "giamicro_update_wr_reports" on wr_reports;
create policy "giamicro_update_wr_reports" on wr_reports
  for update using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "wr_manager_delete_wr_reports" on wr_reports;
create policy "wr_manager_delete_wr_reports" on wr_reports
  for delete using (is_wr_manager());
```

## v0.41.0 - 2026-08-03 (staging)

업무 페이지 사용성 개선 10건을 한 번에 반영했습니다.

- **업무 삭제 권한 제한.** 이제 등록자 본인 또는 관리자만 업무를 삭제할 수 있습니다(상세
  패널의 삭제 버튼이 다른 사람에게는 아예 보이지 않습니다).
- **확인 체크 시 취소선 제거.** 담당자가 업무 확인 체크박스를 누르면 제목에 줄이 그이지
  않고, 흐리게(반투명)만 표시됩니다.
- **칸반 레이아웃 개편.** 진행대기·진행중·완료 3열이 항상 위에 쾌적하게 보이고, 보류/이슈는
  "⏸️ 보류/이슈 (N)" 버튼을 눌러야 펼쳐지는 접이식 섹션으로 아래에 분리됐습니다.
- **업무를 보류로 옮기면 단순 보류인지 이슈인지 물어봅니다.** 이슈를 선택하면 메모를 남길
  수 있고, 이 메모는 업무를 공유하는 모두에게 보이며 작성자도 함께 표시됩니다.
- **나/전체/공유 색상 시스템.** 빠른 업무등록 위젯에서 고른 뱃지가 업무에 저장되고, 그 색이
  칸반 카드 테두리 색으로 그대로 쓰입니다. 색은 뱃지 옆 점을 클릭해 관리자만 바꿀 수
  있습니다(부서 색상과 동일한 방식).
- **업무 마감일 → OS 캘린더 연동.** 상세 패널의 📅 버튼을 누르면 마감 일정을 내 기기의
  기본 캘린더 앱(Mac은 Calendar.app, 그 외는 .ics 다운로드)에 바로 추가할 수 있습니다.
- **빠른 업무등록에 날짜/시간 선택 추가.** 오늘·내일·이번주 뱃지를 누르거나 날짜·시간을
  직접 입력할 수 있습니다. 날짜만 넣으면 그 날짜로, 시간만 넣으면 "오늘 그 시각까지"로,
  둘 다 넣으면 정확히 그 날짜·시각으로 마감이 등록됩니다.
- **사용 가이드 팝업 신설.** 업무 페이지 우상단 ❓ 아이콘을 누르면 빠른등록/채팅/칸반/
  업무기록/삭제·캘린더 사용법을 요약한 팝업이 뜹니다.
- **채팅 서식 툴바.** 입력창 위에 굵게(B)/기울임(I)/취소선(S)/코드(&lt;/&gt;) 버튼이 생겨,
  마크다운 문법을 직접 타이핑하지 않아도 선택한 글자를 감싸서 서식을 넣을 수 있습니다.
- **반응(이모지) 체크 표시 + 목록 확장.** 반응 고르기 팝업에서 이미 남긴 이모지에 파란
  체크 표시가 붙고, 자주 쓰는 이모지가 6개 → 12개로 늘었습니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에서 실행해주세요(재실행해도 안전합니다).

```sql
-- ===== 44. 업무 삭제 권한 분리 (등록자 본인 또는 관리자만) =====
drop policy if exists "giamicro_all_tasks" on tasks;

drop policy if exists "giamicro_select_tasks" on tasks;
create policy "giamicro_select_tasks" on tasks
  for select using (is_giamicro_user());

drop policy if exists "giamicro_insert_tasks" on tasks;
create policy "giamicro_insert_tasks" on tasks
  for insert with check (is_giamicro_user());

drop policy if exists "giamicro_update_tasks" on tasks;
create policy "giamicro_update_tasks" on tasks
  for update using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "owner_delete_tasks" on tasks;
create policy "owner_delete_tasks" on tasks
  for delete using (is_giamicro_user() and (owner_email = lower(auth.jwt() ->> 'email') or is_app_admin()));

-- ===== 45. 업무 - 등록 방식(나/전체/공유)별 색상 =====
alter table tasks add column if not exists origin_mode text not null default '공유'
  check (origin_mode in ('나', '전체', '공유'));

create table if not exists task_mode_colors (
  mode text primary key check (mode in ('나', '전체', '공유')),
  color text not null
);

insert into task_mode_colors (mode, color) values
  ('나', '#3b82f6'),
  ('전체', '#8b5cf6'),
  ('공유', '#f59e0b')
on conflict (mode) do nothing;

alter table task_mode_colors enable row level security;
drop policy if exists "giamicro_select_task_mode_colors" on task_mode_colors;
create policy "giamicro_select_task_mode_colors" on task_mode_colors
  for select using (is_giamicro_user());
drop policy if exists "admin_update_task_mode_colors" on task_mode_colors;
create policy "admin_update_task_mode_colors" on task_mode_colors
  for update using (is_app_admin()) with check (is_app_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_mode_colors'
  ) then
    alter publication supabase_realtime add table task_mode_colors;
  end if;
end $$;

-- ===== 46. 업무 코멘트 - "이슈" 메모 구분 =====
alter table task_comments add column if not exists is_issue boolean not null default false;
```

## v0.40.0 - 2026-08-03 (staging)

업무기록(archive) 기능을 새로 만들었습니다. 완료한 업무가 계속 칸반에 쌓여 있으면 "지금
해야 할 일"과 "이미 끝난 일"이 뒤섞이고, 나중에 "누가 언제 무슨 업무를 했는지" 찾아보기도
어려웠습니다. 이제 완료 → 자동 축소 → 다음날 자동 보관 → 업무기록에서 연도/학기/날짜별로
조회, 순서로 흐름이 정리됩니다.

- **완료하는 순간 카드가 제목만 남기고 줄어듭니다.** 칸반에서 업무를 완료로 옮기면 그
  즉시 설명/담당자/마감 뱃지 등이 사라지고 체크 표시 + 제목만 있는 얇은 줄로 바뀝니다.
- **다음날 자정 직후 자동으로 업무기록으로 이동합니다.** 매일 밤(학기 자동전환 크론
  바로 뒤에) 완료 상태인 업무를 업무보드에서 빼서 보관 처리하는 크론을 새로 추가했습니다.
  업무 자체(코멘트/확인 이력 등)는 지워지지 않고, 그냥 칸반에서만 안 보이게 됩니다.
- **업무기록 화면 신설.** 업무 페이지 우측 상단에 "🗂 업무기록" 아이콘을 누르면 이동합니다.
  연도 → 학기 → 날짜 순으로 접이식으로 묶여 있고, 각 업무를 펼치면 제안자(등록자)/담당자/
  완료 처리자/정시 여부와 함께, 코멘트·상태변경 이력(흐름)까지 확인할 수 있습니다. "전체
  보기"와 "내 기록"(내가 등록했거나 담당한 것만) 필터, 부서 필터를 지원합니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에서 실행해주세요(재실행해도 안전합니다).

```sql
-- ===== 42. 업무기록(archive) - 완료된 업무를 연도/학기/날짜별로 보관 =====
alter table tasks add column if not exists completed_at timestamptz;
alter table tasks add column if not exists archived_at timestamptz;
alter table tasks add column if not exists term_id uuid references terms(id) on delete set null;
create index if not exists tasks_archived_at_idx on tasks(archived_at);
create index if not exists tasks_term_id_idx on tasks(term_id);
```

- **참고: 이 기능은 매일 자정 직후(KST) 자동 실행되는 Vercel Cron에 의존합니다.**
  기존 학기 자동전환 크론과 같은 환경변수(`CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`)를
  그대로 재사용하므로 별도 설정 없이 바로 동작합니다. main에 발행(배포)된 뒤부터 매일
  밤 자동으로 쌓이기 시작하며, staging 미리보기에서는 크론이 프로덕션 스케줄로만 등록되어
  당장 눈으로 확인하려면 직접 완료 처리한 뒤 하루를 기다리시거나, Supabase에서 특정 업무의
  `archived_at`을 수동으로 채워서 업무기록 화면을 미리 확인해보실 수 있습니다.

## v0.39.2 - 2026-08-03 (staging)

- **채팅 업무등록 오류 수정.** "Could not find the 'description' column of 'tasks' in the
  schema cache" 오류는 코드 문제가 아니라, `tasks` 테이블에 `description` 컬럼을 추가하는
  SQL(v0.34에서 이미 안내드렸던 것)이 실제 DB에는 아직 적용되지 않아서 생긴 문제로
  보입니다. 아래 SQL을 Supabase SQL Editor에서 실행하면 컬럼이 없으면 추가하고, 이미 있으면
  아무 일도 하지 않습니다(재실행해도 안전). 혹시 컬럼은 있는데도 같은 오류가 계속되면
  PostgREST가 스키마 변경을 아직 못 읽은 캐시 문제일 수 있어, SQL 맨 끝에 캐시를 강제로
  새로고침하는 구문도 함께 넣었습니다.
- **홈 메뉴 재확인.** v0.39.1에서 없앤 게 맞는데, 그 변경은 staging 브랜치에만 있고 아직
  main(라이브)에는 병합되지 않아서 실제 화면에서는 계속 보이셨을 거예요. staging 미리보기
  URL에서 확인해주시면 사라져 있을 겁니다 - "발행"하시면 라이브에도 반영됩니다.
- **메뉴 순서 변경.** 가장 자주 쓰는 "업무"를 맨 위로 올리고, 그 바로 아래에 "실무자
  매뉴얼"을 뒀습니다.
- **"학교관리" → "학교 관리".** "운영 관리"처럼 띄어쓰기를 맞췄습니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에서 실행해주세요(재실행해도 안전합니다).

```sql
alter table tasks add column if not exists description text;
notify pgrst, 'reload schema';
```

## v0.39.1 - 2026-08-03

사이드바(PC)/상단바(모바일)의 로고를 누르면 이미 홈으로 이동하고 있었어서(기존부터 있던
동작), 메뉴 목록에 따로 있던 "홈" 항목은 중복이라 없앴습니다. 화면 코드/DB 변경은 없습니다.

## v0.39.0 - 2026-08-03

업무등록을 채팅과 분리했습니다. 채팅 문장을 AI가 해석해 담당자/마감일을 추측하는 방식은
문장이 애매하면 틀리기 쉽고, 실시간 채팅 트래픽에 업무 등록까지 얹혀 있었습니다. 이제
업무상황판과 채팅 사이에 항상 떠 있는 "빠른 업무등록" 위젯에서 뱃지로 담당자를 바로
지정해 등록합니다(AI를 거치지 않아 더 빠르고 항상 정확합니다):

- **빠른 업무등록 위젯 신설.** [나] 뱃지를 누르면 내 개인 업무로, [전체]를 누르면 부서원
  전원에게 배정되는 팀 업무로(모두의 "내 업무목록"에 뜹니다), [공유]를 누르면 태그 목록이
  펼쳐져서 원하는 사람만 골라 배정할 수 있습니다. 문장에 "내일까지"처럼 마감 표현이 있으면
  자동으로 인식해 마감일로 저장되고, 인식되면 입력창 옆에 바로 미리보기가 뜹니다. 🔴긴급
  뱃지로 우선순위도 바로 지정할 수 있습니다. 채팅 메시지를 클릭해서 업무로 등록하는 기존
  기능은 회의 중 나온 이야기를 놓치지 않고 바로 업무화할 때 쓰라고 그대로 남겨뒀습니다.
- **채팅창 높이 축소.** 위젯이 새로 들어간 만큼 채팅창 공간을 줄였습니다.
- **마감초과 시각적 강조 강화.** 마감이 지난 업무는 카드 테두리가 빨간색으로 바뀌고 "🔥
  지연" 뱃지가 깜빡이며, 24시간 안에 마감인 업무는 "⏰ 임박" 뱃지가 노란색으로 뜹니다.
  칸반을 하나하나 열어보지 않아도 밀리고 있는 업무가 한눈에 들어옵니다.
- **공유 업무 상태변경 실시간 알림.** 여러 명에게 태그된 업무를 한 명이 진행중/완료 등으로
  옮기면, 그 업무의 등록자와 다른 담당자들에게 "OOO님이 '제목' 업무를 '진행중'으로
  옮겼어요" 토스트 알림이 화면 우측 하단에 바로 뜹니다(본인이 직접 바꾼 경우는 알림이
  뜨지 않습니다). 눌러서 바로 그 업무 상세로 이동할 수 있습니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에 붙여넣고 실행해주세요(재실행해도
  안전합니다).

```sql
-- ===== 42. 업무 - 공유 업무 실시간 알림용 updated_by =====
-- "누가 상태를 바꿨는지" 알아야 그 사람 본인에게는 알림을 안 띄우고, 태그된 다른 사람에게만
-- 실시간 토스트로 "OOO님이 이 업무를 진행중으로 옮겼어요" 같은 알림을 보여줄 수 있습니다.
alter table tasks add column if not exists updated_by text;

-- 위 messages 테이블과 같은 이유로, UPDATE 이벤트에 이전 status 값이 함께 와야 "정말 상태가
-- 바뀐 변경인지"(단순 담당자 태그 수정이나 확인 체크 등은 제외) 클라이언트에서 구분할 수
-- 있습니다. 기본 REPLICA IDENTITY는 기본키만 old에 담아 보내 이 구분이 불가능했습니다.
alter table tasks replica identity full;
```

## v0.38.0 - 2026-08-03

지난 버전(v0.37.0) CHANGELOG에서 "저장소/조회 기능이 더 필요해서 이번 범위에는 넣지 않았다"고
미뤄뒀던 4가지 - 파일/이미지 첨부, 읽음 표시, 링크 미리보기, 메시지 검색·고정 - 를 마저
구현했습니다:

- **파일/이미지 첨부.** 입력창 왼쪽 📎 버튼으로 파일을 고르면(최대 20MB) 바로 업로드되어
  메시지로 전송됩니다. 이미지는 말풍선 안에 바로 미리보기로 뜨고, 다른 파일은 이름+용량이 적힌
  파일 칩으로 표시되며 눌러서 새 탭으로 열어볼 수 있습니다. 회의 음성/행사 사진과 같은 방식으로
  비공개 저장소에 저장되고, 열람 링크는 매번 새로 발급되는 1시간짜리 서명 URL을 씁니다.
- **읽음 표시.** 내가 보낸 메시지 옆에 "아직 안 읽은 부서원 수"가 카카오톡의 숫자처럼 표시되고,
  상대가 채팅방을 열면 실시간으로 줄어듭니다. 메시지마다 읽음 여부를 따로 저장하지 않고
  "부서원별로 마지막으로 읽은 시각"만 저장해서, 그 시각 이후에 온 메시지를 안 읽은 것으로
  계산하는 가벼운 방식을 썼습니다.
- **링크 미리보기.** 메시지에 http(s) 링크가 있으면 구글챗처럼 그 아래에 제목/설명/썸네일이 담긴
  작은 카드가 자동으로 붙습니다. 브라우저가 직접 외부 사이트에 접속하면 대부분 CORS에 막히기
  때문에, 서버가 대신 가져오는 방식이고 사설망 주소로는 접속하지 않도록 기본적인 방어를
  넣었습니다.
- **메시지 검색.** 채팅창 헤더의 🔍를 누르면 검색창이 뜨고, 입력하는 대로 그 부서 채팅방의
  메시지 내용을 검색합니다. 결과를 누르면 해당 메시지로 스크롤 이동하며 잠깐 노란색으로
  반짝여 위치를 표시해줍니다.
- **메시지 고정.** 메시지에 마우스를 올려 📌를 누르면 고정되어 채팅창 상단에 "고정된 메시지"
  바로 모입니다(카카오톡 공지처럼 부서원 누구나 고정/해제 가능). 다만 고정 여부가 아닌
  글자 내용·첨부파일 등은 여전히 작성자 본인만 고칠 수 있도록 DB 쪽에서 한 번 더 막아뒀습니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에 붙여넣고 실행해주세요(재실행해도
  안전합니다).

```sql
-- ===== 41. 채팅 - 첨부파일 / 읽음 표시 / 메시지 고정 (구글챗 스타일 기능 2차) =====

-- 41-1) 파일/이미지 첨부. 메시지당 첨부 1개로 단순화했습니다(여러 개가 필요하면 나중에 별도
-- 테이블로 확장 가능). content는 첨부만 보내고 글자는 안 쓸 수도 있어 빈 문자열을 허용합니다.
alter table messages add column if not exists attachment_path text;
alter table messages add column if not exists attachment_name text;
alter table messages add column if not exists attachment_type text;
alter table messages add column if not exists attachment_size bigint;

-- 회의 음성/행사 사진처럼 사내 파일이라 비공개 버킷으로 만들고, 조회도 signed URL로만
-- 가능하게 합니다(giamicro.com 계정이면 업로드/조회/삭제 모두 가능 - 기존 event-photos와 동일한
-- 신뢰 모델).
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', false)
on conflict (id) do nothing;

drop policy if exists "giamicro_read_chat_files" on storage.objects;
create policy "giamicro_read_chat_files" on storage.objects
  for select using (bucket_id = 'chat-files' and is_giamicro_user());
drop policy if exists "giamicro_write_chat_files" on storage.objects;
create policy "giamicro_write_chat_files" on storage.objects
  for insert with check (bucket_id = 'chat-files' and is_giamicro_user());
drop policy if exists "giamicro_delete_chat_files" on storage.objects;
create policy "giamicro_delete_chat_files" on storage.objects
  for delete using (bucket_id = 'chat-files' and is_giamicro_user());

-- 41-2) 읽음 표시. 부서 채팅방마다 "내가 여기를 마지막으로 읽은 시각"만 한 행씩 저장합니다
-- (메시지마다 읽음 여부를 따로 저장하면 데이터가 기하급수로 늘어나므로, 카카오톡처럼 "이
-- 시각 이후 메시지 = 안 읽음"으로 계산합니다).
create table if not exists message_reads (
  department text not null,
  user_email text not null,
  last_read_at timestamptz not null default now(),
  primary key (department, user_email)
);

alter table message_reads enable row level security;
drop policy if exists "giamicro_select_reads" on message_reads;
create policy "giamicro_select_reads" on message_reads
  for select using (is_giamicro_user());
drop policy if exists "self_insert_reads" on message_reads;
create policy "self_insert_reads" on message_reads
  for insert with check (is_giamicro_user() and user_email = lower(auth.jwt() ->> 'email'));
drop policy if exists "self_update_reads" on message_reads;
create policy "self_update_reads" on message_reads
  for update
  using (is_giamicro_user() and user_email = lower(auth.jwt() ->> 'email'))
  with check (is_giamicro_user() and user_email = lower(auth.jwt() ->> 'email'));

alter table message_reads replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reads'
  ) then
    alter publication supabase_realtime add table message_reads;
  end if;
end $$;

-- 41-3) 메시지 고정. 카카오톡 공지처럼 "누구든" 고정/해제할 수 있게 하려는데, 지난 버전에서
-- 만든 "author_update_own_messages" 정책은 UPDATE 자체를 작성자로만 제한하고 있어 그대로는
-- 다른 사람이 핀을 꽂을 수 없습니다. app_users 자기수정 때와 같은 패턴으로, RLS는
-- giamicro.com 계정이면 누구나 UPDATE를 시도할 수 있게 넓히고, 트리거가 "본인이 작성한
-- 메시지가 아니라면 pinned_at/pinned_by를 뺀 나머지 컬럼(글자 내용, 첨부파일, 답장 대상 등)은
-- 전부 원래 값으로 되돌리는" 방식으로 실제 수정 범위를 좁힙니다.
alter table messages add column if not exists pinned_at timestamptz;
alter table messages add column if not exists pinned_by text;

drop policy if exists "author_update_own_messages" on messages;
drop policy if exists "giamicro_update_messages" on messages;
create policy "giamicro_update_messages" on messages
  for update
  using (is_giamicro_user())
  with check (is_giamicro_user());

create or replace function protect_messages_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.author_email = lower(auth.jwt() ->> 'email') then
    return new; -- 작성자 본인 - 내용/첨부/답장/수정시각 등 전부 자유롭게 바꿀 수 있음
  end if;
  -- 작성자가 아니면 고정(pinned_at/pinned_by)만 바꿀 수 있고 나머지는 원래 값으로 되돌립니다.
  new.content := old.content;
  new.edited_at := old.edited_at;
  new.reply_to_id := old.reply_to_id;
  new.author_email := old.author_email;
  new.department := old.department;
  new.created_at := old.created_at;
  new.source_department := old.source_department;
  new.attachment_path := old.attachment_path;
  new.attachment_name := old.attachment_name;
  new.attachment_type := old.attachment_type;
  new.attachment_size := old.attachment_size;
  return new;
end;
$$;

drop trigger if exists messages_protect_update on messages;
create trigger messages_protect_update
  before update on messages
  for each row execute function protect_messages_update();
```

## v0.37.0 - 2026-08-03

업무 채팅에 구글챗 스타일 기능 대거 추가 + 삭제 UX를 카카오톡 방식으로 변경:

- **메시지 삭제 UX 변경.** 이전엔 이름 옆에 휴지통 아이콘이 있었는데, 카카오톡처럼 내가 보낸
  메시지에 마우스를 올렸을 때만 말풍선 오른쪽에 작게 ✕가 나타나도록 바꿨습니다. 누르면 확인 후
  삭제됩니다.
- **Enter로 전송, Shift+Enter로 줄바꿈.** 입력창이 한 줄짜리 input에서 여러 줄 입력 가능한
  textarea로 바뀌었고, 내용에 맞춰 높이가 자동으로 늘어납니다(최대 5줄 정도, 그 이상은 스크롤).
- **텍스트 서식.** `**굵게**`, `*기울임*`, `~~취소선~~`, `` `코드` `` 문법을 메시지에 그대로
  쓰면 서식이 적용되어 보입니다.
- **메시지 수정.** 내가 보낸 메시지에 마우스를 올리면 ✏️ 아이콘이 뜨고, 눌러서 고치고 저장하면
  "(수정됨)" 표시와 함께 반영됩니다.
- **답장(인용).** 메시지에 마우스를 올려 ↩️를 누르면 입력창 위에 원본이 미리보기로 뜨고, 그
  상태로 보내면 답장한 메시지 위에 원본이 작게 인용되어 표시됩니다.
- **이모지 반응.** 😀 아이콘을 누르면 👍❤️😂😮😢🙏 중 고를 수 있고, 메시지 아래에 반응 뱃지로
  모입니다(같은 이모지를 다시 누르면 취소). 누가 반응했는지는 마우스를 올리면 볼 수 있습니다.
- **입력 중 표시.** 다른 사람이 타이핑하고 있으면 입력창 위에 "OOO님이 입력 중..."이 뜹니다
  (3초 넘게 조용하면 사라집니다).
- **연속 메시지 그룹핑.** 같은 사람이 5분 안에 연달아 보낸 메시지는 이름/시간을 반복해서
  보여주지 않고 말풍선만 이어서 보여줘 채팅창이 덜 복잡해졌습니다.
- **채팅 업무등록 버튼 실패 원인 수정.** 업무 저장이 실패해도 결과를 확인하지 않고 팝업만
  닫아버려서 "눌렀는데 반응이 없다"로 보였던 문제를 고쳤습니다. 이제 실패하면 팝업이 안
  닫히고 이유와 "다시 시도" 버튼이 뜹니다.
- **참고로 이번엔 넣지 않은 것들:** 파일/이미지 첨부, 읽음 표시, 링크 미리보기, 메시지
  검색·고정은 구글챗에 있지만 저장소/조회 기능이 추가로 필요해서 이번 범위에는 넣지
  않았습니다. 필요하시면 다음에 이어서 추가해드릴 수 있어요.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에 붙여넣고 실행해주세요(재실행해도
  안전합니다).

```sql
alter table messages add column if not exists reply_to_id uuid references messages(id) on delete set null;
alter table messages add column if not exists edited_at timestamptz;

drop policy if exists "author_update_own_messages" on messages;
create policy "author_update_own_messages" on messages
  for update
  using (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'))
  with check (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  department text not null,
  emoji text not null,
  author_email text not null,
  created_at timestamptz not null default now(),
  unique (message_id, emoji, author_email)
);
create index if not exists message_reactions_message_idx on message_reactions(message_id);
create index if not exists message_reactions_department_idx on message_reactions(department);

alter table message_reactions enable row level security;
drop policy if exists "giamicro_select_reactions" on message_reactions;
create policy "giamicro_select_reactions" on message_reactions
  for select using (is_giamicro_user());
drop policy if exists "giamicro_insert_own_reaction" on message_reactions;
create policy "giamicro_insert_own_reaction" on message_reactions
  for insert with check (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));
drop policy if exists "author_delete_own_reaction" on message_reactions;
create policy "author_delete_own_reaction" on message_reactions
  for delete using (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));

alter table message_reactions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table message_reactions;
  end if;
end $$;
```

## v0.36.0 - 2026-08-03

업무 채팅 "업무등록" 버튼 실패 원인 수정 + 메시지 본인 삭제 기능:

- **채팅 "업무등록" 버튼을 눌러도 등록이 안 되던 문제 수정.** 원인은 등록 로직 자체가 아니라
  오류 처리 방식이었습니다 - AI 분석이 실패해도 규칙 기반으로 대체되니 문제가 아니었고, 그 다음
  단계인 실제 업무 저장(`tasks` 테이블 insert)이 실패했을 때 결과를 확인하지 않고 그냥 팝업을
  닫아버려서, 저장이 안 됐는데도 화면에는 아무 표시가 없어 "눌렀는데 반응이 없다"로 보였던
  것입니다. 이제 저장 단계 전체를 try/catch로 감싸고 실패하면 팝업이 닫히지 않고 이유를
  보여주며 "다시 시도" 버튼을 제공합니다(콘솔에도 원인을 로그로 남겨서 이후에도 진단하기
  쉽게 했습니다).
- **채팅 메시지 본인 삭제 기능 추가.** 메시지에 마우스를 올리면(내가 보낸 메시지에만) 오른쪽에
  🗑️ 아이콘이 나타나고, 눌러서 확인하면 삭제됩니다. DB 쪽도 함께 손봤습니다 - 기존에는
  giamicro.com 계정이면 누구나 다른 사람 메시지도 지울 수 있었는데(정책이 select/insert/
  delete를 구분하지 않고 전부 열려 있었음), 이제 삭제는 "보낸 사람 본인"만 가능하도록
  좁혔고, 메시지 작성도 본인 이메일로만 가능하도록 함께 막았습니다(다른 사람 이름으로 보내는
  것 방지). 실시간 삭제 반영을 위해 메시지 테이블의 REPLICA IDENTITY도 FULL로 바꿔서, 삭제
  이벤트가 다른 접속자 화면에도 department 필터를 타고 정상적으로 전달되도록 했습니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에 붙여넣고 실행해주세요(재실행해도
  안전합니다).

```sql
drop policy if exists "giamicro_all_messages" on messages;

drop policy if exists "giamicro_select_messages" on messages;
create policy "giamicro_select_messages" on messages
  for select using (is_giamicro_user());

drop policy if exists "giamicro_insert_own_messages" on messages;
create policy "giamicro_insert_own_messages" on messages
  for insert with check (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));

drop policy if exists "author_delete_own_messages" on messages;
create policy "author_delete_own_messages" on messages
  for delete using (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));

alter table messages replica identity full;
```

## v0.35.0 - 2026-08-02

내 계정 설정(프로필 사진/이름) + 직위(권한) 뱃지 표시 + 관리자의 직위 편집 + 담당자 자동 채움을 이름으로 전환:

- **내 계정 설정 화면 신설(`/account`).** 사이드바 하단 프로필을 누르면 이동하는 새 화면으로,
  프로필 사진과 이름을 스스로 바꿀 수 있습니다. 사진은 공개 스토리지 버킷(`avatars`)에 올라가고
  계정당 파일명이 고정돼(upsert) 바꿀 때마다 예전 파일이 쌓이지 않습니다.
- **직위(권한) 뱃지는 자유 입력이 아니라, 우리 권한 체계 그대로 보여주는 읽기 전용 값입니다.**
  `position`(교사/행정직원/관리자/개발자)은 layout.tsx의 메뉴 접근 권한 판단에 직접 쓰이는 값이자
  사이드바 뱃지에 그대로 노출되는 값이기도 합니다. 계정 설정 화면에는 이 값을 뱃지로 "표시"만
  하고, 실제로 바꾸는 기능은 넣지 않았습니다 - 직위는 승인 신청이 들어왔을 때(또는 그 이후
  언제든) 관리자 이상 권한을 가진 사람이 [학교관리 &gt; 사용자 관리]에서 지정/변경합니다.
  이번 업데이트로 그 화면에서 대기 중인 신청자와 이미 승인된 직원 모두의 직위를 관리자가 직접
  선택할 수 있게 됐고(이전엔 온보딩 때 본인이 고른 값이 그대로 굳어 있었습니다), 직위를
  지정해야만 승인 버튼이 활성화되도록 했습니다. 이름/사진은 온보딩 이후에도 본인이 계속 고칠 수
  있도록 관련 DB 정책(RLS)을 넓혔고, 관리자가 아닌 사람이 `position`/`email`/`status`/
  `decided_at`/`decided_by`를 함께 바꾸려는 시도는 트리거가 항상 원래 값으로 되돌립니다(권한
  상승 방지).
- **사이드바 프로필 블록 개편.** 로고 아래 학기 배지 밑에 있던 한 줄짜리 이메일 표시를, 프로필
  사진 + "이름(직위)" + 그 아래 작은 글씨로 로그인 이메일을 보여주는 카드로 바꿨습니다. 예:
  "강경원 (개발자)" 위, "one2k87@gmail.com" 아래. 클릭하면 내 계정 설정으로 이동합니다. 교사
  계정도 이 프로필 카드는 볼 수 있고(교사는 다른 메뉴가 다 가려져 있지만 자기 계정 설정은
  예외로 열어뒀습니다), 사이드바가 없는 모바일 상단 헤더는 이번에는 손대지 않았습니다.
- **사건기록 담당자 자동 채움을 이메일 대신 이름으로.** 새 사건을 작성할 때 담당자 칸에
  자동으로 채워지던 로그인 이메일을, 내 계정 설정에서 정한 이름(없으면 이메일)으로 바꿨습니다.
  물론 자유 텍스트라 필요하면 그대로 고쳐 쓸 수 있습니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에 붙여넣고 실행해주세요(재실행해도 안전합니다 -
  이미 적용됐다면 대부분 건너뜁니다).

```sql
alter table app_users add column if not exists avatar_url text;

drop policy if exists "app_users_update_self_onboarding" on app_users;
drop policy if exists "app_users_update_self" on app_users;
create policy "app_users_update_self" on app_users
  for update
  using (email = lower(auth.jwt() ->> 'email'))
  with check (email = lower(auth.jwt() ->> 'email'));

create or replace function protect_app_users_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_app_admin() then
    return new;
  end if;
  new.email := old.email;
  new.status := old.status;
  new.decided_at := old.decided_at;
  new.decided_by := old.decided_by;
  new.position := old.position;
  return new;
end;
$$;

drop trigger if exists app_users_protect_self_update on app_users;
create trigger app_users_protect_self_update
  before update on app_users
  for each row execute function protect_app_users_self_update();

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "public_read_avatars" on storage.objects;
create policy "public_read_avatars" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "giamicro_write_avatars" on storage.objects;
create policy "giamicro_write_avatars" on storage.objects
  for insert with check (bucket_id = 'avatars' and is_giamicro_user());

drop policy if exists "giamicro_update_avatars" on storage.objects;
create policy "giamicro_update_avatars" on storage.objects
  for update using (bucket_id = 'avatars' and is_giamicro_user());

drop policy if exists "giamicro_delete_avatars" on storage.objects;
create policy "giamicro_delete_avatars" on storage.objects
  for delete using (bucket_id = 'avatars' and is_giamicro_user());
```

(직전에 안내드렸던 버전은 "표시 직함"을 자유 입력으로 따로 두는 설계였는데, 말씀하신 대로 직위는
권한 체계 자체를 보여주는 값이라 자유 입력이 아니라 관리자가 지정하는 읽기 전용 값으로 바꿨습니다.
아직 이전 SQL을 실행하지 않으셨다면 위 버전만 실행하시면 됩니다. 혹시 이미 이전 버전을 실행해서
`app_users.title` 컬럼이 있어도 지금은 코드에서 쓰지 않으니 그대로 두셔도 무해합니다.)

## v0.34.0 - 2026-08-02

"위클리 리포트" 한글 개칭 + 학교관리 메뉴 통합 + 반별 작성 현황 위젯 + 통합 검색:

- **"위클리 리포트" → "주간 학생 관찰기록"으로 개칭.** 사이드바 메뉴명, 페이지 제목, PDF
  표지/푸터 등 화면에 보이는 텍스트를 전부 바꿨습니다. 라우트(`/weekly-report/*`)와 내부
  코드는 그대로라 기존 북마크/링크는 영향 없습니다.
- **"학교관리" 메뉴 신설(통합 관리).** 학생/반/학기/교직원 계정 관리가 운영관리·주간 학생
  관찰기록·지원관리 세 군데에 흩어져 있었고, 특히 "학기"는 두 곳에 중복으로 있었습니다.
  이제 사이드바에 "학교관리" 카테고리를 새로 만들어 학생 정보 조회 · 학생 관리 · 반 관리 ·
  과목반 세팅 · 학기 관리 · 사용자 관리를 한곳에 모았습니다(권한 기준은 기존과 동일 - 반/과목/
  학생 명부/사용자 관리는 관리자만, 학기·학생 정보 조회는 행정직원 이상 누구나).
- **반별 작성 현황 위젯 화면.** "주간 학생 관찰기록" 메뉴에 들어가면 이제 맨 위에 현재 학기가
  크게 표시되고, 그 아래 반마다 위젯 카드가 나옵니다. 위젯 안에는 그 반 학생 리스트와 이번 주
  담임 리포트 작성 여부 뱃지(✅ 발행됨 / 📝 임시저장 / 미작성)가 한눈에 보이고, 카드 우측 상단에
  "8/12 작성" 식으로 반 전체 진행률도 표시됩니다. 학생을 클릭하면 바로 열람·수정할 수 있습니다
  (관리자 권한으로 모든 과목 탭 열람 가능). 반 미배정 학생은 별도 위젯으로 모아 보여주고,
  예전 표 형태 화면은 "전체 목록" 탭으로 그대로 남겨뒀습니다.
- **연도-학기-학년-반 통합 검색.** 주간 학생 관찰기록 통계 화면 하단에 검색 패널을 추가해,
  연도·학기 / 학년 / 반 조건으로 그동안 쌓인 리포트를 바로 찾아볼 수 있습니다. 이를 위해
  `wr_reports`에 작성 시점 학년/반 스냅샷 컬럼(`class_id`, `grade`)을 추가하고 기존 기록에도
  소급 반영했습니다(재학 이력이 있으면 그 기준, 없으면 학생의 현재 학년/반 기준) - 앞으로 반이
  바뀌어도 과거 리포트의 반 기록은 그대로 남습니다.
- **DB 변경 있음.** 아래 SQL을 Supabase SQL Editor에 붙여넣고 실행해주세요(재실행해도
  안전합니다 - 전체 `supabase/schema.sql`에도 반영되어 있습니다).

```sql
alter table wr_reports add column if not exists class_id uuid references wr_classes(id) on delete set null;
alter table wr_reports add column if not exists grade text;
create index if not exists wr_reports_term_grade_class_idx on wr_reports(term_id, grade, class_id);

update wr_reports r
set class_id = coalesce(
    (select we.class_id from wr_enrollments we
     where we.student_id = r.student_id and we.term_id is not distinct from r.term_id
     limit 1),
    (select ws.class_id from wr_students ws where ws.id = r.student_id)
  ),
  grade = coalesce(
    (select we.grade from wr_enrollments we
     where we.student_id = r.student_id and we.term_id is not distinct from r.term_id
     limit 1),
    (select ws.grade from wr_students ws where ws.id = r.student_id)
  )
where r.class_id is null
  and r.grade is null
  and exists (select 1 from wr_students ws where ws.id = r.student_id);
```

(처음 드렸던 SQL의 UPDATE 문에 문법 오류가 있어 `42P01` 에러가 났었습니다 - 위 버전으로 다시
실행해주세요. `alter table`/`create index`는 재실행해도 안전하고, 이미 컬럼이 추가돼 있었다면
그 부분은 건너뛰고 UPDATE만 다시 실행됩니다.)

## v0.33.1 - 2026-08-02

전체 빌드 점검 + 로고 이미지 최적화:

- **빌드 전수 점검.** 클린 환경에서 `npm install` + `npm run build`를 다시 실행해 타입 에러,
  라우트 충돌(경로 중복 등), 머지 마커 잔재 여부를 확인했습니다 - 전부 정상이었고, 빌드는
  약 11초, 클라이언트로 나가는 JS는 전체 라우트 합쳐서 1.7MB 수준으로 확인했습니다.
- **사이드바/로그인 화면 로고 이미지 용량 축소 (핵심 개선).** `logo-main.png`가 실제 화면
  표시 크기(가로 40px)보다 훨씬 큰 원본(5907×1317px, 224KB)으로 들어가 있어서 대시보드
  화면에 들어갈 때마다 불필요하게 큰 파일을 내려받고 있었습니다. 화면에 보이는 최대 크기의
  3배(레티나 디스플레이 대응) 정도로 다시 리사이즈해서 224KB → 43KB(약 81% 감소)로
  줄였고, 로그인/온보딩 화면의 `logo-login.png`도 108KB → 63KB로 줄였습니다. 화질 차이는
  실제 표시 크기에서 육안으로 구분되지 않습니다.
- 그 외 코드 전반(중복 쿼리, 실시간 구독 정리, 브라우저 Supabase 클라이언트 싱글턴 등)은
  이전 점검(v0.33.0, 그 이전 성능 점검들)에서 이미 정리되어 있어 추가로 손댈 부분은
  없었습니다.
- DB 스키마 변경 없음.

## v0.33.0 - 2026-08-02

탭/메뉴 전환 속도 개선을 위한 코드 통합 및 최적화:

- **로그인 사용자 정보 조회를 요청 단위로 통합.** 지금까지는 사이드바(레이아웃)와 각 페이지가
  탭을 옮길 때마다 "로그인 확인 + app_users에서 이름/직위 조회"를 각자 따로 실행해서, 같은
  사람 정보를 같은 화면 전환 안에서 두 번 묻는 셈이었습니다. React의 요청 스코프 캐시(`cache()`)로
  감싼 공용 헬퍼(`getCurrentAppUser`)를 새로 만들어 레이아웃과 학생 조회·관리자 대시보드·업무·
  위클리 리포트 등 18개 페이지에 적용했습니다 - 같은 화면 전환 안에서는 실제 DB 조회가 딱 한
  번만 일어나고 나머지는 그 결과를 재사용합니다. 업무 페이지는 이 과정에서 중복 조회 쿼리
  하나를 완전히 제거했습니다.
- **탭 전환 시 즉시 반응하는 로딩 화면 추가.** 지금까지는 페이지를 클릭한 뒤 새 화면의 데이터가
  도착하기까지 화면이 하얗게 비어 있었는데, 대시보드 전 영역에 공통 로딩 스켈레톤을 추가해
  전환 순간부터 바로 반응하는 것처럼 느껴지도록 했습니다(실제 데이터 조회 시간 자체가
  줄어드는 건 아니지만 체감 속도는 확실히 개선됩니다).
- 그 외 미들웨어 인증 캐싱, 라우트별 코드 스플리팅(리치 텍스트 에디터·PDF 생성 등)은 이전
  점검에서 이미 최적화되어 있음을 재확인했고, 추가로 손댈 부분은 없었습니다.
- DB 스키마 변경 없음.

## v0.32.1 - 2026-08-02

채팅 "업무등록" 팝업 위치/크기 개선:

- 메시지 아래로 뜨면서 바로 다음 메시지를 가리던 문제를 고쳐, 이제 메시지 오른쪽 옆에 작게
  붙습니다(채팅창을 좁게 줄여 오른쪽 공간이 부족할 땐 자동으로 왼쪽에 붙습니다).
- 라벨을 "📋 업무로 등록 (AI 분석)"에서 "📋 업무등록"으로 간단하게 줄였습니다.
- 팝업 크기와 글씨(11px)를 채팅 말풍선(13px)보다 뚜렷하게 작게 만들어서, 실제 채팅 내용과
  헷갈리지 않고 조작 버튼이라는 게 한눈에 구별되도록 했습니다.
- DB 스키마 변경 없음.

## v0.32.0 - 2026-08-02

업무 상황판 위젯 축소 + 채팅 메시지 클릭 → AI 분석 업무등록 + 실시간 채팅 점검:

- **업무 상황판 위젯을 텍스트 크기에 맞게 축소.** 숫자 배지 한 줄뿐인데도 공간을 많이 차지하던
  것을 더 작게 줄이고, 그만큼 채팅창을 키웠습니다(왼쪽 컬럼 기본 비율: 상황판 14% / 채팅 86%,
  드래그로 계속 조절 가능). 오른쪽(내 업무목록+칸반)은 요청대로 그대로 뒀습니다.
- **채팅 자동 업무등록 → 클릭해서 AI가 분석하는 방식으로 전환.** "@담당자를 태그하면 자동으로
  업무 등록"은 실시간 채팅이 활발해지면 잡담까지 전부 업무화될 위험이 있어 방식을 바꿨습니다.
  이제 채팅 메시지를 클릭하면 "📋 업무로 등록 (AI 분석)" 작은 팝업이 뜨고, 눌러야만 AI가 그
  메시지 하나를 분석해서 제목·담당자·마감일·긴급도를 뽑아 업무로 등록합니다(등록 안내
  메시지 자체는 클릭해도 반응하지 않습니다). AI 호출이 실패해도 기존 규칙 기반 파서로 대체
  등록되어 기능이 끊기지 않습니다. AI 분석에는 저렴한 모델(Haiku)을 사용합니다.
  - 새 API: `POST /api/ai/analyze-task`.
- **실시간 채팅 점검.** messages 테이블의 realtime 발행/RLS(도메인 기반 giamicro.com 계정
  전체 허용)는 정상이었습니다. 다만 연결이 잠깐 끊겼다가 재연결되는 경우(와이파이 전환,
  절전 복귀 등) 끊겨 있던 동안의 메시지를 놓칠 수 있는 허점이 있어, 재연결 시 최근 메시지를
  자동으로 다시 불러오도록 보완했습니다. 채팅창 상단에 "🟢 실시간 연결됨 / 🟡 재연결 중..."
  표시를 추가해 연결 상태를 눈으로 확인할 수 있습니다.
- **DB 스키마 변경 없음** - 기존 tasks.description/assignee_emails, messages realtime 설정을
  그대로 사용합니다.

## v0.31.0 - 2026-08-02

전 화면 게시판형 페이지네이션 도입 + 사이드바 메뉴 구분선 + 달력 위젯 축소:

- **목록 화면들을 스크롤 대신 "1 2 3" 페이지 번호로.** 사건기록/회의기록/행사기록/제안함/
  채택예정/매뉴얼/서류함/문의및건의사항/사용자 관리/학생 검색/학기/위클리 리포트 관리(학생
  명부·반 배정·과목반) 화면 모두, 목록이 아래로 계속 늘어나며 스크롤되던 것을 화면 높이에
  맞춰 고정하고 목록 아래에 게시판형 페이지 번호(‹ 이전 · 1 2 3 … · 다음 ›)를 붙였습니다.
  화면당 항목 수는 목록 성격에 맞춰 8~15개로 다르게 잡았습니다. 검색어나 탭을 바꾸면 항상
  1페이지로 돌아갑니다. 학생 검색처럼 검색어가 비어 있으면 전체 명단이 한번에 그려지던
  화면도 이제 페이지네이션이 적용됩니다.
  - 서류함은 "확인 필요" 항목만 예외로 전체 노출(급한 항목은 페이지를 넘기지 않아도 바로
    보여야 하므로), 나머지 목록만 페이지네이션됩니다.
  - 공용 `Pagination` 컴포넌트(`src/components/Pagination.tsx`)로 통일해서, 다음에 새 목록
    화면을 만들 때도 같은 방식으로 바로 붙일 수 있습니다.
- **사이드바 메뉴에 얇은 구분선 복원.** 플라이아웃으로 평평하게 펼쳐지면서 사라졌던 메뉴
  그룹 간 구분이 안 보이던 문제를, 각 메뉴 항목 사이에 얇은 실선을 넣어 다시 구분되게
  했습니다.
- **사이드바 달력+시계 위젯을 더 작게, 위젯답게.** 셀 크기와 간격을 더 줄이고 테두리+옅은
  배경을 넣어 카드형 위젯처럼 보이게 다듬었습니다. 시간 표시는 초 단위까지 나옵니다.
- **DB 스키마 변경 없음** - 전부 화면 레이아웃/컴포넌트 구성 변경입니다.

## v0.30.0 - 2026-08-02

사이드바 달력 상시표시 + 실무자매뉴얼 독립 메뉴화 + 전화 응대용 매뉴얼·학생 통합 조회 화면:

- **달력+시계를 왼쪽 메뉴에 항상 표시.** 홈 화면에만 있던 큰 달력/시계 위젯을 축소판으로 만들어
  왼쪽 사이드바(로고 아래, 메뉴 위)에 항상 떠 있게 옮겼습니다. 어느 화면에 있든 오늘 날짜·시간을
  바로 볼 수 있고, 날짜를 클릭하면 기존처럼 OS 기본 캘린더 앱과 연동됩니다(공휴일 표시 포함).
  홈 화면에서는 중복이라 제거했습니다.
- **실무자매뉴얼을 독립 메뉴로 분리.** "운영 관리" 하위 플라이아웃에 묻혀 있던 실무자매뉴얼을
  꺼내서 홈과 업무 사이에 바로 보이는 최상단 메뉴로 옮겼습니다. 전화 응대 중 클릭 한 번으로
  바로 열 수 있습니다.
- **실무자매뉴얼 화면을 반으로 나눠 매뉴얼+학생 조회를 동시에.** 왼쪽은 기존 매뉴얼 검색, 오른쪽은
  새로 추가된 학생 검색 위젯입니다. 학생 이름이나 학번을 검색하면 페이지 이동 없이 바로 옆에서
  기본 인적사항(생년월일·연락처·보호자 연락처·주소)·학적 이력·관련 사건기록·위클리 리포트
  이력을 확인할 수 있어서, 전화를 받으면서 매뉴얼과 학생 정보를 동시에 훑어볼 수 있습니다.
  더 자세한 업무/채팅 언급 내역이 필요하면 "전체 프로필 페이지 열기"로 기존 학생 통합 프로필
  화면으로 이동할 수 있습니다.
- **DB 스키마 변경 없음** - `/api/students/[id]` API 라우트를 새로 추가해 기존 `/students/[id]`
  페이지가 쓰던 조회 로직을 재사용했습니다(권한 체크 동일: 관리자/행정직원/개발자).

## v0.29.2 - 2026-08-02

업무 탭 레이아웃 2차 개편 - 상황판 초압축(숫자+팝업) + 채팅 3:7 + "내 업무목록" 위젯 + 가로 칸반:

- **상단 헤더 통합.** 부서탭 바 위/아래로 나뉘어 있던 "[부서명] 전용 업무 및 소통 공간" 안내
  헤더를 없애고, 맨 위 부서탭 바 하나로 합쳐서 세로 공간을 줄였습니다.
- **업무 상황판을 숫자 배지 한 줄로 초압축.** 카드를 늘어놓던 기존 방식 대신, "전체/진행&대기/
  보류&이슈/완료"를 숫자 배지 한 줄로만 보여줍니다. 배지를 클릭하면 그 상태의 업무 목록이 팝업
  으로 뜨고(사이드바 부메뉴와 같은 방식 - document.body에 그려서 절대 잘리지 않음), 목록에서
  업무를 클릭하면 바로 상세 패널이 열립니다.
- **왼쪽 컬럼 세로 비율 3:7 고정(상황판:채팅).** 상황판은 작게, 채팅은 크게 - 경계선을 드래그
  하면 비율을 자유롭게 조절할 수 있습니다.
- **오른쪽에 "내 업무목록" 위젯 신설.** 나에게 배정된, 완료되지 않은 업무만 마감 임박순으로
  모아 보여줍니다. 클릭하면 상세 패널이 열립니다.
- **그 아래 칸반보드(진행대기/진행중/보류·이슈/완료)를 가로로 나란히 배치.** 화면이 넓을 땐
  4개 상태 컬럼이 옆으로 나란히 놓여 진짜 칸반보드처럼 카드를 끌어다 놓을 수 있고, 좁아지면
  자동으로 1~2열로 줄어듭니다(드래그앤드롭 기능 자체는 기존과 동일).
- DB 스키마 변경은 없습니다(화면 레이아웃/컴포넌트 구성 변경).

## v0.29.1 - 2026-08-02

업무 탭 UX 개선 - 부메뉴 팝업화 + 채팅 중심 레이아웃 + 채팅만으로 업무등록(마감기한 자동 인식):

- **사이드바 부메뉴가 진짜 팝업으로 뜨도록 수정.** 부메뉴가 사이드바 내부에 그대로 펼쳐지면서
  스크롤이 생기던 문제를 고쳤습니다. 이제 부메뉴는 `document.body`에 직접 그려지는 진짜
  팝업(플로팅 패널)이라, 사이드바가 아무리 길어도 절대 잘리거나 스크롤을 만들지 않습니다.
- **업무 탭 레이아웃을 채팅 중심으로 재조정.** 업무 상황판과 칸반보드(업무목록)는 참고용이라
  작게, 실제로 업무를 처리하고 소통하는 채팅창은 크게 배치했습니다(왼쪽 상황판+칸반 : 오른쪽
  채팅 = 대략 3:7). 경계선을 드래그하면 비율을 자유롭게 조절할 수 있습니다.
- **"+ 새 업무" 버튼/입력폼을 없앴습니다.** 업무 등록은 이제 채팅창에 메시지를 치는 것만으로
  이루어집니다(기존에도 있던 기능이지만, 버튼식 입력창이 따로 있어 헷갈렸던 부분을 정리해
  채팅 한 곳으로 통일했습니다).
- **채팅 업무등록에 마감기한 자연어 인식 추가.** 채팅에 `@강경원 내일까지 이서아 입금확인해
  주세요`라고 치면, @강경원님의 업무목록에 제목 "이서아 입금확인", 마감 "내일"로 자동 등록되고
  채팅에도 "✅ 업무로 등록됨 → 강경원님 태그: "이서아 입금확인" (내일)"로 바로 안내됩니다.
  오늘/내일/모레/글피, "이번주·다음주 O요일까지", "N일 후까지", "O월 O일까지" 형태를 인식하고,
  "~해주세요/~부탁드립니다" 같은 요청형 어미는 제목에서 자동으로 지워집니다. DB 스키마 변경은
  없습니다(기존 tasks.due_at 컬럼을 그대로 사용).

## v0.29.0 - 2026-08-01

통합 인물관리 시스템 - 학생 영구 고유번호 도입 + 연도/학기 통합 + 사건기록-학생 구조적 연결 +
학생 정보 조회 화면 신규:

**동명이인 구분 방법**: 이름만으로는 같은 이름의 학생(예: 김재이가 1A/1C/2J 세 반에 있음)을
구분할 수 없어서, 실제 학교 현장에서 쓰는 "학번" 방식을 그대로 들여왔습니다. 학생이 처음
등록되는 순간 `GIA-2026-0001` 형식의 영구 고유번호(student_no)가 자동으로 한 번 부여되고,
이후 이름이 바뀌든 학년·반이 바뀌든 절대 바뀌지 않습니다. 업무·사건기록·위클리 리포트 세
영역 모두 이제 이 고유번호(정확히는 그것과 묶인 학생 레코드의 id)를 기준으로 같은 학생을
가리키게 됩니다 - "강여명 어머니께서"라는 문구가 나와도, 그 강여명이 어느 학생인지는 화면에서
직접 골라서 정확히 연결해야 합니다(이름만으로는 시스템이 자동으로 확신할 수 없기 때문입니다).

- **학생 영구 고유번호(student_no).** 기존 114명 전원에게 일괄로 GIA-2026-0001 ~ GIA-2026-0114
  번호를 부여했습니다. 신규 등록되는 학생은 등록 시점 연도로 자동 채번됩니다.
- **학생 인적/학적사항 확장.** 생년월일·학생 연락처·주소 컬럼을 추가했고, 반(wr_classes)과도
  FK로 연결해 담임선생님을 안정적으로 조회할 수 있게 했습니다.
- **연도>학기(정규학기+캠프)>학생/교직원 통합 분류체계.** 위클리 리포트가 따로 쓰던 학기
  테이블(wr_terms)을 없애고, 운영(gia-ops)이 쓰던 학기 테이블(terms - 연도+학기유형: 1학기/
  2학기/3학기/여름캠프1/여름캠프2/겨울캠프1/겨울캠프2)로 완전히 통합했습니다. 이제 학기 관리는
  [학기] 화면 하나에서만 하면 되고, 위클리 리포트도 같은 학기 기준으로 움직입니다.
  - **재학 이력(wr_enrollments) 신설.** "몇년도 어느 학기에 이 학생이 몇학년 몇반, 담임은
    누구였는지"를 스냅샷으로 남기는 이력 테이블입니다. 현재 재적생 전원에 대해 지금 진행중인
    학기 기준 스냅샷을 한 건씩 만들어 이력을 시작했습니다.
- **사건기록 ↔ 학생 구조적 연결.** 사건 입력/수정 화면에 "관련 학생(정확히 연결)" 검색창을
  추가했습니다. 이름을 검색하면 학년·반·학번까지 함께 보여줘서 동명이인 중 정확한 학생을 골라
  연결할 수 있고, 기존 자유 텍스트(쉼표 구분 이름) 필드는 메모용으로 그대로 남겨뒀습니다.
- **직위체계 정리.** '교직원'이라는 모호한 표현을 '행정직원'으로 명확히 했습니다(교사/행정직원/
  관리자 3단계 + 개발자는 별도 최고권한, 실제 권한 로직은 바뀌지 않았습니다 - 표현만 정리).
- **학생 정보 조회(통합 프로필) 화면 신규 - `/students`.** 행정직원/관리자(+개발자)만 접근
  가능합니다. 이름이나 학번으로 검색하면 그 학생의 기본 인적사항, 학적 이력(연도·학기별
  학년/반/담임), 관련 사건기록, 위클리 리포트 이력, 그리고 업무/코멘트/채팅에서 그 학생 이름이
  언급된 내역(텍스트 검색 기반 참고용)까지 한 화면에서 볼 수 있습니다. 사이드바 [지원 · 관리]
  카테고리에 "학생 정보 조회" 메뉴가 추가됐습니다.

Supabase SQL Editor에 아래 SQL을 붙여넣고 실행해주세요(재실행해도 안전합니다).

```sql
-- ===== 36. 통합 인물관리(학생 영구 고유번호 + 연도/학기 통합 + 사건-학생 연결) =====
-- "업무·기록·생활(위클리 리포트) 세 영역에서 같은 학생/직원은 항상 같은 고유번호로 관리되어야
-- 한다"는 요청을 반영한 마이그레이션입니다. 동명이인(예: 김재이가 3개 반에 존재) 문제를
-- 이름이 아니라 영구 고유번호(student_no)로 해결하고, 연도별·학기별(정규학기+캠프) 재학
-- 이력을 남기고, 사건기록이 학생 이름 텍스트가 아니라 실제 학생 레코드를 가리키도록 합니다.

-- 36-1) 직위체계 정리: '교직원'(모호한 표현) → '행정직원'으로 명확화.
--       (교사/행정직원/관리자 3단계 + 개발자는 이 체계와 무관하게 완전 별도 최고권한)
update app_users set position = '행정직원' where position = '교직원';
alter table app_users drop constraint if exists app_users_position_check;
alter table app_users add constraint app_users_position_check
  check (position in ('교사', '행정직원', '관리자', '개발자'));

-- 36-2) 학생 영구 고유번호(student_no) + 기본 인적사항 확장 + 학급 FK 연결.
--       student_no는 한 번 부여되면 학년/반/이름이 바뀌어도 절대 바뀌지 않는 내부 식별자입니다.
create sequence if not exists wr_student_no_seq;

alter table wr_students add column if not exists student_no text;
alter table wr_students add column if not exists birth_date date;
alter table wr_students add column if not exists phone text;
alter table wr_students add column if not exists address text;
alter table wr_students add column if not exists class_id uuid references wr_classes(id) on delete set null;

-- 이미 등록된 학생들에게 일괄 채번합니다(입학연도를 알 수 없어 이번 이관 연도 2026으로 표기 -
-- 이후 신규 등록되는 학생은 실제 등록 시점 연도로 자동 채번됩니다).
update wr_students
set student_no = 'GIA-2026-' || lpad(nextval('wr_student_no_seq')::text, 4, '0')
where student_no is null;

alter table wr_students alter column student_no set default
  ('GIA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('wr_student_no_seq')::text, 4, '0'));
alter table wr_students alter column student_no set not null;
create unique index if not exists wr_students_student_no_idx on wr_students(student_no);

-- grade/class_name 텍스트 필드는 기존 화면 호환을 위해 그대로 두고, class_id로 wr_classes와도
-- 연결해 담임선생님을 텍스트 매칭이 아닌 FK로 안정적으로 조회할 수 있게 합니다.
update wr_students ws
set class_id = wc.id
from wr_classes wc
where ws.class_id is null and ws.grade = wc.grade and ws.class_name = wc.class_name;

-- 36-3) 연도>학기(정규학기+캠프) 통합: 위클리 리포트도 운영(gia-ops)과 같은 terms 테이블을
--       씁니다(더 이상 wr_terms를 따로 쓰지 않습니다). terms.term_type은 자유 입력이지만
--       화면에서는 1학기/2학기/3학기/여름캠프1/여름캠프2/겨울캠프1/겨울캠프2를 기본 선택지로
--       제공합니다. wr_reports가 참조하던 wr_terms를 terms로 재연결합니다.
alter table wr_reports drop constraint if exists wr_reports_term_id_fkey;
alter table wr_reports add constraint wr_reports_term_id_fkey
  foreign key (term_id) references terms(id) on delete set null;

-- wr_terms는 이제 쓰이지 않습니다(운영 학기 terms로 완전히 통합) - 안전하게 제거합니다.
drop table if exists wr_terms cascade;

-- 36-4) 재학 이력(wr_enrollments): "몇년도 어느 학기에 이 학생이 몇학년 몇반, 담임은 누구였는지"를
--       스냅샷으로 남기는 이력 테이블입니다. wr_students.grade/class_name(현재값)과 별개로,
--       학기가 바뀔 때마다 새 행을 추가해 나가면 됩니다.
create table if not exists wr_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references wr_students(id) on delete cascade,
  term_id uuid references terms(id) on delete set null,
  grade text,
  class_id uuid references wr_classes(id) on delete set null,
  homeroom_teacher_email text,
  created_at timestamptz not null default now(),
  unique (student_id, term_id)
);
create index if not exists wr_enrollments_student_idx on wr_enrollments(student_id);
create index if not exists wr_enrollments_term_idx on wr_enrollments(term_id);

alter table wr_enrollments enable row level security;
drop policy if exists "giamicro_all_wr_enrollments" on wr_enrollments;
create policy "giamicro_all_wr_enrollments" on wr_enrollments
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- 현재 재학생 전원에 대해, 지금 진행중인 학기(있다면) 기준 스냅샷을 한 건씩 만들어 이력을
-- 시작합니다. 진행중인 학기가 없으면 term_id는 null로 남고, 나중에 학기가 생기면 관리자가
-- [학생 정보 조회] 화면에서 새 학기 스냅샷을 추가하면 됩니다.
insert into wr_enrollments (student_id, term_id, grade, class_id, homeroom_teacher_email)
select ws.id,
       (select id from terms where status = '진행중' order by start_date desc nulls last limit 1),
       ws.grade, ws.class_id, wc.teacher_email
from wr_students ws
left join wr_classes wc on wc.id = ws.class_id
where not exists (
  select 1 from wr_enrollments we
  where we.student_id = ws.id
    and we.term_id is not distinct from (select id from terms where status = '진행중' order by start_date desc nulls last limit 1)
);

-- 36-5) 사건기록 ↔ 학생 구조적 연결(incident_students): incidents.students(자유 텍스트, 쉼표
--       구분)는 빠른 메모용으로 계속 남겨두되, 실제 학생 레코드와 다대다로 연결하는 조인
--       테이블을 추가합니다. 이렇게 연결된 사건은 [학생 정보 조회] 화면에서 그 학생의 학번
--       기준으로 정확히 모아볼 수 있습니다(이름이 같은 다른 학생과 섞이지 않습니다).
create table if not exists incident_students (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  student_id uuid not null references wr_students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (incident_id, student_id)
);
create index if not exists incident_students_incident_idx on incident_students(incident_id);
create index if not exists incident_students_student_idx on incident_students(student_id);

alter table incident_students enable row level security;
drop policy if exists "giamicro_all_incident_students" on incident_students;
create policy "giamicro_all_incident_students" on incident_students
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wr_enrollments') then
    alter publication supabase_realtime add table wr_enrollments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incident_students') then
    alter publication supabase_realtime add table incident_students;
  end if;
end $$;
```

## v0.28.1 - 2026-08-01

위클리 리포트에 실제 학생 명단(114명, 10개 반) 이관 - 코드 변경 없이 DB 데이터만 추가:

- 업로드해주신 실제 GIA 명단(구 프로토타입 DB 덤프)을 현재 `wr_classes`/`wr_students` 스키마에
  맞춰 옮겼습니다. 1A/1C/1J/2Y/2J/2K/3J/3A/4A/5E 총 10개 반, 학생 114명 전원이 들어갑니다.
- 32번에서 넣어뒀던 테스트용 더미 데이터(이해린/김민지/팜하니/강해린/다니엘, 1a/2a 반)는
  정확히 그 5명/2개 반만 지정해서 함께 정리했습니다 - 실제 명단과 섞이지 않습니다.
- ⚠️ **담임 선생님 이메일은 비워뒀습니다.** 원본 자료에 실제 `@giamicro.com` 이메일이 없고
  구 시스템의 아이디/비밀번호만 있었습니다. 아래 담임 배정을 참고해서 [위클리 리포트 관리 >
  반/담임 배정] 화면에서 실제 이메일로 배정해주세요.
  - 1A=Aimie, 1C=Carina, 1J=Jamie, 2Y=Yunsang, 2J=Jandy, 2K=Katherine, 3J=Janelle, 3A=Anna,
    4A=Sarah, 5E=Eamonn
  - Crystal/Michelle/Celine 선생님은 원본 자료상 담임 배정이 없어(과목 전담으로 추정)
    [과목반 세팅] 화면에서 별도로 배정해주세요.
- 코드 변경은 없어서 빌드/배포 없이 아래 SQL만 Supabase SQL Editor에 붙여넣고 실행하시면
  바로 반영됩니다.

```sql
-- ===== 35. 위클리 리포트 실제 데이터(반/학생 전체 명단) 이관 =====
-- (전체 SQL은 supabase/schema.sql의 35번 섹션을 참고해주세요 - 반 10개 + 학생 114명 전체가
--  포함돼 있어 이 체인지로그에는 길이 때문에 요약만 남깁니다.)
```

## v0.28.0 - 2026-08-01

사이드바 화이트 복귀 + 업무 탭 WorkFlatform 원본 재구현 + 플라이아웃 메뉴 + 통합 관리자 대시보드 + 3개 앱 테마 명확화:

- **사이드바를 다시 화이트로 되돌리고, 페이지 배경만 톤 조정했습니다.** 로고가 있는 사이드바가
  계속 색이 바뀌다 보니 로고와 어울리지 않는다는 지적을 반영해, 사이드바/헤더는 다시 흰색으로
  고정하고 각 화면의 콘텐츠 영역 배경만 앱별로 다르게 유지했습니다(가시성 저하 없이 톤만 구분).
  로그인/온보딩/승인대기/PIN처럼 메뉴가 없는 인증 화면은 계속 남색 브랜드 배경을 씁니다.
- **업무 탭을 사용자가 지정한 "워크플랫폼" 참조 소스코드의 UI/UX 그대로 재구현했습니다.** 이전에
  자체적으로 만들었던 남색 톤 칸반 대신, 참조 프로그램과 동일하게 밝은 블루 + 글래스모피즘
  (반투명 블러) 스타일로 전면 교체했습니다.
  - 드래그앤드롭을 `@dnd-kit`(core/sortable/utilities) 라이브러리로 새로 도입해 카드를 마우스로
    끌어다 상태(진행 대기/진행 중/보류·이슈/완료) 사이로 옮기면 실제로 붕 뜨는 미리보기가
    따라오는, 참조와 동일한 드래그 경험을 구현했습니다.
    ⚠️ 신규 의존성 3개(`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)가 추가됐으니
    받으신 뒤 `npm install`을 한 번 실행해주세요.
  - 부서별 업무 상황판(완료율 도넛 게이지 + 전체/완료/진행&대기/보류&이슈 배지 목록), 부서
    그룹채팅(@담당자 태그 시 자동 업무 등록, #부서명 태그 시 해당 부서 채팅방에 공유,
    실시간 자동완성 메뉴), 실시간 로그(상태변경·업무확인 이벤트를 자동 기록)까지 참조의 구성
    요소를 빠짐없이 옮겼습니다. 좌우/상하 크기 조절 가능한 창 구조도 그대로 구현했습니다.
  - 참조 소스코드에는 있었지만 저희 앱에는 이미 메인 사이드바가 있어 중복되는 좌측 세로 부서
    목록만, 상단 가로 탭(부서 색상 점 클릭 시 관리자 색상 변경) 형태로 의도적으로 바꿨습니다.
- **사이드바 메뉴를 플라이아웃(호버 시 오른쪽에 펼쳐지는) 구조로 재편했습니다.** 메뉴가 너무
  길어 계속 스크롤해야 했던 문제를 해결하기 위해, 주메뉴는 홈/업무/운영 관리/위클리
  리포트/지원·관리(+개발자)만 세로로 깔끔하게 두고, 세부 항목(사건기록·회의기록·매뉴얼 등)은
  주메뉴에 마우스를 올렸을 때만 오른쪽에 펼쳐지는 부메뉴로 이동했습니다.
- **문의 및 사용자관리를 "지원 · 관리" 카테고리로 묶어 메뉴 맨 뒤로 옮겼습니다.** 사용자관리와
  새로 만든 관리자 대시보드는 관리자만, 문의및건의사항은 교직원 이상 전원이 볼 수 있도록
  카테고리 안에서 권한별로 항목을 다르게 구성했습니다.
- **통합 관리자 대시보드(`/admin/dashboard`)를 신규로 만들었습니다.** 교장/이사장/부이사장/부서장
  등 "관리자" 직위를 가진 분들이 업무·운영·위클리 리포트 세 영역을 한 화면에서 확인할 수
  있습니다.
  - 최근 30일 사건/행사/회의 건수, 전체 업무 완료율, 재적 학생 수, 이번주 평가 발행률 등
    핵심 지표를 상단에 숫자로 요약했습니다.
  - **반복되는 사건 유형을 자동으로 짚어드립니다** - 최근 6개월간 같은 분류(manual_cat)로
    3건 이상 반복된 사건 유형을 발생 빈도 순으로 보여줍니다.
  - **학생 평가(위클리 리포트) 현황도 함께 봅니다** - 이번 학기 동안 경고·미흡 배지가 3회 이상
    반복된 "반복 지도 필요" 학생과, 우수 배지가 3회 이상 반복된 "반복 우수" 학생을 자동으로
    뽑아 보여줘서, 반복되는 부진에는 추가 조치를, 계속 잘하는 학생에게는 보상을 검토할 수
    있도록 했습니다.
  - **월별 추이를 그래프로 보여줍니다** - 사건·행사·회의 발생 건수 추이, 학생평가 경고/우수
    배지 추이를 최근 6개월 막대그래프로, 부서별 업무 완료율을 비교 막대그래프로 표시합니다.
    별도 차트 라이브러리 없이 SVG 기반 자체 컴포넌트(`GroupedBarChart`)로 구현해 의존성을
    늘리지 않았습니다.
  - ⚠️ 앱의 직위 체계에는 "부장" 직급이 따로 없어(교사/교직원/관리자/개발자 4단계), 현재는
    "관리자" 직위를 가진 모든 계정이 이 대시보드에 접근합니다. 부서장님만 별도로 구분해서
    권한을 드리고 싶으시면 말씀해주세요 - `app_users.position`에 새 값을 추가하는 방식으로
    가능합니다.
- **업무/운영/위클리 리포트 세 화면의 테마를 명확히 구분했습니다.** 사이드바는 공통으로
  흰색을 유지하되, 콘텐츠 영역 배경과 강조색을 화면마다 다르게 해서 지금 어느 앱에 들어와
  있는지 한눈에 알 수 있게 했습니다.
  - 업무: 밝은 블루 + 글래스모피즘(반투명 블러) - WorkFlatform 원본 룩 그대로
  - 운영(gia-ops): 남색 + 골드 - 기존 브랜드 톤 유지
  - 위클리 리포트: 틸(청록) 계열 배경(`--color-wr-bg`) + 전용 강조색(`--color-wr-primary`,
    사이드바 메뉴 강조색과 겹치지 않는 살짝 더 짙은 틸)으로 버튼·강조 요소를 새로 통일했습니다.

DB에는 컬럼 하나만 추가됐습니다(업무 카드에 설명을 남길 수 있도록). Supabase SQL Editor에
아래 SQL을 붙여넣고 실행해주세요 - 이미 실행하셨다면 `if not exists`라 다시 실행해도 안전합니다.

```sql
-- ===== 34. 업무(tasks)에 설명(description) 추가 - WorkFlatform UI/UX 이식 =====
alter table tasks add column if not exists description text;
```

## v0.27.0 - 2026-08-01

디자인 통일 + 업무 탭 고도화 + 위클리 리포트 실데이터 시드 + 통합 SQL 정리:

- **디자인 시스템 도입(GIA 남색+골드).** 로고의 짙은 남색을 기준으로 남색/골드 팔레트를
  `globals.css`에 정의하고, 페이지 배경을 흰색에서 살짝 톤 다운된 회색빛(`#eef1f6`)으로
  바꿔서 흰색 카드가 배경과 구분되도록 했습니다 - "다 하얘서 가시성이 떨어진다"는 문제의
  원인이 흰 카드가 흰 배경 위에 있었기 때문이라, 배경만 바꿔도 앱 전체(GIA ops·업무·위클리
  리포트 공통 레이아웃)에 카드 구분이 생깁니다
- **공용 셸(사이드바/헤더)을 남색 테마로 전환.** 대시보드 좌측 사이드바와 모바일 헤더가
  남색 그라데이션이 되고, 로고는 남색 배경 위에서도 잘 보이도록 흰 칩(chip) 위에 올렸습니다.
  로그인/온보딩/승인대기/PIN 화면도 같은 남색 배경 + 흰 카드로 톤을 맞춰서, 로그인부터
  업무·위클리 리포트까지 하나의 제품처럼 보이도록 했습니다
- **업무 탭을 워크플랫폼(WorkFlatform) 참조 구조에 맞춰 재구성했습니다.**
  - 칸반 컬럼 순서를 참조 앱과 동일하게 "진행 대기 → 진행 중 → 보류·이슈 → 완료"로
    바꿨습니다(DB에 저장되는 상태값 자체는 그대로 두고 화면 라벨/순서만 맞춰서 마이그레이션
    없이 적용됩니다)
  - **업무 확인(담당자 체크) 기능을 추가했습니다.** 담당자로 태그된 사람이 카드를 열어
    "나 확인함" 체크를 하면 시각·이름이 기록되고, 카드에는 "확인 2/3" 같은 진행률이 표시됩니다
  - **실시간 로그 패널을 추가했습니다.** 부서를 선택하면 보드 위쪽에 "OOO님이 업무를
    '진행 중'으로 변경했습니다" / "OOO님이 업무를 확인했습니다" 같은 최근 활동이 실시간으로
    쌓입니다(참조 앱처럼 별도 로그 테이블을 새로 만들지 않고, 기존 코멘트 테이블에 시스템
    이벤트를 함께 기록하는 방식이라 구조가 단순합니다)
  - 부서별 등록 색상(`departments.color`)을 업무 카드/부서 탭/채팅 `#태그`에 실제로
    반영해서 부서 구분이 훨씬 선명해졌습니다
  - dnd-kit·리사이즈 가능한 3단 레이아웃·별도 회의 예약 테이블(meetings)은 이번에 들여오지
    않았습니다 - 기존 드래그앤드롭은 이미 잘 동작하고, 회의 예약은 이 앱의 기존 "회의기록"
    기능과 성격이 달라 중복을 피했습니다
- **업무/사건/행사/제안함/문의 등 앱 전반의 강조 버튼·선택 탭 색상을 슬레이트 계열에서
  GIA 남색으로 통일**해서 세 앱이 같은 브랜드 색을 쓰도록 정리했습니다
- **위클리 리포트 실데이터 시드.** 전달해주신 학생/반/과목/학기 더미 데이터를 실제
  `wr_terms`/`wr_classes`/`wr_students`/`wr_subjects`/`wr_reports` 테이블 구조(uuid 기본키)에
  맞춰 옮겼습니다: 2026년 가을학기, 1학년A·2학년A 반, 학생 5명(이해린/김민지/팜하니/강해린/
  다니엘, 학부모 연락처 포함), 수학(1학년)·영어(2학년) 과목, 이해린 담임 리포트 샘플 1건
  - ⚠️ **원본 데이터의 teacher1/teacher2 계정은 실제 @giamicro.com 이메일이 아니라서 반/과목의
    담당교사는 비워뒀습니다.** 위클리 리포트 관리 > 반/담임 배정, 과목반 세팅 화면에서 실제
    선생님 이메일을 배정해주세요. 이 데이터는 원본 문서에도 "초기 테스트용 더미 데이터"라고
    명시되어 있으니, 실 운영 전에 필요 없는 항목은 같은 관리 화면에서 지우고 실제 데이터로
    교체하시면 됩니다
- **레거시 정리.** 홈 화면의 개인용 "할 일" 위젯이 팀 공유 업무 보드로 완전히 대체된 뒤
  화면 어디에서도 쓰이지 않던 `todos` 테이블을 정리했습니다
- **통합 SQL 정리.** `supabase/schema.sql`은 이제 31개 섹션이 누적된 하나의 파일이고, 전체를
  처음부터 끝까지 한 번에 실행해도 안전합니다(있는 테이블/컬럼은 건드리지 않고, 없는 것만
  만들고, 이번에 불필요해진 `todos`는 제거). 아래 채팅 메시지에 전체 파일을 통째로 붙여
  드렸으니, Supabase SQL Editor에 한 번만 붙여넣고 실행하시면 됩니다

이번 버전은 새 테이블 대신 기존 테이블에 컬럼만 추가하는 방식이라, 아래 SQL만 따로 실행해도
되고, 맨 아래 채팅에 첨부한 전체 통합 SQL을 실행해도 결과는 동일합니다:

```sql
-- ===== 31. 업무 확인(acknowledged_by) + 실시간 로그 =====
alter table tasks add column if not exists acknowledged_by jsonb not null default '[]'::jsonb;
alter table task_comments add column if not exists department text;
alter table task_comments add column if not exists is_system boolean not null default false;

update task_comments tc
set department = t.department
from tasks t
where tc.task_id = t.id and tc.department is null and t.department is not null;

create index if not exists task_comments_department_idx on task_comments(department, created_at);

-- ===== 32. 위클리 리포트 초기 데이터 시드 =====
insert into wr_terms (id, name, start_date, end_date, is_active) values
  (md5('wr-term-2026-fall')::uuid, '2026년 가을학기', '2026-09-01', '2026-12-31', true)
on conflict (id) do nothing;

insert into wr_classes (id, grade, class_name, teacher_email) values
  (md5('wr-class-1a')::uuid, '1', 'A', null),
  (md5('wr-class-2a')::uuid, '2', 'A', null)
on conflict (id) do nothing;

insert into wr_students (id, name, grade, class_name, parent_phone, status) values
  (md5('wr-student-1a-01')::uuid, '이해린', '1', 'A', '010-1111-2222', 'active'),
  (md5('wr-student-1a-02')::uuid, '김민지', '1', 'A', '010-2222-3333', 'active'),
  (md5('wr-student-1a-03')::uuid, '팜하니', '1', 'A', '010-3333-4444', 'active'),
  (md5('wr-student-2a-01')::uuid, '강해린', '2', 'A', '010-5555-6666', 'active'),
  (md5('wr-student-2a-02')::uuid, '다니엘', '2', 'A', '010-7777-8888', 'active')
on conflict (id) do nothing;

insert into wr_subjects (id, name, teacher_email, class_id, color, student_ids) values
  (md5('wr-subject-math-1')::uuid, '수학 (1학년)', null, md5('wr-class-1a')::uuid, '#4F46E5',
    array[md5('wr-student-1a-01')::uuid, md5('wr-student-1a-02')::uuid, md5('wr-student-1a-03')::uuid]),
  (md5('wr-subject-eng-2')::uuid, '영어 (2학년)', null, md5('wr-class-2a')::uuid, '#10B981',
    array[md5('wr-student-2a-01')::uuid, md5('wr-student-2a-02')::uuid])
on conflict (id) do nothing;

insert into wr_reports (id, student_id, term_id, subject, academic, improvement, participation, behavior, social, teacher_note, eval_badges, status, report_date) values
  (md5('wr-report-sample-1')::uuid, md5('wr-student-1a-01')::uuid, md5('wr-term-2026-fall')::uuid, '담임',
   '수학 연산 속도가 매우 빠릅니다.',
   '서술형 문제 풀이 시 식을 적는 연습이 필요합니다.',
   '수업 시간에 항상 집중하며 발표를 잘합니다.',
   '친구들과 배려하며 잘 어울립니다.',
   '리더십이 뛰어납니다.',
   '전반적으로 매우 우수한 성취도를 보이고 있습니다.',
   '{"academic": ["excellent"], "behavior": ["good", "excellent"], "social": ["excellent"]}'::jsonb,
   'published', '2026-08-01')
on conflict (id) do nothing;

-- ===== 33. 레거시 정리: todos 테이블 제거 =====
drop table if exists todos cascade;
```

## v0.26.0 - 2026-08-01

GIA 통합 플랫폼 3번째 통합: "위클리 리포트"(학생 주간 평가 리포트) 병합 + 교사 전용 접근 분리:

- 별도로 개발 중이던 학생 주간 리포트 앱(교사가 학업/보완점/참여도/태도/교우관계 5개 항목을
  뱃지(🌟탁월/🟢양호/⚠️지도요망/🚨집중지도)와 서술형으로 매주 평가하는 앱)을 gia-ops-web
  안에 새 메뉴 "위클리 리포트"로 통합했습니다. 반/과목/학생/학기 데이터는 `wr_` 접두사 테이블로
  분리해서 기존 GIA ops 데이터와 섞이지 않습니다
- **교사(직위=교사)는 로그인하면 위클리 리포트 화면만 보이고, 사이드바에도 "내 담임반"·
  "내 담당과목" 두 메뉴만 나타납니다.** GIA ops(사건/회의/매뉴얼 등)와 업무 보드는 아예 접근
  자체가 막힙니다(주소를 직접 입력해도 위클리 리포트로 돌아옵니다) - 계약직으로 짧게 근무할
  수도 있는 교사에게 내부 문서 성격의 다른 메뉴를 보여주지 않기 위함입니다
- **관리자/교직원/개발자는 기존 메뉴 전체 + 위클리 리포트를 함께 볼 수 있습니다.** 교직원은
  "학생 현황"·"리포트 프린트"를, 관리자(+개발자)는 여기에 더해 "반/담임 배정"·"과목반 세팅"·
  "학생 명부"·"학기 관리"·"통계 대시보드"까지 볼 수 있습니다
- 리포트 작성 화면은 원본 앱의 기능을 그대로 옮겼습니다: 뱃지 복수 선택, 3초 자동 임시저장,
  종합 의견 상용구 저장(개인 브라우저에 저장), 지난주 기록 보기, 임시저장/발행 구분, 다른
  과목 탭은 읽기 전용으로 열람
- 학부모 배포용 PDF(발행된 리포트만 모아서 과목별로 정리)를 리포트 프린트 메뉴에서 바로
  열람/다운로드할 수 있습니다
- 참고: 원본 문서의 "AI 뱃지"는 실제로는 AI가 아니라 선생님이 직접 클릭해서 고르는 수동
  평가였습니다(이름만 ai_tags였을 뿐 생성 로직은 없었음) - 그대로 수동 선택 방식으로 옮겼습니다
- 원본 앱의 회원가입/비밀번호/사용자 승인/오류 로그/개발자 대시보드 화면은 옮기지 않았습니다 -
  이미 gia-ops-web에 동일한 기능(구글 로그인 승인, 개발자 대시보드 등)이 있어서 그걸 그대로
  씁니다. "건의사항" 기능도 기존 "문의및건의사항" 메뉴로 대체됩니다(별도 이관 없음)

Supabase에서 아래 SQL을 SQL Editor에 붙여넣고 실행해주세요:

```sql
-- ===== 위클리 리포트 테이블 =====
create table if not exists wr_terms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  is_active boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists wr_classes (
  id uuid primary key default gen_random_uuid(),
  grade text,
  class_name text,
  teacher_email text,
  sub_teacher_email text,
  created_at timestamptz not null default now()
);

create table if not exists wr_students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade text,
  class_name text,
  parent_phone text,
  note text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table if not exists wr_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teacher_email text,
  class_id uuid references wr_classes(id) on delete set null,
  color text default '#3B82F6',
  student_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists wr_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references wr_students(id) on delete cascade,
  term_id uuid references wr_terms(id) on delete set null,
  subject text not null,
  academic text,
  improvement text,
  participation text,
  behavior text,
  social text,
  teacher_note text,
  eval_badges jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  report_date date not null default current_date,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wr_reports_student_idx on wr_reports(student_id, subject, report_date);
create index if not exists wr_reports_term_idx on wr_reports(term_id);

create table if not exists wr_comments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references wr_students(id) on delete cascade,
  author_email text not null,
  content text not null,
  comment_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists wr_comments_student_idx on wr_comments(student_id, created_at);

drop trigger if exists wr_reports_set_updated_at on wr_reports;
create trigger wr_reports_set_updated_at
  before update on wr_reports
  for each row execute function set_updated_at();

alter table wr_terms enable row level security;
alter table wr_classes enable row level security;
alter table wr_students enable row level security;
alter table wr_subjects enable row level security;
alter table wr_reports enable row level security;
alter table wr_comments enable row level security;

drop policy if exists "giamicro_all_wr_terms" on wr_terms;
create policy "giamicro_all_wr_terms" on wr_terms
  for all using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "giamicro_all_wr_classes" on wr_classes;
create policy "giamicro_all_wr_classes" on wr_classes
  for all using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "giamicro_all_wr_students" on wr_students;
create policy "giamicro_all_wr_students" on wr_students
  for all using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "giamicro_all_wr_subjects" on wr_subjects;
create policy "giamicro_all_wr_subjects" on wr_subjects
  for all using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "giamicro_all_wr_reports" on wr_reports;
create policy "giamicro_all_wr_reports" on wr_reports
  for all using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "giamicro_all_wr_comments" on wr_comments;
create policy "giamicro_all_wr_comments" on wr_comments
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wr_terms') then
    alter publication supabase_realtime add table wr_terms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wr_classes') then
    alter publication supabase_realtime add table wr_classes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wr_students') then
    alter publication supabase_realtime add table wr_students;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wr_subjects') then
    alter publication supabase_realtime add table wr_subjects;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wr_reports') then
    alter publication supabase_realtime add table wr_reports;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wr_comments') then
    alter publication supabase_realtime add table wr_comments;
  end if;
end $$;
```

SQL 실행 후 관리자 화면(위클리 리포트 관리 → 학생 명부 / 반·담임 배정 / 과목반 세팅 / 학기 관리)에서
학생·반·과목·학기 데이터를 등록해주셔야 교사들이 리포트를 작성할 수 있습니다. 또한 기존
교사 계정들의 직위가 정확히 "교사"로 설정되어 있는지 사용자 관리 화면에서 한 번 확인해주세요
(온보딩 때 잘못 선택했다면 본인이 다시 바꿀 수 없으니 관리자가 별도로 안내해주셔야 합니다 -
현재는 앱에 관리자용 직위 수정 화면이 없어서, 필요하시면 다음 작업으로 추가해드릴 수 있습니다).

## v0.25.0 - 2026-08-01

로그인 승인 방식 전면 개편: 이름/소속/직위 온보딩 + 관리자 권한 재정의 + 업무보드 이름 표시:

- 처음 로그인하는 사람은 이제 이름, 소속(유치부/초등부/중고등부), 직위(교사/교직원/관리자)를
  입력하는 온보딩 화면(`/onboarding`)을 먼저 거친 뒤에 승인 대기 화면으로 넘어감. "개발자"
  직위는 johnkang@giamicro.com 계정 전용으로 예약되어 있어 다른 사람에게는 선택지로 보이지
  않음
- 승인 권한이 "승인된 사람이면 누구나"에서 "직위가 관리자(또는 개발자)인 사람만"으로
  좁혀짐. 교사·교직원은 승인해줄 수 없고, 관리자만 사용자 관리 화면에서 승인/거절 처리 가능
  (사이드바의 "관리" 메뉴 자체도 관리자가 아니면 안 보이도록 숨김)
- 이 기능이 추가되기 전 이미 승인됐던 기존 계정도, 아직 이름을 입력한 적이 없다면 다음
  로그인 때 온보딩 화면을 한 번 거치게 됨(그 뒤로는 다시 뜨지 않음)
- 온보딩 중 자기 상태(status)를 스스로 승인으로 바꾸거나, 승인 기록(담당자/일시)을 조작하는
  것은 DB 트리거로 원천 차단됨 - 오직 관리자만 승인/거절 처리 가능
- 사용자 관리 화면에 이제 이메일뿐 아니라 이름·소속·직위가 함께 표시됨
- 업무 보드(칸반 카드, 상세 패널, 담당자 태그, 접속자 목록)와 부서 채팅에서 이제 이메일
  대신 이름이 표시되고, 채팅 멘션도 "@이메일앞부분" 대신 "@이름"으로 사람을 태그함
- (참고) 사건/회의/행사의 담당자·작성자 표시, 문의사항 작성자 표시, 개발자 대시보드 로그는
  이번 작업 범위에 포함되지 않아 여전히 이메일로 표시됩니다 - 필요하시면 다음 작업으로
  이어서 처리해드릴게요

Supabase에서 아래 SQL을 SQL Editor에 붙여넣고 실행해주세요(기존 데이터는 그대로 유지되고,
새 컬럼/정책만 추가됩니다):

```sql
-- app_users에 이름/소속/직위 컬럼 추가
alter table app_users add column if not exists name text;
alter table app_users add column if not exists department text;
alter table app_users add column if not exists position text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_department_check') then
    alter table app_users add constraint app_users_department_check
      check (department in ('유치부', '초등부', '중고등부'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_users_position_check') then
    alter table app_users add constraint app_users_position_check
      check (position in ('교사', '교직원', '관리자', '개발자'));
  end if;
end $$;

-- 관리자 권한을 "승인된 사람"에서 "승인된 + 직위가 관리자인 사람"으로 재정의
create or replace function is_app_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((auth.jwt() ->> 'email') ilike 'johnkang@giamicro.com', false)
    or exists (
      select 1 from app_users
      where email = lower(auth.jwt() ->> 'email')
        and status = 'approved'
        and position = '관리자'
    );
$$;

-- 온보딩(이름 입력 전 1회) 자기 행 수정 허용
drop policy if exists "app_users_update_self_while_pending" on app_users;
drop policy if exists "app_users_update_self_onboarding" on app_users;
create policy "app_users_update_self_onboarding" on app_users
  for update
  using (email = lower(auth.jwt() ->> 'email') and name is null)
  with check (email = lower(auth.jwt() ->> 'email'));

-- 본인 스스로는 status/decided_at/decided_by/email을 바꿀 수 없도록 트리거로 이중 차단
-- (관리자가 하는 승인/거절 처리는 영향받지 않음)
create or replace function protect_app_users_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_app_admin() then
    return new;
  end if;
  new.email := old.email;
  new.status := old.status;
  new.decided_at := old.decided_at;
  new.decided_by := old.decided_by;
  return new;
end;
$$;

drop trigger if exists app_users_protect_self_update on app_users;
create trigger app_users_protect_self_update
  before update on app_users
  for each row execute function protect_app_users_self_update();

-- 개발자 계정 이름/직위 채우기
insert into app_users (email, status, decided_at, decided_by, name, position)
values ('johnkang@giamicro.com', 'approved', now(), 'system', 'John Kang', '개발자')
on conflict (email) do update set status = 'approved', name = 'John Kang', position = '개발자';
```

SQL 실행 후에는 기존에 이미 승인된 계정들(개발자 제외)이 전부 "직위 미입력" 상태가 되므로,
다음 로그인 때 온보딩 화면에서 소속·직위를 입력해달라고 팀에 안내해주시면 됩니다. 그 전까지는
관리자 화면에 "이름 미입력(온보딩 대기 중)"으로 표시됩니다.

## v0.24.0 - 2026-07-31

GIA WorkFlatform 통합 2단계: 부서별 실시간 채팅 + 채팅→업무 자동 전환 (우선 초등부만 활성화):

- 업무 페이지에서 부서 탭을 선택하면(기본값 초등부) 오른쪽에 그 부서의 실시간 채팅창이 뜸.
  팀원이 메시지를 보내면 같은 부서를 보고 있는 모든 사람 화면에 실시간으로 뜸
- 채팅에서 "@사람이름"을 태그하면 그 메시지가 즉시 업무 카드로 등록되고(상태: 예정, 담당자:
  태그된 사람), "✅ 업무로 등록됨" 안내 메시지가 채팅에 남아서 누가 봐도 바로 확인 가능
- 채팅에서 "#부서명"을 태그하면 같은 메시지가 그 부서 채팅방에도 그대로 복사되어 들어감
  (원본 부서 이름이 "~에서 공유됨"으로 표시됨) - 부서 간 교차 공유
- 빠른 입력을 위해 채팅 입력창 위에 팀원 이름(@)과 다른 부서(#) 버튼을 눌러서 바로 태그를
  삽입할 수 있게 함
- 부서를 선택하면 그 부서 업무의 완료율을 보여주는 원형 게이지 위젯 추가
- 부서 목록을 코드에 하드코딩하지 않고 departments 테이블로 관리하도록 변경. 지금은 초등부만
  등록돼 있고, 유치부/중고등부는 나중에 departments 테이블에 행만 추가하면 코드 수정 없이 탭과
  채팅이 자동으로 생김

이번 단계에서 기획서 대비 단순화한 부분: 부서 하나당 채널을 여러 개(공지/자유 등) 두는 기능은
아직 없고 부서=채널 1:1로 구현했습니다. 또 지금은 모든 승인된 팀원이 모든 부서 채팅을 볼 수
있어요(부서 소속에 따른 접근 제한은 아직 없음, 학교 규모상 전체 공유가 더 유용할 것으로 판단).
필요하시면 다음 단계로 추가하겠습니다.

```sql
-- ===== 29. GIA WorkFlatform 통합 2단계 - 부서 레지스트리 + 실시간 채팅 =====
create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text not null default '#3B82F6',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into departments (name, color, sort_order)
values ('초등부', '#3B82F6', 1)
on conflict (name) do nothing;

alter table departments enable row level security;
drop policy if exists "giamicro_all_departments" on departments;
create policy "giamicro_all_departments" on departments
  for all using (is_giamicro_user()) with check (is_giamicro_user());

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  department text not null,
  author_email text not null,
  content text not null,
  source_department text,
  created_at timestamptz not null default now()
);
create index if not exists messages_department_idx on messages(department, created_at);

alter table messages enable row level security;
drop policy if exists "giamicro_all_messages" on messages;
create policy "giamicro_all_messages" on messages
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- (realtime publication 추가 구문은 supabase/schema.sql 29번 섹션 전체를 참고하세요)
```

## v0.23.0 - 2026-07-31

GIA WorkFlatform 통합 1단계: 업무보드에 부서 개념 + 글래스모피즘 스타일 적용:

- 사장님이 주신 "GIA WorkFlatform" 기획서(부서별 채팅+업무 자동할당+글래스모피즘 UI 협업툴)를
  검토한 결과, 단계적으로 통합하기로 했고 1단계로 업무보드에 부서(department) 개념을 추가함
- tasks에 부서 필드 추가(기본값 유치부/초등부/행정실 + 실제 쓰인 부서명이 자동으로 선택지에
  추가됨 - 학기/행사명과 같은 방식). 업무 등록 시, 업무 카드 상세에서 부서를 지정할 수 있고,
  보드 상단 탭에서 "전체" 또는 특정 부서만 필터링해서 볼 수 있음
- 디자인: 기획서의 vanilla CSS 대신, 기존 Tailwind 체계를 유지하면서 Tailwind 유틸리티만으로
  글래스모피즘(반투명 + 블러 + 은은한 그라데이션)을 구현함. 앱 전체 스타일 일관성은 유지하고
  업무 페이지에만 유리감 있는 프리미엄 톤을 적용
- 다음 단계(부서별 실시간 채팅 + `@`/`#` 태그로 업무 자동 전환)는 별도로 진행 예정 - 실제 부서
  전체 목록과 Supabase 요금제(Realtime 동시 연결 수) 확인이 먼저 필요함

```sql
-- ===== 28. 업무에 부서(department) 추가 - GIA WorkFlatform 통합 1단계 =====
alter table tasks add column if not exists department text;
create index if not exists tasks_department_idx on tasks(department);
```

## v0.22.0 - 2026-07-31

"업무" 메뉴 신설: 팀 공유 실시간 칸반보드(개인 할일/업무히스토리 기능 대체):

- 이전에 만든 개인용 할 일(홈 위젯)/업무히스토리(달력)는 "차라리 팀이 같이 보는 업무판이 낫겠다"는
  요청에 따라 이번 버전에서 새 "업무" 메뉴로 완전히 대체했습니다. 홈 화면과 사이드바에서
  제거했고(파일도 정리), DB의 todos 테이블은 남아있지만 더 이상 앱에서 쓰지 않습니다(원하시면
  나중에 직접 삭제하셔도 됩니다).
- 사이드바에 "업무" 메뉴 신설(홈 바로 아래). 팀 전체가 같은 보드를 실시간으로 봅니다.
- 지금 이 페이지에 접속해 있는 팀원을 실시간으로 보여줌(Supabase Presence)
- 업무를 등록하면 카드 형태로 "예정" 칸에 들어가고, 마우스로 카드를 끌어서 진행중/완료/보류
  칸으로 옮길 수 있음(모바일 등 드래그가 불편한 환경을 위해 카드마다 상태를 바로 바꾸는
  드롭다운도 함께 제공)
- 업무를 등록하거나 카드를 열었을 때, 지금 접속 중인 팀원을 포함한 승인된 팀원 전체를
  담당자로 태그할 수 있음(여러 명 가능)
- 카드를 클릭하면 상세 패널이 열리고, 상태/우선순위/마감일/담당자를 바로 수정할 수 있음
- 구글 시트 메모처럼, 각 업무 카드에 실시간 코멘트를 남길 수 있음 - 팀원이 그 업무를 보고 있으면
  코멘트가 실시간으로 함께 뜸
- 완료된 업무는 기본적으로 최근 14일치만 보여서 보드가 오래된 카드로 지저분해지지 않게 하고,
  체크박스로 전체 완료 이력도 펼쳐볼 수 있음
- 우선순위(보통/긴급) 태그, 마감일 지난 카드 빨간 테두리 강조 등 부가 기능도 함께 추가
- 홈 화면은 "업무 현황"(예정/진행중/완료/보류 건수 + 나에게 태그된 업무 건수)만 요약으로 보여주고,
  자세히 보려면 업무 메뉴로 이동하도록 정리

```sql
-- ===== 27. 업무(tasks) - 팀 공유 칸반보드 + 실시간 코멘트 =====
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,
  title text not null,
  status text not null default '예정' check (status in ('예정', '진행중', '완료', '보류')),
  priority text not null default '보통' check (priority in ('보통', '긴급')),
  owner_email text not null,
  assignee_emails text[] not null default '{}',
  position double precision not null default 0,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_status_idx on tasks(status);

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

alter table tasks enable row level security;
drop policy if exists "giamicro_all_tasks" on tasks;
create policy "giamicro_all_tasks" on tasks
  for all using (is_giamicro_user()) with check (is_giamicro_user());

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_email text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_id_idx on task_comments(task_id);

alter table task_comments enable row level security;
drop policy if exists "giamicro_all_task_comments" on task_comments;
create policy "giamicro_all_task_comments" on task_comments
  for all using (is_giamicro_user()) with check (is_giamicro_user());

drop policy if exists "giamicro_select_approved_app_users" on app_users;
create policy "giamicro_select_approved_app_users" on app_users
  for select using (is_giamicro_user() and status = 'approved');

-- (realtime publication 추가 구문은 supabase/schema.sql 27번 섹션 전체를 참고하세요)
```

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
