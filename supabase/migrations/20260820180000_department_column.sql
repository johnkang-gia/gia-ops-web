-- ===== 96. 부서(유치부/초등부/중고등부) 명시 칸 + 유치부 분리 =====
-- 요청: "부서는 유치부는 통합하지말고 따로 만들어 달라고 하셨어... 앞으로도 저런형식을가진
-- 아이들을 유치부로 분류하고... 유치부는 우선 분리해서 표면적으로는 안보이게 해줘"
--
-- 지금까지는 학년 표기(wr_classes.grade)의 글자 모양을 보고 부서를 추측했는데, 표기가 조금만
-- 달라져도 엉뚱한 부서로 묶입니다. 새 학기 데이터를 통째로 넣기 전에 부서를 명시적으로 담는
-- 칸을 만들어, 앞으로는 추측 없이 이 값만 보고 판단하게 합니다. 나중에 유치부용 프로그램을
-- 따로 만들 때도 이 칸 하나로 학생을 골라낼 수 있습니다.

alter table wr_students add column if not exists department text
  check (department is null or department in ('유치부', '초등부', '중고등부'));
alter table wr_classes add column if not exists department text
  check (department is null or department in ('유치부', '초등부', '중고등부'));

create index if not exists wr_students_department_idx on wr_students(department);
create index if not exists wr_classes_department_idx on wr_classes(department);

-- 기존 행은 그동안 쓰던 추측 규칙과 같은 기준으로 한 번만 채워둡니다(이미 값이 있으면 건드리지
-- 않으므로 여러 번 실행해도 안전합니다). 새로 들어오는 데이터는 명시적으로 넣습니다.
update wr_classes
set department = case
  when grade ~* '유치|^K|^유' then '유치부'
  when grade ~ '중|고' then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int >= 7 then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int between 1 and 6 then '초등부'
  else null
end
where department is null and grade is not null;

update wr_students
set department = case
  when grade ~* '유치|^K|^유' then '유치부'
  when grade ~ '중|고' then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int >= 7 then '중고등부'
  when coalesce(nullif(regexp_replace(grade, '[^0-9]', '', 'g'), ''), '0')::int between 1 and 6 then '초등부'
  else null
end
where department is null and grade is not null;
