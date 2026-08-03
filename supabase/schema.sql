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
