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
  decided_by text
);

alter table app_users enable row level security;

-- security definer로 만들어 아래 정책이 자기 자신(app_users)을 참조해도 재귀 없이 안전합니다.
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

-- 승인된 사용자(개발자 포함)는 전체 목록을 보고 승인/거절/차단을 처리할 수 있음
drop policy if exists "app_users_manage_by_admin" on app_users;
create policy "app_users_manage_by_admin" on app_users
  for all
  using (is_app_admin())
  with check (is_app_admin());

-- 개발자 계정은 배포 즉시 승인 상태로 등록해 잠기지 않도록 합니다.
insert into app_users (email, status, decided_at, decided_by)
values ('johnkang@giamicro.com', 'approved', now(), 'system')
on conflict (email) do update set status = 'approved';

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
