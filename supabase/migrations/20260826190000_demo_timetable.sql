-- 오리엔테이션 데모 반에 실제와 똑같은 시간표를 넣습니다.
--
-- 요청: "데모 오리엔테이션 계정 화면에 더미 시간표도 만들어야 해. 그냥 우리 담임선생님 중
-- 한 분 데이터를 더미로 똑같이 복사해서 가져와줘."
--
-- 신입 선생님에게 "이 화면이 이렇게 생겼습니다"를 보여주는 것이 이 계정의 목적인데, 시간표가
-- 비어 있으면 정작 매일 보게 될 화면을 못 보여줍니다. 그렇다고 가짜 과목명을 지어내면 실제와
-- 달라서 설명이 겉돕니다 - 그래서 실제 반의 시간표를 그대로 복사합니다.
--
-- 어느 반을 복사하나요?
--   초등부 실제 반 중에서 시간표 칸이 가장 많이 채워진 반을 자동으로 고릅니다. 반 이름을
--   코드에 박아두면 그 반이 없어지거나 담임이 바뀔 때 이 스크립트가 조용히 아무것도 안 하게
--   됩니다. "가장 잘 채워진 반"은 학기가 바뀌어도 늘 존재합니다.
--
-- 여러 번 실행해도 안전합니다(데모 반의 기존 시간표를 지우고 다시 넣습니다).
begin;

do $$
declare
  demo_class_id uuid := 'd0000000-0000-4000-a000-000000000001';
  source_class_id uuid;
  source_label text;
  copied int;
begin
  -- 데모 반이 아직 없으면(오리엔테이션 마이그레이션 미실행) 조용히 넘어갑니다.
  if not exists (select 1 from wr_classes where id = demo_class_id) then
    raise notice '건너뜀: 데모 반이 없습니다. 20260821200000_demo_account_orientation.sql을 먼저 실행하세요.';
    return;
  end if;

  -- 시간표가 가장 많이 채워진 실제 초등부 반을 고릅니다.
  select c.id, coalesce(c.grade, '') || ' ' || coalesce(c.class_name, '')
    into source_class_id, source_label
  from wr_classes c
  join wr_timetable t on t.class_id = c.id
  where coalesce(c.is_demo, false) = false
    and c.department = '초등부'
  group by c.id, c.grade, c.class_name
  order by count(t.id) desc
  limit 1;

  if source_class_id is null then
    raise notice '건너뜀: 복사할 실제 초등부 시간표가 없습니다.';
    return;
  end if;

  -- 데모 반의 기존 시간표를 비우고 다시 채웁니다(중복·잔여물 없이 항상 같은 결과).
  delete from wr_timetable where class_id = demo_class_id;

  insert into wr_timetable (class_id, weekday, period_id, subject_name, subject_id, teacher_name, room)
  select demo_class_id, t.weekday, t.period_id, t.subject_name, t.subject_id, t.teacher_name, t.room
  from wr_timetable t
  where t.class_id = source_class_id
  on conflict (class_id, weekday, period_id) do update
    set subject_name = excluded.subject_name,
        subject_id   = excluded.subject_id,
        teacher_name = excluded.teacher_name,
        room         = excluded.room,
        updated_at   = now();

  get diagnostics copied = row_count;
  raise notice '데모 반 시간표 % 칸을 "%"에서 복사했습니다.', copied, source_label;
end $$;

commit;
