-- ===== 같은 아이가 두 줄로 들어간 것을 하나로 합칩니다 =====
--
-- 26-27 명부를 반영하면서 조하윤이 두 줄이 됐습니다. 짝짓기가 **이름 + 생년월일**로 찾는데,
-- 이미 앱에 있던 줄의 생년월일이 명부와 달랐던 것으로 보입니다. 그래서 «명부에는 있는데
-- 앱에 없는 신규생»으로 보고 새로 만들었습니다.
--
-- 중복은 그냥 지우면 안 됩니다. 두 줄 중 어느 쪽에 셔틀 배정·출결·인보이스·의류 사이즈가
-- 붙어 있는지 알 수 없고, 지우는 순간 그 기록이 함께 사라지거나 학생 연결이 끊어집니다.
-- 끊어진 기록은 화면에 «학생 미확인»으로 남는데, 그게 왜 생겼는지는 아무도 모릅니다.
--
-- 그래서 **참조를 먼저 옮기고** 빈 줄을 지웁니다.
--
-- 옮길 표를 손으로 나열하지 않습니다. wr_students(id) 를 가리키는 외래키가 지금 25곳이고,
-- 앞으로도 늡니다. 목록을 적어두면 새 표가 생길 때마다 여기를 고쳐야 하고, 고치는 것을
-- 잊으면 **그 표만 조용히 옛 학생을 가리킨 채 남습니다.** 정보 스키마에서 스스로 찾게 합니다.

create or replace function public.merge_students(keep_id uuid, drop_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
  moved int := 0;
  dropped int := 0;
  n int;
begin
  -- **아무나 부를 수 없습니다.**
  --
  -- 이 함수는 security definer 라 호출자의 권한을 넘어 표를 고칩니다. 그 힘이 있는 함수를
  -- 문 없이 두면, 로그인한 누구든 학생 두 명을 지워 합칠 수 있게 됩니다. 되돌릴 수 없는
  -- 일이라 관리자만 부르게 막습니다. 마이그레이션 안에서 도는 것은 auth.uid() 가 비어
  -- 있으므로(사람 요청이 아님) 그대로 지나갑니다.
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

  -- wr_students(id) 를 가리키는 모든 칸을 찾아 옮깁니다.
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
       and ccu.table_name = 'wr_students'
       and ccu.column_name = 'id'
       and tc.table_schema = 'public'
  loop
    begin
      execute format('update %I.%I set %I = $1 where %I = $2',
                     fk.table_schema, fk.table_name, fk.column_name, fk.column_name)
        using keep_id, drop_id;
      get diagnostics n = row_count;
      moved := moved + n;
    exception when unique_violation then
      -- 옮기면 겹치는 줄(같은 아이의 같은 날 출결, 같은 학기 등록 …). 같은 아이의 같은
      -- 사실이 두 벌 있는 것이므로 하나면 충분합니다. 옮기는 대신 지웁니다.
      execute format('delete from %I.%I where %I = $1', fk.table_schema, fk.table_name, fk.column_name)
        using drop_id;
      get diagnostics n = row_count;
      dropped := dropped + n;
      raise notice '[병합] %.% 는 겹쳐서 %건을 지웠습니다', fk.table_schema, fk.table_name, n;
    end;
  end loop;

  -- 남기는 줄에서 비어 있는 칸을 지울 줄에서 채워옵니다. 어느 쪽에만 적혀 있던 값이
  -- 병합 때문에 사라지면, 사라진 줄 모르고 다시 찾아 헤매게 됩니다.
  update wr_students k set
    name_en       = coalesce(nullif(btrim(coalesce(k.name_en, '')), ''), d.name_en),
    birth_date    = coalesce(k.birth_date, d.birth_date),
    gender        = coalesce(k.gender, d.gender),
    grade         = coalesce(nullif(btrim(coalesce(k.grade, '')), ''), d.grade),
    class_name    = coalesce(nullif(btrim(coalesce(k.class_name, '')), ''), d.class_name),
    class_id      = coalesce(k.class_id, d.class_id),
    department    = coalesce(nullif(btrim(coalesce(k.department, '')), ''), d.department),
    address       = coalesce(nullif(btrim(coalesce(k.address, '')), ''), d.address),
    lat           = coalesce(k.lat, d.lat),
    lng           = coalesce(k.lng, d.lng),
    phone         = coalesce(nullif(btrim(coalesce(k.phone, '')), ''), d.phone),
    mother_phone  = coalesce(nullif(btrim(coalesce(k.mother_phone, '')), ''), d.mother_phone),
    father_phone  = coalesce(nullif(btrim(coalesce(k.father_phone, '')), ''), d.father_phone),
    parent_phone  = coalesce(nullif(btrim(coalesce(k.parent_phone, '')), ''), d.parent_phone),
    parent_email  = coalesce(nullif(btrim(coalesce(k.parent_email, '')), ''), d.parent_email),
    allergies     = coalesce(nullif(btrim(coalesce(k.allergies, '')), ''), d.allergies),
    instrument    = coalesce(nullif(btrim(coalesce(k.instrument, '')), ''), d.instrument),
    photo_path    = coalesce(k.photo_path, d.photo_path),
    -- 메모는 둘 다 살립니다. 한쪽을 버리면 그 안에 알레르기나 사연이 적혀 있었을 때
    -- 되돌릴 방법이 없습니다.
    note          = nullif(btrim(concat_ws(E'\n', nullif(btrim(coalesce(k.note, '')), ''),
                                                 nullif(btrim(coalesce(d.note, '')), ''))), ''),
    custom_fields = coalesce(d.custom_fields, '{}'::jsonb) || coalesce(k.custom_fields, '{}'::jsonb)
    from wr_students d
   where k.id = keep_id and d.id = drop_id;

  delete from wr_students where id = drop_id;

  return format('참조 %s건을 옮기고 %s건을 정리한 뒤 한 줄로 합쳤습니다.', moved, dropped);
end;
$$;

revoke all on function public.merge_students(uuid, uuid) from public, anon;
grant execute on function public.merge_students(uuid, uuid) to authenticated;

comment on function public.merge_students(uuid, uuid) is
  '중복 학생 두 줄을 하나로 합칩니다. wr_students(id) 를 가리키는 모든 외래키를 스스로 찾아 옮기므로, 표가 새로 생겨도 여기를 고칠 필요가 없습니다.';


-- ── 조하윤 정리 ─────────────────────────────────────────────────────────────
--
-- 먼저 만들어진 줄을 남깁니다. 그쪽에 다른 자료가 더 붙어 있을 가능성이 큽니다.
do $fix$
declare
  ids uuid[];
  msg text;
begin
  select array_agg(id order by created_at)
    into ids
    from wr_students
   where is_demo = false and btrim(name) = '조하윤';

  if ids is null or array_length(ids, 1) < 2 then
    raise notice '[조하윤] 중복이 없습니다(현재 %건).', coalesce(array_length(ids, 1), 0);
    return;
  end if;

  -- 셋 이상이어도 앞의 하나로 모읍니다.
  for i in 2 .. array_length(ids, 1) loop
    select public.merge_students(ids[1], ids[i]) into msg;
    raise notice '[조하윤] %', msg;
  end loop;
end
$fix$;


-- ── 다른 중복도 알려줍니다 ──────────────────────────────────────────────────
--
-- 조하윤만 그랬을 리 없습니다. 같은 짝짓기로 들어간 다른 아이가 있는지 여기서 한 번 훑고
-- 알림으로 남깁니다. **자동으로 합치지는 않습니다** - 이름이 같아도 정말 두 사람인 경우가
-- 있고(김재이가 셋입니다), 사람 확인 없이 합치면 되돌릴 수 없습니다.
do $dup$
declare
  r record;
  n int := 0;
begin
  for r in
    select btrim(name) as nm, count(*) as c,
           array_agg(coalesce(birth_date::text, '생일없음') order by created_at) as births
      from wr_students
     where is_demo = false and status = 'active'
     group by btrim(name)
    having count(*) > 1
     order by 1
  loop
    -- 생년월일이 서로 다르면 진짜 동명이인일 수 있습니다. 같거나 한쪽이 비었으면 중복 의심.
    n := n + 1;
    raise notice '[중복 의심] % — %명 (생년월일: %)', r.nm, r.c, array_to_string(r.births, ', ');
  end loop;
  if n = 0 then
    raise notice '[중복 의심] 없음';
  else
    raise notice '[중복 의심] 이름이 겹치는 %건 — 정말 두 사람인지 [학생 → 명부 관리]에서 확인해 주세요', n;
  end if;
end
$dup$;
