-- 반 이름만 있고 연결이 비어 있는 학생을 이어 붙입니다
--
-- 학생 추가 화면과 구글시트 반영이 반 **이름**만 저장하고 **연결**(class_id)은 비워두고
-- 있었습니다. 화면에는 반 이름이 잘 보이니 다 된 줄 알았는데, 반 배정 화면에서는 그 아이가
-- 「미배정」에 있었습니다.
--
-- 코드는 고쳤지만 **이미 저장된 줄은 그대로 남습니다.** 여기서 한 번 이어 붙입니다.
--
-- 이름이 정확히 하나의 반과 맞을 때만 잇습니다. 여럿과 맞으면 그대로 둡니다 - 엉뚱한 반에
-- 넣는 것보다 미배정이 낫습니다. 미배정은 화면에 보이지만, 엉뚱한 반은 아무에게도 안 보입니다.
--
-- 비교는 **띄어쓰기·대소문자를 무시**합니다. 사람은 「G2 C」와 「g2c」를 같은 것으로 적습니다.

update public.wr_students s
set class_id = c.id,
    -- 이름도 명부에 적힌 그대로로 맞춥니다. 표기가 갈리면 반별로 세는 화면이 두 줄로 나옵니다.
    class_name = c.class_name
from public.wr_classes c
where s.class_id is null
  and s.class_name is not null
  and c.is_demo = s.is_demo
  and lower(regexp_replace(c.class_name, '[^a-zA-Z0-9가-힣]', '', 'g'))
      = lower(regexp_replace(s.class_name, '[^a-zA-Z0-9가-힣]', '', 'g'))
  -- 같은 이름의 반이 둘 이상이면 고르지 않습니다.
  and (
    select count(*) from public.wr_classes c2
    where c2.is_demo = s.is_demo
      and lower(regexp_replace(c2.class_name, '[^a-zA-Z0-9가-힣]', '', 'g'))
          = lower(regexp_replace(s.class_name, '[^a-zA-Z0-9가-힣]', '', 'g'))
  ) = 1;

-- 남은 것을 언제든 확인할 수 있게 해둡니다. 숫자가 0이 아니면 반 이름이 명부의 반과 다르거나
-- 같은 이름의 반이 둘 이상이라는 뜻입니다.
create or replace view public.students_without_class as
select s.id, s.name, s.grade, s.class_name,
       (select count(*) from public.wr_classes c
        where c.is_demo = s.is_demo
          and lower(regexp_replace(c.class_name, '[^a-zA-Z0-9가-힣]', '', 'g'))
              = lower(regexp_replace(s.class_name, '[^a-zA-Z0-9가-힣]', '', 'g'))) as 이름이_맞는_반_수
from public.wr_students s
where s.class_id is null and s.status = 'active' and s.is_demo = false;

comment on view public.students_without_class is
  '반 이름은 있는데 반 연결이 비어 있는 재학생. 0이 아니면 반 이름이 명부와 다르거나 같은 이름의 반이 둘 이상입니다.';
