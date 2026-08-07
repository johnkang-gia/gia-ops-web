-- GIA 운영 자동화 시스템 - Supabase(Postgres) 스키마
-- Supabase 대시보드 > SQL Editor에 전체를 붙여넣고 한 번에 실행하세요.
-- 기존 구글 시트(v18 .gs)의 사건기록/회의록/행사기록 열 구성을 그대로 옮긴 필드 구성입니다.

create extension if not exists pgcrypto;

-- ===== 1. 테이블 =====

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,          -- 예: INC-260714-091530-482 (기존 genId('INC')와 동일 형식)
  date date not null,
  title text not null,
  detail text,
  good text,
  lack text,
  suggest text,
  owner text,
  students text,                          -- 관련 학생 이름(쉼표로 여러 명)
  manual_cat text,                        -- 매뉴얼 항목(정렬/분류용)
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,          -- 예: MTG-260714-091530-482
  date date not null,
  attendees text,
  content text not null,
  status text,
  next_agenda text,
  final_record text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,          -- 예: EVT-260714-091530-482
  date date not null,
  name text not null,
  owner text,
  good text,
  lack text,
  suggest text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incidents_date_idx on incidents (date desc);
create index if not exists meetings_date_idx on meetings (date desc);
create index if not exists events_date_idx on events (date desc);

-- ===== 2. updated_at 자동 갱신 =====

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists incidents_set_updated_at on incidents;
create trigger incidents_set_updated_at
  before update on incidents
  for each row execute function set_updated_at();

drop trigger if exists meetings_set_updated_at on meetings;
create trigger meetings_set_updated_at
  before update on meetings
  for each row execute function set_updated_at();

drop trigger if exists events_set_updated_at on events;
create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();

-- ===== 3. 접근 제어: giamicro.com 계정만 조회/작성 가능 (RLS) =====
-- 기존 시스템(WEB_APP_ALLOWED_DOMAIN=giamicro.com)과 동일한 신뢰 모델입니다:
-- 도메인 내 로그인한 직원은 모두 전체 사건/행사/회의를 보고 쓸 수 있습니다(개인별 소유권 구분 없음).
-- 앱 쪽 middleware.ts에서도 같은 도메인 검사를 하지만, RLS가 최종 방어선입니다.

create or replace function is_giamicro_user()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'email') ilike '%@giamicro.com', false);
$$;

alter table incidents enable row level security;
alter table meetings enable row level security;
alter table events enable row level security;

drop policy if exists "giamicro_all_incidents" on incidents;
create policy "giamicro_all_incidents" on incidents
  for all
  using (is_giamicro_user())
  with check (is_giamicro_user());

drop policy if exists "giamicro_all_meetings" on meetings;
create policy "giamicro_all_meetings" on meetings
  for all
  using (is_giamicro_user())
  with check (is_giamicro_user());

drop policy if exists "giamicro_all_events" on events;
create policy "giamicro_all_events" on events
  for all
  using (is_giamicro_user())
  with check (is_giamicro_user());

-- ===== 4. 실시간 동기화(Realtime) 활성화 =====
-- Supabase 대시보드 > Database > Replication 에서도 테이블별로 켤 수 있지만,
-- 아래 구문으로 한 번에 켜둡니다. 이미 publication에 포함돼 있으면 오류 없이 건너뜁니다.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incidents'
  ) then
    alter publication supabase_realtime add table incidents;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meetings'
  ) then
    alter publication supabase_realtime add table meetings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table events;
  end if;
end $$;

-- =====================================================================
-- Phase 2: AI 제안 워크플로우 · 채택예정/발행 · 자체 매뉴얼(PDF) · PIN 2차 보안
-- (구글 시트를 완전히 대체하기 위해 추가된 테이블입니다. 위 스크립트를 이미 실행했다면
--  이 블록만 추가로 SQL Editor에 붙여넣고 실행해도 됩니다 - 전체를 다시 실행해도 안전합니다.)
-- =====================================================================

-- ===== 5. 사건/행사/회의에 "AI 스캔 여부" 컬럼 추가 =====
-- 예전 구글 시트 버전은 처리상태(status) 칸이 비어있는지로 "아직 안 본 기록"을 판단했지만,
-- status는 담당자가 자유롭게 쓰는 칸이라 스캔 여부 판단으로 쓰기에는 부정확했습니다.
-- 전용 컬럼으로 분리해 "AI가 이미 검토했는지"를 명확히 구분합니다.

alter table incidents add column if not exists scanned_at timestamptz;
alter table events add column if not exists scanned_at timestamptz;
alter table meetings add column if not exists scanned_at timestamptz;

-- ===== 6. 제안함(proposals) =====
-- 기존 사건제안함/행사제안함/회의제안함 3개 시트를 하나의 테이블로 통합하고 source 컬럼으로 구분합니다.

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,               -- 예: PRP-260716-...
  source text not null check (source in ('incidents', 'events', 'meetings')),
  source_id text,                              -- 원본 사건/행사/회의의 case_id
  date date not null default current_date,
  target_doc text not null,                    -- '학부모용' | '실무자용' | '둘다'
  category text not null,
  remediation text,                            -- 보완/재발방지 방안 (여러 옵션을 줄바꿈으로 합쳐서 저장)
  parent_msg text,                              -- 학부모 안내 멘트 옵션들
  student_edu text,                             -- 학생 교육 방법 옵션들
  final_text text not null,                     -- 매뉴얼에 바로 반영 가능한 정리된 문구(수정 가능)
  legal_basis text,
  applicability text,
  legal_summary text,
  benchmark text,
  status text not null default '검토대기',       -- 검토대기 | 승인 | 보류 | 삭제
  reflected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proposals_status_idx on proposals (status);
create index if not exists proposals_source_idx on proposals (source, source_id);

drop trigger if exists proposals_set_updated_at on proposals;
create trigger proposals_set_updated_at
  before update on proposals
  for each row execute function set_updated_at();

alter table proposals enable row level security;
drop policy if exists "giamicro_all_proposals" on proposals;
create policy "giamicro_all_proposals" on proposals
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- ===== 7. 채택예정(adopted) =====
-- 제안함에서 "승인"하면 여기로 옮겨져, 담당자가 GIA 실정에 맞게 구체화한 뒤 "발행"해야
-- 비로소 매뉴얼(manual_sections)에 반영됩니다.

create table if not exists adopted (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,
  source_id text not null,                      -- 원본 제안(proposals.case_id)
  source text not null,
  date date not null default current_date,
  target_doc text not null,
  category text not null,
  ai_original text,                              -- AI 제안 원문(참고용)
  specific_text text not null,                   -- 구체화한 최종 내용(직접 수정, 매뉴얼에 반영될 문구)
  guide text,                                     -- 구체화할 때 참고할 안내
  legal_basis text,
  applicability text,
  legal_summary text,
  benchmark text,
  publish boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists adopted_publish_idx on adopted (publish);

drop trigger if exists adopted_set_updated_at on adopted;
create trigger adopted_set_updated_at
  before update on adopted
  for each row execute function set_updated_at();

alter table adopted enable row level security;
drop policy if exists "giamicro_all_adopted" on adopted;
create policy "giamicro_all_adopted" on adopted
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- ===== 8. 매뉴얼(manual_sections) - 구글 문서를 대체하는 자체 매뉴얼 콘텐츠 저장소 =====
-- "GIA 운영계획안"(학부모용)과 "GIA 실무자매뉴얼"(실무자용) 두 문서를, 항목(category)별로
-- 누적된 텍스트로 저장합니다. /manuals 화면과 PDF 생성이 이 테이블을 읽습니다.

create table if not exists manual_sections (
  id uuid primary key default gen_random_uuid(),
  target_doc text not null,                      -- '학부모용' | '실무자용'
  category text not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique (target_doc, category)
);

drop trigger if exists manual_sections_set_updated_at on manual_sections;
create trigger manual_sections_set_updated_at
  before update on manual_sections
  for each row execute function set_updated_at();

alter table manual_sections enable row level security;
drop policy if exists "giamicro_all_manual_sections" on manual_sections;
create policy "giamicro_all_manual_sections" on manual_sections
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- ===== 9. PIN 2차 보안(pins) =====
-- 구글 로그인 뒤 한 번 더 확인하는 PIN을 계정별로 저장합니다. 원문 PIN은 절대 저장하지 않고
-- 무작위 salt + SHA-256 해시만 저장합니다(개발자를 포함해 누구도 원래 값을 알 수 없음).
-- 본인 행(row)만 만들 수 있고, 한 번 만든 뒤에는 본인도 수정할 수 없습니다(분실 시 개발자가
-- service_role 키로만 초기화 가능) - 이 부분은 기존 구글 시트 버전과 동일한 보안 모델입니다.

create table if not exists pins (
  user_email text primary key,
  salt text not null,
  hash text not null,
  created_at timestamptz not null default now()
);

alter table pins enable row level security;

drop policy if exists "own_pin_select" on pins;
create policy "own_pin_select" on pins
  for select using (user_email = (auth.jwt() ->> 'email'));

drop policy if exists "own_pin_insert" on pins;
create policy "own_pin_insert" on pins
  for insert with check (user_email = (auth.jwt() ->> 'email'));

-- update/delete 정책은 의도적으로 만들지 않습니다 - 본인도 RLS로는 수정/삭제할 수 없고,
-- 분실 시에는 개발자가 service_role 키(RLS 우회)로만 초기화할 수 있습니다.

-- ===== 10. 새 테이블 Realtime 활성화 =====

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'proposals'
  ) then
    alter publication supabase_realtime add table proposals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'adopted'
  ) then
    alter publication supabase_realtime add table adopted;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'manual_sections'
  ) then
    alter publication supabase_realtime add table manual_sections;
  end if;
end $$;

-- =====================================================================
-- Phase 3: AI 매뉴얼 작성(직접 글쓰기 -> AI 제안) · 회의록 AI 정리
-- (Phase 1 + Phase 2를 이미 실행했다면 이 블록만 추가로 SQL Editor에 붙여넣고 실행해도 됩니다.
--  전체를 다시 실행해도 안전합니다.)
-- =====================================================================

-- ===== 11. 제안함(proposals) 출처(source)에 "manual"(AI 매뉴얼 작성) 추가 =====
-- 기존에는 사건/행사/회의 3가지 출처만 허용했는데, "AI 매뉴얼" 메뉴에서 담당자가 직접 쓴 초안도
-- 같은 제안함 파이프라인(제안 -> 승인 -> 채택예정 -> 발행)을 타도록 출처를 하나 더 허용합니다.
-- 제약조건 이름은 schema.sql에서 별도 이름을 주지 않았을 때 Postgres가 자동으로 붙이는
-- "<테이블>_<컬럼>_check" 규칙을 따릅니다.

alter table proposals drop constraint if exists proposals_source_check;
alter table proposals add constraint proposals_source_check
  check (source in ('incidents', 'events', 'meetings', 'manual'));

-- ===== 12. AI 매뉴얼 작성 초안(manual_drafts) =====
-- "AI 매뉴얼" 메뉴에서 담당자가 두서없이 쓴 원문을 그대로 보관합니다(감사/추적용). AI가 다듬은
-- 결과물은 proposals 테이블에 source='manual'로 저장되고, 이 테이블의 case_id를 source_id로 참조합니다.

create table if not exists manual_drafts (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,                 -- 예: MDR-260730-...
  target_doc text not null,                      -- '학부모용' | '실무자용'
  raw_text text not null,
  scanned_at timestamptz,                        -- AI가 처리해서 제안을 만든 시각
  created_at timestamptz not null default now()
);

alter table manual_drafts enable row level security;
drop policy if exists "giamicro_all_manual_drafts" on manual_drafts;
create policy "giamicro_all_manual_drafts" on manual_drafts
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'manual_drafts'
  ) then
    alter publication supabase_realtime add table manual_drafts;
  end if;
end $$;

-- ===== 13. 로그인 승인제(app_users) - 개발자/관리자 권한 구분 =====
-- giamicro.com 계정이면 누구나 로그인은 되지만, 관리자가 승인하기 전에는 대시보드에 들어갈 수
-- 없습니다(짧게 근무하고 그만두는 인력 대응). 개발자(johnkang@giamicro.com)는 이 테이블 상태와
-- 무관하게 항상 접근 가능하도록 is_app_admin() 함수에서 이메일을 직접 하드코딩해 확인합니다.

create table if not exists app_users (
  email text primary key,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  name text,
  department text check (department in ('유치부', '초등부', '중고등부')),
  position text check (position in ('교사', '교직원', '관리자', '개발자'))
);

-- 기존에 이미 만들어진 테이블에도 안전하게 컬럼을 추가합니다(신규 설치 시에는 위 CREATE TABLE에서
-- 이미 컬럼이 있으므로 아래 구문은 아무 일도 하지 않습니다).
alter table app_users add column if not exists name text;
alter table app_users add column if not exists department text;
alter table app_users add column if not exists position text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_department_check'
  ) then
    alter table app_users add constraint app_users_department_check
      check (department in ('유치부', '초등부', '중고등부'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_position_check'
  ) then
    alter table app_users add constraint app_users_position_check
      check (position in ('교사', '교직원', '관리자', '개발자'));
  end if;
end $$;

alter table app_users enable row level security;

-- security definer로 만들어 아래 정책이 자기 자신(app_users)을 참조해도 재귀 없이 안전합니다.
-- 관리자 권한은 이제 "승인된 사용자"가 아니라 "직위가 관리자(또는 개발자)인 승인된 사용자"에게만 있습니다.
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

-- 본인 행은 승인 상태 확인을 위해 항상 조회 가능
drop policy if exists "app_users_select_self" on app_users;
create policy "app_users_select_self" on app_users
  for select
  using (email = lower(auth.jwt() ->> 'email'));

-- 최초 로그인 시 본인 신청(행 생성)을 허용
drop policy if exists "app_users_insert_self" on app_users;
create policy "app_users_insert_self" on app_users
  for insert
  with check (email = lower(auth.jwt() ->> 'email'));

-- 온보딩(이름/소속/직위 입력)을 위해 "아직 이름을 입력한 적 없는" 본인 행만 스스로 수정할 수
-- 있게 합니다(신규 가입자뿐 아니라, 이 기능이 추가되기 전 이미 승인됐던 기존 계정도 이름이
-- 비어있으면 한 번은 채울 수 있도록 함). status/decided_at/decided_by/email은 아래 트리거가
-- 본인 스스로는 절대 바꿀 수 없도록 한 번 더 강제하므로, 이 정책만으로 "내가 내 상태를
-- 승인으로 바꾼다"거나 "내 직위를 몰래 관리자로 올린 뒤 상태까지 승인시킨다"는 불가능합니다.
drop policy if exists "app_users_update_self_while_pending" on app_users;
drop policy if exists "app_users_update_self_onboarding" on app_users;
create policy "app_users_update_self_onboarding" on app_users
  for update
  using (email = lower(auth.jwt() ->> 'email') and name is null)
  with check (email = lower(auth.jwt() ->> 'email'));

-- 관리자가 아닌 본인 스스로의 수정 요청에서는 email/status/decided_at/decided_by를 항상 원래
-- 값으로 되돌려, 온보딩 정책이 열려 있는 짧은 순간에도 상태를 셀프 승인하거나 담당자 기록을
-- 조작할 수 없도록 한 번 더 막습니다. 관리자(is_app_admin())가 수행하는 승인/거절 처리는
-- 이 트리거의 영향을 받지 않습니다.
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

-- 승인된 사용자(개발자 포함)는 전체 목록을 보고 승인/거절/차단을 처리할 수 있음
drop policy if exists "app_users_manage_by_admin" on app_users;
create policy "app_users_manage_by_admin" on app_users
  for all
  using (is_app_admin())
  with check (is_app_admin());

-- 개발자 계정은 배포 즉시 승인 상태로 등록해 잠기지 않도록 합니다.
insert into app_users (email, status, decided_at, decided_by, name, position)
values ('johnkang@giamicro.com', 'approved', now(), 'system', 'John Kang', '개발자')
on conflict (email) do update set status = 'approved', name = 'John Kang', position = '개발자';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_users'
  ) then
    alter publication supabase_realtime add table app_users;
  end if;
end $$;

-- ===== 14. AI 매뉴얼: 대상 문서(학부모용/실무자용) AI 자동 판단 =====
-- 이전에는 작성자가 미리 "학부모용"/"실무자용"을 선택했지만, 이제 AI가 내용을 보고 어느
-- 문서(또는 둘 다)에 반영할지 직접 판단합니다. 판단 전에는 target_doc이 비어있어야 하므로
-- NOT NULL 제약을 해제합니다.
alter table manual_drafts alter column target_doc drop not null;

-- ===== 15. 서류함(documents) - 학교가 갖춰야 할 서류를 AI 추천/초안 작성으로 관리 =====
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,           -- 예: DOC-260730-...
  name text not null,
  category text,
  status text not null default '필요' check (status in ('필요', '준비중', '보유', '만료임박', '해당없음')),
  notes text,
  ai_draft text,                          -- AI가 만들어준 서류 초안(있으면)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists documents_set_updated_at on documents;
create trigger documents_set_updated_at
  before update on documents
  for each row execute function set_updated_at();

alter table documents enable row level security;
drop policy if exists "giamicro_all_documents" on documents;
create policy "giamicro_all_documents" on documents
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
  ) then
    alter publication supabase_realtime add table documents;
  end if;
end $$;

-- ===== 16. 매뉴얼 항목 서명 필요 여부 (PDF에 서명란 자동 삽입용) =====
alter table manual_sections add column if not exists requires_signature boolean not null default false;

-- ===== 17. AI 예상 문의/컴플레인 제안(proposals.source에 'complaint' 추가) =====
-- 실무자매뉴얼에 "학부모가 이런 문의/컴플레인을 하면 이렇게 답한다"를 미리 채워두기 위해,
-- AI가 예상되는 문의/컴플레인과 권장 응대 문구를 제안함에 자동으로 만들어 넣습니다.
alter table proposals drop constraint if exists proposals_source_check;
alter table proposals add constraint proposals_source_check
  check (source in ('incidents', 'events', 'meetings', 'manual', 'complaint'));

-- ===== 18. 행사 정규/일시적 구분 + 사진 =====
alter table events add column if not exists kind text not null default 'adhoc' check (kind in ('regular', 'adhoc'));
alter table events add column if not exists photo_paths text[] not null default '{}';

-- ===== 19. 학기/캠프(terms) - 매년 반복되는 학기·캠프를 누적 기록하고 다음 회차에 참고 =====
-- 학기 중 계속 진행되는 회의에서 나온 안건이 자동으로 이 기록(good/lack/suggest)에 누적되고,
-- 다음 해 같은 학기/캠프가 시작될 때 AI 비교 리포트로 참고할 수 있습니다.
create table if not exists terms (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,             -- 예: TRM-260730-...
  term_type text not null,                  -- 예: '1학기', '여름캠프1' (자유 입력, 반복해서 쓰면 자동으로 묶임)
  year text not null,                       -- 예: '2026'
  start_date date,
  end_date date,
  status text not null default '진행중' check (status in ('진행중', '종료')),
  good text,
  lack text,
  suggest text,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists terms_set_updated_at on terms;
create trigger terms_set_updated_at
  before update on terms
  for each row execute function set_updated_at();

alter table terms enable row level security;
drop policy if exists "giamicro_all_terms" on terms;
create policy "giamicro_all_terms" on terms
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'terms'
  ) then
    alter publication supabase_realtime add table terms;
  end if;
end $$;

-- ===== 20. 행사/학기 사진 저장소(Storage) =====
-- 비공개 버킷 - giamicro.com 로그인 사용자만 업로드/조회/삭제할 수 있습니다(아동 사진 포함 가능하므로
-- 공개 버킷으로 만들지 않습니다).
insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', false)
on conflict (id) do nothing;

drop policy if exists "giamicro_read_event_photos" on storage.objects;
create policy "giamicro_read_event_photos" on storage.objects
  for select using (bucket_id = 'event-photos' and is_giamicro_user());

drop policy if exists "giamicro_write_event_photos" on storage.objects;
create policy "giamicro_write_event_photos" on storage.objects
  for insert with check (bucket_id = 'event-photos' and is_giamicro_user());

drop policy if exists "giamicro_delete_event_photos" on storage.objects;
create policy "giamicro_delete_event_photos" on storage.objects
  for delete using (bucket_id = 'event-photos' and is_giamicro_user());

-- ===== 21. 채택예정 AI 비판적 검증(반복 검증 워크플로우) =====
-- 채택예정 항목을 발행하기 전, AI가 예상 후속 문의/맹점/보완 제안을 비판적으로 짚어주고,
-- 실무자가 내용을 보완한 뒤 다시 검증받을 수 있도록 결과와 검증 횟수를 누적합니다.
alter table adopted add column if not exists review_result jsonb;
alter table adopted add column if not exists review_count integer not null default 0;
alter table adopted add column if not exists last_reviewed_at timestamptz;

-- ===== 22. 회의록 대화형 작성(채팅) + 음성 녹음 업로드 =====
-- 두서없이 적은 회의 메모를 채팅으로 붙여넣으면 AI가 애매한 부분을 되물어가며 정리합니다.
-- 대화 전체(source_chat)를 남겨서 나중에 왜 이렇게 정리됐는지 참고할 수 있게 하고, 녹음
-- 파일을 올린 경우 저장 경로(audio_path)도 함께 기록합니다.
alter table meetings add column if not exists source_chat jsonb;
alter table meetings add column if not exists audio_path text;

insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

drop policy if exists "giamicro_read_meeting_audio" on storage.objects;
create policy "giamicro_read_meeting_audio" on storage.objects
  for select using (bucket_id = 'meeting-audio' and is_giamicro_user());

drop policy if exists "giamicro_write_meeting_audio" on storage.objects;
create policy "giamicro_write_meeting_audio" on storage.objects
  for insert with check (bucket_id = 'meeting-audio' and is_giamicro_user());

drop policy if exists "giamicro_delete_meeting_audio" on storage.objects;
create policy "giamicro_delete_meeting_audio" on storage.objects
  for delete using (bucket_id = 'meeting-audio' and is_giamicro_user());

-- ===== 23. 사건/회의를 현재 진행중인 학기와 자동 연결(term_id) =====
-- 담당자가 새 사건/회의를 저장하는 시점에 "진행중" 상태인 학기·캠프가 있으면 그 학기에 자동으로
-- 묶어서, 학기 화면에서 해당 기간에 쌓인 사건/회의를 목록으로 바로 볼 수 있게 합니다.
alter table incidents add column if not exists term_id uuid references terms(id) on delete set null;
alter table meetings add column if not exists term_id uuid references terms(id) on delete set null;
create index if not exists incidents_term_id_idx on incidents(term_id);
create index if not exists meetings_term_id_idx on meetings(term_id);

-- ===== 24. 문의및 건의사항(inquiries) + 오류로그/AI 사용량 로그 + 개발자 대시보드 =====
-- 직원 누구나 오류 신고·기능 제안을 남길 수 있고(inquiries), 개발자(johnkang@giamicro.com)는
-- 전체 문의를 관리하고, 시스템이 자동으로 남기는 오류 로그(error_logs)와 AI 호출 로그
-- (ai_usage_logs)를 통해 앱이 원활히 돌아가는지 모니터링합니다.
-- is_developer()는 src/lib/roles.ts의 DEVELOPER_EMAILS와 반드시 같은 이메일로 맞춰주세요.

create or replace function is_developer()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'johnkang@giamicro.com', false);
$$;

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,           -- 예: INQ-260731-...
  category text not null,                  -- 오류 | 기능제안 | 기타
  title text not null,
  content text not null,
  status text not null default '접수',     -- 접수 | 처리중 | 완료
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

-- ===== 25. 개인 할 일(todos) - 홈 화면 왼쪽 위젯 =====
-- 다른 테이블(사건/회의/행사 등)은 giamicro 도메인 전체가 공유하지만, 할 일은 각자 자신의
-- 업무를 적는 개인용이라 본인 것만 보이고 수정할 수 있게 user_email 기준으로 제한합니다.
-- due_at을 설정하면 그 시간에 브라우저 알림(팝업)으로 알려주고, notified 컬럼으로 중복 알림을
-- 막습니다(한 번 알림을 보내면 true로 바뀌고 다시 보내지 않음).
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  text text not null,
  for_date date not null default current_date,  -- 이 할 일이 속한 날짜(업무 히스토리 조회 기준)
  due_at timestamptz,                            -- 설정하면 이 시각에 팝업/브라우저 알림
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

-- ===== 26. 할 일에 날짜(for_date) 추가 - 업무 히스토리(달력) 조회용 =====
-- 기존에 todos 테이블이 이미 있던 환경(위 25번을 이미 실행한 경우)을 위한 업그레이드 경로입니다.
-- 신규 설치는 위 25번 create table에 for_date가 이미 포함되어 있어 아래 구문은 효과가 없습니다.
alter table todos add column if not exists for_date date not null default current_date;
create index if not exists todos_user_date_idx on todos(user_email, for_date);

-- ===== 27. 업무(tasks) - 팀 공유 칸반보드 + 실시간 코멘트 =====
-- 25번의 todos(개인 전용 할 일)를 대체하는 팀 공유 업무 관리입니다. giamicro 팀 전체가 실시간으로
-- 같은 보드를 보고, 카드를 드래그해서 상태를 옮기고, 담당자를 태그하고, 각 업무에 코멘트를
-- 남길 수 있습니다. status는 칸반 보드의 4개 컬럼(예정/진행중/완료/보류)이고, position은 같은
-- 컬럼 안에서의 정렬 순서(카드를 옮길 때마다 갱신)입니다.
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,               -- 예: TSK-260801-...
  title text not null,
  status text not null default '예정' check (status in ('예정', '진행중', '완료', '보류')),
  priority text not null default '보통' check (priority in ('보통', '긴급')),
  department text,                              -- 예: 유치부/초등부/행정실(자유 입력, 부서별 필터용)
  owner_email text not null,                   -- 최초 등록자
  assignee_emails text[] not null default '{}', -- 태그된 담당자(복수 가능)
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

-- 담당자 태그 선택창에 쓸 팀원 목록: 승인된(app_users.status='approved') 사용자는 누구나 서로의
-- 이메일을 조회할 수 있게 허용합니다(기존에는 본인 행 또는 관리자만 조회 가능했음).
drop policy if exists "giamicro_select_approved_app_users" on app_users;
create policy "giamicro_select_approved_app_users" on app_users
  for select using (is_giamicro_user() and status = 'approved');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
  ) then
    alter publication supabase_realtime add table task_comments;
  end if;
end $$;

-- ===== 28. 업무에 부서(department) 추가 - GIA WorkFlatform 통합 1단계 =====
-- 기존에 27번을 이미 실행한 환경을 위한 업그레이드 경로입니다(신규 설치는 위 create table에
-- department가 이미 포함되어 있어 아래 구문은 효과가 없습니다). 나중에 부서별 실시간 채팅 등을
-- 얹을 때도 이 컬럼(또는 정식 departments 테이블)을 기준으로 확장할 예정입니다.
alter table tasks add column if not exists department text;
create index if not exists tasks_department_idx on tasks(department);

-- ===== 29. GIA WorkFlatform 통합 2단계 - 부서 레지스트리 + 실시간 채팅 =====
-- 사장님이 주신 기획서(부서별 실시간 채팅 + 채팅 중 @사람/#부서 태그 시 즉시 업무로 전환·공유)를
-- 반영합니다. 우선 초등부만 활성화하고, 유치부/중고등부는 나중에 departments에 행만 추가하면
-- 코드 수정 없이 그대로 확장됩니다.
--
-- departments: 부서 레지스트리(부서명/색상/정렬 순서). tasks.department는 계속 자유 입력 텍스트로
-- 남겨두고(기존 데이터 보존), 화면에서는 departments 테이블 값을 기본 선택지로 보여줍니다.
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

-- messages: 부서별 실시간 채팅. source_department가 채워져 있으면 "다른 부서 채팅에서 #태그로
-- 넘어온 메시지"라는 뜻입니다(원본은 그대로 남고, 태그된 부서 채팅에도 복사되어 들어갑니다).
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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'departments'
  ) then
    alter publication supabase_realtime add table departments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;

-- ===== 30. 위클리 리포트(Weekly Student Report) 통합 =====
-- 별도로 개발되던 "학생 주간 리포트" 앱을 gia-ops-web 안으로 합칩니다. 기존 사건/행사/회의
-- 등과 개념적으로 겹치지 않는 새 도메인이라 테이블 이름을 wr_ 접두사로 분리했습니다(기존
-- terms 테이블은 학기/캠프 반복행사 기록용이라 성격이 달라, 위클리 리포트 전용 학기 테이블을
-- 따로 둡니다). 권한은 이 프로젝트의 기존 관례(테이블 단위 RLS는 giamicro 승인 사용자에게
-- 넓게 열어두고, "교사는 자기 반/과목만 수정 가능" 같은 세부 규칙은 화면 쪽에서 처리)를
-- 그대로 따릅니다 - tasks/messages 테이블과 동일한 패턴입니다.

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
  subject text not null,                    -- '담임' 또는 실제 과목명
  academic text,
  improvement text,
  participation text,
  behavior text,
  social text,
  teacher_note text,
  eval_badges jsonb not null default '{}',  -- {academic:['good'], ...} 형태
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

-- ===== 31. 업무 확인(acknowledged_by) + 실시간 로그 - GIA WorkFlatform 참조 구조 통합 3단계 =====
-- 참조 소스코드(WorkFlatform)의 task_assignees(담당자별 확인 여부)와 별도 활동 로그 테이블을
-- 그대로 들여오는 대신, 이 프로젝트의 기존 관례(부모 테이블에 jsonb 컬럼 하나 추가)를 따라
-- tasks.acknowledged_by 컬럼 하나로 "담당자가 업무를 확인했다"를 기록합니다. 활동 로그도 새
-- 테이블을 만들지 않고, 기존 task_comments에 department/is_system 컬럼만 추가해서 상태변경·
-- 업무확인 이벤트를 "시스템 코멘트"로 남기고, 화면에서는 is_system=true인 것만 모아
-- "실시간 로그" 패널로 보여줍니다.
alter table tasks add column if not exists acknowledged_by jsonb not null default '[]'::jsonb;

alter table task_comments add column if not exists department text;
alter table task_comments add column if not exists is_system boolean not null default false;

-- 이미 task_comments에 데이터가 쌓여있는 환경을 위해, 소속 업무(tasks)의 department를
-- 한 번 백필해둡니다(이후로는 코멘트 등록 시점에 항상 department를 함께 저장합니다).
update task_comments tc
set department = t.department
from tasks t
where tc.task_id = t.id and tc.department is null and t.department is not null;

create index if not exists task_comments_department_idx on task_comments(department, created_at);

-- ===== 32. 위클리 리포트 초기 데이터 시드 (테스트/더미 데이터) =====
-- 업로드된 weekly_report_supabase_seed.md의 더미 데이터를 실제 wr_* 테이블(uuid 기본키) 구조에
-- 맞춰 옮긴 것입니다. md5('고유문자열')::uuid 트릭으로 여러 insert 문이 서로를 안정적으로
-- 참조할 수 있는 고정 uuid를 만들었습니다(같은 문자열이면 항상 같은 uuid가 나와서, 이 스크립트를
-- 여러 번 실행해도 on conflict do nothing으로 안전하게 무시됩니다).
-- 주의: 원본 시드의 teacher1/teacher2 계정은 실제 @giamicro.com 이메일이 아니라서 teacher_email을
-- 비워뒀습니다. 관리자 화면(위클리 리포트 관리 > 반/담임 배정, 과목반 세팅)에서 실제 선생님
-- 이메일을 배정해주세요.
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

-- ===== 33. 레거시 정리: todos(개인 전용 할 일) 테이블 제거 =====
-- 25번에서 만든 todos는 27번의 tasks(팀 공유 칸반보드)로 완전히 대체되어 더 이상 화면 어디에서도
-- 쓰이지 않습니다(홈 화면 위젯도 이미 tasks 기반으로 바뀜). 있는 건 두고 없는 건 만들고 불필요한
-- 건 지운다는 원칙에 따라, 실서비스 DB에 남아있는 이 테이블을 안전하게 제거합니다.
drop table if exists todos cascade;

-- ===== 34. 업무(tasks)에 설명(description) 추가 - WorkFlatform UI/UX 이식 =====
-- 참조 소스코드(WorkFlatform)의 업무 카드는 제목과 별도로 짧은 설명(description)을 한 줄 더
-- 보여줍니다. 기존에는 title 하나뿐이었는데, 이 컬럼을 추가해 카드에 "무엇을 해야 하는지"를
-- 조금 더 자세히 적을 수 있게 했습니다(선택 입력 - 비워두면 예전처럼 제목만 보입니다).
alter table tasks add column if not exists description text;

-- ===== 35. 위클리 리포트 실제 데이터(반/학생 전체 명단) 이관 =====
-- 업로드된 weekly_report_gia_real_data.md의 실제 GIA 학생·반 명단(구 프로토타입 DB 덤프)을
-- 현재 wr_* 스키마(uuid 기본키) 구조에 맞춰 옮긴 것입니다. md5('고유문자열')::uuid 트릭으로
-- 이 스크립트를 여러 번 실행해도 on conflict do nothing으로 안전하게 무시됩니다.
--
-- 1) 32번에서 넣었던 테스트용 더미 데이터(이해린/김민지/팜하니/강해린/다니엘, 1a/2a 반)를
--    먼저 정리합니다 - 실제 명단과 섞이지 않도록 정확히 그 5명/2개 반/2개 과목만 지정해서
--    지웁니다(다른 데이터는 건드리지 않습니다). 학생 삭제 시 해당 학생의 리포트도 함께
--    지워집니다(wr_reports.student_id가 on delete cascade로 걸려있음).
delete from wr_subjects where id in (md5('wr-subject-math-1')::uuid, md5('wr-subject-eng-2')::uuid);
delete from wr_students where id in (
  md5('wr-student-1a-01')::uuid, md5('wr-student-1a-02')::uuid, md5('wr-student-1a-03')::uuid,
  md5('wr-student-2a-01')::uuid, md5('wr-student-2a-02')::uuid
);
delete from wr_classes where id in (md5('wr-class-1a')::uuid, md5('wr-class-2a')::uuid);

-- 2) 반 10개를 만듭니다. teacher_email은 원본 자료에 실제 @giamicro.com 이메일이 없어서
--    (아이디/비밀번호 방식의 구 시스템 계정만 있었음) 비워뒀습니다 - 아래 담임 선생님 성함을
--    참고해서 [위클리 리포트 관리 > 반/담임 배정] 화면에서 실제 이메일로 배정해주세요.
--    담임: 1A=Aimie, 1C=Carina, 1J=Jamie, 2Y=Yunsang, 2J=Jandy, 2K=Katherine,
--          3J=Janelle, 3A=Anna, 4A=Sarah, 5E=Eamonn
--    (Crystal/Michelle/Celine 선생님은 원본 자료상 담임이 아닌 과목 전담으로 보입니다 -
--     필요하시면 [과목반 세팅] 화면에서 과목별로 배정해주세요.)
insert into wr_classes (id, grade, class_name, teacher_email) values
  (md5('wr-class-real-1a')::uuid, '1', 'A', null),
  (md5('wr-class-real-1c')::uuid, '1', 'C', null),
  (md5('wr-class-real-1j')::uuid, '1', 'J', null),
  (md5('wr-class-real-2y')::uuid, '2', 'Y', null),
  (md5('wr-class-real-2j')::uuid, '2', 'J', null),
  (md5('wr-class-real-2k')::uuid, '2', 'K', null),
  (md5('wr-class-real-3j')::uuid, '3', 'J', null),
  (md5('wr-class-real-3a')::uuid, '3', 'A', null),
  (md5('wr-class-real-4a')::uuid, '4', 'A', null),
  (md5('wr-class-real-5e')::uuid, '5', 'E', null)
on conflict (id) do nothing;

-- 3) 학생 114명 전원을 넣습니다(원본 STU 코드를 md5 키에 그대로 넣어 고유성을 보장했습니다).
insert into wr_students (id, name, grade, class_name, status) values
  (md5('wr-student-real-STU-10000')::uuid, '김사랑(Benecia Kim)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10001')::uuid, '김단우(Danu Kim)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10002')::uuid, '심규민(Gyumin Shim)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10003')::uuid, '박하솜(Hasom Park)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10004')::uuid, '주이안(Ian Ju)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10005')::uuid, '김재이(Jay Kim)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10006')::uuid, '남예인(Jennie Nam)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10007')::uuid, '이라엘(Lael Lee)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10008')::uuid, '김도은(Rogan Kim)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-10009')::uuid, '이서준(Seojun Lee)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-100010')::uuid, '원세빈(Sophia Won)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-100011')::uuid, '권태이(Tay Kwon)', '1', 'A', 'active'),
  (md5('wr-student-real-STU-100012')::uuid, '한우영(Zoe Han)', '1', 'A', 'active'),

  (md5('wr-student-real-STU-10010')::uuid, '김나율(Anna Kim)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10011')::uuid, '이아인(Ayn Lee)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10012')::uuid, '황라윤(Bella Hwang)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10013')::uuid, '박도하(Doha Park)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10014')::uuid, '서민준(Eden Seo)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10015')::uuid, '이현우(Harry Lee)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10016')::uuid, '문준연(Joon Moon)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10017')::uuid, '연하윤(Hayoon Yon)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10018')::uuid, '김재이(Jay Kim)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-10019')::uuid, '고서윤(Jenny Go)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-100110')::uuid, '전준백(Justin Jeon)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-100111')::uuid, '백서아(Ruby Paik)', '1', 'C', 'active'),
  (md5('wr-student-real-STU-100112')::uuid, '박세인(Clara Park)', '1', 'C', 'active'),

  (md5('wr-student-real-STU-10020')::uuid, '신민하(Brooklyn Shin)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10021')::uuid, '손별(Byeol Son)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10022')::uuid, '곽세린(Celine Kwak)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10023')::uuid, '이예나(Eliana Lee)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10024')::uuid, '이은재(Ellie Lee)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10025')::uuid, '전지완(Eric Jeon)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10026')::uuid, '황이안(Ian Hwang)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10027')::uuid, '이예준(Isaac Lee)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10028')::uuid, '고진우(Jinwoo Ko)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-10029')::uuid, '이신원(Max Lee)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-100210')::uuid, '노유겸(Noah Roh)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-100211')::uuid, '박세주(Reina Park)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-100212')::uuid, '정서안(Sharlene Jung)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-100213')::uuid, '황라원(Sophia Hwang)', '1', 'J', 'active'),
  (md5('wr-student-real-STU-100214')::uuid, '이연우(Yeni Lee)', '1', 'J', 'active'),

  (md5('wr-student-real-STU-10030')::uuid, '임예나(Grace Lim)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10031')::uuid, 'Maya Amelia Dowding(Maya Amelia Dowding)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10032')::uuid, '임다현(Diane Lim)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10033')::uuid, '김현수(Hans Kim)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10034')::uuid, '민송희(Sophia Min)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10035')::uuid, '이서아(Vivian Lee)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10036')::uuid, '엄하율(Henry Hayule Eom)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10037')::uuid, '홍서형(Danny Hong)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10038')::uuid, '유한솔(Kai Yoo)', '2', 'Y', 'active'),
  (md5('wr-student-real-STU-10039')::uuid, '황시원(Sean Hwang)', '2', 'Y', 'active'),

  (md5('wr-student-real-STU-10040')::uuid, '강서후(Seohu Kang)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10041')::uuid, '김재이(Jay Kim)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10042')::uuid, '정겨울(Wynter Jeong)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10043')::uuid, '이서현(Elizabeth Lee)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10044')::uuid, '민노엘(Noel Min)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10045')::uuid, '강이제(Ije Kang)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10046')::uuid, '황준호(June Hwang)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10047')::uuid, '정이엘(E.L. Jeong)', '2', 'J', 'active'),
  (md5('wr-student-real-STU-10048')::uuid, '정레인(Rain Jung)', '2', 'J', 'active'),

  (md5('wr-student-real-STU-10050')::uuid, '이준원(Jun Lee)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10051')::uuid, '최서아(Sarah Choi)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10052')::uuid, '정세진(Emma Jung)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10053')::uuid, '차봄(Bom Cha)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10054')::uuid, '이주원(Benny Lee)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10055')::uuid, '지수(Soo Ji)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10056')::uuid, '이준서(Justin Lee)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10057')::uuid, '이예온(Grace Lee)', '2', 'K', 'active'),
  (md5('wr-student-real-STU-10058')::uuid, '임주한(Juhan Lim)', '2', 'K', 'active'),

  (md5('wr-student-real-STU-10060')::uuid, '곽호율(James Kwak)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10061')::uuid, '홍동은(Jaden Hong)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10062')::uuid, '김태오(Theo Kim)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10063')::uuid, '남가인(Gahin Nam)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10064')::uuid, '고이건(Eagon Koh)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10065')::uuid, '김서진(Seojin Kim)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10066')::uuid, '마리아 파즈 마누키안(Maria Paz Manoukian)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10067')::uuid, '김동하(Dongha Kim)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10068')::uuid, '정채린(Serena Jung)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-10069')::uuid, '김태리(Terry Kim)', '3', 'J', 'active'),
  (md5('wr-student-real-STU-100610')::uuid, '임하임(Blaire Lim)', '3', 'J', 'active'),

  (md5('wr-student-real-STU-10070')::uuid, '김서이(Victoria Kim)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10071')::uuid, '김지민(Jimin Kim)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10072')::uuid, '유재이(Jay Yu)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10073')::uuid, '이세은(Lina Lee)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10074')::uuid, '임선우(Sunwoo Lim)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10075')::uuid, '정리사(Lisa Jung)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10076')::uuid, '정서우(Stella Jung)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10077')::uuid, '정하임(Hayim Jung)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10078')::uuid, '강하라(Hara Kang)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-10079')::uuid, '황준호(June Hwang)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-100710')::uuid, '조장훈(Janghoon Cho)', '3', 'A', 'active'),
  (md5('wr-student-real-STU-100711')::uuid, '권수호(Teddy Kwon)', '3', 'A', 'active'),

  (md5('wr-student-real-STU-10080')::uuid, '임지효(Jihyo Yim)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10081')::uuid, '최서연(Seoyeon Choi)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10082')::uuid, '강예성(Yesung Kang)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10083')::uuid, '이한범(Danny Lee)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10084')::uuid, '김리안(Rian Kim)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10085')::uuid, '강하늘(Skye Kang)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10086')::uuid, '김태지(Teji Kim)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10087')::uuid, '김태윤(Teddy Kim)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10088')::uuid, '이온유(Roy Lee)', '4', 'A', 'active'),
  (md5('wr-student-real-STU-10089')::uuid, '도윤서(Yoonseo Doh)', '4', 'A', 'active'),

  (md5('wr-student-real-STU-10090')::uuid, '박준후(Justin Park)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10091')::uuid, '문수민(Clara Moon)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10092')::uuid, '김시아(Joy Kim)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10093')::uuid, '김시준(Leo Kim)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10094')::uuid, '정도현(Aaron Jung)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10095')::uuid, '정채윤(Olivia Jung)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10096')::uuid, '강하엘(Hael Kang)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10097')::uuid, '제이콥 딜런 마(Jacob Dylan Ma)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10098')::uuid, '강여명(Ryeomyeong Kang)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-10099')::uuid, '후안 이그나시오 마누키안(Juan Ignacio Manoukian)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-100910')::uuid, '이도후(Henry Lee)', '5', 'E', 'active'),
  (md5('wr-student-real-STU-100911')::uuid, '박지음(Jeum Park)', '5', 'E', 'active')
on conflict (id) do nothing;

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

-- ===== 37. wr_reports에 학년/반 스냅샷 컬럼 추가 (연도-학기-학년-반 통합 검색) =====
-- 지금까지 wr_reports는 student_id + term_id(연도+학기)만 갖고 있어서, "이 학기 3학년 2반
-- 리포트만 모아보기" 같은 검색을 하려면 wr_enrollments를 거쳐 조인해야 했습니다. 리포트를
-- 쓴/발행한 시점의 학년·반을 리포트 행 자체에 함께 저장해두면(wr_enrollments처럼 이력용
-- 스냅샷) 조인 없이 바로 연도-학기-학년-반 조합으로 검색할 수 있습니다. 반이 학기 중간에
-- 바뀌어도 그 시점 리포트의 반 기록은 그대로 남습니다.
alter table wr_reports add column if not exists class_id uuid references wr_classes(id) on delete set null;
alter table wr_reports add column if not exists grade text;
create index if not exists wr_reports_term_grade_class_idx on wr_reports(term_id, grade, class_id);

-- 기존에 이미 저장된 리포트에도 소급 적용합니다: 같은 student_id+term_id의 재학 이력
-- (wr_enrollments)이 있으면 그 학년/반을, 없으면 학생의 현재 학년/반(wr_students)을 채웁니다.
-- (UPDATE ... FROM의 JOIN ON 절에서는 갱신 대상 테이블(r)을 참조할 수 없어 - Postgres 제약 -
-- 상관 서브쿼리 형태로 작성했습니다.)
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

-- ===== 38. 내 계정 설정(프로필 사진/이름) + 직위(권한) 뱃지 관리자 편집 + 자기수정 범위 확대 =====
-- position(교사/행정직원/관리자/개발자)은 layout.tsx의 isAdmin/isTeacher/isStaffOrAbove 권한
-- 판단에 직접 쓰이는 값이자, 사이드바 뱃지에 그대로 노출되는 "우리 권한 체계" 그 자체입니다.
-- 그래서 본인이 자유 문구로 바꿀 수 있는 별도 필드를 두지 않고, position 값 자체를 읽기 전용
-- 뱃지로 노출합니다 - 실제로 이 값을 바꿀 수 있는 사람은 관리자(이상)뿐이고, 승인 시점이든
-- 그 이후든 [학교관리 > 사용자 관리] 화면에서 지정/변경합니다(온보딩 때 본인이 고른 값은
-- 참고용 초기값일 뿐, 승인하려면 관리자가 직위를 확정해야 합니다).
alter table app_users add column if not exists avatar_url text;

-- 온보딩 때만(name is null) 스스로 고칠 수 있던 기존 정책을 "언제든 본인 행을 수정 가능"으로
-- 넓힙니다 - 이제 내 계정 설정 화면에서 이름/사진을 온보딩 이후에도 바꿀 수 있어야 하기
-- 때문입니다. email/status/decided_at/decided_by/position은 아래 트리거가 비관리자에겐
-- 항상 원래 값으로 되돌리므로, 이 정책이 넓어져도 그 컬럼들(특히 position)은 여전히 스스로
-- 바꿀 수 없고 관리자만 바꿀 수 있습니다.
drop policy if exists "app_users_update_self_onboarding" on app_users;
drop policy if exists "app_users_update_self" on app_users;
create policy "app_users_update_self" on app_users
  for update
  using (email = lower(auth.jwt() ->> 'email'))
  with check (email = lower(auth.jwt() ->> 'email'));

-- position도 email/status/decided_at/decided_by와 함께 비관리자는 절대 스스로 바꿀 수 없도록
-- 트리거를 확장합니다(권한 상승 방지). 관리자(is_app_admin())의 수정은 그대로 통과됩니다.
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

-- 프로필 사진 - 공개 버킷으로 만들어(공개 URL 그대로 사용) 사이드바를 렌더링할 때마다
-- signed URL을 새로 발급받는 비용을 피합니다(민감 정보가 아니므로 공개해도 괜찮은 사진).
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

-- ===== 39. 채팅 메시지 - 보낸 사람 본인만 삭제 가능 =====
-- 기존 "giamicro_all_messages" 정책은 for all(select/insert/update/delete 전부)이라, 도메인
-- 계정이기만 하면 다른 사람이 보낸 메시지도 지울 수 있었습니다. 잘못 보낸 메시지는 "보낸
-- 사람만" 지울 수 있어야 하므로, 하나의 for all 정책을 명령별로 쪼갰습니다: 조회는 그대로
-- 누구나, 작성은 author_email이 본인 계정과 같을 때만(다른 사람 이름으로 메시지를 보내는 것도
-- 막습니다), 삭제는 author_email이 본인일 때만 허용합니다.
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

-- Supabase Realtime은 DELETE 이벤트의 "이전 행" 정보를 기본적으로 기본키만 담아 보냅니다.
-- ChatPanel의 실시간 구독이 department 컬럼으로 필터링하는데, 기본키만 오면 그 필터를 판단할
-- 수 없어 삭제 이벤트 자체가 다른 접속자에게 전달되지 않습니다. REPLICA IDENTITY FULL로
-- 바꾸면 삭제된 행의 전체 컬럼이 함께 전달되어 필터가 정상 동작합니다.
alter table messages replica identity full;

-- ===== 40. 채팅 - 답장/수정/이모지 반응 (구글챗 스타일 기능) =====
-- reply_to_id: 답장(인용)할 때 원본 메시지를 가리킵니다. 원본이 나중에 삭제되면 답장 자체는
-- 남기고 참조만 끊습니다(on delete set null) - "삭제된 메시지에 대한 답장"이라는 게 채팅에서는
-- 자연스러운 표현이라 답장까지 함께 지우지 않습니다.
alter table messages add column if not exists reply_to_id uuid references messages(id) on delete set null;
-- edited_at: 값이 있으면 화면에 "(수정됨)"을 표시합니다.
alter table messages add column if not exists edited_at timestamptz;

-- 메시지 수정은 보낸 사람 본인만 가능합니다(삭제와 동일한 원칙).
drop policy if exists "author_update_own_messages" on messages;
create policy "author_update_own_messages" on messages
  for update
  using (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'))
  with check (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));

-- 이모지 반응 - 메시지 자체를 건드리지 않고 별도 테이블에 "누가 어떤 메시지에 어떤 이모지를
-- 남겼는지"만 기록합니다(메시지 jsonb 컬럼을 여러 사람이 동시에 고치는 것보다 훨씬 안전합니다).
-- 같은 사람이 같은 메시지에 같은 이모지를 두 번 못 남기게 unique 제약을 걸어두고, 클라이언트는
-- 이미 남긴 반응을 다시 누르면 삭제(토글)합니다.
-- department을 반응 테이블에도 그대로 복사해둡니다(messages와 조인 없이도 실시간 구독을
-- department별로 필터링하려면 필요합니다 - 그렇지 않으면 다른 부서 채팅방의 반응 이벤트까지
-- 전부 받아서 매번 걸러내야 합니다).
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

-- ===== 42. 업무기록(archive) - 완료된 업무를 연도/학기/날짜별로 보관 =====
-- completed_at: 상태가 '완료'로 바뀐 시각(다시 열었다가 재완료하면 그때마다 갱신됨) - "언제
-- 했는지"의 기준 시각입니다. archived_at: 매일 밤 크론이 그 전날까지 완료된 업무를 업무보드
-- 칸반에서 빼서 업무기록으로 넘길 때 채우는 시각 - 이 값이 있으면 화면(칸반)에서는 더 이상
-- 안 보이고 업무기록에만 보입니다. term_id: 보관 시점에 "진행중"이던 학기를 스냅샷으로
-- 남겨서, 업무기록 화면이 연도>학기별로 묶어 보여줄 수 있게 합니다(incidents/meetings와
-- 동일한 패턴).
alter table tasks add column if not exists completed_at timestamptz;
alter table tasks add column if not exists archived_at timestamptz;
alter table tasks add column if not exists term_id uuid references terms(id) on delete set null;
create index if not exists tasks_archived_at_idx on tasks(archived_at);
create index if not exists tasks_term_id_idx on tasks(term_id);

-- ===== 43. 업무 - 공유 업무 실시간 알림용 updated_by =====
-- "누가 상태를 바꿨는지" 알아야 그 사람 본인에게는 알림을 안 띄우고, 태그된 다른 사람에게만
-- 실시간 토스트로 "OOO님이 이 업무를 진행중으로 옮겼어요" 같은 알림을 보여줄 수 있습니다.
alter table tasks add column if not exists updated_by text;

-- 위 messages 테이블과 같은 이유로, UPDATE 이벤트에 이전 status 값이 함께 와야 "정말 상태가
-- 바뀐 변경인지"(단순 담당자 태그 수정이나 확인 체크 등은 제외) 클라이언트에서 구분할 수
-- 있습니다. 기본 REPLICA IDENTITY는 기본키만 old에 담아 보내 이 구분이 불가능했습니다.
alter table tasks replica identity full;

-- ===== 44. 업무 삭제 권한 분리 (등록자 본인 또는 관리자만) =====
-- 기존 "giamicro_all_tasks" 정책은 for all이라 giamicro.com 계정이면 누구나 남의 업무도
-- 지울 수 있었습니다. messages 테이블 때와 동일한 패턴으로, 삭제만 등록자 본인(또는
-- 관리자)로 좁히고 나머지 명령은 그대로 넓게 유지합니다.
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
-- 빠른 업무등록 위젯에서 고른 뱃지([나]/[전체]/[공유])를 그대로 저장해서, 칸반 카드
-- 테두리 색을 부서색 대신 이 값으로 표시할 수 있게 합니다. 채팅으로 등록되는 업무(AI
-- 분석/@태그)는 특정 인원에게 배정되는 경우가 대부분이라 기본값을 '공유'로 둡니다.
alter table tasks add column if not exists origin_mode text not null default '공유'
  check (origin_mode in ('나', '전체', '공유'));

-- 색상은 3개(나/전체/공유) 고정 행만 있는 아주 작은 설정 테이블입니다. 조회는 누구나,
-- 수정(색상 변경)은 관리자 이상만 가능합니다.
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
-- 업무를 보류로 보내면서 "이슈가 있다"고 표시하면, 이유를 적는 메모를 남길 수 있습니다.
-- 이 메모는 일반 코멘트와 같은 테이블(task_comments)에 저장하되, is_issue로 구분해서
-- 업무기록/상세 화면에서 다르게(⚠️ 강조) 보여줄 수 있게 합니다. 작성자는 author_email로
-- 이미 표시되고 있어 별도 컬럼이 필요 없습니다.
alter table task_comments add column if not exists is_issue boolean not null default false;

-- ===== 47. 주간 학생 관찰기록 - 영문 이름 + 관리자/행정직원 삭제 권한 =====
-- 담당 교사 중 영어 원어민이 있어 학생 리스트를 영어 이름과 함께 볼 수 있어야 합니다.
alter table wr_students add column if not exists name_en text;

-- 관리자(position='관리자') 또는 행정직원(position='행정직원')이면 참 - is_app_admin()은
-- '관리자'만 포함하므로, 위클리 리포트에서는 행정직원까지 포함하는 이 함수를 따로 둡니다.
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

-- 리포트 삭제는 그동안 아예 만들 수 없었는데(화면에 버튼 자체가 없었음), 이제 관리자/행정직원만
-- 지울 수 있게 허용합니다. 조회/작성/수정은 기존처럼 giamicro.com 계정이면 누구나 가능한 범위를
-- 유지합니다(교사는 화면(UI)에서 자기 담당 과목만 수정하도록 이미 제한되어 있습니다).
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

-- ===== 48. 반복 업무 + 업무별 첨부파일 =====
-- 반복 업무: 완료되는 순간 클라이언트가 다음 회차를 자동으로 새로 등록합니다. recurrence는
-- {freq:'daily'|'weekly'|'monthly', weekday?, day_of_month?} 형태의 JSON이고,
-- recurrence_group_id는 같은 반복 시리즈의 여러 회차를 하나로 묶어 추적하기 위한 값입니다.
alter table tasks add column if not exists recurrence jsonb;
alter table tasks add column if not exists recurrence_group_id uuid;

-- 업무별 첨부파일 - 채팅 첨부(messages.attachment_*)와 동일한 구조를 업무카드 단위로 반복합니다.
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

-- ===== 49. AI 기능별 과금 on/off 토글 (개발자 대시보드) =====
-- callClaudeJson()이 호출될 때마다 opts.route로 넘어오는 값과 1:1로 매칭되는 "기능 스위치"
-- 테이블입니다. 개발자가 과금이 부담스러운 기능을 여기서 끄면(enabled=false), claude.ts가 실제
-- Anthropic API를 호출하기 전에 막아서 비용이 아예 발생하지 않습니다. 모든 로그인 사용자가
-- SELECT 할 수 있어야 사이드바 "일시정지중" 배너를 누구나 볼 수 있고, 끄고 켜는 것은 개발자만
-- 가능합니다. key는 src/lib/ai/pricing.ts의 AI_FEATURES 목록과 반드시 일치해야 합니다.
create table if not exists ai_feature_flags (
  key text primary key,
  label text not null,
  group_name text not null,
  enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table ai_feature_flags enable row level security;

drop policy if exists "giamicro_select_ai_feature_flags" on ai_feature_flags;
create policy "giamicro_select_ai_feature_flags" on ai_feature_flags
  for select using (is_giamicro_user());

drop policy if exists "developer_manage_ai_feature_flags" on ai_feature_flags;
create policy "developer_manage_ai_feature_flags" on ai_feature_flags
  for all using (is_developer()) with check (is_developer());

insert into ai_feature_flags (key, label, group_name) values
  ('scan:incidents', '사건기록 정리 AI', '기록함'),
  ('scan:events', '행사기록 정리 AI', '기록함'),
  ('scan:meetings', '회의기록 정리 AI', '기록함'),
  ('fill-incident', '사건기록 자동작성 AI', '기록함'),
  ('clean-meeting', '회의록 다듬기 AI', '기록함'),
  ('meeting-chat', '회의록 챗봇 AI', '기록함'),
  ('compare-events', '행사 비교분석 AI', '기록함'),
  ('compare-terms', '학기 비교분석 AI', '기록함'),
  ('manual-draft', '매뉴얼 초안작성 AI', '매뉴얼 · 문서'),
  ('manual-faq', '매뉴얼 FAQ AI', '매뉴얼 · 문서'),
  ('document-draft', '서류 초안작성 AI', '매뉴얼 · 문서'),
  ('document-recommend', '서류 추천 AI', '매뉴얼 · 문서'),
  ('anticipate-complaints', '민원예측 AI', '제안함 · 채택예정'),
  ('review-adopted', '채택예정 검토 AI', '제안함 · 채택예정'),
  ('proposals-decide', '제안 승인 정리 AI', '제안함 · 채택예정'),
  ('analyze-task', '업무 분석 AI', '업무')
on conflict (key) do nothing;

-- ===== 50. 동시입력 안전장치: 업무 확인/담당자 토글 원자적 RPC + wr_reports 중복 방지 =====
-- 여러 사람이 동시에 같은 데이터를 건드릴 때 생기는 두 가지 문제를 막습니다.
--
-- (1) tasks.acknowledged_by(업무 확인)/assignee_emails(담당자 태그)는 지금까지 클라이언트가
--     "현재 배열 + 새 항목"을 계산해서 배열 전체를 update했습니다. 예를 들어 전체공지 업무를
--     5명이 거의 동시에 "확인" 클릭하면, 늦게 도착한 update가 먼저 도착한 사람의 확인 기록을
--     통째로 덮어써서 조용히 사라질 수 있었습니다(감지 불가능한 데이터 유실). 아래 두 함수는
--     update 한 문장으로 처리되어 Postgres가 같은 행에 대한 동시 update를 자동으로 한 번에
--     하나씩 순서대로 처리해주므로, 몇 명이 동시에 눌러도 모든 기록이 안전하게 누적됩니다.
create or replace function toggle_task_ack(p_task_id uuid, p_email text)
returns tasks
language sql
as $$
  update tasks t
  set acknowledged_by = case
    when exists (
      select 1 from jsonb_array_elements(t.acknowledged_by) e where e->>'email' = p_email
    )
    then coalesce(
      (select jsonb_agg(e) from jsonb_array_elements(t.acknowledged_by) e where e->>'email' <> p_email),
      '[]'::jsonb
    )
    else t.acknowledged_by || jsonb_build_array(jsonb_build_object('email', p_email, 'time', now()))
  end
  where t.id = p_task_id
  returning *;
$$;

create or replace function toggle_task_assignee(p_task_id uuid, p_email text)
returns tasks
language sql
as $$
  update tasks
  set assignee_emails = case
    when p_email = any(assignee_emails) then array_remove(assignee_emails, p_email)
    else array_append(assignee_emails, p_email)
  end
  where id = p_task_id
  returning *;
$$;

-- (2) 주간 학생 관찰기록(wr_reports)도 같은 학생/과목/주(report_date) 리포트를 두 사람이(또는
--     한 사람이 두 탭으로) 거의 동시에 처음 열어 저장하면, 둘 다 "아직 리포트가 없다"고 판단해
--     각자 INSERT를 해서 중복 행이 생길 수 있었습니다. 먼저 기존에 이미 생겼을 수 있는 중복을
--     최신 것만 남기고 정리한 뒤, DB가 직접 중복을 막도록 고유 제약을 겁니다(앱 쪽은 이제
--     upsert로 저장하도록 함께 수정했습니다 - ReportFormModal.tsx).
delete from wr_reports a
using wr_reports b
where a.student_id = b.student_id
  and a.subject = b.subject
  and a.report_date = b.report_date
  and (a.updated_at, a.id) < (b.updated_at, b.id);

drop index if exists wr_reports_student_idx;
create unique index if not exists wr_reports_unique_idx on wr_reports(student_id, subject, report_date);
alter table wr_reports drop constraint if exists wr_reports_unique_key;
alter table wr_reports add constraint wr_reports_unique_key unique using index wr_reports_unique_idx;

-- ===== 51. 실시간 채팅/업무판 정밀 점검 후 보완 =====
-- (1) 반복 업무 다음 회차 중복 생성 방지: 칸반 드래그/상세패널 두 곳 모두 완료 처리 시 다음
-- 회차를 만들 수 있게 됐는데(TaskDetailPanel.tsx도 이제 반복을 이어갑니다), 두 사람이 거의
-- 동시에 같은 업무를 완료 처리하면 둘 다 "다음 회차"를 insert 시도할 수 있습니다. 같은
-- 반복 시리즈(recurrence_group_id)에서 다음 마감일(due_at)이 겹치는 두 번째 시도는 이 고유
-- 제약에 걸려 실패하는데, 클라이언트(src/lib/recurrence.ts의 renewRecurringTask)가 그 실패
-- (23505)를 정상 상황으로 조용히 무시하도록 되어 있어 중복 업무가 생기지 않습니다.
create unique index if not exists tasks_recurrence_next_idx
  on tasks(recurrence_group_id, due_at)
  where recurrence_group_id is not null;

-- (2) 채팅 메시지 본문 검색(ILIKE '%검색어%')은 앞에 %가 붙어 일반 인덱스를 못 쓰고 매번
-- 전체를 훑습니다. pg_trgm 확장 + GIN 인덱스를 걸어두면 메시지가 많이 쌓여도 검색이 느려지지
-- 않습니다(사람 수·메시지 수가 지금 당장은 적어도, 몇 달 뒤를 대비한 예방 조치입니다).
create extension if not exists pg_trgm;
create index if not exists messages_content_trgm_idx on messages using gin (content gin_trgm_ops);

-- ===== 52. 반(wr_classes) 담임을 "이름만" 임시 배정 (계정 이메일은 나중에 연결) =====
-- 담임 계정(giamicro.com 로그인)이 아직 만들어지지 않은 상태에서도, 실제 담임 이름 기준으로
-- 반을 미리 배정해둘 수 있도록 이름 전용 컬럼을 추가합니다. teacher_email이 채워지면 화면은
-- 그 계정 이름을 우선 보여주고, 비어있으면 이 이름을 대신 보여줍니다(ClassManageClient.tsx).
alter table wr_classes add column if not exists teacher_name text;
alter table wr_classes add column if not exists sub_teacher_name text;

update wr_classes set teacher_name = 'Aimie' where class_name = '1A' and teacher_name is null;
update wr_classes set teacher_name = 'Carina' where class_name = '1C' and teacher_name is null;
update wr_classes set teacher_name = 'Jamie' where class_name = '1J' and teacher_name is null;
update wr_classes set teacher_name = 'Yunsang' where class_name = '2Y' and teacher_name is null;
update wr_classes set teacher_name = 'Jandy' where class_name = '2J' and teacher_name is null;
update wr_classes set teacher_name = 'Katherine' where class_name = '2K' and teacher_name is null;
update wr_classes set teacher_name = 'Janelle' where class_name = '3J' and teacher_name is null;
update wr_classes set teacher_name = 'Anna' where class_name = '3A' and teacher_name is null;
update wr_classes set teacher_name = 'Sarah' where class_name = '4A' and teacher_name is null;
update wr_classes set teacher_name = 'Eamonn' where class_name = '5E' and teacher_name is null;

-- ===== 53. 관리자 메뉴 신설: 교육뉴스 + GIA시스템 =====
-- 관리자(부이사장/이사장 등)만 보는 두 기능입니다. 둘 다 Anthropic의 web_search 도구로 최신
-- 웹 정보를 찾아와 생성하므로(callClaudeJsonWithWebSearch), is_app_admin()만 접근하도록
-- 다른 지원 테이블(inquiries 등)보다 좁게 RLS를 걸었습니다.

-- (1) 교육뉴스: 주 2회(월/수) AI가 국제학교/교육정책/트렌드 관련 최신 소식을 검색해 정리해
-- 쌓아두는 다이제스트입니다. items는 [{category, headline, body, source_name, source_url}] 배열.
create table if not exists education_news (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,
  published_date date not null default current_date,
  title text not null,
  summary text not null,
  items jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists education_news_date_idx on education_news (published_date desc);
alter table education_news enable row level security;
drop policy if exists "admin_all_education_news" on education_news;
create policy "admin_all_education_news" on education_news
  for all using (is_app_admin()) with check (is_app_admin());

-- (2) GIA시스템: GIA가 이미 갖춘 시스템(카테고리별 보유/부분보유/미보유 현황)과, 다른 국제학교/
-- 공립학교가 갖춘 시스템 중 GIA에 없는 것을 AI가 웹 검색으로 찾아 제안하는 기능입니다.
-- source='ai_suggested'인 미보유 항목을 관리자가 "제안함으로 보내기"를 누르면 기존
-- proposals→adopted(채택예정)→발행 파이프라인(운영관리)을 그대로 타고, 발행되는 순간
-- 이 표의 상태가 자동으로 '보유'로 바뀝니다(아래 adopted.system_ref_id로 연결).
create table if not exists gia_systems (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  status text not null default '미보유',   -- 보유 | 부분보유 | 미보유
  description text,
  benchmark_school text,                    -- AI 제안일 때 참고한 벤치마킹 대상(학교/사례)
  source text not null default 'manual',    -- manual | ai_suggested
  adopted_from_id uuid,
  adopted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists gia_systems_category_name_idx on gia_systems (category, name);
alter table gia_systems enable row level security;
drop policy if exists "admin_all_gia_systems" on gia_systems;
create policy "admin_all_gia_systems" on gia_systems
  for all using (is_app_admin()) with check (is_app_admin());

drop trigger if exists gia_systems_set_updated_at on gia_systems;
create trigger gia_systems_set_updated_at
  before update on gia_systems
  for each row execute function set_updated_at();

-- proposals에 "GIA시스템 제안" 출처를 추가하고, adopted에는 어떤 gia_systems 행에서 왔는지
-- 역참조 컬럼을 둡니다(발행 시 자동으로 그 행을 '보유'로 갱신하기 위함 - /api/adopted/publish).
alter table proposals drop constraint if exists proposals_source_check;
alter table proposals add constraint proposals_source_check
  check (source in ('incidents', 'events', 'meetings', 'manual', 'complaint', 'system'));
alter table adopted add column if not exists system_ref_id uuid references gia_systems(id) on delete set null;

-- GIA가 이 앱을 통해 이미 갖추고 있는 시스템을 항목별로 미리 정리해둡니다(관리자가 처음 이
-- 화면을 열었을 때부터 "이미 갖춘 것"이 채워져 있도록). 이후 AI 제안이 발행되면 이 목록에
-- 새 행이 자동으로 추가되거나 상태가 갱신됩니다.
insert into gia_systems (category, name, status, description, source) values
  ('구비서류', '서류함(구비서류 체크리스트)', '보유', 'GIA 운영 앱의 서류함에서 필요서류 목록과 준비 상태(필요/준비중/보유/만료임박)를 관리하고 있습니다.', 'manual'),
  ('내규', '실무자 매뉴얼', '부분보유', '사건/행사 대응 절차 등 일부 내규성 문서는 실무자 매뉴얼에 정리돼 있으나, 별도의 정식 취업규칙/내규집은 아직 없습니다.', 'manual'),
  ('계약서', '계약서 관리', '미보유', '교직원/거래처 계약서를 별도로 체계화해 관리하는 기능이 아직 없습니다.', 'manual'),
  ('학생관리', '학생 통합 프로필 + 주간 학생 관찰기록', '보유', '학생별 영구 고유번호, 재학이력, 과목별 평가·코멘트를 관리하고 있습니다.', 'manual'),
  ('교사관리', '교직원 직위·담당 배정 관리', '보유', '교사/행정직원/관리자 직위 구분과 담당 반·과목 배정을 관리하고 있습니다.', 'manual'),
  ('교직원관리', '사용자 승인·직위 관리', '보유', '신규 직원 온보딩 승인, 소속·직위 지정을 관리자 화면에서 처리하고 있습니다.', 'manual'),
  ('매뉴얼', '운영계획안 · 실무자매뉴얼 (AI 초안작성 포함)', '보유', 'AI 초안작성을 포함한 매뉴얼 작성/발행 시스템을 갖추고 있습니다.', 'manual'),
  ('운영계획안', '운영계획안(학부모용 문서)', '보유', '매뉴얼 시스템 내 학부모용 문서로 관리되고 있습니다.', 'manual')
on conflict (category, name) do nothing;

-- ===== 54. 속도개선: terms(학기) 테이블 인덱스 =====
-- getCurrentTerm()이 "지금 진행중인 학기"를 찾기 위해 거의 모든 화면 진입 시(레이아웃+9개
-- 페이지) status='진행중' 필터 + start_date 정렬로 이 테이블을 조회합니다. 지금까지 이 테이블에
-- 색인이 없어 매번 전체를 훑고 있었는데, 학기 수가 쌓일수록 영향이 커지므로 색인을 추가합니다.
create index if not exists terms_status_start_date_idx on terms (status, start_date desc);

-- ===== 55. PIN 2차 보안 제거 =====
-- 구글 로그인(도메인 제한) + 관리자 승인 두 단계로도 충분히 보안이 된다는 판단에 따라, 승인
-- 뒤 한 번 더 개인 PIN을 입력하게 하던 2차 확인 단계를 없앴습니다(요청: "보안 핀 설정은
-- 없애줘 지금으로도 확실히 보안은 되는것 같아"). 앱 쪽 미들웨어의 PIN 체크와 /pin 화면,
-- /api/pin 라우트는 이미 코드에서 제거했고, 여기서는 더 이상 쓰지 않는 pins 테이블만 정리합니다.
drop table if exists pins;

-- ===== 56. 업무(tasks) 공개범위 - 등록 방식(나/공유/전체)에 따라 실제로 조회를 제한 =====
-- 지금까지 "giamicro_select_tasks" 정책은 giamicro.com 로그인 계정이면 누구나 모든 업무를
-- 조회할 수 있었습니다. [나]/[공유] 모드로 등록해도 실제로는 화면에서만 안 보였을 뿐, 다른
-- 직원 브라우저로도 데이터 자체는 그대로 내려가고 있었습니다. 요청에 따라 조회 단계에서부터
-- 실제로 막습니다: [전체]는 그대로 모두에게 보이고, [나](개인 업무)와 [공유](태그한 사람에게만
-- 배정)는 등록자 본인과 담당자(assignee_emails)로 태그된 사람에게만 보입니다. [나] 모드는
-- 등록자=담당자=나 자신이라 결과적으로 나에게만 보이고, [공유] 모드는 등록자인 나와 내가
-- 태그한 사람 모두에게 보입니다(요청: "업무등록 나로 할경우 다른사람에게는 안보이고
-- 나에게만... 태그를 하면 내 업무목록과 태그한사람 둘에게... 전체로 하면 모두에게").
drop policy if exists "giamicro_select_tasks" on tasks;
create policy "giamicro_select_tasks" on tasks
  for select using (
    is_giamicro_user()
    and (
      origin_mode = '전체'
      or owner_email = lower(auth.jwt() ->> 'email')
      or lower(auth.jwt() ->> 'email') = any(assignee_emails)
    )
  );

-- ===== 57. 데이터 백업/복원 (관리자·개발자 전용) =====
-- 사건/회의/행사/제안함/채택예정/매뉴얼/업무/서류함처럼 매일 손으로 입력·수정하는 운영
-- 핵심 데이터가 실수나 버그로 꼬이거나 통째로 날아가는 사고에 대비해, 버튼 한 번으로 지금
-- 상태를 JSON 스냅샷으로 저장해두고, 필요하면 그 시점으로 되돌릴 수 있게 합니다(요청:
-- "데이터가 꼬여서 날아가버리지않게 백업할수있게... 백업복원도 관리자,개발자권한을 가진
-- 사람이 복원 할 수 있게"). is_app_admin()은 이미 "직위=관리자" 또는 "개발자 계정"이면
-- true라(정의는 위 3번 섹션 참고) 별도 권한 함수 없이 그대로 씁니다.
--
-- 백업 대상은 아래 10개 테이블(사건/회의/행사/제안함/채택예정/매뉴얼/업무 3종/서류함)로
-- 한정합니다 - 로그인 계정(app_users)·채팅(messages)·주간 관찰기록(wr_*)처럼 되돌렸을 때
-- 오히려 로그인/권한이 꼬이거나 영향 범위가 지나치게 커지는 테이블은 일부러 뺐습니다.
-- 필요해지면 이 배열에 추가하면 됩니다.
create or replace function backup_target_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'incidents', 'meetings', 'events', 'proposals', 'adopted', 'manual_sections',
    'documents', 'tasks', 'task_comments', 'task_attachments'
  ];
$$;

create table if not exists backups (
  id uuid primary key default gen_random_uuid(),
  label text,
  created_by text not null,
  created_at timestamptz not null default now(),
  tables text[] not null,   -- 이 스냅샷이 실제로 포함한 테이블 목록(복원 시 이 목록만 사용)
  snapshot jsonb not null   -- { "incidents": [...], "meetings": [...], ... }
);

alter table backups enable row level security;

-- 조회는 관리자/개발자만 - insert/update/delete용 정책은 만들지 않습니다. 백업 생성·복원은
-- 아래 security definer 함수를 통해서만 이뤄지고, 함수 안에서 매번 is_app_admin()을 다시
-- 확인하므로 이 테이블에 직접 쓰는 경로 자체가 없습니다(RLS를 우회하는 함수이니만큼 함수
-- 내부 검사가 유일한 방어선입니다).
drop policy if exists "admin_select_backups" on backups;
create policy "admin_select_backups" on backups
  for select using (is_giamicro_user() and is_app_admin());

-- 백업 생성: 대상 테이블을 하나씩 훑어 JSON 배열로 통째로 담습니다. security definer로
-- 실행해야, tasks처럼 행 단위로 조회 범위가 좁아진(요청 56번) 테이블도 "지금 보이는 것만"이
-- 아니라 전체가 빠짐없이 백업됩니다 - 대신 함수 맨 앞에서 is_app_admin()을 확인해, 이 강한
-- 권한이 관리자/개발자 외에는 절대 쓰이지 않도록 막습니다.
create or replace function create_backup(p_label text default null)
returns backups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_table_json jsonb;
  v_snapshot jsonb := '{}'::jsonb;
  v_row backups;
begin
  if not is_app_admin() then
    raise exception '백업은 관리자/개발자만 만들 수 있습니다.';
  end if;

  foreach v_table in array backup_target_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %I t', v_table)
      into v_table_json;
    v_snapshot := jsonb_set(v_snapshot, array[v_table], v_table_json);
  end loop;

  insert into backups (label, created_by, tables, snapshot)
  values (p_label, lower(auth.jwt() ->> 'email'), backup_target_tables(), v_snapshot)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function create_backup(text) from public;
grant execute on function create_backup(text) to authenticated;

-- 백업 복원: 테이블을 통째로 delete 후 insert하지 않고, "스냅샷에 없는 행만 지우고, 스냅샷에
-- 있는 행은 upsert(있으면 덮어쓰고 없으면 새로 만듦)"하는 방식을 씁니다. 예를 들어
-- incident_students(사건-학생 연결)처럼 이 백업 대상에는 없지만 incidents를 참조하는 다른
-- 테이블이 있는데, 지금도 있고 백업에도 있는 사건까지 일단 통째로 지웠다가 다시 넣으면
-- on delete cascade로 그 연결 데이터까지 도미노로 사라져버립니다. upsert 방식은 실제로
-- "이 백업 시점엔 없었던" 행만 지우므로 그런 부작용이 없습니다. 테이블 순서(위 배열)는
-- task_comments/task_attachments가 tasks보다 뒤에 오도록 맞춰뒀습니다(참조 무결성).
create or replace function restore_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_backup backups;
  v_table text;
  v_rows jsonb;
  v_set_clause text;
begin
  if not is_app_admin() then
    raise exception '복원은 관리자/개발자만 할 수 있습니다.';
  end if;

  select * into v_backup from backups where id = p_backup_id;
  if v_backup is null then
    raise exception '해당 백업을 찾을 수 없습니다.';
  end if;

  foreach v_table in array v_backup.tables loop
    v_rows := coalesce(v_backup.snapshot -> v_table, '[]'::jsonb);

    execute format(
      'delete from %I where id not in (select (r->>''id'')::uuid from jsonb_array_elements($1) r)',
      v_table
    ) using v_rows;

    if jsonb_array_length(v_rows) > 0 then
      select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
        into v_set_clause
        from information_schema.columns
        where table_schema = 'public' and table_name = v_table and column_name <> 'id';

      execute format(
        'insert into %I select * from jsonb_populate_recordset(null::%I, $1) on conflict (id) do update set %s',
        v_table, v_table, v_set_clause
      ) using v_rows;
    end if;
  end loop;
end;
$$;

revoke all on function restore_backup(uuid) from public;
grant execute on function restore_backup(uuid) to authenticated;

-- ===== 58. 업무 처리사항(resolution_note) =====
-- 업무 상세 패널의 코멘트 영역을 위(코멘트)/아래(처리사항)로 나누면서, "이 업무를 어떻게
-- 완료했는지"를 기록하는 전용 칸을 추가합니다(요청: "아래부분은 이 업무가 어떻게 완료되었는지
-- 처리사항을 기록하도록"). tasks 테이블에 그냥 컬럼 하나만 추가하면, 완료 후 archived_at만
-- 채우는 기존 보관 처리(cron)를 그대로 거쳐도 이 값이 함께 남아 업무기록·업무 보고서에서
-- "업무 + 업무결과"로 이어서 볼 수 있습니다(요청: "완료탭에 들어가면, 보관함으로 가고,
-- 보고서에 업무와 업무결과로 나와서").
alter table tasks add column if not exists resolution_note text;

-- ===== 59. 학생 명부 확장(보호자 이메일/성별/알러지) + 커스텀 칼럼 =====
-- "학생등록할 때 ... 보호자이메일, ... 성별, 알러지여부 기록할 수 있게 해주고, 혹시나 칼럼을
-- 추가할 수도 있으니 칼럼 추가 기능도 넣어줘"라는 요청으로, 고정 컬럼 3개(보호자 이메일/성별/
-- 알러지)를 wr_students에 추가하고, 그 외 앞으로 필요할 수 있는 항목은 관리자가 화면에서
-- 직접 칼럼을 만들 수 있도록 custom_fields(jsonb) + 칼럼 정의 테이블로 확장 가능하게 했습니다.
alter table wr_students add column if not exists parent_email text;
alter table wr_students add column if not exists gender text check (gender in ('남', '여'));
alter table wr_students add column if not exists allergies text;
-- 관리자가 화면에서 "+ 칼럼 추가"로 만든 항목의 값은 { 칼럼키: "입력값" } 형태로 여기 담깁니다.
alter table wr_students add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- 관리자가 직접 추가한 칼럼의 정의(이름표시용 라벨/입력형식)를 저장합니다. field_key는 화면에서
-- 무작위로 생성해 절대 겹치지 않게 하고, 학생별 실제 값은 위 wr_students.custom_fields에 이
-- field_key를 키로 저장됩니다. 칼럼을 지워도(삭제) 이미 입력된 값 자체는 학생 레코드에 남아있고
-- 화면에서만 더 이상 보이지 않습니다(데이터 유실 방지).
create table if not exists wr_student_field_defs (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'number', 'date')),
  sort_order int not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);

alter table wr_student_field_defs enable row level security;
drop policy if exists "giamicro_all_wr_student_field_defs" on wr_student_field_defs;
create policy "giamicro_all_wr_student_field_defs" on wr_student_field_defs
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- ===== 60. 사이드바 프로필 옆 알림 배지 (v0.57.6에서 설계 변경 - task_list_reads 폐기) =====
-- 처음에는(v0.57.2~0.57.5) "안 읽은 채팅 + 마지막 방문 이후 새 업무" 방식이라 방문 시각을
-- 저장하는 task_list_reads 테이블이 필요했는데, 요청("프로필 옆에 동그라미 숫자를 띄우고,
-- 그게 내업무 갯수를 뜻하고 새로운 업무가 생길때마다 빨간색으로 깜빡깜빡이도록 하고
-- 업무확인하면 그냥 작은 원안에 숫자를 표시하게")에 따라 "지금 내 업무함에 있는 업무
-- 개수"를 그때그때 세는 방식으로 바뀌면서 더 이상 방문 시각을 저장할 필요가 없어졌습니다.
-- 이미 실행한 적이 있다면 정리 차원에서 지웁니다(실행한 적이 없어도 안전합니다).
drop table if exists task_list_reads cascade;

-- ===== 61. 테마(라이트/다크/리퀴드글라스/GIA) - 내 계정 설정에 저장 =====
-- 요청("테마구현 : 라이트(지금), 다크, 리퀴드글라스, GIA")에 따라 계정별로 테마를 저장합니다.
-- 적용 범위는 사용자가 고른 대로 사이드바/헤더 등 공통 틀(shell)만이고, 개별 화면 내부(업무/
-- 위클리 리포트 등 앱별 고유 색상)는 이번 범위에서 뺐습니다("전체 공통 틀만"). name/avatar_url과
-- 마찬가지로 본인 행이라 protect_app_users_self_update 트리거가 막는 컬럼(email/status/
-- decided_at/decided_by/position)에 포함되지 않으므로 별도 정책 변경 없이 계정 설정 화면에서
-- 바로 저장할 수 있습니다.
alter table app_users add column if not exists theme text not null default 'light';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_theme_check'
  ) then
    alter table app_users add constraint app_users_theme_check
      check (theme in ('light', 'dark', 'liquid-glass', 'gia-brand'));
  end if;
end $$;

-- ===== 62. 업무 소프트 삭제(7일 휴지통) + 선후관계(의존) 표시 =====
-- UX 점검("사건/행사/업무/문서 등 실제 기록 삭제에 되돌리기 기능이 전혀 없어 삭제가 즉시
-- 영구적")에 대한 보완입니다. tasks에 한해 우선 적용합니다(이 세션에서 가장 삭제 빈도가 높고,
-- 이미 실시간 코멘트/로그가 함께 딸려있어 "휴지통에 잠깐 머물다 완전히 사라지는" 흐름의
-- 가치가 가장 큰 화면이라 이번 라운드는 여기부터 적용하고, 다른 화면은 이후 라운드에서
-- 순서대로 넓힙니다).
alter table tasks add column if not exists deleted_at timestamptz;
alter table tasks add column if not exists depends_on_task_id uuid references tasks(id) on delete set null;

-- 기존에는 giamicro.com 계정이면 select/insert/update/delete를 전부 통틀어 허용하는 단일
-- "for all" 정책 하나였습니다. deleted_at이 있는(삭제된) 업무를 일반 조회에서 자동으로
-- 숨기려면 select만 별도 조건을 걸어야 해서, 정책을 동작별로 나눕니다. update/insert/delete는
-- 기존과 동일하게 giamicro.com 계정이면 전부 허용됩니다(소프트 삭제/복구도 결국 update이므로
-- 이 삭제된 업무의 update가 update 정책 위반은 아닙니다 - 반대로 select 정책은 deleted_at is
-- null 조건이 있어 일반 목록 조회(WorkBoardClient 등 16곳)는 코드 수정 없이 자동으로
-- 삭제된 업무를 걸러냅니다).
drop policy if exists "giamicro_all_tasks" on tasks;

drop policy if exists "giamicro_select_tasks" on tasks;
create policy "giamicro_select_tasks" on tasks
  for select using (is_giamicro_user() and deleted_at is null);

-- 삭제한 지 7일 이내인 업무는, 본인(등록자)이거나 태그된 담당자이거나 관리자면 휴지통
-- 화면(/work/trash)에서 볼 수 있습니다. 위 select 정책과는 OR로 합쳐지므로(둘 다 permissive
-- 정책), 평소 목록 조회에는 전혀 섞이지 않고 휴지통 화면의 "deleted_at is not null" 조회에만
-- 적용됩니다.
drop policy if exists "giamicro_select_own_trashed_tasks" on tasks;
create policy "giamicro_select_own_trashed_tasks" on tasks
  for select using (
    is_giamicro_user()
    and deleted_at is not null
    and deleted_at > now() - interval '7 days'
    and (
      is_app_admin()
      or owner_email = lower(auth.jwt() ->> 'email')
      or lower(auth.jwt() ->> 'email') = any(assignee_emails)
    )
  );

drop policy if exists "giamicro_insert_tasks" on tasks;
create policy "giamicro_insert_tasks" on tasks
  for insert with check (is_giamicro_user());

drop policy if exists "giamicro_update_tasks" on tasks;
create policy "giamicro_update_tasks" on tasks
  for update using (is_giamicro_user()) with check (is_giamicro_user());

-- 이 시점에는 앱에 "완전 삭제" UI가 없어서 giamicro.com 계정이면 누구나 하드 삭제할 수 있게
-- 열어뒀는데, 이제 휴지통에 "영구삭제/휴지통 비우기" 버튼을 추가하면서(요청) 그대로 두면 본인
-- 소유가 아닌 업무도 아무나 영구 삭제할 수 있게 되어 있었습니다. owner_delete_tasks(44번
-- 섹션 - 등록자 또는 관리자만) 하나만 남기고 이 정책은 제거합니다.
drop policy if exists "giamicro_delete_tasks" on tasks;

-- ===== 63. 신청서(구글폼 연동) 가져오기 - 학기/행사 신청을 붙여넣기로 정리 + 양식 기억 =====
-- 요청("구글폼으로 보통 새로운 학기 등록 신청을 받거나, 행사 신청을 받거나 하는데... 구글폼에
-- 링크된 구글시트를 연결하면, 분석해서... 구글폼 형식도 매번 비슷하니까 기억했다가 바로 다시
-- 사용할 수 있도록 학기,이벤트 별로 저장할 수 있도록"). 구글시트 API 연동(OAuth 앱 등록,
-- 클라이언트 시크릿 발급 등)이 아직 없어서 실시간으로 시트 URL을 직접 읽어오지는 못하고,
-- 기존 "구글시트로 가져오기" 화면과 같은 방식으로 시트 표를 복사해 붙여넣습니다. 대신 열
-- 제목(headers)과 표준 항목(이름/연락처/학년 등) 매칭 규칙을 "템플릿"으로 저장해두면, 다음에
-- 같은 형식(구글폼은 보통 질문이 안 바뀌므로 열 제목도 그대로)의 시트를 붙여넣을 때 자동으로
-- 알아보고 매칭을 다시 안 해도 되게 했습니다.
create table if not exists form_import_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('term', 'event')),
  headers text[] not null,
  column_mapping jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists form_submissions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references form_import_templates(id) on delete set null,
  kind text not null check (kind in ('term', 'event')),
  term_id uuid references terms(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  mapped jsonb not null default '{}'::jsonb,
  imported_by text not null,
  imported_at timestamptz not null default now()
);

create index if not exists form_submissions_kind_idx on form_submissions (kind, imported_at desc);
create index if not exists form_submissions_term_idx on form_submissions (term_id);
create index if not exists form_submissions_event_idx on form_submissions (event_id);

alter table form_import_templates enable row level security;
drop policy if exists "giamicro_all_form_import_templates" on form_import_templates;
create policy "giamicro_all_form_import_templates" on form_import_templates
  for all using (is_giamicro_user()) with check (is_giamicro_user());

alter table form_submissions enable row level security;
drop policy if exists "giamicro_all_form_submissions" on form_submissions;
create policy "giamicro_all_form_submissions" on form_submissions
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'form_submissions'
  ) then
    alter publication supabase_realtime add table form_submissions;
  end if;
end $$;

-- ===== 64. 신청서 템플릿/기록에 연도·학기타입·목적 구조화 필드 추가 =====
-- 요청("신청서 탭에서는 구글시트 붙여넣기 전에 무슨학기의 어떤 행사인지... 선택해서 구글폼올리고,
-- 그것에 학사일정에 기록으로 남아서... 이전 학기 준비사항들을 참고하여"). year/term_type은 학기
-- 관리 화면(terms)과 같은 값 체계를 씁니다 - 아직 terms에 해당 학기 행이 없어도(다음 학기를 미리
-- 준비하는 경우) 먼저 지정할 수 있습니다. form_import_templates의 값은 "가장 최근 사용" 기준으로
-- 갱신되고, form_submissions의 값은 그 회차에 실제 선택했던 값 그대로 고정되어(요청 답변: "같은
-- 데이터는 통합관리를 해서 검색이나 색인이 쉽게") 학기준비 화면에서 term_type으로 지난 같은
-- 학기의 신청서 기록을 정확히 찾아올 수 있습니다.
alter table form_import_templates add column if not exists year text not null default '';
alter table form_import_templates add column if not exists term_type text not null default '';
alter table form_import_templates add column if not exists purpose text not null default '';

alter table form_submissions add column if not exists year text not null default '';
alter table form_submissions add column if not exists term_type text not null default '';
alter table form_submissions add column if not exists purpose text not null default '';

create index if not exists form_import_templates_term_type_idx on form_import_templates (term_type, year desc);
create index if not exists form_submissions_term_type_idx on form_submissions (term_type, year desc);

-- ===== 65. 업무탭 실시간 로그를 좌우 분할 - 왼쪽 부서 메모장 =====
-- 요청("실시간 로그 반으로 나눠서 오른쪽 실시간로그 왼쪽 메모 적을 수 있도록"). 부서마다 한 장의
-- 공유 메모장을 두고(부서당 1행), 누구나 자유롭게 적고 지울 수 있는 화이트보드처럼 씁니다.
-- 실시간 구독으로 다른 사람이 수정하면 화면에 바로 반영됩니다.
create table if not exists department_memos (
  department text primary key,
  content text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table department_memos enable row level security;
drop policy if exists "giamicro_all_department_memos" on department_memos;
create policy "giamicro_all_department_memos" on department_memos
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'department_memos'
  ) then
    alter publication supabase_realtime add table department_memos;
  end if;
end $$;

-- ===== 66. 2026년도 학기 프리셋 시드 + 신청서 가져오기 학기선택 실연동 =====
-- 요청("신청서 가져오기에서 기본적으로 26년도에 1,2,3학기 여름캠프1,2, 겨울캠프 1,2 이렇게
-- 세팅해줘... 지금 설정된 학기들이 가져오기 학기선택에 반영되도록"). terms 테이블에 2026년
-- 7개 학기(정규 3개 + 캠프 4개)를 미리 등록해두고, 신청서 가져오기 화면의 연도/학기타입
-- 선택은 이제 이 terms 테이블에 실제로 등록된 값만 보여줍니다(정적 목록이 아님). status는
-- 일부러 '종료'로 시드합니다 - '진행중'으로 한꺼번에 넣으면 홈/사이드바에 뜨는 "현재 학기"가
-- 7개 중 아무거나 하나로 잡혀버립니다. 실제로 시작한 학기를 "현재 학기"로 켜는 것은 기존
-- 학기 관리 화면(/terms)의 전환 기능을 그대로 쓰면 됩니다(전환하면 이전 진행중 학기는 자동
-- 종료됨). 이미 같은 연도+학기타입 행이 있으면 건너뜁니다(재실행해도 중복 생성되지 않도록).
insert into terms (case_id, year, term_type, status)
select 'TRM-SEED-' || v.year || '-' || v.term_type, v.year, v.term_type, '종료'
from (values
  ('2026', '1학기'),
  ('2026', '2학기'),
  ('2026', '3학기'),
  ('2026', '여름캠프1'),
  ('2026', '여름캠프2'),
  ('2026', '겨울캠프1'),
  ('2026', '겨울캠프2')
) as v(year, term_type)
where not exists (
  select 1 from terms t where t.year = v.year and t.term_type = v.term_type
);

-- ===== 67. 속도 개선: 계속 쌓이는 로그성 테이블 인덱스 =====
-- error_logs/ai_usage_logs는 매 AI 호출·매 오류마다 계속 쌓이기만 하는 테이블이라(삭제 없음),
-- 시간이 지날수록 /dev 대시보드의 "최근 N일" 조회가 느려집니다. created_at 인덱스를 미리
-- 걸어둡니다. inquiries는 /dev에서 "완료 아닌 것" 개수를 매번 세므로 status 인덱스를 추가합니다.
create index if not exists error_logs_created_at_idx on error_logs (created_at desc);
create index if not exists ai_usage_logs_created_at_idx on ai_usage_logs (created_at desc);
create index if not exists inquiries_status_idx on inquiries (status);

-- ===== 68. 동시접속 안전장치: 학기 전환을 원자적 RPC로 =====
-- 예전에는 "현재 진행중 학기 종료 + 새 학기 진행중 전환/생성"을 화면(클라이언트)에서 여러 번의
-- update로 나눠 실행했습니다. 관리자 여러 명이 거의 동시에 서로 다른 학기로 전환을 누르면, 각자
-- 약간 오래된 목록을 기준으로 계산해서 실행 순서에 따라 진행중 학기가 0개나 2개 이상으로 꼬일
-- 수 있었습니다(요청: "동시접속,동시사용환경을 원활하게"). 이 함수 하나가 종료 처리와
-- 전환/생성을 하나의 트랜잭션으로 묶어서, Postgres가 자동으로 순서를 보장합니다 - 몇 명이
-- 동시에 눌러도 항상 정확히 하나만 진행중으로 남습니다. TermsClient.tsx의 setCurrentTermType이
-- 이제 이 RPC 하나만 호출합니다.
create or replace function switch_current_term(p_term_type text, p_year text, p_case_id text)
returns terms
language plpgsql
as $$
declare
  result terms;
  target_id uuid;
begin
  select id into target_id from terms
  where term_type = p_term_type and year = p_year
  order by created_at desc
  limit 1;

  update terms set status = '종료'
  where status = '진행중' and id is distinct from target_id;

  if target_id is not null then
    update terms set status = '진행중' where id = target_id returning * into result;
  else
    insert into terms (case_id, term_type, year, status, good, lack, suggest)
    values (p_case_id, p_term_type, p_year, '진행중', '', '', '')
    returning * into result;
  end if;

  return result;
end;
$$;

-- ===== 69. 동시접속 안전장치: 채택예정 발행(매뉴얼 반영)을 원자적 RPC로 =====
-- 채택예정 항목을 "발행"하면 매뉴얼(manual_sections)의 같은 항목(target_doc+category) 뒤에 내용이
-- 이어붙습니다. 예전에는 "이미 있는지 조회 → 있으면 update, 없으면 insert"를 서버에서 두 단계로
-- 실행해서, 서로 다른 채택예정 두 건이 같은 항목에 거의 동시에 발행되면 둘 다 "아직 없음"으로
-- 읽고 동시에 insert를 시도해 유니크 제약(target_doc, category) 위반으로 한쪽이 발행 실패할 수
-- 있었습니다. insert ... on conflict do update는 Postgres가 유니크 인덱스로 자동 직렬화하므로,
-- 몇 건이 동시에 발행돼도 항상 안전하게 이어붙여집니다. api/adopted/publish/route.ts가 이 RPC
-- 하나만 호출합니다(내용은 호출 전에 이미 HTML로 정규화되어 전달됩니다).
create or replace function upsert_manual_section(p_target_doc text, p_category text, p_addition_html text)
returns manual_sections
language plpgsql
as $$
declare
  result manual_sections;
begin
  insert into manual_sections (target_doc, category, content)
  values (p_target_doc, p_category, p_addition_html)
  on conflict (target_doc, category)
  do update set content = manual_sections.content || excluded.content
  returning * into result;

  return result;
end;
$$;

-- ===== 70. 통합관리: 자동 일일 백업 =====
-- 이미 관리자 화면(/admin/backups)에 수동 백업/복원(create_backup/restore_backup, 위 57번
-- 섹션)이 있습니다 - 그걸 매일 자동으로도 한 번 실행되게 합니다(요청: "통합관리를 위해...
-- 방법들을 제안해줘" 답변 중 "자동 일일 백업" - 깜빡하고 수동 백업을 안 남겨둔 날에도 최소한의
-- 안전망이 있게). create_backup()은 로그인 세션(auth.jwt())을 통해 is_app_admin()을 확인하는데,
-- 크론은 서비스 역할 키로 실행되어 로그인 세션이 없으므로 그 경로를 그대로 쓸 수 없습니다. 대신
-- 이 함수는 관리자 로그인 여부와 무관하게 동작하되, 일반 로그인 사용자(authenticated)에게는
-- 실행 권한 자체를 주지 않아 서비스 역할 키로만 호출 가능합니다(cron/route.ts 참고).
create or replace function create_scheduled_backup()
returns backups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_table_json jsonb;
  v_snapshot jsonb := '{}'::jsonb;
  v_row backups;
begin
  foreach v_table in array backup_target_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %I t', v_table)
      into v_table_json;
    v_snapshot := jsonb_set(v_snapshot, array[v_table], v_table_json);
  end loop;

  insert into backups (label, created_by, tables, snapshot)
  values ('자동 일일 백업 · ' || to_char(now(), 'YYYY-MM-DD'), 'system(자동백업)', backup_target_tables(), v_snapshot)
  returning * into v_row;

  return v_row;
end;
$$;

-- authenticated/anon에는 일부러 실행 권한을 주지 않습니다 - 이 함수는 cron(서비스 역할 키)에서만
-- 호출되도록 의도한 것이라, 로그인만 한 일반 사용자가 supabase.rpc()로 직접 호출할 수 없어야 합니다.
revoke all on function create_scheduled_backup() from public, authenticated, anon;

-- ===== 71. 행정 요청(교사 → 행정직원) =====
-- 교사 화면에서는 학사일정 등 내부 문서 성격의 메뉴를 모두 감추는 대신(요청: "교사권한은
-- 학사일정 안보이게"), 사물함 파손·물품 구입·아픈 학생 인계·출결 문의처럼 실제로 자주 생기는
-- "행정직원에게 요청하는 일들"을 앱 안에서 등록하고 처리 현황을 볼 수 있게 합니다(요청:
-- "교사는 행정부에... 여러 일들을 요청"). 교사는 자기 요청만 등록/열람하고, 행정직원·관리자는
-- 전체 요청을 보고 상태를 바꿀 수 있습니다. is_wr_manager()는 이름은 위클리 리포트에서 먼저
-- 만들었지만 "관리자 또는 행정직원"이라는 조건 자체는 이 기능에도 그대로 맞아 재사용합니다.
create table if not exists staff_requests (
  id uuid primary key default gen_random_uuid(),
  case_id text unique not null,
  category text not null check (category in ('사물함파손', '물품구입', '아픈학생인계', '출결상황문의', '기타')),
  title text not null,
  content text not null default '',
  student_name text,
  status text not null default '접수대기' check (status in ('접수대기', '처리중', '완료')),
  requested_by text not null,
  requested_by_name text,
  resolved_by text,
  resolved_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists staff_requests_set_updated_at on staff_requests;
create trigger staff_requests_set_updated_at
  before update on staff_requests
  for each row execute function set_updated_at();

alter table staff_requests enable row level security;

drop policy if exists "giamicro_select_staff_requests" on staff_requests;
create policy "giamicro_select_staff_requests" on staff_requests
  for select using (is_giamicro_user());

drop policy if exists "giamicro_insert_staff_requests" on staff_requests;
create policy "giamicro_insert_staff_requests" on staff_requests
  for insert with check (is_giamicro_user() and requested_by = lower(auth.jwt() ->> 'email'));

-- 상태 변경/처리 메모는 관리자·행정직원만, 요청 본인은 아직 접수 전(접수대기)이면 내용을 고칠 수
-- 있습니다(오타 수정 등). 이미 처리 중/완료로 넘어간 요청은 본인도 손댈 수 없습니다.
drop policy if exists "manage_staff_requests" on staff_requests;
create policy "manage_staff_requests" on staff_requests
  for update using (
    is_wr_manager() or (requested_by = lower(auth.jwt() ->> 'email') and status = '접수대기')
  )
  with check (
    is_wr_manager() or (requested_by = lower(auth.jwt() ->> 'email') and status = '접수대기')
  );

drop policy if exists "manager_delete_staff_requests" on staff_requests;
create policy "manager_delete_staff_requests" on staff_requests
  for delete using (is_wr_manager());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_requests'
  ) then
    alter publication supabase_realtime add table staff_requests;
  end if;
end $$;

-- ===== 72. 행정요청 확장: 카테고리 관리 + 업무보드 자동등록 + 상태 자동동기화 + 코멘트 + 번역 =====

-- 72-1. 카테고리를 관리자가 등록/편집할 수 있도록 별도 테이블로 분리합니다(요청: "행정요청은
-- 굉장히 다양한 부분들이 있으니까... 사물함파손,물품구입 등을 관리자가 등록/편집할 수 있게").
-- category 값 자체를 기본키로 써서 기존 staff_requests.category 값(사물함파손/물품구입/
-- 아픈학생인계/출결상황문의/기타)과 그대로 맞습니다 - 기존 데이터 마이그레이션이 필요 없습니다.
-- 카테고리를 지우면 이미 등록된 요청들이 참조를 잃으므로, 삭제 대신 active=false로 숨기기만
-- 합니다(새 요청 등록 시 선택지에서만 빠짐).
create table if not exists staff_request_categories (
  category text primary key,
  label_en text not null,
  icon text not null default '📎',
  sort_order double precision not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists staff_request_categories_set_updated_at on staff_request_categories;
create trigger staff_request_categories_set_updated_at
  before update on staff_request_categories
  for each row execute function set_updated_at();

alter table staff_request_categories enable row level security;

drop policy if exists "giamicro_select_staff_request_categories" on staff_request_categories;
create policy "giamicro_select_staff_request_categories" on staff_request_categories
  for select using (is_giamicro_user());

-- 요청("카테고리 관리는 교사 이외의 권한들이 전부 할 수 있게 해줘")에 따라 관리자뿐 아니라
-- 행정직원까지 관리할 수 있도록 is_app_admin() 대신 is_wr_manager()(위클리 리포트에서 이미
-- "관리자 또는 행정직원"을 뜻하는 함수로 정의됨)를 씁니다.
drop policy if exists "admin_manage_staff_request_categories" on staff_request_categories;
create policy "staff_manage_staff_request_categories" on staff_request_categories
  for all using (is_wr_manager()) with check (is_wr_manager());

insert into staff_request_categories (category, label_en, icon, sort_order) values
  ('사물함파손', 'Locker Damage', '🔧', 1),
  ('물품구입', 'Supply Request', '🛒', 2),
  ('아픈학생인계', 'Sick Student Handoff', '🏥', 3),
  ('출결상황문의', 'Attendance Inquiry', '📋', 4),
  ('기타', 'Other', '📎', 5)
on conflict (category) do nothing;

-- 72-2. staff_requests 확장: 기존 category CHECK 제약을 떼고 위 카테고리 테이블을 참조하도록
-- 바꿉니다(관리자가 새 카테고리를 추가할 때마다 CHECK 제약을 다시 만들 필요가 없도록). 번역본
-- (title_ko/title_en/content_ko/content_en - 요청: "요청과 코멘트 모두 한,영 번역을 지원"),
-- 자동 등록된 업무 연결(task_id - 요청: "초등부 전체 업무창에 자동으로 행정요청이 등록되게"),
-- 코멘트 수 캐시(comment_count - 요청: "코멘트는 교사의 내가 등록한 요청에 실시간으로 반영")도
-- 함께 추가합니다.
alter table staff_requests drop constraint if exists staff_requests_category_check;

alter table staff_requests add column if not exists title_ko text;
alter table staff_requests add column if not exists title_en text;
alter table staff_requests add column if not exists content_ko text;
alter table staff_requests add column if not exists content_en text;
alter table staff_requests add column if not exists task_id uuid references tasks(id) on delete set null;
alter table staff_requests add column if not exists comment_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_requests_category_fkey'
  ) then
    alter table staff_requests
      add constraint staff_requests_category_fkey
      foreign key (category) references staff_request_categories(category);
  end if;
end $$;

-- 72-3. 요청 등록 시 초등부 전체 업무창에 업무를 함께 등록하고(요청: "점수가 되면[등록이 되면]
-- 초등부 전체 업무창에 자동으로 행정요청이 등록되게"), 요청 행과 업무 행 두 개를 한 트랜잭션으로
-- 묶어(둘 중 하나만 반쯤 만들어지는 상황 방지) 만드는 원자적 RPC입니다. is_giamicro_user()라면
-- tasks/staff_requests 모두 이미 RLS로 쓸 수 있어 security definer가 필요 없습니다(switch_current_
-- term/upsert_manual_section과 같은 방식). 나중에 담당 행정직원별 자동 배정 파이프라인을 붙일
-- 때도(요청: "나중에는 각 행정직원의 역할을 나누고... 자동으로 이 행정직원에게 가도록") 여기
-- assignee_emails만 채워주면 되도록 우선 origin_mode='전체'로 등록해둡니다.
create or replace function create_staff_request(
  p_case_id text,
  p_task_case_id text,
  p_category text,
  p_title text,
  p_title_ko text,
  p_title_en text,
  p_content text,
  p_content_ko text,
  p_content_en text,
  p_student_name text
) returns staff_requests
language plpgsql
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text;
  v_task_id uuid;
  v_row staff_requests;
begin
  select name into v_name from app_users where email = v_email;

  insert into tasks (case_id, title, department, owner_email, origin_mode, status, priority)
  values (p_task_case_id, '[행정요청] ' || p_title, '초등부', v_email, '전체', '예정', '보통')
  returning id into v_task_id;

  insert into staff_requests (
    case_id, category, title, title_ko, title_en, content, content_ko, content_en,
    student_name, requested_by, requested_by_name, task_id
  ) values (
    p_case_id, p_category, p_title, p_title_ko, p_title_en, p_content, p_content_ko, p_content_en,
    p_student_name, v_email, coalesce(v_name, v_email), v_task_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- 72-4. 업무보드 쪽 변화를 요청 상태에 자동으로 반영합니다(요청: "업무목록에서 확인체크를
-- 한개라도하면 접수대기에서 초록불로... 완료탭으로 옮기면... 완료된 요청"). 담당자가 업무를
-- "확인"하면(acknowledged_by가 0개→1개 이상) 접수대기→처리중으로, 업무가 완료로 바뀌면
-- 처리중/접수대기→완료로 자동 전환합니다(반대로 완료를 취소하면 처리중으로 되돌립니다).
-- staff_requests에는 이미 realtime이 붙어있어(위 71번 섹션) 이 UPDATE만으로 교사 화면에도 바로
-- 반영됩니다 - 업무보드를 조작하는 사람은 항상 관리자/행정직원(is_wr_manager())이라 일반
-- update 정책을 그대로 통과하므로 security definer가 필요 없습니다.
create or replace function sync_staff_request_from_task() returns trigger
language plpgsql
as $$
begin
  if jsonb_array_length(new.acknowledged_by) > 0
     and jsonb_array_length(old.acknowledged_by) = 0 then
    update staff_requests set status = '처리중'
    where task_id = new.id and status = '접수대기';
  end if;

  if new.status = '완료' and old.status is distinct from '완료' then
    update staff_requests
    set status = '완료', resolved_by = coalesce(new.updated_by, new.owner_email), resolved_at = now()
    where task_id = new.id and status <> '완료';
  end if;

  if old.status = '완료' and new.status is distinct from '완료' then
    update staff_requests
    set status = '처리중', resolved_at = null
    where task_id = new.id and status = '완료';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_sync_staff_request on tasks;
create trigger tasks_sync_staff_request
  after update on tasks
  for each row execute function sync_staff_request_from_task();

-- 72-5. 요청에 대한 코멘트(행정직원↔교사 대화, 요청: "행정요청에 대해서 코멘트를 넣을 수 있게").
create table if not exists staff_request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references staff_requests(id) on delete cascade,
  author_email text not null,
  author_name text,
  content text not null,
  content_ko text,
  content_en text,
  created_at timestamptz not null default now()
);
create index if not exists staff_request_comments_request_id_idx on staff_request_comments(request_id, created_at);

alter table staff_request_comments enable row level security;

drop policy if exists "giamicro_select_staff_request_comments" on staff_request_comments;
create policy "giamicro_select_staff_request_comments" on staff_request_comments
  for select using (is_giamicro_user());

drop policy if exists "giamicro_insert_staff_request_comments" on staff_request_comments;
create policy "giamicro_insert_staff_request_comments" on staff_request_comments
  for insert with check (is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));

drop policy if exists "author_or_manager_delete_staff_request_comments" on staff_request_comments;
create policy "author_or_manager_delete_staff_request_comments" on staff_request_comments
  for delete using (is_wr_manager() or author_email = lower(auth.jwt() ->> 'email'));

-- 코멘트 수를 staff_requests.comment_count에 캐시해둡니다 - 목록 화면(교사의 "내가 등록한
-- 요청" 포함)이 이미 staff_requests를 realtime 구독하고 있어서(71번 섹션), 이 카운트 하나만
-- 갱신되면 코멘트 스레드를 펼치지 않아도 실시간으로 배지가 뜹니다(요청: "코멘트는 교사의 내가
-- 등록한 요청에 실시간으로 반영되도록"). security definer로 만든 이유: 예를 들어 이미 완료된
-- 내 요청에 감사 코멘트를 남기는 경우처럼, 글쓴이가 staff_requests의 UPDATE 정책(관리자/
-- 행정직원이거나 "본인+접수대기 상태")을 만족하지 못하는 상황에서도 카운트 갱신만큼은 항상
-- 성공해야 하기 때문입니다.
create or replace function bump_staff_request_comment_count() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update staff_requests set comment_count = comment_count + 1 where id = new.request_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update staff_requests set comment_count = greatest(0, comment_count - 1) where id = old.request_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists staff_request_comments_bump_count on staff_request_comments;
create trigger staff_request_comments_bump_count
  after insert or delete on staff_request_comments
  for each row execute function bump_staff_request_comment_count();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_request_comments'
  ) then
    alter publication supabase_realtime add table staff_request_comments;
  end if;
end $$;

-- 72-6. 번역 AI 기능도 다른 AI 기능들처럼 개발자가 필요하면 끌 수 있게 등록합니다(요청: "요청은
-- 대부분 영어로 할것이라... 한,영 번역을 지원해주고").
insert into ai_feature_flags (key, label, group_name) values
  ('requests-translate', '행정요청 한/영 번역 AI', '업무')
on conflict (key) do nothing;

-- ===== 73. 사건·회의·AI매뉴얼 통합 고도화(제안서 8개 항목) =====
-- 직전에 전달한 제안서(단기/중기/장기 8개 항목)를 반영합니다: (1) 매뉴얼 항목에 원본 사건/회의
-- 역참조 저장, (2) 반복 사건 패턴을 매뉴얼 화면에도 노출(홈과 동일하게 AI 호출 없이 순수 집계),
-- (3) GIA시스템 자동 매칭(AI 호출 없이 이름 겹침만으로 매칭 - 과금 절감 요청과도 맞물림),
-- (4) 정책영역(domain) 상위분류를 기존 AI 분류 호출에 필드만 추가(새 AI 호출 없음),
-- (5) 매뉴얼 변경 이력, (8) 정기 리뷰 사이클(오래된 항목/최근 사건 급증 항목 플래그).

-- ----- (1)+(4) manual_sections: 원본 참조(sources) + 정책영역(domain) -----
alter table manual_sections add column if not exists sources jsonb not null default '[]'::jsonb;
alter table manual_sections add column if not exists domain text;

-- ----- (4) proposals/adopted: 정책영역(domain) 컬럼 - AI 분류 결과를 그대로 이어붙임 -----
alter table proposals add column if not exists domain text;
alter table adopted add column if not exists domain text;

-- ----- upsert_manual_section 확장: 원본(source/source_id)과 정책영역(domain)을 함께 누적 -----
-- 기존 호출부(발행 API)도 새 매개변수 없이 그대로 호출 가능하도록 전부 default null로 둡니다.
create or replace function upsert_manual_section(
  p_target_doc text,
  p_category text,
  p_addition_html text,
  p_source text default null,
  p_source_id text default null,
  p_domain text default null
)
returns manual_sections
language plpgsql
as $$
declare
  result manual_sections;
  v_new_source jsonb := '[]'::jsonb;
begin
  if p_source is not null and p_source_id is not null then
    v_new_source := jsonb_build_array(
      jsonb_build_object('source', p_source, 'source_id', p_source_id, 'added_at', now())
    );
  end if;

  insert into manual_sections (target_doc, category, content, domain, sources)
  values (p_target_doc, p_category, p_addition_html, p_domain, v_new_source)
  on conflict (target_doc, category)
  do update set
    content = manual_sections.content || excluded.content,
    -- 정책영역은 처음 정해진 값을 유지합니다(누적될 때마다 AI가 다르게 판단해서 바뀌는 것 방지).
    domain = coalesce(manual_sections.domain, excluded.domain),
    -- 같은 (source, source_id)는 한 번만 남기고, added_at이 가장 이른 것을 기준으로 정렬해 쌓습니다.
    sources = (
      select coalesce(jsonb_agg(d.elem order by (d.elem->>'added_at')::timestamptz asc), '[]'::jsonb)
      from (
        select distinct on (e->>'source', e->>'source_id') e as elem
        from jsonb_array_elements(manual_sections.sources || excluded.sources) as e
        order by e->>'source', e->>'source_id', (e->>'added_at')::timestamptz asc
      ) d
    )
  returning * into result;

  return result;
end;
$$;

-- ----- (2) GIA시스템 자동 매칭 -----
-- AI 호출 없이(이름 겹침만으로) 매뉴얼 항목이 발행될 때 관련 있어 보이는 미보유 시스템을 표시합니다.
alter table gia_systems add column if not exists related_manual_category text;
alter table gia_systems add column if not exists related_manual_target_doc text;

-- ----- (5) 매뉴얼 변경 이력 -----
-- 항목 내용이 바뀌기 직전의 이전 버전을 스냅샷으로 남깁니다(요청: "언제, 왜 바뀌었는지 추적").
create table if not exists manual_section_history (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references manual_sections(id) on delete cascade,
  target_doc text not null,
  category text not null,
  content text not null,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists manual_section_history_section_idx
  on manual_section_history (section_id, changed_at desc);

alter table manual_section_history enable row level security;
drop policy if exists "giamicro_select_manual_section_history" on manual_section_history;
create policy "giamicro_select_manual_section_history" on manual_section_history
  for select using (is_giamicro_user());
-- insert 정책은 의도적으로 만들지 않습니다 - 아래 트리거 함수만(security definer) 기록을 남길 수
-- 있고, 사람이 직접 이력을 손대거나 지어낼 수 없도록 막습니다.

create or replace function log_manual_section_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and OLD.content is distinct from NEW.content then
    insert into manual_section_history (section_id, target_doc, category, content, changed_by, changed_at)
    values (OLD.id, OLD.target_doc, OLD.category, OLD.content, coalesce(auth.jwt() ->> 'email', 'system'), now());
  end if;
  return NEW;
end;
$$;

drop trigger if exists manual_sections_log_history on manual_sections;
create trigger manual_sections_log_history
  before update on manual_sections
  for each row execute function log_manual_section_history();

-- ----- (8) 매뉴얼 정기 리뷰 사이클 -----
-- 크론(주 1회)이 "1년 이상 재검토 안 된 항목"/"최근 90일 관련 사건 급증한 항목"을 여기에 표시해두면
-- 관리자가 매뉴얼 화면 상단 배너에서 확인하고 처리(resolved) 표시할 수 있습니다.
create table if not exists manual_review_flags (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references manual_sections(id) on delete cascade,
  reason text not null check (reason in ('오래됨', '사건급증')),
  detail text,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists manual_review_flags_unresolved_idx
  on manual_review_flags (section_id, reason)
  where resolved = false;

alter table manual_review_flags enable row level security;
drop policy if exists "giamicro_select_manual_review_flags" on manual_review_flags;
create policy "giamicro_select_manual_review_flags" on manual_review_flags
  for select using (is_giamicro_user());
drop policy if exists "admin_resolve_manual_review_flags" on manual_review_flags;
create policy "admin_resolve_manual_review_flags" on manual_review_flags
  for update using (is_app_admin()) with check (is_app_admin());
-- insert는 크론이 서비스 역할 키로 실행해 RLS를 우회하므로 별도 정책이 필요 없습니다.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'manual_review_flags'
  ) then
    alter publication supabase_realtime add table manual_review_flags;
  end if;
end $$;

-- ----- GIA시스템 항목 전면 재설계 + 서류함 자동분류 연동 -----
-- 요청: "gia시스템의 경우 ... 다른 공립이나 사립, 그리고 국제학교에서 구비중인 시스템을 참고해서
-- 항목화 ... 재정,운영과 같은 대분류항목에서부터 더 들어가서 운영-교직원-교직원계약서 뭐 이런식으로
-- 항목을 세분화 ... 필요한 서류가 있다면 서류함에 만들어주고, 서류함에 만들때에도 이 분류를 그대로
-- 적용해서 서류도 자동으로 분류화". 기존 category(중분류)는 그대로 두고 그 위에 major(대분류)를
-- 새로 추가해 3단계(대분류>중분류=category>세부 항목=name) 구조로 만듭니다. document_id는
-- "서류함에 만들기" 버튼으로 documents 행을 만들면 그 행을 가리키도록 연결해, 이미 만든 항목은
-- 중복 생성하지 않고 바로 서류함으로 이동할 수 있게 합니다.
alter table gia_systems add column if not exists major text not null default '';
alter table gia_systems add column if not exists document_id uuid references documents(id) on delete set null;
drop index if exists gia_systems_category_name_idx;
create unique index if not exists gia_systems_major_category_name_idx on gia_systems (major, category, name);

-- documents(서류함)에도 같은 분류 체계를 그대로 적용합니다(대분류는 새로 추가, 중분류는 기존
-- category 컬럼을 그대로 재사용). gia_system_id는 어느 GIA시스템 항목에서 자동 생성됐는지
-- 역참조합니다(요청: "서류함에 만들때에도 이 분류를 그대로 적용해서 서류도 자동으로 분류화").
alter table documents add column if not exists category_major text;
alter table documents add column if not exists gia_system_id uuid references gia_systems(id) on delete set null;

-- 기존 6개 항목(구비서류/내규/계약서/학생관리/교사관리/교직원관리)은 전부 지우고, 다른 공립·사립·
-- 국제학교가 일반적으로 갖추는 시스템을 참고해 대분류>중분류>세부 항목으로 세분화한 44개 항목으로
-- 다시 구성합니다. 기존에 GIA가 이미 갖췄던 것(서류함/운영계획안/학생통합프로필/교직원 배정관리 등)은
-- 같은 상태를 유지한 채 새 분류 체계 안으로 이전했습니다.
delete from gia_systems;

insert into gia_systems (major, category, name, status, description, source) values
  ('재정', '예산·회계', '연간 예산안 수립 및 이사회 승인 절차', '미보유', '매 회계연도 시작 전 예산안을 편성하고 이사회 승인을 받는 정식 절차가 문서화되어 있지 않습니다.', 'manual'),
  ('재정', '예산·회계', '회계장부·전표 관리 시스템', '미보유', '수입/지출 전표를 체계적으로 기록하고 월별로 마감하는 회계 시스템이 아직 없습니다.', 'manual'),
  ('재정', '등록금·수납', '등록금 고지 및 수납 관리 시스템', '미보유', '등록금 고지서 발송, 납부 확인, 미납 관리를 체계적으로 처리하는 시스템이 없습니다.', 'manual'),
  ('재정', '등록금·수납', '환불 규정 및 처리 절차', '미보유', '중도 퇴원 시 환불 기준일과 환불액 산정 기준이 문서로 명시되어 있지 않습니다.', 'manual'),
  ('재정', '구매·계약', '구매품의 및 발주 승인 체계', '미보유', '물품/용역 구매 시 품의부터 승인까지의 절차가 표준화되어 있지 않습니다.', 'manual'),
  ('재정', '구매·계약', '거래처(용역·물품) 계약서 관리', '미보유', '청소, 급식, 셔틀 등 외부 용역업체와의 계약서를 체계적으로 보관·관리하는 시스템이 없습니다.', 'manual'),
  ('인사·교직원', '채용', '교사·직원 채용공고 및 선발 절차', '미보유', '채용 공고, 서류/면접 전형, 합격자 통보까지의 표준 절차가 문서화되어 있지 않습니다.', 'manual'),
  ('인사·교직원', '채용', '아동학대·성범죄 경력조회 체계', '미보유', '채용 전/재직 중 정기적으로 아동학대 및 성범죄 경력을 조회하는 절차가 필요합니다.', 'manual'),
  ('인사·교직원', '계약·노무', '교직원 표준근로계약서 관리', '미보유', '교직원 개인별 근로계약서를 표준 양식으로 작성·보관하는 체계가 없습니다.', 'manual'),
  ('인사·교직원', '계약·노무', '취업규칙·내규집', '부분보유', '사건/행사 대응 절차 등 일부 내규성 문서는 실무자매뉴얼에 정리돼 있으나, 별도의 정식 취업규칙/내규집은 아직 없습니다.', 'manual'),
  ('인사·교직원', '계약·노무', '4대보험 및 노무관리', '미보유', '4대보험 가입/변경, 급여명세서 발급 등 노무 행정을 체계적으로 관리하는 시스템이 없습니다.', 'manual'),
  ('인사·교직원', '근태·평가', '근태관리(출퇴근) 시스템', '미보유', '교직원 출퇴근 기록과 연차/휴가 사용 현황을 관리하는 시스템이 없습니다.', 'manual'),
  ('인사·교직원', '근태·평가', '교직원 직위·담당 배정 관리', '보유', '교사/행정직원/관리자 직위 구분과 담당 반·과목 배정을 관리하고 있습니다.', 'manual'),
  ('인사·교직원', '근태·평가', '교직원 인사평가 체계', '미보유', '정기적인 교직원 근무평가 및 피드백 절차가 마련되어 있지 않습니다.', 'manual'),
  ('학사', '입학·학적', '입학전형 및 대기자 관리 시스템', '미보유', '입학 지원, 전형 진행, 대기자 순번을 체계적으로 관리하는 시스템이 없습니다.', 'manual'),
  ('학사', '입학·학적', '재학생 학적관리(전입·전출)', '미보유', '학생의 전입/전출/휴학 등 학적 변동사항을 기록·관리하는 표준 절차가 없습니다.', 'manual'),
  ('학사', '성적·평가', '학생 통합 프로필 + 주간 학생 관찰기록', '보유', '학생별 영구 고유번호, 재학이력, 과목별 평가·코멘트를 관리하고 있습니다.', 'manual'),
  ('학사', '성적·평가', '생활기록부·수료증 발급 체계', '미보유', '학생 생활기록부나 수료증을 표준 양식으로 발급하는 체계가 없습니다.', 'manual'),
  ('학사', '출결·교육과정', '출결관리 시스템', '미보유', '일일 출결 확인 및 장기결석 학생을 추적하는 시스템이 없습니다.', 'manual'),
  ('학사', '출결·교육과정', '교육과정 편성 및 시수관리', '미보유', '학년/학기별 교육과정 편성과 과목별 시수를 관리하는 체계가 문서화되어 있지 않습니다.', 'manual'),
  ('운영', '사건·위기대응', '사건·사고 대응 매뉴얼', '부분보유', '사건 유형별 대응 절차가 실무자매뉴얼에 점차 축적되고 있으나, 전체 위기상황을 아우르는 통합 매뉴얼은 아직 부족합니다.', 'manual'),
  ('운영', '사건·위기대응', '비상연락망 및 위기대응체계', '미보유', '화재/지진/실종 등 비상상황 발생 시 연락 순서와 대응 역할을 정한 비상연락망이 없습니다.', 'manual'),
  ('운영', '통학·차량', '통학차량 운행 및 승하차 관리', '미보유', '셔틀버스 운행 시간표, 승하차 확인, 미탑승 학생 대응 절차가 표준화되어 있지 않습니다.', 'manual'),
  ('운영', '통학·차량', '차량 안전점검 및 운전자 관리', '미보유', '차량 정기 안전점검과 운전자 자격/이력 관리 체계가 없습니다.', 'manual'),
  ('운영', '급식·보건', '급식 위생·알레르기 관리 체계', '미보유', '학생별 알레르기 정보를 급식 준비 과정에 반영하는 체계와 위생점검 기록이 없습니다.', 'manual'),
  ('운영', '급식·보건', '보건실 운영 및 투약관리', '미보유', '상비약 관리, 학부모 동의 기반 투약 절차, 보건실 이용 기록 체계가 없습니다.', 'manual'),
  ('운영', '행사·캠프', '행사 기획 및 사후평가 체계', '부분보유', '행사기록 메뉴에서 사진/소감을 남기고 있지만, 기획 단계의 체크리스트나 예산 승인 절차는 아직 표준화되지 않았습니다.', 'manual'),
  ('운영', '행사·캠프', '방학캠프 운영관리', '부분보유', '여름/겨울캠프를 학기 개념으로 기록하고 있으나, 캠프 전용 안전관리·프로그램 승인 절차는 부족합니다.', 'manual'),
  ('시설·안전', '시설관리', '시설 안전점검표 및 유지보수 체계', '미보유', '건물/놀이시설 등에 대한 정기 안전점검표와 보수 이력 관리 체계가 없습니다.', 'manual'),
  ('시설·안전', '시설관리', '소방·전기 정기점검 체계', '미보유', '소방시설과 전기설비에 대한 법정 정기점검 일정 관리 체계가 없습니다.', 'manual'),
  ('시설·안전', '보안·출입', '방문자 출입관리 시스템', '미보유', '외부인 방문 시 신원 확인 및 출입 기록을 남기는 체계가 없습니다.', 'manual'),
  ('시설·안전', '보안·출입', 'CCTV 운영 및 관리방침', '미보유', 'CCTV 설치/열람/보관기간에 대한 공식 운영방침이 문서화되어 있지 않습니다.', 'manual'),
  ('입학·홍보', '홍보', '학교 소개자료 및 웹사이트 관리', '미보유', '학교 소개자료, 웹사이트 콘텐츠를 정기적으로 갱신·관리하는 담당 체계가 없습니다.', 'manual'),
  ('입학·홍보', '홍보', 'SNS·사진 활용 동의관리', '미보유', '학생 사진/영상을 SNS나 홍보물에 사용할 때 학부모 동의를 개별적으로 확인·기록하는 체계가 없습니다.', 'manual'),
  ('입학·홍보', '학부모소통', '학부모 상담예약 체계', '미보유', '학부모가 담임/행정팀과 상담을 예약하고 기록을 남기는 체계가 없습니다.', 'manual'),
  ('입학·홍보', '학부모소통', '학부모 만족도조사', '미보유', '정기적으로 학부모 만족도를 조사하고 결과를 운영 개선에 반영하는 절차가 없습니다.', 'manual'),
  ('행정·문서', '문서관리', '서류함(구비서류 체크리스트)', '보유', 'GIA 운영 앱의 서류함에서 필요서류 목록과 준비 상태(필요/준비중/보유/만료임박)를 관리하고 있습니다.', 'manual'),
  ('행정·문서', '문서관리', '공문서·증명서 발급관리', '미보유', '재학증명서 등 각종 증명서 발급 이력을 관리하는 체계가 없습니다.', 'manual'),
  ('행정·문서', '규정', '운영계획안', '보유', '학부모에게 배포되는 학교 운영 방침을 운영계획안 문서로 관리하고 있습니다.', 'manual'),
  ('행정·문서', '규정', '매뉴얼 정기 리뷰 체계', '보유', '1년 이상 재검토되지 않았거나 관련 사건이 급증한 매뉴얼 항목을 자동으로 짚어주는 정기 리뷰 기능을 운영 중입니다.', 'manual'),
  ('정보보안·법무', '개인정보보호', '개인정보처리방침 및 동의서 관리', '미보유', '학생/학부모 개인정보 수집·이용에 대한 공식 처리방침과 동의서 관리 체계가 없습니다.', 'manual'),
  ('정보보안·법무', '개인정보보호', '개인정보 유출 대응 체계', '미보유', '개인정보 유출 사고 발생 시 신고·통지 절차가 마련되어 있지 않습니다.', 'manual'),
  ('정보보안·법무', '등록·인허가', '대안교육기관 등록서류 관리', '미보유', '대안교육기관에 관한 법률에 따른 등록 서류 원본과 갱신 이력을 체계적으로 보관하는 체계가 없습니다.', 'manual'),
  ('정보보안·법무', '등록·인허가', '인허가 갱신일정 관리', '미보유', '각종 인허가의 갱신 시점을 미리 알려주는 일정 관리 체계가 없습니다.', 'manual');

-- GIA시스템 AI 벤치마킹 제안을 "추가" 또는 "세분화" 두 용도로만 쓰도록 좁히면서(요청: "이미 잘
-- 정리해둔 항목들을 마음대로 지우거나 하지 않도록"), 세분화 제안이면 원본 항목 이름을 이 컬럼에
-- 남겨서 화면에 "OOO 항목을 세분화한 제안"이라고 표시합니다. 원본 항목 자체는 절대 수정/삭제
-- 대상이 아니며(API는 여전히 "없을 때만 추가"만 수행), 이 컬럼은 순수 참고용 텍스트입니다.
alter table gia_systems add column if not exists refines_name text;

-- ===== 73. 학생 출석부(실시간 체크 + 보호자 연락) =====
-- 요청: "학생출석부를 교사가 실시간 체크할 수 있게 해주고 다른권한의 교직원들도 그것을
-- 실시간으로 보고 결석학생 보호자에게 연락할 수 있는 출석부 시스템을 메뉴로 만들어줘". 반(학급)
-- 담임교사가 매일 학생별 출결 상태를 체크하면, 행정직원/관리자 등 다른 직원도 같은 화면을
-- Realtime으로 동시에 보고, 결석/조퇴한 학생의 보호자에게 바로 연락(전화/이메일)한 뒤 연락
-- 완료 여부를 기록할 수 있게 합니다. 학생-날짜 조합으로 하루 한 행만 존재합니다(unique).
create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references wr_students(id) on delete cascade,
  class_id uuid references wr_classes(id) on delete set null,
  date date not null default current_date,
  status text not null default '출석' check (status in ('출석', '지각', '결석', '조퇴', '기타')),
  note text,
  checked_by text,
  checked_by_name text,
  checked_at timestamptz,
  contacted_guardian boolean not null default false,
  contact_note text,
  contacted_by text,
  contacted_by_name text,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, date)
);
create index if not exists attendance_records_date_idx on attendance_records(date);
create index if not exists attendance_records_class_date_idx on attendance_records(class_id, date);

drop trigger if exists attendance_records_set_updated_at on attendance_records;
create trigger attendance_records_set_updated_at
  before update on attendance_records
  for each row execute function set_updated_at();

alter table attendance_records enable row level security;

-- 기존 관례(tasks/messages/wr_* 등)와 동일하게 giamicro 승인 사용자에게 테이블 단위로 넓게
-- 열어두고(담임교사가 결석을 체크하거나, 다른 직원이 대신 체크/보호자 연락을 기록하는 등 누구나
-- 쓸 수 있어야 하는 화면이라), "교사는 기본적으로 자기 반만 본다" 같은 세부 규칙은 화면(서버
-- 쿼리) 쪽에서 처리합니다.
drop policy if exists "giamicro_all_attendance_records" on attendance_records;
create policy "giamicro_all_attendance_records" on attendance_records
  for all using (is_giamicro_user()) with check (is_giamicro_user());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_records'
  ) then
    alter publication supabase_realtime add table attendance_records;
  end if;
end $$;

-- ===== 74. 운영계획안·매뉴얼 "항목" 체계 도입 + GIA시스템 편집권한 확장 =====
-- 요청: "Gia시스템을 참조했을 때, 학부모님들께 보낼 운영계획안에 들어가면 좋을 항목들을
-- 추려주고... 매뉴얼은 실무자가 컴플레인 받을 수 있는 여러 상황들이나 규정들을... 매뉴얼
-- 항목도 만들어줘... 모든 항목들(시스템의항목들이나, 매뉴얼, 운영계획안의 항목들)은 편집
-- 가능하도록". 지금까지 운영계획안(학부모용)/매뉴얼(실무자용)의 "항목(category)"은 AI가
-- 사건/회의를 제안으로 만들 때 그때그때 자유롭게 지어내던 이름이었습니다. 이제 GIA시스템
-- 벤치마킹과 국제학교 컴플레인/규정 사례를 참고해 미리 정리한 "고정 항목 목록"을 만들고, AI
-- 분류도 이 목록 중에서만 고르도록 완전히 대체합니다(요청 확인: "새 항목 체계로 완전히
-- 대체"). 항목은 관리자·행정직원이 화면에서 이름/설명/보유상태를 직접 추가·수정·삭제할 수
-- 있습니다(요청 확인: "관리자·행정직원까지" 편집 가능).

-- ----- (1) GIA시스템 편집 권한을 관리자→관리자+행정직원으로 확장 -----
-- 지금까지는 is_app_admin()이라 관리자 계정만 조회/수정할 수 있었는데, 위클리 리포트 등에서
-- 이미 쓰던 "관리자 또는 행정직원" 판정 함수(is_wr_manager)로 교체합니다.
drop policy if exists "admin_all_gia_systems" on gia_systems;
create policy "admin_all_gia_systems" on gia_systems
  for all using (is_wr_manager()) with check (is_wr_manager());

-- ----- (2) 정책 항목(policy_categories) 테이블 -----
-- target_doc='학부모용'은 운영계획안 항목, target_doc='실무자용'은 매뉴얼 항목입니다.
-- gia_system_id는 학부모용 항목이 어느 GIA시스템 항목을 참고해 만들어졌는지 남겨둡니다(추적용,
-- 필수 아님). status는 gia_systems와 같은 보유/부분보유/미보유 3단계이고, 실제로 그 항목에
-- 해당하는 manual_sections 콘텐츠가 채워지면 관리자가 화면에서 손으로 갱신합니다.
create table if not exists policy_categories (
  id uuid primary key default gen_random_uuid(),
  target_doc text not null check (target_doc in ('학부모용', '실무자용')),
  domain text not null default '',
  category text not null,
  description text,
  status text not null default '미보유' check (status in ('보유', '부분보유', '미보유')),
  sort_order double precision not null default 0,
  source text not null default 'benchmark',   -- 'gia_system' | 'benchmark' | 'manual'
  gia_system_id uuid references gia_systems(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_doc, category)
);

drop trigger if exists policy_categories_set_updated_at on policy_categories;
create trigger policy_categories_set_updated_at
  before update on policy_categories
  for each row execute function set_updated_at();

alter table policy_categories enable row level security;

-- 조회는 giamicro 전 직원(사건/회의 입력 화면에서 드롭다운으로 골라야 하므로), 추가·수정·삭제는
-- 관리자·행정직원만 허용합니다.
drop policy if exists "giamicro_select_policy_categories" on policy_categories;
create policy "giamicro_select_policy_categories" on policy_categories
  for select using (is_giamicro_user());

drop policy if exists "manager_insert_policy_categories" on policy_categories;
create policy "manager_insert_policy_categories" on policy_categories
  for insert with check (is_wr_manager());

drop policy if exists "manager_update_policy_categories" on policy_categories;
create policy "manager_update_policy_categories" on policy_categories
  for update using (is_wr_manager()) with check (is_wr_manager());

drop policy if exists "manager_delete_policy_categories" on policy_categories;
create policy "manager_delete_policy_categories" on policy_categories
  for delete using (is_wr_manager());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'policy_categories'
  ) then
    alter publication supabase_realtime add table policy_categories;
  end if;
end $$;

-- ----- (3) 사건/회의에 "항목" 태그 컬럼 추가 -----
-- incidents.manual_cat은 원래부터 "매뉴얼 항목(정렬/분류용)"이라는 주석대로 실무자용 항목
-- 태그로 계속 씁니다. 여기에 학부모용(운영계획안) 항목 태그를 새로 추가하고, meetings에는
-- 둘 다 없었으므로 두 컬럼을 새로 추가합니다(요청: "그 항목을 기준으로 사건,회의,운영계획안을
-- 항목화 해줘").
alter table incidents add column if not exists op_plan_cat text;
alter table meetings add column if not exists manual_cat text;
alter table meetings add column if not exists op_plan_cat text;

-- ----- (4) 학부모용(운영계획안) 항목 시드 - GIA시스템 44개 항목 중 학부모 공개에 적합한 것만
-- 추려 안내형 문구로 다듬었습니다. status는 참고한 GIA시스템 항목의 보유상태를 그대로
-- 물려받습니다(정확한 실제 보유여부는 관리자가 화면에서 다시 확인/수정하면 됩니다).
insert into policy_categories (target_doc, domain, category, description, status, source, gia_system_id, sort_order) values
  ('학부모용', '재정', '등록금 납부 및 환불 규정', '등록금 고지·수납 절차와 중도 퇴원 시 환불 기준을 학부모에게 명확히 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='재정' and category='등록금·수납' and name='환불 규정 및 처리 절차'), 1),
  ('학부모용', '학사', '입학 전형 및 대기자 관리 안내', '입학 지원부터 전형, 대기자 순번 안내까지의 절차를 학부모가 알기 쉽게 정리하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='학사' and category='입학·학적' and name='입학전형 및 대기자 관리 시스템'), 2),
  ('학부모용', '학사', '학적 관리(전입·전출) 안내', '전입·전출·휴학 등 학적 변동 시 필요한 절차와 서류를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='학사' and category='입학·학적' and name='재학생 학적관리(전입·전출)'), 3),
  ('학부모용', '학사', '출결 관리 및 결석 처리 기준', '지각·결석·조퇴 처리 기준과 장기결석 시 절차를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='학사' and category='출결·교육과정' and name='출결관리 시스템'), 4),
  ('학부모용', '학사', '교육과정 및 학사일정 안내', '학년/학기별 교육과정 편성과 주요 학사일정을 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='학사' and category='출결·교육과정' and name='교육과정 편성 및 시수관리'), 5),
  ('학부모용', '학사', '성적 평가 및 생활기록부 발급 안내', '평가 방식과 생활기록부·수료증 발급 절차를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='학사' and category='성적·평가' and name='생활기록부·수료증 발급 체계'), 6),
  ('학부모용', '운영', '위기상황 대응 및 비상연락 체계 안내', '화재·지진 등 비상상황 발생 시 학교의 대응 절차와 학부모 연락 방법을 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='운영' and category='사건·위기대응' and name='비상연락망 및 위기대응체계'), 7),
  ('학부모용', '운영', '통학차량 운행 및 안전관리 안내', '셔틀버스 운행 시간표, 승하차 확인, 안전관리 방침을 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='운영' and category='통학·차량' and name='통학차량 운행 및 승하차 관리'), 8),
  ('학부모용', '운영', '급식 위생 및 알레르기 관리방침', '급식 위생점검과 학생 알레르기 정보 반영 절차를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='운영' and category='급식·보건' and name='급식 위생·알레르기 관리 체계'), 9),
  ('학부모용', '운영', '보건실 운영 및 투약 동의 절차', '상비약 관리와 학부모 동의 기반 투약 절차를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='운영' and category='급식·보건' and name='보건실 운영 및 투약관리'), 10),
  ('학부모용', '운영', '행사 및 방학캠프 운영 안내', '정규 행사와 방학캠프의 운영 방침·안전관리를 안내하는 항목입니다.', '부분보유', 'gia_system', (select id from gia_systems where major='운영' and category='행사·캠프' and name='방학캠프 운영관리'), 11),
  ('학부모용', '시설·안전', '시설 안전점검 및 소방·전기 점검 안내', '건물·놀이시설, 소방·전기설비의 정기 안전점검 체계를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='시설·안전' and category='시설관리' and name='시설 안전점검표 및 유지보수 체계'), 12),
  ('학부모용', '시설·안전', '방문자 출입 및 CCTV 운영방침', '외부인 출입 확인 절차와 CCTV 설치·열람·보관 기준을 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='시설·안전' and category='보안·출입' and name='CCTV 운영 및 관리방침'), 13),
  ('학부모용', '입학·홍보', 'SNS·사진 활용 동의 안내', '학생 사진·영상을 SNS나 홍보물에 사용할 때의 학부모 동의 절차를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='입학·홍보' and category='홍보' and name='SNS·사진 활용 동의관리'), 14),
  ('학부모용', '입학·홍보', '학부모 상담 예약 및 소통창구 안내', '담임·행정팀과의 상담 예약 방법과 평소 소통 채널을 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='입학·홍보' and category='학부모소통' and name='학부모 상담예약 체계'), 15),
  ('학부모용', '입학·홍보', '학부모 만족도 조사 안내', '정기 만족도 조사 방식과 결과 반영 절차를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='입학·홍보' and category='학부모소통' and name='학부모 만족도조사'), 16),
  ('학부모용', '정보보안·법무', '개인정보 처리방침 및 동의서 안내', '학생·학부모 개인정보 수집·이용 목적과 동의 절차를 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='정보보안·법무' and category='개인정보보호' and name='개인정보처리방침 및 동의서 관리'), 17),
  ('학부모용', '정보보안·법무', '개인정보 유출 시 대응절차 안내', '개인정보 유출 사고 발생 시 학부모에게 알리는 절차와 대응 방침을 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='정보보안·법무' and category='개인정보보호' and name='개인정보 유출 대응 체계'), 18),
  ('학부모용', '정보보안·법무', '대안교육기관 등록 현황 안내', '대안교육기관에 관한 법률에 따른 학교 등록 현황을 투명하게 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='정보보안·법무' and category='등록·인허가' and name='대안교육기관 등록서류 관리'), 19),
  ('학부모용', '인사·교직원', '교직원 아동학대·성범죄 경력조회 방침 안내', '채용 전/재직 중 정기적으로 시행하는 경력조회 방침을 학부모가 안심할 수 있도록 안내하는 항목입니다.', '미보유', 'gia_system', (select id from gia_systems where major='인사·교직원' and category='채용' and name='아동학대·성범죄 경력조회 체계'), 20)
on conflict (target_doc, category) do nothing;

-- ----- (5) 실무자용(매뉴얼) 항목 시드 - 국제학교/타 학교의 컴플레인 대응·규정 사례를 참고해
-- GIA에 아직 없는 항목을 새로 정리했습니다(요청: "실무자가 컴플레인 받을 수 있는 여러
-- 상황들이나, 규정들을... 다른학교나 국제학교들을 참고하여"). 전부 신규 벤치마킹 항목이라
-- source='benchmark', status는 전부 '미보유'로 시작합니다.
insert into policy_categories (target_doc, domain, category, description, status, source, sort_order) values
  ('실무자용', '아동보호·안전', '아동학대 인지 및 의무신고 절차', '교직원이 아동학대 징후를 인지했을 때 따라야 할 신고 의무와 절차가 문서화되어 있지 않습니다.', '미보유', 'benchmark', 1),
  ('실무자용', '아동보호·안전', '학생 안전사고 발생 시 보고체계', '교내외 안전사고 발생 시 누구에게 몇 시간 내 어떤 순서로 보고하는지에 대한 표준 절차가 없습니다.', '미보유', 'benchmark', 2),
  ('실무자용', '아동보호·안전', '알레르기·응급질환 대응 프로토콜', '아나필락시스 등 응급상황 발생 시 에피펜 사용법을 포함한 대응 절차가 표준화되어 있지 않습니다.', '미보유', 'benchmark', 3),
  ('실무자용', '괴롭힘·생활지도', '학교폭력·따돌림 대응 절차', '학생 간 괴롭힘 신고 접수부터 조사, 조치까지의 단계별 절차가 마련되어 있지 않습니다.', '미보유', 'benchmark', 4),
  ('실무자용', '괴롭힘·생활지도', '사이버불링(온라인 괴롭힘) 대응 지침', 'SNS·메신저를 통한 온라인 괴롭힘 신고와 대응 지침이 없습니다.', '미보유', 'benchmark', 5),
  ('실무자용', '괴롭힘·생활지도', '학생 징계 절차 및 이의제기(항소) 절차', '징계 결정 과정과 학생·학부모가 이의를 제기할 수 있는 절차가 문서화되어 있지 않습니다.', '미보유', 'benchmark', 6),
  ('실무자용', '괴롭힘·생활지도', '학생 간 다툼·갈등 중재 절차', '경미한 학생 간 갈등을 담임/행정팀이 중재하는 표준 절차가 없습니다.', '미보유', 'benchmark', 7),
  ('실무자용', '컴플레인·민원대응', '학부모 민원 접수 및 처리 절차', '학부모 민원을 접수하고 단계적으로(담임→행정팀→관리자) 처리하는 공식 절차가 없습니다.', '미보유', 'benchmark', 8),
  ('실무자용', '컴플레인·민원대응', '교사 대상 컴플레인 대응 지침', '불친절·편애 등 특정 교사에 대한 컴플레인을 접수하고 조사하는 지침이 없습니다.', '미보유', 'benchmark', 9),
  ('실무자용', '컴플레인·민원대응', '성적·평가 이의제기 절차', '평가 결과에 대한 학부모·학생의 이의제기를 접수하고 재검토하는 절차가 없습니다.', '미보유', 'benchmark', 10),
  ('실무자용', '컴플레인·민원대응', '언론·SNS 부정적 게시물 대응 지침', '학교 관련 부정적 게시물이나 민원이 SNS에 올라왔을 때의 대응 원칙이 없습니다.', '미보유', 'benchmark', 11),
  ('실무자용', '개인정보·법무', '학생 개인정보 유출·오남용 신고 대응 절차', '개인정보 유출 의심 사례를 신고받고 조사·통지하는 내부 절차가 없습니다.', '미보유', 'benchmark', 12),
  ('실무자용', '개인정보·법무', '양육권 분쟁 시 학생 인계 기준', '이혼·양육권 분쟁 가정의 경우 비양육 보호자의 학생 접근·인계 기준이 마련되어 있지 않습니다.', '미보유', 'benchmark', 13),
  ('실무자용', '개인정보·법무', '학생 사진·영상 SNS 게시 전 동의 확인 절차', '행사 사진 등을 게시하기 전 학부모 동의 여부를 확인하는 실무 절차가 없습니다.', '미보유', 'benchmark', 14),
  ('실무자용', '교직원 행동강령', '교직원 채용 전 신원조회 절차', '채용 확정 전 성범죄·아동학대 경력조회를 거치는 표준 절차가 문서화되어 있지 않습니다.', '미보유', 'benchmark', 15),
  ('실무자용', '교직원 행동강령', '교직원 행동강령 위반 신고·조사 절차', '부적절한 언행 등 교직원의 행동강령 위반을 신고하고 조사하는 절차가 없습니다.', '미보유', 'benchmark', 16),
  ('실무자용', '교직원 행동강령', '내부고발자 보호 및 신고창구', '내부 비위를 신고한 직원을 보호하는 절차와 익명 신고창구가 없습니다.', '미보유', 'benchmark', 17),
  ('실무자용', '통학·현장학습 안전', '통학버스 사고·지연 발생 시 대응 절차', '통학버스 사고나 지연 발생 시 학부모 안내와 대체 이동수단 확보 절차가 없습니다.', '미보유', 'benchmark', 18),
  ('실무자용', '통학·현장학습 안전', '현장학습(캠프 포함) 안전관리 및 사고대응 절차', '교외 활동 중 사고 발생 시 인솔교사가 따라야 할 표준 대응 절차가 없습니다.', '미보유', 'benchmark', 19),
  ('실무자용', '통학·현장학습 안전', '대체교사(서브) 배치 시 인수인계 절차', '담임 부재 시 대체교사에게 학생 특이사항을 인계하는 표준 절차가 없습니다.', '미보유', 'benchmark', 20),
  ('실무자용', '학습지원', '특수교육대상·학습지원 학생 관련 민원 대응 지침', '학습지원이 필요한 학생에 대한 학부모 민원을 다루는 별도 지침이 없습니다.', '미보유', 'benchmark', 21),
  ('실무자용', '위생·보건', '감염병 발생 시 등교중지 및 보고 절차', '전염병 의심 학생의 등교중지 기준과 보건당국 보고 절차가 마련되어 있지 않습니다.', '미보유', 'benchmark', 22)
on conflict (target_doc, category) do nothing;

-- ===== 사건기록 조치사항(resolution_note) =====
-- 요청: "사건기록에서 사건이 어떻게 완료되었는지 적을 수 있는 조치사항 공간을 만들어줘 - 어떤
-- 조치를 취했는지 적을 수 있도록". good/lack/suggest(회고·제안)와 별개로, 실제로 어떤 조치를
-- 취했는지를 남기는 칸입니다(업무탭 tasks.resolution_note와 동일한 패턴).
alter table incidents add column if not exists resolution_note text;

-- ===== 행정요청 제거 + 구글챗 미러링(출결알림/선생님요청) 도입 =====
-- 요청: "행정요청도 없애줘, 구글챗 미러링이 된다면 행정요청도 여기로 받을거라서 상관없어".
-- 행정요청 기능(교사가 앱 안에서 직접 입력하던 방식)을 완전히 걷어내고, 대신 교사들이 이미 쓰고
-- 있는 구글챗의 두 방(출결알림/선생님요청)을 읽기전용으로 실시간 미러링해서 같은 역할을
-- 대신합니다. 아래 DROP은 71~72번 섹션에서 만든 행정요청 관련 테이블/함수/트리거를 전부
-- 정리합니다 - 앱 코드가 더 이상 이 테이블들을 참조하지 않으므로 안전합니다.
drop trigger if exists tasks_sync_staff_request on tasks;
drop function if exists sync_staff_request_from_task();
drop trigger if exists staff_request_comments_bump_count on staff_request_comments;
drop function if exists bump_staff_request_comment_count();
drop function if exists create_staff_request(text, text, text, text, text, text, text, text, text[], text);
drop table if exists staff_request_comments cascade;
drop table if exists staff_requests cascade;
drop table if exists staff_request_categories cascade;

-- 구글챗 미러링 메시지 저장 테이블입니다. 실제 적재는 /api/cron/poll-chat-messages 라우트
-- (서비스 롤 키 사용, 외부 무료 스케줄러가 1분마다 호출)가 Chat API(spaces.messages.list)를
-- 직접 조회해 insert하고, 여기서는 조회/(업무등록 표시용) 갱신 정책만 둡니다.
-- google_message_id에 unique를 걸어 폴링 구간이 겹쳐도 중복 저장을 막습니다(upsert
-- ignoreDuplicates로 흡수). 참고: 처음에는 Google Workspace Events API + Pub/Sub push
-- 방식(진짜 실시간)으로 설계했지만, Pub/Sub 주제에 구글 시스템 계정을 Publisher로 추가하는
-- 단계가 조직의 Domain Restricted Sharing 정책에 막혀서(GCP 조직 정책 관리자 권한 필요 -
-- 이번 설계의 출발점인 "관리자 승인 없이 혼자 끝내기"와 상충) IAM 변경이 전혀 필요 없는
-- 폴링 방식으로 다시 바꿨습니다.
create table if not exists google_chat_mirror_messages (
  id uuid primary key default gen_random_uuid(),
  source_key text not null check (source_key in ('attendance', 'teacher_requests')),
  google_message_id text not null unique,
  google_space_id text,
  sender_display_name text,
  sender_email text,
  content text not null,
  created_at_google timestamptz not null,
  received_at timestamptz not null default now(),
  task_id uuid references tasks(id) on delete set null
);

create index if not exists google_chat_mirror_messages_source_created_idx
  on google_chat_mirror_messages(source_key, created_at_google desc);

alter table google_chat_mirror_messages enable row level security;

-- "업무탭에서 전체 행정직원들이 보고" - is_wr_manager()(관리자 또는 행정직원)로 조회를
-- 제한합니다. 교사는 여전히 구글챗 자체에서 보고 씁니다(이 테이블에는 접근 권한이 없습니다).
drop policy if exists "wr_manager_select_google_chat_mirror_messages" on google_chat_mirror_messages;
create policy "wr_manager_select_google_chat_mirror_messages" on google_chat_mirror_messages
  for select using (is_wr_manager());

-- insert는 webhook 라우트가 서비스 롤 키로 처리하므로(RLS 우회) 별도 insert 정책이 필요
-- 없습니다. update는 "🔧 업무로 등록" 클릭 시 task_id를 표시하는 용도로만 씁니다.
drop policy if exists "wr_manager_update_google_chat_mirror_messages" on google_chat_mirror_messages;
create policy "wr_manager_update_google_chat_mirror_messages" on google_chat_mirror_messages
  for update using (is_wr_manager()) with check (is_wr_manager());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'google_chat_mirror_messages'
  ) then
    alter publication supabase_realtime add table google_chat_mirror_messages;
  end if;
end $$;

-- Pub/Sub push 구독 방식을 쓸 때 구독 상태를 기억해두던 테이블이었는데, 폴링 방식으로
-- 바꾸면서 더 이상 쓰지 않아 정리합니다(앱 코드가 더 이상 참조하지 않으므로 안전합니다).
drop table if exists google_chat_subscriptions cascade;

-- 구글챗 미러링 인증 방식을 서비스 계정+도메인 위임에서 본인 계정 OAuth로 바꿨습니다(요청: "나는
-- 직원이라 관리자 권한이 없고... 관리자 계정 없이 방법이 없을까?" - Workspace Events API는 본인
-- 자격증명으로도 동작하므로 도메인 관리자 승인 없이 강경원님 본인 계정만으로 설정 가능합니다).
-- 여기 저장되는 refresh_token은 이 앱이 구글챗을 대신 읽을 수 있는 열쇠라, select 정책을 아예
-- 두지 않아 서비스 롤 키를 쓰는 서버 라우트(크론/콜백)만 접근할 수 있습니다 - 화면 어디에서도
-- 조회할 수 없습니다. 행은 id='default' 하나만 존재합니다(계정이 한 명뿐이므로).
create table if not exists google_chat_oauth_tokens (
  id text primary key default 'default',
  refresh_token text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table google_chat_oauth_tokens enable row level security;

-- ===== 75. 교직원 통합기록 (요청: "학생처럼 교직원도 통합으로 관리, 입사/퇴사, 연도별 담당
-- 반 등 고유 데이터로 기록 유지") =====
-- 학생 쪽(wr_students + wr_enrollments)과 같은 구조입니다: 로그인 계정(app_users.email)을
-- 그대로 영구 식별자로 쓰고(별도 명부 테이블을 새로 만들지 않음 - 계정이 삭제되지 않는 한
-- 퇴사해도 행이 남아있어 기록이 계속 유지됩니다), 연도/학기별로 달라지는 값(소속·직위·담당
-- 반/역할)은 staff_assignments에 이력으로 쌓습니다.
alter table app_users add column if not exists hire_date date;
alter table app_users add column if not exists leave_date date;

create table if not exists staff_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null references app_users(email) on delete cascade,
  term_id uuid references terms(id) on delete set null,
  department text,
  position text,
  role_label text not null,   -- 자유 입력: "3학년 2반 담임", "영어 부담임", "체육 교사" 등
  grade text,
  class_id uuid references wr_classes(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists staff_assignments_staff_idx on staff_assignments(staff_email, created_at desc);
create index if not exists staff_assignments_term_idx on staff_assignments(term_id);

alter table staff_assignments enable row level security;

-- 조회는 학생 정보 조회와 동일하게 관리자·행정직원까지(is_wr_manager) - 동료의 입사/퇴사일 같은
-- 인사 정보라 교사에게는 노출하지 않습니다.
drop policy if exists "wr_manager_select_staff_assignments" on staff_assignments;
create policy "wr_manager_select_staff_assignments" on staff_assignments
  for select using (is_wr_manager());

-- 기록 추가/수정/삭제는 관리자만(기존 사용자관리 승인/직위 변경과 같은 권한 경계).
drop policy if exists "admin_write_staff_assignments" on staff_assignments;
create policy "admin_write_staff_assignments" on staff_assignments
  for all using (is_app_admin()) with check (is_app_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_assignments'
  ) then
    alter publication supabase_realtime add table staff_assignments;
  end if;
end $$;

-- ===== 76. 셔틀(등하원 차량) 관리 =====
-- 지입차량이라 기사님·차량번호·동승 선생님이 수시로 바뀌므로, 노선(shuttle_routes)에 현재
-- 담당자를 직접 적어두고 바뀔 때마다 갱신합니다(별도 기사 마스터 테이블을 두면 매번 두 곳을
-- 고쳐야 해서 실무에서 오히려 어긋납니다).
create table if not exists shuttle_routes (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('등원', '하원')),
  route_no text not null,                    -- '1', '1-1', '20-2' 등 (PDF의 호차)
  name text,                                 -- '잠원', '메이플자이 Gate2' 등 권역명
  driver_name text,
  driver_phone text,
  vehicle_no text,                           -- 차량번호(지입차량이라 바뀔 수 있음)
  teacher_name text,
  teacher_phone text,
  -- 출발 기준시각: 등원 08:00, 하원 16:00(요청) - 노선별로 다르면 여기서 조정합니다.
  depart_time time not null default '08:00',
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 호차 번호에 유니크 제약을 두지 않습니다 - 실제 배차표(2026BUS.pdf)에 "등원 22호"가 청담1과
-- 청담4 두 노선에 중복으로 적혀 있었습니다. 운영 중에도 노선이 갈라지거나 번호를 잠시 겹쳐
-- 쓰는 일이 있어서, 제약으로 막기보다 화면에서 보고 정리하는 편이 실무에 맞습니다.
alter table shuttle_routes drop constraint if exists shuttle_routes_direction_route_no_key;
create index if not exists shuttle_routes_direction_no_idx on shuttle_routes(direction, route_no);

create table if not exists shuttle_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references shuttle_routes(id) on delete cascade,
  seq int not null default 0,                -- 노선 안에서의 순서
  stop_time text,                            -- '8:27', '16:40-50' 등 표기 그대로(범위/미정이 섞여 있음)
  address text,
  gate text,                                 -- 메이플자이처럼 게이트가 나뉘는 경우
  note text,
  lat double precision,                      -- 노선 지도용 좌표(카카오 지오코딩 결과 또는 수동 보정)
  lng double precision,
  geocoded_at timestamptz,                   -- 좌표를 마지막으로 채운 시각(자동/수동 공통)
  created_at timestamptz not null default now()
);
create index if not exists shuttle_stops_route_idx on shuttle_stops(route_id, seq);

-- 어떤 학생이 어느 정류장에서 무슨 요일에 타는지. 요일별로 내리는 곳이 다른 학생이 있어서
-- (요청 5) 같은 학생이 요일만 다르게 여러 행을 가질 수 있습니다.
-- weekdays: 1=월 ... 5=금. 매일이면 {1,2,3,4,5}.
create table if not exists shuttle_assignments (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid not null references shuttle_stops(id) on delete cascade,
  student_id uuid references wr_students(id) on delete set null,
  student_name_raw text not null,            -- PDF 표기 그대로(김연우A 등) - 명부 연결 전/실패 시 대비
  class_raw text,                            -- '5 Nightingale', '학교' 등 표기 그대로
  weekdays int[] not null default '{1,2,3,4,5}',
  guardian_phone text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists shuttle_assignments_stop_idx on shuttle_assignments(stop_id);
create index if not exists shuttle_assignments_student_idx on shuttle_assignments(student_id);

-- 하루치 탑승 체크 기록(동승 선생님 모바일 체크 + 자동 결석/픽업 반영).
-- auto_status는 출결내역(구글챗/부서메모)에서 자동으로 반영된 값이고, status는 실무자가
-- 더블체크해서 확정한 값입니다(요청 4: 자동체크하되 수정 가능하게).
create table if not exists shuttle_boardings (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  assignment_id uuid not null references shuttle_assignments(id) on delete cascade,
  auto_status text check (auto_status in ('결석', '픽업', '지각', '조퇴')),
  status text not null default '예정' check (status in ('예정', '탑승', '미탑승', '결석', '픽업')),
  checked_by text,
  checked_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (service_date, assignment_id)
);
create index if not exists shuttle_boardings_date_idx on shuttle_boardings(service_date);

-- 노선 단위 운행 상태(출발/도착 5분전/도착) - 동승 선생님이 누르면 기록되고, 대시보드와
-- 학부모 알림이 이 값을 실시간으로 따라갑니다.
create table if not exists shuttle_run_events (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  route_id uuid not null references shuttle_routes(id) on delete cascade,
  event text not null check (event in ('출발', '5분전', '도착')),
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists shuttle_run_events_date_idx on shuttle_run_events(service_date, route_id);

alter table shuttle_routes enable row level security;
alter table shuttle_stops enable row level security;
alter table shuttle_assignments enable row level security;
alter table shuttle_boardings enable row level security;
alter table shuttle_run_events enable row level security;

-- 조회는 로그인한 giamicro.com 계정이면 누구나(동승 선생님이 교사 계정일 수 있어 교사도 포함).
-- 편집(노선/정류장/배정)은 관리자·행정직원만, 탑승 체크는 동승 선생님이 해야 하므로 로그인
-- 사용자 전체에게 허용합니다.
do $$
declare t text;
begin
  foreach t in array array['shuttle_routes','shuttle_stops','shuttle_assignments'] loop
    execute format('drop policy if exists "giamicro_select_%1$s" on %1$s', t);
    execute format('create policy "giamicro_select_%1$s" on %1$s for select using (is_giamicro_user())', t);
    execute format('drop policy if exists "wr_manager_write_%1$s" on %1$s', t);
    execute format('create policy "wr_manager_write_%1$s" on %1$s for all using (is_wr_manager()) with check (is_wr_manager())', t);
  end loop;
  foreach t in array array['shuttle_boardings','shuttle_run_events'] loop
    execute format('drop policy if exists "giamicro_all_%1$s" on %1$s', t);
    execute format('create policy "giamicro_all_%1$s" on %1$s for all using (is_giamicro_user()) with check (is_giamicro_user())', t);
  end loop;
end $$;

drop trigger if exists shuttle_routes_set_updated_at on shuttle_routes;
create trigger shuttle_routes_set_updated_at
  before update on shuttle_routes
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['shuttle_routes','shuttle_stops','shuttle_assignments','shuttle_boardings','shuttle_run_events'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
