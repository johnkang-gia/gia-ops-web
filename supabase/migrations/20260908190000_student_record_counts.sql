-- ===== 이 학생 줄에 무엇이 붙어 있는가 =====
--
-- 이름이 같은 두 줄을 놓고 사람이 정해야 하는 것은 하나입니다.
-- **다른 아이인가, 같은 아이인데 줄이 두 번 만들어진 것인가.**
--
-- 그 판단에 가장 큰 단서는 이름도 생일도 아니라 **붙어 있는 기록**입니다.
--
--   · 한쪽에만 기록이 있고 다른 쪽이 텅 비었다 → 같은 아이인데 새 줄이 또 생긴 것.
--     비어 있는 쪽을 지우면 됩니다.
--   · 양쪽에 기록이 나뉘어 있다 → 같은 아이인데 그동안 두 줄로 나뉘어 쌓인 것.
--     합쳐야 하고, 합치기 전에 어느 쪽으로 모을지 정해야 합니다.
--   · 양쪽 다 기록이 충실하고 반이 다르다 → 동명이인일 가능성이 큽니다. 합치면 두 아이의
--     출결과 관찰기록이 섞이고, 그건 되돌리기가 매우 어렵습니다.
--
-- 지금은 이 셋을 화면에서 구별할 방법이 없어서, 결국 합치기를 미루거나 잘못 합칩니다.
--
-- ── 표 목록을 손으로 적지 않습니다 ─────────────────────────────────────
--
-- wr_students(id) 를 가리키는 외래키가 지금 25곳이고 앞으로도 늡니다. 목록을 적어두면 새
-- 표가 생길 때마다 여기를 고쳐야 하고, 잊으면 그 표의 기록만 조용히 안 세어집니다. 그러면
-- 「기록 없음」이라고 잘못 말하게 되는데, 그 말을 믿고 지우면 기록이 사라집니다.
--
-- merge_students 가 이미 같은 방식으로 옮길 표를 스스로 찾습니다. 세는 쪽도 같은 방식이어야
-- **세는 범위와 옮기는 범위가 같아집니다.**

create or replace function public.student_record_counts(ids uuid[])
returns table (student_id uuid, table_name text, n bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
begin
  if ids is null or array_length(ids, 1) is null then
    return;
  end if;

  -- 재무 자료까지 세므로 아무나 부르면 안 됩니다. 다른 표들이 이미 쓰고 있는 판정을
  -- 그대로 씁니다 - 여기서만 다른 기준을 쓰면 한쪽만 고치고 다른 쪽을 잊습니다.
  -- (건수만 돌려줍니다. 내용은 나가지 않습니다.)
  if auth.uid() is not null and not public.is_giamicro_user() then
    raise exception '권한이 없습니다.';
  end if;

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
       -- 자기 자신을 가리키는 칸(형제자매 연결 등)은 「붙어 있는 기록」이 아닙니다.
       and tc.table_name <> 'wr_students'
  loop
    return query execute format(
      'select %I as student_id, %L::text as table_name, count(*)::bigint as n
         from %I.%I
        where %I = any($1)
        group by %I',
      fk.col, fk.tbl, fk.sch, fk.tbl, fk.col, fk.col
    ) using ids;
  end loop;
end;
$$;

comment on function public.student_record_counts(uuid[]) is
  '학생 줄마다 붙어 있는 기록 수를 표별로 셉니다. 표 목록은 외래키에서 스스로 찾습니다 - 적어두면 새 표를 빠뜨리고, 빠뜨리면 「기록 없음」이라고 잘못 말하게 됩니다.';

revoke all on function public.student_record_counts(uuid[]) from public;
grant execute on function public.student_record_counts(uuid[]) to authenticated;
