-- 영어이름을 한글로 적은 표기 별칭
--
-- 담당자 확인: "마야, 에이바, 제이콥은 각각 초등부 maya의 한글, 8th grade의 elliana ma
-- (일라이아나), jacob dylan ma의 한글 표기야."
--
-- 이 세 명은 셔틀 매칭에서 **퇴소로 잘못 넘어갈 뻔했습니다.** 명부에는 영문으로 있는데
-- 셔틀 명단에는 한글로 적혀 있어서, 기계 눈에는 명부에 없는 아이였습니다.
--
-- 규칙으로는 풀 수 없습니다 - Maya를 '마야'로 옮길지 '마이아'로 옮길지는 사람이 정하는
-- 것이지 규칙이 아닙니다. 그래서 한 번 알려주면 기억하는 방식이 맞고, 그 자리가 이미
-- 있습니다(attendance_learning_rules, 출결 인박스의 🔎 가르치기가 쓰는 표).
--
-- 세 명을 코드에 박아 넣지 않고 여기 넣는 이유: 네 번째 아이에게 또 막히지 않기 위해서입니다.
-- 앞으로 같은 일이 생기면 출결 인박스에서 🔎 를 눌러 가르치면 셔틀에도 함께 적용됩니다.

do $$
declare
  target uuid;
  pairs text[][] := array[
    -- 별칭(셔틀·출결에 적히는 표기), 명부에서 찾을 영문 이름 조각
    array['마야',              'maya'],
    array['에이바',            'elliana'],
    array['에이바(일라이아나)', 'elliana'],
    array['일라이아나',        'elliana'],
    array['제이콥',            'jacob']
  ];
  pair text[];
  hits int;
begin
  foreach pair slice 1 in array pairs loop
    -- 재학 중인 학생 중에서 영문 이름으로 찾습니다. 딱 한 명일 때만 별칭을 겁니다 -
    -- 둘 이상이면 어느 쪽인지 기계가 정할 일이 아닙니다.
    --
    -- (uuid에는 min()이 없어서 세는 것과 고르는 것을 나눕니다. 한 번에 하려다 실패했습니다.)
    select count(*) into hits
    from public.wr_students
    where status = 'active'
      and is_demo = false
      and name_en ilike '%' || pair[2] || '%';

    select id into target
    from public.wr_students
    where status = 'active'
      and is_demo = false
      and name_en ilike '%' || pair[2] || '%'
    limit 1;

    if hits = 0 then
      raise notice '건너뜀 · 명부에서 "%" 를 찾지 못했습니다 (별칭: %)', pair[2], pair[1];
      continue;
    end if;
    if hits > 1 then
      raise notice '건너뜀 · "%" 에 %명이 걸립니다 - 사람이 지정해야 합니다 (별칭: %)', pair[2], hits, pair[1];
      continue;
    end if;

    insert into public.attendance_learning_rules (kind, pattern, student_id, student_name)
    select 'alias', lower(replace(pair[1], ' ', '')), target, s.name
    from public.wr_students s where s.id = target
    on conflict (kind, pattern) do update
      set student_id = excluded.student_id,
          student_name = excluded.student_name;

    raise notice '별칭 등록 : % → %', pair[1], target;
  end loop;
end $$;

-- 확인
select
  r.pattern                    as "적힌 표기",
  s.name                       as "학생",
  s.name_en                    as "영문",
  coalesce(s.grade, '-')       as "학년"
from public.attendance_learning_rules r
left join public.wr_students s on s.id = r.student_id
where r.kind = 'alias'
order by r.pattern;
