-- ===== 수업일 달력 =====
--
-- 출석부의 분모입니다. "김서이가 이번 학기에 며칠 결석했나" 는 지금도 셀 수 있지만,
-- **"몇 일 중에 며칠"** 인지는 어디에도 답이 없었습니다. `terms` 에는 시작일과 종료일만 있고,
-- 방학·공휴일·재량휴업일을 적을 자리가 없습니다.
--
-- 분모가 없으면 출석률도 출석일수도 못 냅니다. 그리고 상급학교 서류·체류 증빙에서 실제로
-- 묻는 것이 바로 그 두 숫자입니다.
--
-- **평일을 자동으로 깔고, 예외만 사람이 뺍니다.** 100일을 하나씩 누르게 하면 그 일은 결국
-- 안 하게 되고, 안 하면 출석부 전체가 멈춥니다. 공휴일은 미리 넣어두고, 학교마다 다른
-- 방학·재량휴업일만 손으로 빼면 됩니다.

create table if not exists public.school_days (
  -- 날짜가 곧 열쇠입니다. 하루가 두 줄이 되면 수업일수가 두 번 세어집니다.
  day date primary key,

  -- 이 날 학교를 하는가. false 면 출석부에서 아예 빠집니다(결석으로 세지 않습니다).
  is_school_day boolean not null default true,

  -- 왜 쉬는가. '공휴일' · '방학' · '재량휴업일' · '개교기념일' · '기타'
  -- 쉬는 날에만 뜻이 있습니다. 화면에 그대로 보여주므로 사람이 읽는 말로 적습니다.
  closed_reason text,
  -- 화면에 뜨는 이름. '설날', '여름방학'.
  label text,

  term_id uuid references public.terms(id) on delete set null,

  -- 사람이 손댄 날인가. 자동 생성이 사람이 정한 것을 덮어쓰지 않기 위한 표시입니다.
  -- 이 표시가 없으면 "학기 달력 다시 만들기" 를 누를 때마다 재량휴업일이 도로 수업일이 됩니다.
  touched_by_human boolean not null default false,

  note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.school_days is
  '수업일 달력. 출석률의 분모입니다. 평일을 자동으로 깔고 방학·휴업일만 사람이 뺍니다.';
comment on column public.school_days.touched_by_human is
  'true면 자동 생성이 덮어쓰지 않습니다 - 자동이 사람 판단을 이기면 안 됩니다.';

create index if not exists school_days_term_idx on public.school_days (term_id, day);
create index if not exists school_days_open_idx on public.school_days (day) where is_school_day;

-- ── 기록이 시작된 날 ─────────────────────────────────────────────────────────
--
-- **자료가 없는 것과 결석이 0인 것은 다릅니다.**
--
-- 출석부를 쓰기 전의 날짜에는 아무 기록도 없습니다. 그 날들을 그냥 세면 "전원 출석" 으로
-- 읽히고, 그 숫자가 상급학교 서류에 그대로 나갑니다. 없는 출석을 있다고 적는 것입니다.
--
-- 그래서 **언제부터 실제로 출석을 찍기 시작했는지**를 한 줄 적어두고, 그 앞날은 집계에서
-- '자료 없음' 으로 따로 셉니다.
create table if not exists public.attendance_coverage (
  -- 한 줄짜리 표입니다. 학교가 하나라 기준도 하나입니다.
  id boolean primary key default true check (id),
  -- 이 날부터의 기록만 믿을 수 있습니다.
  starts_on date,
  note text,
  updated_by text,
  updated_at timestamptz not null default now()
);

comment on table public.attendance_coverage is
  '출석 기록을 실제로 찍기 시작한 날. 그 앞날은 결석 0이 아니라 자료 없음입니다.';

insert into public.attendance_coverage (id, starts_on, note)
values (true, null, '아직 정하지 않았습니다. 출석부 화면에서 정할 수 있습니다.')
on conflict (id) do nothing;

-- ── 학기 평일 자동 깔기 ──────────────────────────────────────────────────────
--
-- 학기 시작~종료 사이 평일을 수업일로 만듭니다. 이미 있는 날은 **건드리지 않습니다** -
-- 특히 사람이 손댄 날(touched_by_human)은 절대 덮어쓰지 않습니다.
--
-- 토요일·일요일만 뺍니다. 공휴일은 아래 표에서 따로 지웁니다 - 두 가지를 한 함수에 섞으면
-- "왜 이 날이 빠졌는지" 를 나중에 알 수 없습니다.
create or replace function public.fill_school_days(p_term_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  n integer := 0;
begin
  select id, start_date, end_date into t from terms where id = p_term_id;
  if t.id is null then
    raise exception '학기를 찾지 못했습니다: %', p_term_id;
  end if;
  if t.start_date is null or t.end_date is null then
    raise exception '학기에 시작일 또는 종료일이 없습니다. 학기 화면에서 먼저 적어주세요.';
  end if;

  insert into school_days (day, is_school_day, term_id)
  select d::date, true, t.id
    from generate_series(t.start_date, t.end_date, interval '1 day') as d
   -- 1~5 = 월~금. 주말은 애초에 만들지 않습니다.
   where extract(isodow from d) between 1 and 5
  on conflict (day) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.fill_school_days(uuid) is
  '학기 평일을 수업일로 깝니다. 이미 있는 날은 건드리지 않습니다(사람이 정한 것이 이깁니다).';

-- ── 공휴일 ───────────────────────────────────────────────────────────────────
--
-- 2026~2027학년도에 걸리는 한국 공휴일입니다. 대체공휴일까지 포함합니다.
--
-- 미리 넣어두는 이유: 이걸 안 넣으면 첫 설정에서 사람이 달력을 하나씩 훑으며 빨간 날을
-- 찾아야 합니다. 그 일은 지루하고, 지루한 일은 한두 개를 빠뜨립니다. 빠뜨린 하루는
-- 그 날 결석한 아이 전원의 결석 일수에 그대로 남습니다.
--
-- 날짜가 학기 밖이면 아무 일도 안 합니다 - 있는 날만 쉬는 날로 바꿉니다.
do $$
declare
  h record;
begin
  for h in
    select * from (values
      ('2026-01-01'::date, '신정'),
      ('2026-02-16'::date, '설날 연휴'),
      ('2026-02-17'::date, '설날'),
      ('2026-02-18'::date, '설날 연휴'),
      ('2026-03-02'::date, '삼일절 대체공휴일'),
      ('2026-05-01'::date, '근로자의 날'),
      ('2026-05-05'::date, '어린이날'),
      ('2026-05-25'::date, '부처님오신날 대체공휴일'),
      ('2026-06-03'::date, '지방선거'),
      ('2026-08-17'::date, '광복절 대체공휴일'),
      ('2026-09-24'::date, '추석 연휴'),
      ('2026-09-25'::date, '추석'),
      ('2026-10-05'::date, '개천절 대체공휴일'),
      ('2026-10-09'::date, '한글날'),
      ('2026-12-25'::date, '성탄절'),
      ('2027-01-01'::date, '신정'),
      ('2027-02-05'::date, '설날 연휴'),
      ('2027-02-08'::date, '설날 대체공휴일'),
      ('2027-03-01'::date, '삼일절'),
      ('2027-05-05'::date, '어린이날'),
      ('2027-05-13'::date, '부처님오신날'),
      ('2027-06-07'::date, '현충일 대체공휴일'),
      ('2027-08-16'::date, '광복절 대체공휴일')
    ) as v(day, label)
  loop
    update school_days
       set is_school_day = false,
           closed_reason = '공휴일',
           label = h.label,
           updated_at = now()
     where day = h.day
       -- 사람이 손댄 날은 그대로 둡니다. 학교가 공휴일에 행사를 하기로 했을 수도 있습니다.
       and touched_by_human = false;
  end loop;
end $$;

-- ── 접근 제한 ────────────────────────────────────────────────────────────────
-- 교직원은 달력을 읽어야 합니다(자기 반 출석부가 이 달력 위에서 계산됩니다).
-- 고치는 것은 행정실만 - 하루를 잘못 빼면 전교생의 출석일수가 함께 틀어집니다.
alter table public.school_days enable row level security;
alter table public.attendance_coverage enable row level security;

do $$
declare t text;
begin
  foreach t in array array['school_days', 'attendance_coverage'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_giamicro_user())', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_wr_manager()) with check (public.is_wr_manager())',
      t || '_write', t);
  end loop;
end $$;

drop trigger if exists school_days_set_updated_at on public.school_days;
create trigger school_days_set_updated_at
  before update on public.school_days
  for each row execute function public.set_updated_at();
