-- 하원수단 기간 지정 — 「10/15부터 11/20까지 목요일은 할머니」
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────
-- 하원수단의 기간은 「이번주 · 다음주 · 매주」 셋뿐이었습니다. 「다음 달 말까지 화·목 학원차」처럼
-- 몇 주에 걸친 일정은 매주로 넣고 끝나는 날 사람이 지워야 했고, 지우는 것을 잊으면 그 요일마다
-- 학원차를 기다리게 됩니다. 반대로 한 주씩 나눠 넣으면 같은 일을 몇 번이나 반복해야 합니다.
--
-- ── 어떻게 담나 ─────────────────────────────────────────────────────────
-- 기간을 **주 단위 줄로 펼쳐** 넣습니다. 기간 안에서 그 요일에 해당하는 날마다 그 주의 줄
-- (week_start = 그 주 월요일)을 하나씩 만듭니다. 하원수단을 읽는 화면이 아홉 곳인데 모두
-- 「그 주 줄 > 매주 줄」 규칙(dismissalWeek.ts)으로 읽고 있어서, 이렇게 담으면 읽는 쪽은
-- 한 줄도 고치지 않고 기간이 그대로 맞게 나옵니다. 새 뜻을 하나 더 만들면 아홉 곳 중 한 곳은
-- 반드시 빠뜨리고, 그 화면만 다른 하원수단을 말합니다.
--
-- 펼친 줄들은 같은 range_id 로 묶어, 화면이 「10/15~11/20」 한 줄로 보여주고 한 번에 지웁니다.
-- 지난 주 줄은 기존 정리(purge_expired_dismissal_plans)가 그대로 치웁니다.

alter table public.student_dismissal_plans add column if not exists range_id uuid;
alter table public.student_dismissal_plans add column if not exists range_start date;
alter table public.student_dismissal_plans add column if not exists range_end date;

comment on column public.student_dismissal_plans.range_id is
  '기간으로 넣은 줄의 묶음 번호. 같은 기간에서 펼쳐진 주별 줄은 같은 값입니다(화면 표시·한꺼번에 지우기).';
comment on column public.student_dismissal_plans.range_start is '기간의 첫날(사람이 고른 값).';
comment on column public.student_dismissal_plans.range_end is '기간의 마지막 날(사람이 고른 값).';

create index if not exists student_dismissal_plans_range_idx
  on public.student_dismissal_plans (range_id) where range_id is not null;

-- 기간 한 건을 주별 줄로 펼쳐 넣습니다. 한 주씩 따로 부르면 중간에 실패했을 때 절반만 들어간
-- 기간이 남는데, 그건 화면에 오류가 아니라 «몇 주는 할머니, 몇 주는 셔틀»로 보입니다. 함수
-- 하나 안에서 하면 한 트랜잭션입니다.
create or replace function public.set_dismissal_range(
  p_student uuid,
  p_weekday smallint,
  p_kind text,
  p_label text,
  p_time text,
  p_note text,
  p_start date,
  p_end date,
  p_range_id uuid,
  p_by text default null
) returns integer
language plpgsql
as $$
declare
  d date;
  ws date;
  n integer := 0;
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception '기간이 올바르지 않습니다 (% ~ %)', p_start, p_end;
  end if;
  if p_end - p_start > 400 then
    raise exception '기간이 너무 깁니다. 1년이 넘는 일정은 「매주」로 넣어주세요';
  end if;
  for d in select generate_series(p_start, p_end, interval '1 day')::date loop
    if extract(isodow from d)::int = p_weekday then
      ws := d - (p_weekday - 1);
      insert into public.student_dismissal_plans
        (student_id, weekday, kind, label, depart_time, note, week_start, range_id, range_start, range_end, updated_by)
      values (p_student, p_weekday, p_kind, p_label, p_time, p_note, ws, p_range_id, p_start, p_end, p_by)
      on conflict (student_id, weekday, week_start) where week_start is not null
      do update set kind = excluded.kind, label = excluded.label,
                    depart_time = excluded.depart_time, note = excluded.note,
                    range_id = excluded.range_id, range_start = excluded.range_start,
                    range_end = excluded.range_end, updated_by = excluded.updated_by;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

comment on function public.set_dismissal_range is
  '하원수단 기간 한 건을 주별 줄로 펼쳐 저장(한 트랜잭션). 그 주에 이미 있던 그 주짜리 줄은 덮습니다 - 나중에 넣은 것이 사람의 최신 뜻입니다.';

create or replace function public.clear_dismissal_range(
  p_range_id uuid,
  p_weekday smallint default null
) returns integer
language plpgsql
as $$
declare
  n integer;
begin
  delete from public.student_dismissal_plans
   where range_id = p_range_id
     and (p_weekday is null or weekday = p_weekday);
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.clear_dismissal_range is
  '기간으로 넣은 하원수단 지우기(요일을 주면 그 요일만). 펼쳐진 주별 줄을 하나씩 지우게 두면 몇 주가 남습니다.';

-- 한 주짜리로 다시 넣으면 그 줄은 더 이상 기간의 일부가 아닙니다. 묶음 표시를 남겨 두면 나중에
-- 「기간 지우기」가 사람이 따로 넣은 그 주 줄까지 지웁니다.
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
                  updated_by = excluded.updated_by,
                  range_id = null, range_start = null, range_end = null
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

notify pgrst, 'reload schema';
