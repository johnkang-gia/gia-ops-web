-- 과목반(과목 선생님) 데이터(요청 ⑦). wr_subjects는 담당 선생님을 teacher_email로만 갖고
-- 있었는데, 특별교과 선생님은 아직 giamicro 계정이 없는 분이 많아 이름으로도 적을 수 있게
-- teacher_name 칸을 추가합니다(반 관리의 담임과 같은 방식). 그 뒤 26-27 명부(교직원)에 있는
-- 특별교과 담당을 채웁니다.
alter table public.wr_subjects add column if not exists teacher_name text;

-- 특별교과 담당(명부 2쪽 Specialty). 고정 UUID라 다시 실행해도 늘어나지 않습니다.
insert into public.wr_subjects (id, name, teacher_name, color)
values
  ('5b000000-0000-4000-c000-000000000001', '중국어', '박은지 (Eunji Park)', '#ef4444'),
  ('5b000000-0000-4000-c000-000000000002', '한국사', '조진형 (Joseph Cho)', '#f59e0b'),
  ('5b000000-0000-4000-c000-000000000003', '코딩', 'Eamonn', '#0ea5e9'),
  ('5b000000-0000-4000-c000-000000000004', '중국어·ASD', '조주은 (June Cho)', '#8b5cf6'),
  ('5b000000-0000-4000-c000-000000000005', 'ASD', 'Teneqha Ford', '#10b981'),
  ('5b000000-0000-4000-c000-000000000006', 'ASD', 'Sophia Shim', '#10b981'),
  ('5b000000-0000-4000-c000-000000000007', 'ASD', 'Celine', '#10b981'),
  ('5b000000-0000-4000-c000-000000000008', 'ASD', 'Anna', '#10b981'),
  ('5b000000-0000-4000-c000-000000000009', 'ASD 보조', 'Crystal Jung', '#14b8a6')
on conflict (id) do update
  set name = excluded.name, teacher_name = excluded.teacher_name, color = excluded.color;
