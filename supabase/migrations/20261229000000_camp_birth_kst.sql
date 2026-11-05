-- 캠프 신청의 생년월일이 하루씩 앞당겨져 있던 것을 바로잡습니다.
--
-- 구글폼 결과 시트의 날짜 칸은 앱스크립트가 세계표준시 시각(한국 자정 = 전날 15:00Z)으로 보내는데, 받는 쪽이
-- 앞 10글자만 잘라 생일을 하루 이르게 적었습니다. 그래서 명부의 생일과 안 맞아 자동 연결이 거의 안 됐습니다.
-- 받는 쪽은 고쳤고(readCampForm), 이미 들어온 줄은 원문(raw)의 시각을 한국 날짜로 다시 계산합니다.
-- 사람이 직접 고친 생일은 원문과 다르므로 건드리지 않습니다(원문에서 잘라낸 값과 같은 줄만 고칩니다).

with src as (
  select a.id,
         a.birth_date,
         (select value from jsonb_each_text(a.raw) j
           where j.key ~* '(생년|생일|birth|dob)' and j.value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
           limit 1) as v
    from public.camp_applications a
)
update public.camp_applications a
   set birth_date = to_char((src.v::timestamptz at time zone 'Asia/Seoul'), 'YYYY-MM-DD')
  from src
 where src.id = a.id
   and src.v is not null
   and a.birth_date = left(src.v, 10);
