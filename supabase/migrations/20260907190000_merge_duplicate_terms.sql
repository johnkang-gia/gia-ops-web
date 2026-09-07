-- ===== 이름이 같은 학기가 두 줄로 있는 것을 하나로 합칩니다 =====
--
-- 「26-27 1학기」가 두 줄입니다. 하나는 진행중, 하나는 종료. 화면에서는 이름이 같아
-- 구별이 안 되는데, 학비외 항목은 종료된 쪽에 들어가 있었습니다. 그래서 항목을 다 넣고도
-- 지금 학기 화면에서는 하나도 안 보입니다 - **아무 오류도 없이** 비어 보입니다.
--
-- 그냥 지우면 안 됩니다. terms(id) 를 가리키는 칸 중 두 곳은 **on delete cascade** 입니다.
--
--   · wr_term_class_snapshots  — 학기별 반 배정(그 학기에 누가 어느 반이었나)
--   · academic_checklist_meetings
--
-- 학기 줄을 지우는 순간 이 표의 줄들이 함께 사라집니다. 반 배정 스냅샷이 사라지면 그 학기
-- 「애들 명단」이 통째로 없어지고, 없어졌다는 사실은 화면에 오류로 뜨지 않습니다. 나머지
-- 칸들은 set null 이라 지워지지는 않지만 학기 연결이 끊겨 「학기 미상」으로 남습니다.
--
-- 그래서 순서가 중요합니다: **참조를 모두 옮기고 → 남은 참조가 없는지 확인하고 → 지웁니다.**
-- 확인 단계에서 하나라도 남아 있으면 지우지 않고 멈춥니다.
--
-- 옮길 표는 손으로 나열하지 않습니다. terms(id) 를 가리키는 칸이 이미 열 곳이 넘고 앞으로도
-- 늡니다. 목록을 적어두면 새 표가 생길 때마다 여기를 고쳐야 하고, 고치는 것을 잊으면 그
-- 표만 조용히 옛 학기를 가리킨 채 남습니다. 정보 스키마에서 스스로 찾게 합니다.

create or replace function public.merge_terms(keep_id uuid, drop_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
  ctids tid[];
  -- 한 글자 이름을 쓰지 않습니다. plpgsql 변수와 SQL 별칭이 같은 글자면
  -- «column reference "c" is ambiguous» 로 함수가 실행 시점에 멈춥니다.
  row_ctid tid;
  moved int := 0;
  dropped int := 0;
  snap_dropped int := 0;
  leftover int;
  total_left int := 0;
  keep_label text;
  drop_label text;
  snap_before int;
  snap_after int;
begin
  -- 아무나 부를 수 없습니다. security definer 라 호출자의 권한을 넘어 표를 고치고,
  -- 되돌릴 수 없는 일입니다. 마이그레이션 안에서는 auth.uid() 가 비어 있어 그대로 지나갑니다.
  if auth.uid() is not null and not public.is_app_admin() then
    raise exception '학기를 합치는 것은 관리자만 할 수 있습니다.';
  end if;

  if keep_id = drop_id then
    return '같은 학기입니다 - 할 일이 없습니다.';
  end if;

  select year || ' ' || term_type into keep_label from public.terms where id = keep_id;
  select year || ' ' || term_type into drop_label from public.terms where id = drop_id;
  if keep_label is null or drop_label is null then
    raise exception '합칠 학기를 찾지 못했습니다(keep=%, drop=%)', keep_id, drop_id;
  end if;

  -- ── 0. 반 배정 스냅샷은 학기당 한 벌뿐입니다 ─────────────────────────
  --
  -- wr_term_class_snapshots 는 unique(term_id) 라, 두 학기 모두 스냅샷을 갖고 있으면
  -- 옮길 자리가 없습니다. 아래 일반 규칙대로면 옮기려던 쪽(지울 학기)이 정리되는데,
  -- **그쪽에 아이가 더 많이 담겨 있을 수 있습니다.** 학비외 항목이 지울 학기 쪽에 들어가
  -- 있었던 것처럼, 사람이 어느 쪽을 썼는지는 이름으로 알 수 없습니다.
  --
  -- 그래서 «담긴 학생 수»로 고릅니다. 많이 담긴 쪽이 실제로 쓰인 쪽입니다.
  -- 지울 학기 쪽이 더 많으면 남기는 쪽 것을 먼저 비워, 아래에서 그 쪽이 옮겨 오게 합니다.
  declare
    keep_n int;
    drop_n int;
  begin
    select coalesce((select sum(jsonb_array_length(coalesce(cls->'students', '[]'::jsonb)))
                       from jsonb_array_elements(s.classes) cls), 0)
      into keep_n from public.wr_term_class_snapshots s where s.term_id = keep_id;
    select coalesce((select sum(jsonb_array_length(coalesce(cls->'students', '[]'::jsonb)))
                       from jsonb_array_elements(s.classes) cls), 0)
      into drop_n from public.wr_term_class_snapshots s where s.term_id = drop_id;

    if keep_n is not null and drop_n is not null and drop_n > keep_n then
      raise notice '[학기병합] 반 배정 보관본: 지울 학기 쪽에 학생이 더 많아(%명 > %명) 그쪽을 살립니다', drop_n, keep_n;
      delete from public.wr_term_class_snapshots where term_id = keep_id;
    elsif keep_n is not null and drop_n is not null then
      raise notice '[학기병합] 반 배정 보관본: 남기는 학기 쪽을 씁니다(%명, 다른 쪽 %명)', keep_n, drop_n;
    end if;
  end;

  -- 이 자리부터 세어야 아래 검사가 맞습니다. 위에서 일부러 비운 한 벌까지 «사라졌다»로
  -- 세면, 옳게 고른 결과가 오류로 잡힙니다.
  select count(*) into snap_before from public.wr_term_class_snapshots where term_id in (keep_id, drop_id);

  -- ── 1. 참조를 옮깁니다 ───────────────────────────────────────────────
  --
  -- 한 표를 한 문장으로 옮기지 않고 **한 줄씩** 옮깁니다. 통째로 옮기다 한 줄이 겹치면
  -- 그 문장 전체가 취소되는데, 그때 표 전체를 지워버리면 옮겨졌어야 할 멀쩡한 줄까지
  -- 함께 사라집니다. 겹치는 줄만 골라 정리하려면 줄 단위로 봐야 합니다.
  -- ctid 는 어느 표에나 있는 물리적 줄 번호라, 기본키 이름을 몰라도 한 줄을 집을 수 있습니다.
  for fk in
    select tc.table_schema, tc.table_name, kcu.column_name, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.table_schema = tc.table_schema
      join information_schema.referential_constraints rc
        on rc.constraint_name = tc.constraint_name
       and rc.constraint_schema = tc.constraint_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and ccu.table_name = 'terms'
       and ccu.column_name = 'id'
       and tc.table_schema = 'public'
  loop
    execute format('select array_agg(ctid) from %I.%I where %I = $1',
                   fk.table_schema, fk.table_name, fk.column_name)
      into ctids using drop_id;

    foreach row_ctid in array coalesce(ctids, '{}'::tid[])
    loop
      begin
        execute format('update %I.%I set %I = $1 where ctid = $2',
                       fk.table_schema, fk.table_name, fk.column_name)
          using keep_id, row_ctid;
        moved := moved + 1;
      exception when unique_violation then
        -- 남기는 학기에 이미 같은 줄이 있습니다(같은 학기·같은 학생의 반 배정 등).
        -- 같은 사실이 두 벌인 것이므로 남기는 쪽을 정본으로 두고 이쪽을 정리합니다.
        execute format('delete from %I.%I where ctid = $1', fk.table_schema, fk.table_name) using row_ctid;
        dropped := dropped + 1;
        if fk.table_name = 'wr_term_class_snapshots' then snap_dropped := snap_dropped + 1; end if;
        raise notice '[학기병합] %.% : 이미 같은 줄이 있어 1건 정리(남기는 학기 값을 씁니다)',
                     fk.table_schema, fk.table_name;
      end;
    end loop;

    if coalesce(array_length(ctids, 1), 0) > 0 then
      raise notice '[학기병합] %.%.% (삭제규칙 %) : %건 처리',
                   fk.table_schema, fk.table_name, fk.column_name, fk.delete_rule,
                   coalesce(array_length(ctids, 1), 0);
    end if;
  end loop;

  -- ── 2. 지우기 전에 확인합니다 ─────────────────────────────────────────
  --
  -- 하나라도 남아 있으면 지우지 않습니다. cascade 로 매달린 표가 있어서, 남은 채로 지우면
  -- 그 줄들이 조용히 함께 사라집니다.
  for fk in
    select tc.table_schema, tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and ccu.table_name = 'terms'
       and ccu.column_name = 'id'
       and tc.table_schema = 'public'
  loop
    execute format('select count(*) from %I.%I where %I = $1',
                   fk.table_schema, fk.table_name, fk.column_name)
      into leftover using drop_id;
    if leftover > 0 then
      raise warning '[학기병합] %.%.% 에 아직 %건이 옛 학기를 가리킵니다',
                    fk.table_schema, fk.table_name, fk.column_name, leftover;
      total_left := total_left + leftover;
    end if;
  end loop;

  if total_left > 0 then
    raise exception '옮기지 못한 줄이 %건 남아 학기를 지우지 않았습니다. 지웠다면 이 줄들이 함께 사라졌을 것입니다.', total_left;
  end if;

  -- ── 3. 남기는 줄의 빈 칸을 채웁니다 ───────────────────────────────────
  --
  -- 한쪽에만 적혀 있던 기간이 병합 때문에 사라지면, 사라진 줄 모르고 다시 입력하게 됩니다.
  update public.terms k set
    start_date    = coalesce(k.start_date, d.start_date),
    end_date      = coalesce(k.end_date, d.end_date),
    shuttle_label = coalesce(k.shuttle_label, d.shuttle_label)
  from public.terms d
  where k.id = keep_id and d.id = drop_id;

  delete from public.terms where id = drop_id;

  -- ── 4. 학생 명단이 줄지 않았는지 세어 봅니다 ──────────────────────────
  select count(*) into snap_after from public.wr_term_class_snapshots where term_id = keep_id;
  if snap_after + snap_dropped < snap_before then
    raise exception '반 배정 스냅샷이 %건에서 %건으로 줄었습니다(겹쳐서 정리 %건). 학생 명단이 사라졌습니다.',
                    snap_before, snap_after, snap_dropped;
  end if;
  raise notice '[학기병합] 반 배정 스냅샷 %건 → %건 (겹쳐서 정리 %건)', snap_before, snap_after, snap_dropped;

  return format('%s 로 합쳤습니다 - %s건 이동, %s건 정리, 반 배정 %s건 유지', keep_label, moved, dropped, snap_after);
end;
$$;

comment on function public.merge_terms(uuid, uuid) is
  '이름이 같은 학기 두 줄을 하나로 합칩니다. terms(id) 참조를 한 줄씩 옮기고, 남은 참조가 없음을 확인한 뒤에만 지웁니다.';

revoke all on function public.merge_terms(uuid, uuid) from public;
grant execute on function public.merge_terms(uuid, uuid) to authenticated;

-- ── 지금 있는 중복을 정리합니다 ────────────────────────────────────────
--
-- 같은 (연도, 학기종류) 가 둘 이상이면 하나로 모읍니다. 남기는 쪽은 **진행중인 줄**입니다 -
-- 화면이 «지금»으로 보여주는 것이 그 줄이고, 사람이 앞으로 넣을 자료도 거기로 들어갑니다.
-- 진행중인 줄이 그 묶음에 없으면 먼저 만들어진 줄로 모읍니다.
do $$
declare
  g record;
  keep uuid;
  d record;
  msg text;
begin
  for g in
    select year, term_type
      from public.terms
     group by year, term_type
    having count(*) > 1
  loop
    select id into keep from public.terms
     where year = g.year and term_type = g.term_type and status = '진행중'
     limit 1;
    if keep is null then
      select id into keep from public.terms
       where year = g.year and term_type = g.term_type
       order by created_at nulls last, start_date nulls last
       limit 1;
    end if;

    for d in
      select id from public.terms
       where year = g.year and term_type = g.term_type and id <> keep
    loop
      msg := public.merge_terms(keep, d.id);
      raise notice '[학기병합] % %: %', g.year, g.term_type, msg;
    end loop;
  end loop;
end $$;

-- ── 다시 생기지 않게 ───────────────────────────────────────────────────
--
-- 정리만 하고 두면 다음에 또 만들어집니다. 같은 연도·같은 학기종류는 한 줄뿐이어야 합니다.
-- 이름이 같은 학기가 둘이면 사람은 절대 구별할 수 없고, 잘못 고른 쪽에 넣은 자료는
-- 아무 오류 없이 사라진 것처럼 보입니다.
create unique index if not exists terms_year_type_uniq on public.terms (year, term_type);
