-- ===== 학생 합치기: 지우지 말고 «채워 넣기» =====
--
-- 지금까지의 합치기는 두 가지를 잃었습니다.
--
-- ① **겹치는 줄을 통째로 지웠습니다.** 한 표를 한 문장으로 옮기다 한 줄이라도 겹치면 그
--    문장 전체가 취소되고, 그때 그 표에서 지울 학생의 줄을 **전부** 지웠습니다. 겹치지
--    않았을 멀쩡한 줄까지 함께 사라집니다.
--
-- ② **겹치는 줄끼리 견주지 않았습니다.** 같은 날 출결이 양쪽에 있는데 한쪽에만 사유가
--    적혀 있으면, 사유가 적힌 쪽을 지우고 빈 쪽을 남길 수도 있었습니다. 사라진 줄은
--    아무 데도 안 뜹니다.
--
-- 이제는 이렇게 합니다.
--
--   · 한 줄씩 옮깁니다(ctid). 겹치는 줄만 따로 다룹니다.
--   · 겹치면 **남는 줄의 빈 칸을 지울 줄의 값으로 채우고** 나서 지웁니다.
--     양쪽에 값이 있으면 남는 쪽을 그대로 둡니다 - 둘 다 사람이 넣은 값이라 자동으로
--     고르면 안 됩니다.
--   · 학생 줄 자체도 같은 규칙으로 칸을 채웁니다. 칸 목록을 손으로 적지 않고
--     정보 스키마에서 읽습니다 - 적어두면 칸이 늘 때마다 여기를 고쳐야 하고, 잊으면
--     그 칸만 조용히 비워집니다.

create or replace function public.merge_students(keep_id uuid, drop_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
  col record;
  ctids tid[];
  row_ctid tid;
  other_ctid tid;
  ukey text[];
  cond text;
  setlist text;
  moved int := 0;
  merged int := 0;
  filled int := 0;
  n int;
begin
  -- 되돌릴 수 없는 일이라 관리자만 부릅니다. 마이그레이션 안에서는 auth.uid() 가 비어
  -- 있어(사람 요청이 아님) 그대로 지나갑니다.
  if auth.uid() is not null and not public.is_app_admin() then
    raise exception '학생을 합치는 것은 관리자만 할 수 있습니다.';
  end if;

  if keep_id = drop_id then
    return '같은 줄입니다 - 할 일이 없습니다.';
  end if;
  if not exists (select 1 from wr_students where id = keep_id)
     or not exists (select 1 from wr_students where id = drop_id) then
    raise exception '합칠 학생을 찾지 못했습니다(keep=%, drop=%)', keep_id, drop_id;
  end if;

  -- ── 1. 학생 줄의 빈 칸을 채웁니다 ──────────────────────────────────────
  --
  -- 한쪽에만 적혀 있던 생년월일·영문이름·주소·보호자 연락처가 병합 때문에 사라지면,
  -- 사라진 줄 모르고 다시 찾아 헤매게 됩니다.
  for col in
    select column_name, data_type
      from information_schema.columns
     where table_schema = 'public' and table_name = 'wr_students'
       and column_name not in ('id', 'created_at', 'updated_at', 'is_demo')
       and is_generated = 'NEVER'
       and is_updatable = 'YES'
  loop
    -- 글자 칸은 «비어 있음»이 null 일 수도, 빈 문자열일 수도 있습니다. 둘 다 빈 것으로 봅니다.
    if col.data_type in ('text', 'character varying', 'character') then
      cond := format('(k.%I is null or btrim(k.%I) = '''')', col.column_name, col.column_name);
    else
      cond := format('k.%I is null', col.column_name);
    end if;

    execute format(
      'update public.wr_students k set %I = d.%I from public.wr_students d
         where k.id = $1 and d.id = $2 and %s and d.%I is not null',
      col.column_name, col.column_name, cond, col.column_name
    ) using keep_id, drop_id;
    get diagnostics n = row_count;
    filled := filled + n;
  end loop;

  -- ── 2. 학생을 가리키는 줄들을 옮깁니다 ────────────────────────────────
  --
  -- 옮길 표를 손으로 나열하지 않습니다. wr_students(id) 를 가리키는 외래키가 25곳이고
  -- 앞으로도 늡니다. 목록을 적어두면 새 표가 생길 때마다 여기를 고쳐야 하고, 고치는 것을
  -- 잊으면 그 표만 조용히 옛 학생을 가리킨 채 남습니다.
  for fk in
    select tc.table_schema as sch, tc.table_name as tbl, kcu.column_name as col
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and ccu.table_name = 'wr_students'
       and ccu.column_name = 'id'
       and tc.table_schema = 'public'
  loop
    -- 이 표에서 «무엇이 같으면 같은 줄인가». 그 칸에 학생 칸이 들어 있는 유니크 조건을
    -- 찾습니다(예: attendance_records 의 (student_id, date)).
    select array_agg(a.attname order by k.ord)
      into ukey
      from pg_index i
      join lateral unnest(i.indkey::int2[]) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
     where i.indrelid = format('%I.%I', fk.sch, fk.tbl)::regclass
       and i.indisunique
       and i.indpred is null
       and a.attnum > 0
     group by i.indexrelid
    having bool_or(a.attname = fk.col)
     limit 1;

    execute format('select array_agg(ctid) from %I.%I where %I = $1', fk.sch, fk.tbl, fk.col)
      into ctids using drop_id;

    foreach row_ctid in array coalesce(ctids, '{}'::tid[])
    loop
      other_ctid := null;

      -- 남길 쪽에 «같은 줄»이 이미 있는가. 유니크 칸에서 학생 칸만 빼고 견줍니다.
      if ukey is not null then
        select string_agg(format('a.%I is not distinct from b.%I', c, c), ' and ')
          into cond
          from unnest(ukey) as c
         where c <> fk.col;

        if cond is not null then
          execute format(
            'select b.ctid from %I.%I a join %I.%I b on %s where a.ctid = $1 and b.%I = $2 limit 1',
            fk.sch, fk.tbl, fk.sch, fk.tbl, cond, fk.col
          ) into other_ctid using row_ctid, keep_id;
        else
          -- 유니크 칸이 학생 칸 하나뿐인 표(학생당 한 줄, 예: 학생 사진). 견줄 것이 없으니
          -- 남는 쪽 줄이 곧 상대입니다. 있으면 그 줄의 빈 칸을 채우고, 없으면 그냥 옮깁니다.
          execute format('select ctid from %I.%I where %I = $1 limit 1', fk.sch, fk.tbl, fk.col)
            into other_ctid using keep_id;
        end if;
      end if;

      if other_ctid is not null then
        -- 겹칩니다. **남는 줄의 빈 칸만** 지울 줄에서 채우고, 그다음에 지웁니다.
        -- 양쪽에 값이 있으면 남는 쪽을 그대로 둡니다 - 둘 다 사람이 넣은 값이라 기계가
        -- 고르면 안 됩니다.
        select string_agg(
                 case when c.data_type in ('text', 'character varying', 'character')
                      then format('%I = case when (b.%I is null or btrim(b.%I) = '''') then a.%I else b.%I end',
                                  c.column_name, c.column_name, c.column_name, c.column_name, c.column_name)
                      else format('%I = coalesce(b.%I, a.%I)', c.column_name, c.column_name, c.column_name)
                 end, ', ')
          into setlist
          from information_schema.columns c
         where c.table_schema = fk.sch and c.table_name = fk.tbl
           and c.column_name not in ('id', 'created_at', 'updated_at')
           and c.column_name <> fk.col
           and c.is_generated = 'NEVER'
           and c.is_updatable = 'YES'
           and not (c.column_name = any(coalesce(ukey, '{}'::text[])));

        if setlist is not null then
          execute format(
            'update %I.%I b set %s from %I.%I a where b.ctid = $1 and a.ctid = $2',
            fk.sch, fk.tbl, setlist, fk.sch, fk.tbl
          ) using other_ctid, row_ctid;
        end if;

        execute format('delete from %I.%I where ctid = $1', fk.sch, fk.tbl) using row_ctid;
        merged := merged + 1;
      else
        begin
          execute format('update %I.%I set %I = $1 where ctid = $2', fk.sch, fk.tbl, fk.col)
            using keep_id, row_ctid;
          moved := moved + 1;
        exception when unique_violation then
          -- 위에서 못 찾은 겹침(유니크 조건을 못 읽은 표). 한 줄만 정리합니다 -
          -- 표 전체를 비우지 않습니다.
          execute format('delete from %I.%I where ctid = $1', fk.sch, fk.tbl) using row_ctid;
          merged := merged + 1;
          raise notice '[병합] %.% : 겹쳐서 1건 정리(유니크 조건을 읽지 못했습니다)', fk.sch, fk.tbl;
        end;
      end if;
    end loop;

    if coalesce(array_length(ctids, 1), 0) > 0 then
      raise notice '[병합] %.%.% : %건 처리', fk.sch, fk.tbl, fk.col, coalesce(array_length(ctids, 1), 0);
    end if;
  end loop;

  -- ── 3. 남은 참조가 없는지 확인한 뒤에 지웁니다 ────────────────────────
  --
  -- 하나라도 남은 채로 지우면, cascade 로 매달린 표의 줄이 조용히 함께 사라집니다.
  for fk in
    select tc.table_schema as sch, tc.table_name as tbl, kcu.column_name as col
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and ccu.table_name = 'wr_students'
       and ccu.column_name = 'id'
       and tc.table_schema = 'public'
  loop
    execute format('select count(*) from %I.%I where %I = $1', fk.sch, fk.tbl, fk.col)
      into n using drop_id;
    if n > 0 then
      raise exception '옮기지 못한 줄이 %.% 에 %건 남아 학생을 지우지 않았습니다.', fk.sch, fk.tbl, n;
    end if;
  end loop;

  delete from wr_students where id = drop_id;

  return format('합쳤습니다 - 빈 칸 %s개 채움, %s건 이동, %s건 통합', filled, moved, merged);
end;
$$;

comment on function public.merge_students(uuid, uuid) is
  '학생 두 줄을 하나로 합칩니다. 겹치는 줄은 남는 줄의 빈 칸을 채운 뒤 정리하고, 겹치지 않는 줄은 그대로 옮깁니다.';

revoke all on function public.merge_students(uuid, uuid) from public;
grant execute on function public.merge_students(uuid, uuid) to authenticated;
