-- rls-ok: 색인만 만듭니다. `shuttle_boardings` 의 자물쇠는 그대로입니다.

-- **한 아이의 오늘 탑승 줄은 하나뿐이어야 합니다.**
--
-- ── 무엇이 문제인가 ───────────────────────────────────────────────────────
--
-- 코드는 `upsert(..., onConflict: "service_date,assignment_id")` 로 넣습니다. 이 구문은
-- **그 두 칸에 유일 색인이 있어야** 돌아갑니다. 처음 만든 표(`schema.sql`)에는
-- `unique (service_date, assignment_id)` 가 적혀 있지만, 그 표가 만들어진 뒤에 붙은
-- 제약이라면 `create table if not exists` 는 아무 일도 하지 않고 지나갑니다.
--
-- 색인이 없으면 하원 시간에 두 사람이 거의 동시에 같은 아이를 누를 때 **두 줄이 생깁니다.**
-- 화면에는 오류가 아니라 한 아이가 두 번 뜨거나, 나중 줄이 앞 줄을 가려 «결석인데 탑승»
-- 같은 어긋남으로 보입니다. 하원 명단은 종이로 뽑아 쓰기 때문에 그 종이가 틀리면 아이가
-- 엉뚱한 차를 탑니다.
--
-- ── 순서가 중요합니다 ─────────────────────────────────────────────────────
--
-- 이미 겹친 줄이 있으면 색인 만들기가 실패합니다. 그래서 **먼저 정리하고** 만듭니다.
-- 남길 줄은 «사람이 마지막으로 손댄 것» → 없으면 «가장 최근에 만든 것» 입니다 - 사람이
-- 누른 판단이 자동보다 셉니다(코드의 `isHumanSet` 과 같은 기준).

do $$
declare
  dropped int := 0;
begin
  -- ① 겹친 줄 정리. 한 짝에 여러 줄이면 하나만 남깁니다.
  with ranked as (
    select
      id,
      row_number() over (
        partition by service_date, assignment_id
        order by
          -- 사람이 체크한 줄을 먼저 살립니다(checked_by 가 있고 자동 표시가 아닌 것).
          (checked_by is not null and checked_by not like 'AI(%') desc,
          checked_at desc nulls last,
          created_at desc
      ) as rn
    from public.shuttle_boardings
  )
  delete from public.shuttle_boardings b
  using ranked r
  where b.id = r.id and r.rn > 1;
  get diagnostics dropped = row_count;
  if dropped > 0 then
    raise notice '겹친 탑승 줄 %개를 정리했습니다(한 짝에 하나만 남김).', dropped;
  end if;

  -- ② 유일 색인. 이미 어떤 이름으로든 같은 짝의 유일 색인이 있으면 만들지 않습니다 -
  --    같은 색인을 두 벌 두면 넣을 때마다 두 번 갱신하게 됩니다.
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'shuttle_boardings'
      and i.indisunique
      and i.indnatts = 2
      and (
        -- `attname` 은 `name` 형이라 `text[]` 와 바로 견줄 수 없습니다
        -- (operator does not exist: name[] = text[]). ::text 로 맞춥니다.
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(i.indkey) as k(attnum)
        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      ) = array['assignment_id', 'service_date']
  ) then
    create unique index shuttle_boardings_date_assignment_uniq
      on public.shuttle_boardings (service_date, assignment_id);
    raise notice '탑승 줄 유일 색인을 만들었습니다.';
  end if;
end $$;

-- 겹친 줄이 남아 있는지는 언제든 이 뷰로 확인합니다. 비어 있어야 정상입니다.
create or replace view public.shuttle_boarding_duplicates as
  select service_date, assignment_id, count(*) as rows
  from public.shuttle_boardings
  group by service_date, assignment_id
  having count(*) > 1;

comment on view public.shuttle_boarding_duplicates is
  '같은 날 같은 배정에 탑승 줄이 둘 이상인 곳. 비어 있어야 정상입니다.';
