-- 하원수단(기간) ↔ 지속 특이사항 — 한쪽을 고치면 다른 쪽이 따라 바뀝니다
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────
-- 「앞으로 5주 동안 월요일 픽업」 같은 일정이 두 곳에 따로 들어왔습니다.
--   · 하원수단(student_dismissal_plans) — 하원수단 화면·업무보드에서 넣음
--   · 지속 특이사항(shuttle_persistent_notes) — 하원 체크표 왼쪽 위젯·토들 자동 등록
-- 둘은 서로 몰랐습니다. 하원수단에 기간을 넣어도 지속 특이사항 목록에는 없고, 지속 특이사항에
-- 픽업 기간을 넣어도 하원수단 화면에는 없었습니다. 같은 사실을 두 번 적게 되고, 한쪽만 고치면
-- 두 화면이 다른 말을 합니다.
--
-- ── 어떻게 묶나 ─────────────────────────────────────────────────────────
-- 날짜가 정해진 하원수단은 모두 기간 묶음(range_id)으로 들어갑니다(이번주만·다음주만도 그 주
-- 월~금 기간). 지속 특이사항에 그 묶음 번호(dismissal_range_id)를 달아 **한 묶음 = 한 특이사항**
-- 으로 짝을 짓습니다.
--   · 하원수단 줄이 바뀌면 → 그 묶음의 특이사항을 다시 계산(요일·기간·내용). 줄이 다 지워지면 끔.
--   · 특이사항(픽업, 기간 있음, 학생 연결됨)을 새로 넣으면 → 하원수단 기간을 만들고 묶음 번호를 담.
--   · 짝지어진 특이사항의 기간·요일을 고치거나 끄면 → 하원수단 기간을 다시 만들거나 지움.
-- 코드가 아니라 트리거로 하는 이유: 넣는 자리가 다섯 곳(하원수단 창·한 번에 넣기·빠른 넣기·
-- 체크표 위젯·토들 자동)이고, 한 곳만 빠뜨려도 한쪽만 바뀝니다. 표가 바뀌면 누가 바꿨든 따라갑니다.
--
-- 서로가 서로를 부르면 끝없이 돕니다. 한쪽이 다른 쪽을 고치는 동안에는 `gia.dismissal_sync` 를
-- 켜 두고, 켜져 있으면 반대쪽 트리거는 아무것도 하지 않습니다.
--
-- 날짜가 없는(학기 내내) 지속 특이사항과 「매주」 하원수단은 묶지 않습니다. 끝나는 날이 없는
-- 것을 하원수단으로 옮기면 지울 때를 아무도 모릅니다.

alter table public.shuttle_persistent_notes add column if not exists dismissal_range_id uuid;

comment on column public.shuttle_persistent_notes.dismissal_range_id is
  '짝지어진 하원수단 기간 묶음(student_dismissal_plans.range_id). 한 묶음에 특이사항 하나.';

create unique index if not exists shuttle_persistent_notes_range_uidx
  on public.shuttle_persistent_notes (dismissal_range_id) where dismissal_range_id is not null;

-- ── 하원수단 → 특이사항 ────────────────────────────────────────────────
create or replace function public.sync_note_from_dismissal_range(p_range uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_kind text;
  v_label text;
  v_time text;
  v_start date;
  v_end date;
  v_days int[];
  v_name text;
  v_content text;
  v_prev text := coalesce(current_setting('gia.dismissal_sync', true), 'off');
begin
  if p_range is null then return; end if;

  select p.student_id, p.kind, p.label, p.depart_time
    into v_student, v_kind, v_label, v_time
    from public.student_dismissal_plans p
   where p.range_id = p_range
   order by p.week_start
   limit 1;

  perform set_config('gia.dismissal_sync', 'on', true);

  -- 묶음이 다 지워졌거나 «셔틀»(= 평소대로 탐)이면 특이사항은 끕니다.
  if v_student is null or v_kind = '셔틀' then
    update public.shuttle_persistent_notes set active = false
     where dismissal_range_id = p_range and active;
    perform set_config('gia.dismissal_sync', v_prev, true);
    return;
  end if;

  select min(range_start), max(range_end), array_agg(distinct weekday::int order by weekday::int)
    into v_start, v_end, v_days
    from public.student_dismissal_plans
   where range_id = p_range;

  select name into v_name from public.wr_students where id = v_student;

  v_content := '하원수단 ' || v_kind
    || coalesce(' ' || nullif(v_time, ''), '')
    || coalesce(' ' || nullif(v_label, ''), '')
    || ' (' || to_char(v_start, 'FMMM/FMDD') || '~' || to_char(v_end, 'FMMM/FMDD') || ')';

  insert into public.shuttle_persistent_notes
    (term, student_name, student_id, content, effect_kind, effect_days, effect_from, effect_to, active, created_by, dismissal_range_id)
  values
    ('정규학기', coalesce(v_name, '이름 미확인'), v_student, v_content, 'pickup', v_days, v_start, v_end, true, '하원수단', p_range)
  on conflict (dismissal_range_id) where dismissal_range_id is not null
  do update set student_id = excluded.student_id,
                student_name = excluded.student_name,
                content = excluded.content,
                effect_kind = 'pickup',
                effect_days = excluded.effect_days,
                effect_from = excluded.effect_from,
                effect_to = excluded.effect_to,
                active = true;

  -- 켜기 전 값으로 되돌립니다. 'off' 로 끄면 이 함수를 부른 바깥 동기화의 문지기까지 꺼집니다.
  perform set_config('gia.dismissal_sync', v_prev, true);
end;
$$;

create or replace function public.trg_dismissal_plan_note_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('gia.dismissal_sync', true), 'off') = 'on' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.range_id is not null then
    perform public.sync_note_from_dismissal_range(old.range_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.range_id is not null
     and (tg_op = 'INSERT' or new.range_id is distinct from old.range_id
          or new.kind is distinct from old.kind or new.label is distinct from old.label
          or new.depart_time is distinct from old.depart_time) then
    perform public.sync_note_from_dismissal_range(new.range_id);
  end if;
  return null;
end;
$$;

drop trigger if exists dismissal_plan_note_sync on public.student_dismissal_plans;
create trigger dismissal_plan_note_sync
  after insert or update or delete on public.student_dismissal_plans
  for each row execute function public.trg_dismissal_plan_note_sync();

-- ── 특이사항 → 하원수단 ────────────────────────────────────────────────
-- 특이사항 하나를 하원수단 기간으로 펼칩니다. 하원수단 쪽에 이미 있던 수단(외부버스 등)이
-- 있으면 그대로 두고 기간만 다시 깝니다 - 특이사항에는 «픽업»밖에 없어서, 기간을 고칠 때마다
-- 수단을 보호자픽업으로 덮으면 사람이 적은 수단이 사라집니다.
create or replace function public.dismissal_range_from_note(
  p_note public.shuttle_persistent_notes,
  p_range uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := '보호자픽업';
  v_label text := '픽업';
  v_time text := null;
  v_days int[];
  d int;
  n integer := 0;
  v_others uuid[];
  r uuid;
begin
  select p.kind, p.label, p.depart_time into v_kind, v_label, v_time
    from public.student_dismissal_plans p
   where p.range_id = p_range
   order by p.week_start
   limit 1;
  v_kind := coalesce(v_kind, '보호자픽업');
  if v_label is null and v_kind = '보호자픽업' then v_label := '픽업'; end if;

  delete from public.student_dismissal_plans where range_id = p_range;

  v_days := case when coalesce(array_length(p_note.effect_days, 1), 0) = 0
                 then array[1,2,3,4,5] else p_note.effect_days end;

  -- 이 기간이 덮게 될 **다른 기간 묶음**. 덮인 주가 빠진 채 그 묶음의 특이사항이 옛 요일·기간을
  -- 계속 말하지 않도록, 다 쓴 뒤 다시 계산합니다.
  select array_agg(distinct range_id) into v_others
    from public.student_dismissal_plans
   where student_id = p_note.student_id
     and range_id is not null and range_id <> p_range
     and weekday = any (v_days)
     and week_start between (p_note.effect_from - (extract(isodow from p_note.effect_from)::int - 1))
                        and p_note.effect_to;
  foreach d in array v_days loop
    if d between 1 and 5 then
      n := n + public.set_dismissal_range(
        p_note.student_id, d::smallint, v_kind, v_label, v_time, null,
        p_note.effect_from, p_note.effect_to, p_range, coalesce(p_note.created_by, '지속 특이사항'));
    end if;
  end loop;
  foreach r in array coalesce(v_others, '{}'::uuid[]) loop
    perform public.sync_note_from_dismissal_range(r);
  end loop;
  return n;
end;
$$;

create or replace function public.trg_note_dismissal_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wants boolean;
  v_prev text := coalesce(current_setting('gia.dismissal_sync', true), 'off');
begin
  if coalesce(current_setting('gia.dismissal_sync', true), 'off') = 'on' then
    return new;
  end if;

  -- 하원수단으로 옮길 수 있는 특이사항: 켜져 있고, 픽업이고, 학생이 붙어 있고, 기간이 닫혀 있음.
  wants := new.active and new.effect_kind = 'pickup' and new.student_id is not null
           and new.effect_from is not null and new.effect_to is not null
           and new.effect_to >= new.effect_from and new.effect_to - new.effect_from <= 400;

  if tg_op = 'UPDATE' and old.dismissal_range_id is not null and not wants then
    perform set_config('gia.dismissal_sync', 'on', true);
    delete from public.student_dismissal_plans where range_id = old.dismissal_range_id;
    perform set_config('gia.dismissal_sync', v_prev, true);
    return new;
  end if;

  if not wants then return new; end if;

  if tg_op = 'UPDATE' and new.dismissal_range_id is not null
     and new.effect_from is not distinct from old.effect_from
     and new.effect_to is not distinct from old.effect_to
     and new.effect_days is not distinct from old.effect_days
     and new.student_id is not distinct from old.student_id
     and old.active then
    return new; -- 내용(글)만 고친 것. 하원수단은 그대로.
  end if;

  if new.dismissal_range_id is null then
    new.dismissal_range_id := gen_random_uuid();
  end if;

  perform set_config('gia.dismissal_sync', 'on', true);
  begin
    perform public.dismissal_range_from_note(new, new.dismissal_range_id);
  exception when others then
    -- 하원수단을 못 만들었다고 특이사항까지 막지는 않습니다. 대신 짝을 비워 두어,
    -- 하원수단 화면에 없다는 사실이 «묶음 없음»으로 남게 합니다.
    new.dismissal_range_id := null;
  end;
  perform set_config('gia.dismissal_sync', v_prev, true);
  return new;
end;
$$;

drop trigger if exists note_dismissal_sync on public.shuttle_persistent_notes;
create trigger note_dismissal_sync
  before insert or update on public.shuttle_persistent_notes
  for each row execute function public.trg_note_dismissal_sync();

-- 특이사항을 아예 지우면 짝지어진 하원수단 기간도 지웁니다.
create or replace function public.trg_note_dismissal_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('gia.dismissal_sync', true), 'off') = 'on' then
    return old;
  end if;
  if old.dismissal_range_id is not null then
    perform set_config('gia.dismissal_sync', 'on', true);
    delete from public.student_dismissal_plans where range_id = old.dismissal_range_id;
    perform set_config('gia.dismissal_sync', 'off', true);
  end if;
  return old;
end;
$$;

drop trigger if exists note_dismissal_delete on public.shuttle_persistent_notes;
create trigger note_dismissal_delete
  after delete on public.shuttle_persistent_notes
  for each row execute function public.trg_note_dismissal_delete();

-- ── 이미 들어와 있는 것 맞추기 ──────────────────────────────────────────
-- ① 끝나지 않은 하원수단 기간마다 특이사항을 만듭니다.
do $$
declare r record;
begin
  for r in
    select distinct range_id from public.student_dismissal_plans
     where range_id is not null and range_end >= (now() at time zone 'Asia/Seoul')::date
  loop
    perform public.sync_note_from_dismissal_range(r.range_id);
  end loop;
end $$;

-- ② 기간이 닫힌 픽업 특이사항(아직 짝 없음, 끝나지 않음)을 하원수단으로 펼칩니다. 같은 아이·같은
--    기간의 하원수단 특이사항이 ①에서 막 생겼다면 그건 이미 짝이 있으니 건너뜁니다.
update public.shuttle_persistent_notes n
   set content = n.content
 where n.active and n.effect_kind = 'pickup' and n.student_id is not null
   and n.dismissal_range_id is null
   and n.effect_from is not null and n.effect_to is not null
   and n.effect_to >= (now() at time zone 'Asia/Seoul')::date
   and not exists (
     select 1 from public.shuttle_persistent_notes m
      where m.dismissal_range_id is not null and m.active
        and m.student_id = n.student_id
        and m.effect_from = n.effect_from and m.effect_to = n.effect_to
   );

notify pgrst, 'reload schema';
