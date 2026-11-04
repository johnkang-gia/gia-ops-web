-- 캠프 수강료 청구 (겨울캠프·여름캠프)
--
-- 캠프는 정규학기와 따로 돕니다. 같은 기간에 정규학기가 「진행중」으로 살아 있으므로 캠프 학기를 진행중으로
-- 만들 수 없습니다(진행중은 하나뿐). 그래서 학기 상태에 「예정」을 더합니다 - 재무 학기 고르개에는 뜨고,
-- 「지금 학기」를 찾는 화면들(status = '진행중')에는 안 걸립니다.
--
-- 외부 학생은 명부(wr_students)에 「캠프」 상태로 넣습니다. 청구서·입금은 학생 번호에 매달리므로 명부 밖에
-- 두면 청구서를 만들 수 없고, 「재학(active)」으로 넣으면 출결·셔틀·반배정 명단에 섞입니다. 명부를 읽는
-- 함수(loadStudents)는 기본이 active 만이라 캠프 학생은 정규 화면에 저절로 안 나옵니다.

-- ── 학기 상태: 예정 ─────────────────────────────────────────────────────────
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname = 'terms' and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.terms drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.terms add constraint terms_status_check check (status in ('진행중', '종료', '예정'));

-- ── 명부 상태: 캠프(외부 학생) ───────────────────────────────────────────────
-- 명부에는 처음 검사(active·inactive·보류) 뒤에 생긴 상태(졸업·퇴학·전출)가 이미 들어 있어서, 옛 목록에 「캠프」만
-- 더하면 기존 줄이 걸립니다. 쓰이는 상태 전부에 「캠프」를 더하고, 그래도 모르는 값이 남아 있으면 검사를 걸지 않고
-- 알립니다 - 모르는 값 때문에 이 마이그레이션 전체가 멈추면 캠프 청구가 통째로 안 열립니다.
alter table public.wr_students drop constraint if exists wr_students_status_check;
do $$
declare odd text;
begin
  select string_agg(distinct status, ', ') into odd
    from public.wr_students
   where status is not null
     and status not in ('active', 'inactive', '보류', '졸업', '퇴학', '전출', '캠프');
  if odd is null then
    alter table public.wr_students add constraint wr_students_status_check
      check (status in ('active', 'inactive', '보류', '졸업', '퇴학', '전출', '캠프'));
  else
    raise notice '명부에 모르는 상태가 있어 상태 검사를 걸지 않았습니다: %', odd;
  end if;
end $$;

-- ── 캠프 신청 ────────────────────────────────────────────────────────────────
create table if not exists public.camp_applications (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id) on delete cascade,
  -- 같은 응답이 두 번 들어와도 한 줄입니다(시트 행 번호·응답 시각으로 만든 열쇠).
  source_key text not null,
  source text not null default '구글폼' check (source in ('구글폼', '직접')),
  submitted_at timestamptz,
  -- 폼 응답 원문(머리줄 → 값). 읽는 규칙이 틀렸을 때 다시 읽을 재료입니다.
  raw jsonb not null default '{}'::jsonb,
  applicant_name text not null default '',
  applicant_name_en text,
  grade text,
  birth_date text,
  guardian_name text,
  guardian_phone text,
  email text,
  weeks smallint check (weeks in (2, 3)),
  shuttle text check (shuttle in ('왕복', '편도', '미이용')),
  -- 폼에서 읽은 대답. 할인은 이 셋과 «연결한 학생이 재학생인가»로 정합니다(campFee.ts).
  says_current boolean not null default false,
  sibling boolean not null default false,
  -- returning 은 SQL 예약어라 이름을 바꿨습니다.
  is_returning boolean not null default false,
  -- 사람이 할인을 직접 고른 경우만 채웁니다. 비어 있으면 규칙대로입니다.
  discount_override text check (discount_override in ('재학생', '형제', '재수강', '없음')),
  -- 사람이 금액을 직접 정한 경우만 채웁니다.
  amount_override integer check (amount_override is null or amount_override >= 0),
  student_id uuid references public.wr_students(id) on delete set null,
  status text not null default '접수' check (status in ('접수', '확정', '취소')),
  invoice_id uuid references public.invoices(id) on delete set null,
  memo text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, source_key)
);
create index if not exists camp_applications_term_idx on public.camp_applications (term_id, status);
create index if not exists camp_applications_student_idx on public.camp_applications (student_id);

alter table public.camp_applications enable row level security;
drop policy if exists camp_applications_finance on public.camp_applications;
create policy camp_applications_finance on public.camp_applications
  for all to authenticated using (public.is_finance_user()) with check (public.is_finance_user());

-- ── 구글폼 연결(토큰) ────────────────────────────────────────────────────────
create table if not exists public.camp_intake_links (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id) on delete cascade,
  token text not null unique,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  last_result text,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.camp_intake_links enable row level security;
drop policy if exists camp_intake_links_finance on public.camp_intake_links;
create policy camp_intake_links_finance on public.camp_intake_links
  for all to authenticated using (public.is_finance_user()) with check (public.is_finance_user());

-- 캠프 수강료 항목이 묶일 분류.
insert into public.fee_categories (name, sort_order) values ('캠프', 90) on conflict (name) do nothing;

notify pgrst, 'reload schema';
