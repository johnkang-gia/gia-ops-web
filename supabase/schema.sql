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
