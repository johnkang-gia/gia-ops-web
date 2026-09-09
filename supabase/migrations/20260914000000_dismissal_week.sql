-- 하원수단에 **어느 주인가**를 붙입니다
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 하원수단은 「학생 × 요일」 한 줄뿐이었고, 그 한 줄은 **영원히 매주**를 뜻했습니다.
-- 그런데 실제로 오는 연락은 대개 그 주 한 번짜리입니다 - "이번 주 목요일만 할머니가
-- 데리러 갑니다", "다음 주부터 화·목 학원차 탑니다".
--
-- 적을 자리가 없으니 둘 중 하나가 됐습니다.
--
--   · 매주로 적어두고 다음 주에 지우기를 잊음 → 매주 목요일마다 할머니를 기다립니다
--   · 아예 안 적고 사람이 기억함           → 그날 아무도 모릅니다
--
-- 둘 다 오류로 안 보입니다. 화면에는 그럴듯한 값이 적혀 있습니다.
--
-- ── 이 마이그레이션이 하는 일 ────────────────────────────────────────
--
-- 줄마다 `week_start`(그 주의 월요일)를 붙이고, **비어 있으면 매주**로 읽습니다.
-- 비어 있는 것을 매주로 정한 이유는 이미 쌓인 줄이 전부 매주이기 때문입니다 - 옛 자료가
-- 갑자기 뜻을 바꾸면, 바뀐 줄이 어느 것인지 아무도 모릅니다.

alter table public.student_dismissal_plans
  add column if not exists week_start date;

comment on column public.student_dismissal_plans.week_start is
  '이 줄이 적용되는 주의 월요일. 비어 있으면 매주 - 이 표에 이미 쌓인 줄이 전부 매주라 그 뜻을 그대로 둡니다.';

-- ── 한 아이의 한 요일에 하나씩, 「매주」와 「그 주」 각각 ────────────────
--
-- 예전 규칙은 `unique (student_id, weekday)` 였습니다. 그대로 두면 매주 셔틀인 아이에게
-- 이번 주 목요일만 다른 수단을 적을 수 없습니다 - 덮어써야 하는데, 덮어쓰면 다음 주에
-- 셔틀이 사라집니다.
--
-- 두 줄이 공존하되 **각 갈래 안에서는 하나뿐**이어야 합니다. 널을 섞은 유니크 제약은
-- 널끼리 서로 다른 값으로 취급되어(매주 줄이 몇 개든 들어갑니다) 쓸 수 없으므로,
-- 조건부 인덱스 둘로 나눕니다.
alter table public.student_dismissal_plans
  drop constraint if exists student_dismissal_plans_student_id_weekday_key;

create unique index if not exists student_dismissal_plans_weekly_uq
  on public.student_dismissal_plans (student_id, weekday)
  where week_start is null;

create unique index if not exists student_dismissal_plans_oneweek_uq
  on public.student_dismissal_plans (student_id, weekday, week_start)
  where week_start is not null;

-- 「이 주에 걸리는 줄」이 매 화면의 첫 질의입니다.
create index if not exists student_dismissal_plans_week_idx
  on public.student_dismissal_plans (week_start, weekday);

-- ── 저장은 함수 하나로 ──────────────────────────────────────────────
--
-- 화면에서 upsert 를 쓸 수 없게 됐습니다. PostgREST 의 on_conflict 는 칸 이름만 받는데,
-- 위 인덱스는 조건부라 칸 이름만으로는 어느 쪽인지 정해지지 않습니다.
--
-- 「지우고 다시 넣기」로 대신할 수도 있지만, 지우기가 되고 넣기가 실패하면 **적혀 있던
-- 하원수단이 사라집니다.** 그 아이는 그날 아무 데도 안 뜨는데, 화면에는 오류가 아니라
-- 그냥 빈 줄로 보입니다.
--
-- 그래서 판단을 여기 한 곳에 둡니다. 화면은 부르기만 합니다.
create or replace function public.set_dismissal_plan(
  p_student uuid,
  p_weekday smallint,
  p_kind text,
  p_label text default null,
  p_time text default null,
  p_note text default null,
  p_week_start date default null,
  p_by text default null
) returns uuid
language plpgsql
-- security invoker(기본). 표의 자물쇠를 그대로 지납니다 - 함수가 자물쇠를 우회하면
-- 자물쇠를 채운 뜻이 없어집니다.
as $$
declare
  v_id uuid;
begin
  if p_week_start is null then
    insert into public.student_dismissal_plans
      (student_id, weekday, kind, label, depart_time, note, week_start, updated_by)
    values (p_student, p_weekday, p_kind, p_label, p_time, p_note, null, p_by)
    on conflict (student_id, weekday) where week_start is null
    do update set kind = excluded.kind, label = excluded.label,
                  depart_time = excluded.depart_time, note = excluded.note,
                  updated_by = excluded.updated_by
    returning id into v_id;
  else
    insert into public.student_dismissal_plans
      (student_id, weekday, kind, label, depart_time, note, week_start, updated_by)
    values (p_student, p_weekday, p_kind, p_label, p_time, p_note, p_week_start, p_by)
    on conflict (student_id, weekday, week_start) where week_start is not null
    do update set kind = excluded.kind, label = excluded.label,
                  depart_time = excluded.depart_time, note = excluded.note,
                  updated_by = excluded.updated_by
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

comment on function public.set_dismissal_plan is
  '하원수단 한 줄 저장. week_start 가 비면 매주, 있으면 그 주만. 지우고 다시 넣지 않는 이유는 지우기만 성공하면 하원수단이 조용히 사라지기 때문입니다.';

create or replace function public.clear_dismissal_plan(
  p_student uuid,
  p_weekday smallint,
  p_week_start date default null
) returns integer
language plpgsql
as $$
declare
  n integer;
begin
  delete from public.student_dismissal_plans
   where student_id = p_student
     and weekday = p_weekday
     and week_start is not distinct from p_week_start;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.clear_dismissal_plan is
  '하원수단 한 줄 지우기. is not distinct from 을 쓰는 이유: week_start = null 은 널과 견주면 참이 아니라 널이라 아무것도 안 지워집니다.';

-- ── 지나간 한 주짜리 치우기 ─────────────────────────────────────────
--
-- 사람이 지우게 두지 않습니다. 사람이 지워야 하는 목록은 언젠가 안 지워지고, 안 지워진
-- 목록은 결국 아무도 안 봅니다.
--
-- 두 주를 남기는 이유: 지난 주에 무엇이었는지 물어보는 일이 실제로 있습니다("지난주
-- 목요일에 누가 데려갔죠?"). 그날 바로 지우면 그 물음에 답할 수 없습니다.
create or replace function public.purge_expired_dismissal_plans()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.student_dismissal_plans
   where week_start is not null
     and week_start < (current_date at time zone 'Asia/Seoul')::date - 14;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.purge_expired_dismissal_plans is
  '지난 한 주짜리 하원수단 치우기(2주 지난 것). 크론이 매일 부릅니다 - 사람이 지워야 하는 목록은 언젠가 안 지워집니다.';
