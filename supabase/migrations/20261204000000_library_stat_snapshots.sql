-- ===== 도서관 기준선 스냅샷 =====
--
-- ── 왜 필요한가 ───────────────────────────────────────────────────────────
-- 인증(Ai/MSA-CESS) 재평가는 "지금 어떤가"만 묻지 않습니다. **개선 계획**을 함께 내야 하고,
-- 개선 계획은 "무엇을 얼마에서 얼마로"가 적혀 있어야 성립합니다. 그런데 출발점 숫자를 날짜와
-- 함께 어딘가에 고정해 두지 않으면, 1년 뒤에 비교할 대상이 없습니다. 화면은 늘 '오늘'만
-- 보여주니까요.
--
-- 그래서 오늘 숫자를 **날짜를 박아** 한 줄로 남깁니다. 다음에 또 남기면 두 줄이 되고, 그
-- 둘의 차이가 곧 "이만큼 나아졌다"는 증거입니다. 심사단이 보고 싶어 하는 것이 그 두 줄입니다.
--
-- ── 세는 일을 SQL 안에서 하는 이유 ────────────────────────────────────────
-- 숫자를 앱에서 세어 보내면, 앱이 바뀔 때마다 세는 규칙이 조용히 달라집니다. 작년 줄과 올해
-- 줄이 서로 다른 규칙으로 세어진 것이면 둘을 나란히 놓을 수 없습니다 - 그 표는 증거가 아니라
-- 혼란입니다. 그래서 세는 규칙을 이 함수 하나에 두고, 그 함수만 부릅니다.
--
-- ── 같은 날 두 번 부르면 ──────────────────────────────────────────────────
-- 덮어씁니다(taken_on 이 유일키). 하루에 여러 줄이 쌓이면 "그래서 10월 15일 숫자가 뭐냐"에
-- 답이 둘이 됩니다. 하루 한 줄이면 늘 답이 하나입니다.

create table if not exists public.lib_stat_snapshots (
  id uuid primary key default gen_random_uuid(),
  /** 어느 날 기준인가. 하루 한 줄입니다. */
  taken_on date not null unique,
  taken_by text,
  /** 적어 두는 사람의 메모(«전수 장서 점검 직후» 같은 것). */
  note text,

  -- 장서
  titles int not null default 0,
  copies int not null default 0,
  with_isbn int not null default 0,
  with_level int not null default 0,
  with_shelf int not null default 0,
  with_series int not null default 0,
  /** 등급별 종수·권수. [{"level":2,"titles":269,"copies":317}, …] */
  by_level jsonb not null default '[]'::jsonb,

  -- 책장 점검
  bins int not null default 0,
  bins_done int not null default 0,
  check_rows int not null default 0,
  check_copies int not null default 0,
  last_check_at timestamptz,
  holdings_fixes int not null default 0,

  -- 이용
  cards int not null default 0,
  loans_total int not null default 0,
  loans_12m int not null default 0,
  borrowers_12m int not null default 0,
  /** 한 번도 나간 적 없는 종수. 장서 정리(weeding)의 유일한 객관적 근거입니다. */
  never_borrowed int not null default 0,
  loans_out_now int not null default 0,

  created_at timestamptz not null default now()
);

comment on table public.lib_stat_snapshots is
  '도서관 현황을 날짜와 함께 고정해 둔 줄. 인증 개선 계획의 출발점·비교점으로 씁니다. 세는 규칙은 lib_take_stat_snapshot() 하나에 있습니다.';

alter table public.lib_stat_snapshots enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'lib_stat_snapshots' and policyname = 'lib_stat_snapshots_rw') then
    create policy lib_stat_snapshots_rw on public.lib_stat_snapshots
      for all using (public.is_lib_user()) with check (public.is_lib_user());
  end if;
end $$;

-- ── 오늘 숫자를 세어 한 줄로 남깁니다 ─────────────────────────────────────
create or replace function public.lib_take_stat_snapshot(p_note text default null)
returns public.lib_stat_snapshots
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.lib_stat_snapshots;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  /*
    '최근 1년'은 한국 날짜로 끊습니다. 빌린 시각은 UTC 로 저장되므로 그대로 자르면 밤 9시
    이후 대출이 옆날로 넘어갑니다(UTC+9). 통계 쪽(stats.ts)도 같은 규칙입니다.
  */
  v_since date := v_today - 365;
begin
  if not public.is_lib_user() then
    raise exception '도서관 계정만 기록할 수 있습니다.';
  end if;

  insert into public.lib_stat_snapshots as s (
    taken_on, taken_by, note,
    titles, copies, with_isbn, with_level, with_shelf, with_series, by_level,
    bins, bins_done, check_rows, check_copies, last_check_at, holdings_fixes,
    cards, loans_total, loans_12m, borrowers_12m, never_borrowed, loans_out_now
  )
  select
    v_today,
    coalesce(auth.jwt() ->> 'email', 'unknown'),
    p_note,
    (select count(*) from lib_books),
    (select coalesce(sum(total_copies), 0) from lib_books),
    (select count(*) from lib_books where isbn is not null),
    (select count(*) from lib_books where label_level is not null),
    (select count(*) from lib_books where location_id is not null),
    (select count(*) from lib_books where coalesce(btrim(series), '') <> ''),
    (select coalesce(jsonb_agg(jsonb_build_object('level', level, 'titles', t, 'copies', c)
              order by level asc nulls last), '[]'::jsonb)
       from (select label_level as level, count(*) t, coalesce(sum(total_copies), 0) c
               from lib_books group by label_level) g),
    (select count(*) from lib_locations),
    (select count(*) from lib_locations where checked_done_at is not null),
    (select count(*) from lib_shelf_check),
    (select coalesce(sum(copies), 0) from lib_shelf_check),
    (select max(checked_at) from lib_shelf_check),
    (select count(*) from lib_holdings_fix),
    (select count(*) from lib_card_issues),
    (select count(*) from lib_loans),
    (select count(*) from lib_loans
      where ((borrowed_at at time zone 'Asia/Seoul')::date) >= v_since),
    (select count(distinct student_no) from lib_loans
      where ((borrowed_at at time zone 'Asia/Seoul')::date) >= v_since),
    -- 한 번도 나간 적 없는 종. 대출 기록이 아예 없는 책입니다.
    (select count(*) from lib_books b
      where not exists (select 1 from lib_loans l where l.book_id = b.id)),
    (select count(*) from lib_loans where status = '대출중' and returned_at is null)
  on conflict (taken_on) do update set
    taken_by = excluded.taken_by,
    note = coalesce(excluded.note, s.note),
    titles = excluded.titles, copies = excluded.copies,
    with_isbn = excluded.with_isbn, with_level = excluded.with_level,
    with_shelf = excluded.with_shelf, with_series = excluded.with_series,
    by_level = excluded.by_level,
    bins = excluded.bins, bins_done = excluded.bins_done,
    check_rows = excluded.check_rows, check_copies = excluded.check_copies,
    last_check_at = excluded.last_check_at, holdings_fixes = excluded.holdings_fixes,
    cards = excluded.cards, loans_total = excluded.loans_total,
    loans_12m = excluded.loans_12m, borrowers_12m = excluded.borrowers_12m,
    never_borrowed = excluded.never_borrowed, loans_out_now = excluded.loans_out_now
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.lib_take_stat_snapshot(text) is
  '오늘(한국 날짜) 도서관 현황을 세어 lib_stat_snapshots 에 한 줄로 남깁니다. 같은 날 다시 부르면 덮어씁니다.';

grant execute on function public.lib_take_stat_snapshot(text) to authenticated;

notify pgrst, 'reload schema';
