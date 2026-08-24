-- 직원 답글이 "해결"인지 "진행중"인지
--
-- 요청: "우리 직원이 쓴글도 분석할 수 있어? (...) 우리직원이 쓴글이라면 문의가
-- 해결되었는지 안되었는지 표시되도록"
--
-- 지금까지는 직원이 답글을 달면 무조건 "처리 완료"로 넘겼습니다. 그런데 "확인 후
-- 연락드리겠습니다" 같은 답은 아직 끝난 게 아닙니다. 그래서 답글 내용을 보고 갈라,
-- 해결이면 목록에서 빼고, 진행중이면 "답변중"으로 남겨 계속 눈에 띄게 합니다.

alter table public.pickup_requests
  add column if not exists reply_status text; -- 'resolved' | 'pending' | null

comment on column public.pickup_requests.reply_status is
  '직원 답글 분석 결과. resolved=해결(목록에서 빠짐), pending=답변은 했으나 미해결(답변중 표시).';
