-- 【진단 전용 · 아무것도 바꾸지 않습니다】 토들 링크가 왜 안 만들어지는지
--
-- 토들 주소는 이렇게 생겼습니다.
--   https://web.toddleapp.com/platform/{학교번호}/messaging/{방번호}
--
-- 앱은 두 가지 중 하나로 이 주소를 만듭니다.
--   ① source_url        수집기가 통째로 저장해 둔 주소
--   ② source_chat_id    방 번호만 있을 때, 다른 줄의 주소에서 학교번호를 빌려 조립
--
-- 버튼이 안 보인다면 **둘 다 비어 있다**는 뜻입니다. 무엇이 비었는지 봅니다.

-- ① 칸이 아예 없는 경우(마이그레이션 미실행)라면 여기서 오류가 납니다.
--    "column does not exist" 가 나오면 20260824140000_parent_inquiries.sql 을 돌려야 합니다.
select
  count(*)                                            as "전체",
  count(*) filter (where source = '토들')              as "토들에서 온 것",
  count(source_url)                                   as "주소 있음",
  count(source_chat_id)                               as "방번호 있음",
  count(*) filter (where source_url is null and source_chat_id is null) as "둘 다 없음"
from pickup_requests;

-- ② 주소가 하나라도 있으면 학교번호를 빌려올 수 있습니다. 실제로 어떻게 생겼는지 봅니다.
select source_url as "저장된 주소 예시"
  from pickup_requests
 where source_url is not null
 order by received_at desc
 limit 3;

-- ③ 최근 토들 문의 5건의 상태
select
  to_char(received_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "받은 시각",
  channel_label as "채팅방",
  coalesce(matched_name, ai_student_name) as "학생",
  case when source_url is not null then '있음' else '—' end     as "주소",
  case when source_chat_id is not null then '있음' else '—' end as "방번호"
  from pickup_requests
 where source = '토들'
 order by received_at desc
 limit 5;
