-- 학부모 상담 — 행사·상담실·예약·상태 기록·상담 메모
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 학부모 상담은 구글시트 + 앱스크립트로 돌았습니다. 상태 흐름(미도착 → 대기 → 상담준비 →
-- 상담중 → 완료)과 여러 상담실 순회 배정은 잘 짜여 있었지만 세 가지가 걸렸습니다.
--
--   · 학생을 **이름 글자**로 적었습니다. 김재이가 셋이라 명단의 「김재이」가 누구인지 시트는
--     모릅니다(CLAUDE.md §2-4-1).
--   · 로그인 없이 여는 현황판이 부르는 함수가 **학부모 전화번호까지** 돌려줬습니다. 화면에
--     안 보여도 주소만 알면 그대로 받아 갈 수 있었습니다.
--   · 계정·비밀번호를 시트에 글자 그대로 적었고, 지난 상담은 새 명단에 덮였습니다.
--
-- ── 어떻게 바꾸나 ───────────────────────────────────────────────────────────
--
--   · 학생은 **번호로** 잇습니다(consult_appointment_students). 형제를 한 번에 상담하면
--     한 예약에 여러 번호가 붙고, 따로 하면 예약이 따로 생깁니다.
--   · 행사(consult_events)마다 따로 남습니다. 1학기·2학기 상담이 서로 덮이지 않습니다.
--   · 상태가 바뀔 때마다 한 줄 남깁니다(consult_status_log). 누가 언제 바꿨는지, 그리고
--     상담실마다 실제로 몇 분 걸리는지(예상 대기 시간의 근거)가 여기서 나옵니다.
--   · 로그인은 교직원 계정이고, 현황판은 서버가 학년·이름(가림 여부는 행사 설정)·상태만
--     골라 보냅니다. 전화번호는 현황판 쪽으로 아예 나가지 않습니다.
--
-- 이 표들은 처음부터 «상담 모듈»로 묶어 둡니다. 새 플랫폼에서는 학교가 켜고 끄는 옵션
-- 모듈이 되므로(설계서 24장), 다른 갈래와 섞지 않습니다.

-- ── 1. 행사 ─────────────────────────────────────────────────────────────────
create table if not exists public.consult_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 상담 날짜. 이틀 이상이면 끝 날짜를 함께 적습니다.
  event_date date null,
  end_date date null,
  status text not null default '준비' check (status in ('준비', '진행', '종료')),
  -- 현황판에 이름을 가릴지(김*하). 학교 로비처럼 여럿이 보는 화면이면 켜 두는 것이 기본입니다.
  mask_names boolean not null default true,
  -- 형제를 넣을 때 기본값. 'together' = 한 번에 함께 상담, 'separate' = 따로, 'ask' = 넣을 때마다 묻기.
  sibling_default text not null default 'ask' check (sibling_default in ('together', 'separate', 'ask')),
  -- 기록이 쌓이기 전 예상 대기 시간의 출발값(분). 상담이 몇 건 끝나면 실제 평균으로 바뀝니다.
  default_minutes int not null default 15 check (default_minutes between 3 and 120),
  -- 현황판 열쇠. 로그인 없이 여는 화면이라 추측할 수 없는 값이어야 합니다.
  board_token uuid not null default gen_random_uuid(),
  board_enabled boolean not null default true,
  -- 이 시각이 지나면 현황판이 닫힙니다(비우면 행사가 「종료」가 될 때 닫힘).
  board_expires_at timestamptz null,
  -- 전자칠판 주소창에 손으로 칠 짧은 주소(/cs/코드).
  board_short_code text null,
  -- 학부모 개인 확인 링크(QR)를 열어 둘지.
  personal_links_enabled boolean not null default true,
  -- 연습용 계정(오리엔테이션)이 만든 행사. 실제 행사 목록에 섞이지 않게 값으로 못박습니다.
  is_demo boolean not null default false,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists consult_events_board_token_idx on public.consult_events (board_token);
create unique index if not exists consult_events_short_code_idx on public.consult_events (board_short_code) where board_short_code is not null;

-- ── 2. 상담실 ───────────────────────────────────────────────────────────────
create table if not exists public.consult_rooms (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.consult_events(id) on delete cascade,
  name text not null,
  -- 면담하는 선생님. 계정이 있으면 이메일로 잇습니다 - 선생님 화면이 «내 상담실»을 이걸로 찾습니다.
  teacher_email text null,
  teacher_name text null,
  -- 안내용 글자(예: 「1학년」). 배정 판단에는 쓰지 않습니다.
  grade_label text null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);
create index if not exists consult_rooms_event_idx on public.consult_rooms (event_id);

-- ── 3. 예약 ─────────────────────────────────────────────────────────────────
create table if not exists public.consult_appointments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.consult_events(id) on delete cascade,
  -- 예약 시각 'HH:MM'. 날짜는 행사에 있습니다.
  scheduled_time text null check (scheduled_time is null or scheduled_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- 지금 가 있거나 가야 할 상담실.
  room_id uuid null references public.consult_rooms(id) on delete set null,
  status text not null default '미도착'
    check (status in ('미도착', '대기', '상담준비', '상담중', '완료', '취소', '전화상담')),
  -- 취소·전화상담을 다시 누르면 돌아갈 자리.
  prev_status text null,
  -- 학부모가 늦는다고 알려온 분.
  delay_min int not null default 0 check (delay_min between 0 and 600),
  arrived_at timestamptz null,
  -- 면담자가 「다음 분 호출」을 누른 때. 현황판이 이 값으로 큰 안내를 띄웁니다.
  called_at timestamptz null,
  -- 여러 상담실을 도는 경우의 코스와 이미 끝낸 방. 비어 있으면 지금 방 하나로 끝납니다.
  course_room_ids uuid[] not null default '{}',
  done_room_ids uuid[] not null default '{}',
  -- 안내데스크 메모(현황판·학부모 링크에는 나가지 않습니다).
  note text null,
  -- 학부모가 휴대폰으로 «내 순서»를 보는 링크의 열쇠.
  personal_token uuid not null default gen_random_uuid(),
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consult_appointments_event_idx on public.consult_appointments (event_id);
create unique index if not exists consult_appointments_token_idx on public.consult_appointments (personal_token);

-- 예약 ↔ 학생. 형제를 함께 상담하면 한 예약에 둘 이상이 붙습니다.
create table if not exists public.consult_appointment_students (
  appointment_id uuid not null references public.consult_appointments(id) on delete cascade,
  student_id uuid not null references public.wr_students(id) on delete cascade,
  primary key (appointment_id, student_id)
);
create index if not exists consult_appt_students_student_idx on public.consult_appointment_students (student_id);

-- ── 4. 상태 기록 ────────────────────────────────────────────────────────────
-- 지우지 않고 쌓습니다. 「되돌리기」도 기록 한 줄입니다.
create table if not exists public.consult_status_log (
  id bigserial primary key,
  appointment_id uuid not null references public.consult_appointments(id) on delete cascade,
  event_id uuid not null references public.consult_events(id) on delete cascade,
  from_status text null,
  to_status text not null,
  room_id uuid null,
  -- 바꾸기 직전 예약 줄의 값(상태·방·코스 진행·호출·도착). 「되돌리기」는 이 값을 그대로
  -- 되살립니다 - 상태 글자 하나만 되돌리면 순회 코스에서 끝낸 방 목록이 어긋납니다.
  before jsonb null,
  -- 무엇을 눌렀나(arrive·call·start·finish·undo …). 통계와 «누가 무엇을» 확인에 씁니다.
  action text null,
  by_email text null,
  at timestamptz not null default now()
);
create index if not exists consult_status_log_event_idx on public.consult_status_log (event_id, at);

-- ── 5. 상담 메모 ────────────────────────────────────────────────────────────
-- 면담한 선생님이 남기는 기록. 쓴 사람과 관리자만 읽습니다 - 상담 내용은 교직원 전체가
-- 볼 자료가 아닙니다.
create table if not exists public.consult_notes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.consult_appointments(id) on delete cascade,
  student_id uuid null references public.wr_students(id) on delete set null,
  room_id uuid null references public.consult_rooms(id) on delete set null,
  author_email text not null,
  author_name text null,
  body text not null,
  -- 후속 할 일로 업무보드에 올렸으면 그 업무 번호.
  task_id uuid null,
  created_at timestamptz not null default now()
);
create index if not exists consult_notes_student_idx on public.consult_notes (student_id);
create index if not exists consult_notes_appt_idx on public.consult_notes (appointment_id);

-- updated_at
drop trigger if exists consult_events_set_updated_at on public.consult_events;
create trigger consult_events_set_updated_at before update on public.consult_events
  for each row execute function set_updated_at();
drop trigger if exists consult_appointments_set_updated_at on public.consult_appointments;
create trigger consult_appointments_set_updated_at before update on public.consult_appointments
  for each row execute function set_updated_at();

-- ── 6. 자물쇠 ───────────────────────────────────────────────────────────────
-- 교직원만. 현황판·학부모 링크는 로그인이 없으므로 서버가 열쇠(토큰)를 확인하고 필요한
-- 칸만 골라 보냅니다 - 표 자체는 anon 에게 열지 않습니다.
alter table public.consult_events enable row level security;
alter table public.consult_rooms enable row level security;
alter table public.consult_appointments enable row level security;
alter table public.consult_appointment_students enable row level security;
alter table public.consult_status_log enable row level security;
alter table public.consult_notes enable row level security;

drop policy if exists consult_events_staff on public.consult_events;
create policy consult_events_staff on public.consult_events
  for all to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user());

drop policy if exists consult_rooms_staff on public.consult_rooms;
create policy consult_rooms_staff on public.consult_rooms
  for all to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user());

drop policy if exists consult_appointments_staff on public.consult_appointments;
create policy consult_appointments_staff on public.consult_appointments
  for all to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user());

drop policy if exists consult_appt_students_staff on public.consult_appointment_students;
create policy consult_appt_students_staff on public.consult_appointment_students
  for all to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user());

drop policy if exists consult_status_log_staff on public.consult_status_log;
create policy consult_status_log_staff on public.consult_status_log
  for all to authenticated using (public.is_giamicro_user()) with check (public.is_giamicro_user());

-- 메모: 쓴 사람 + 관리자만.
drop policy if exists consult_notes_owner on public.consult_notes;
create policy consult_notes_owner on public.consult_notes
  for all to authenticated
  using (public.is_giamicro_user() and (author_email = lower(auth.jwt() ->> 'email') or public.is_app_admin()))
  with check (public.is_giamicro_user() and author_email = lower(auth.jwt() ->> 'email'));

revoke all on public.consult_events, public.consult_rooms, public.consult_appointments,
  public.consult_appointment_students, public.consult_status_log, public.consult_notes from anon;

-- ── 7. 「바뀌었다」 번호 ────────────────────────────────────────────────────
-- 현황판은 3초마다 번호만 물어봅니다. 번호를 올리는 일은 표의 트리거가 합니다 - 코드에서
-- 부르면 언젠가 한 곳을 빠뜨립니다(board_revisions 와 같은 이유).
insert into public.board_revisions (key) values ('consult') on conflict (key) do nothing;

create or replace function public.bump_consult() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.bump_board_revision('consult');
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['consult_events', 'consult_rooms', 'consult_appointments', 'consult_appointment_students'] loop
    execute format('drop trigger if exists %I on public.%I', 'bump_consult_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each statement execute function public.bump_consult()',
      'bump_consult_' || t, t
    );
  end loop;
end $$;

-- ── 8. 실시간 ───────────────────────────────────────────────────────────────
-- 안내데스크·면담자 화면은 바뀌는 순간 다시 읽습니다(구독에 조건을 걸지 않습니다).
do $$
declare
  t text;
begin
  foreach t in array array['consult_events', 'consult_rooms', 'consult_appointments', 'consult_appointment_students', 'consult_notes'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when others then
  raise notice '상담 표 실시간 등록을 건너뜁니다: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
