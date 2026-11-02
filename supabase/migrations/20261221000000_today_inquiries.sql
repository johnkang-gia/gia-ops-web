-- 오늘의 문의사항: 토들에 들어온 학부모 글 전부를 분류·관리합니다.
--
-- 예전 기준은 셔틀이었습니다(픽업 / 문의 / 기타). 「기타」는 본문을 버리고 무시로 내렸고,
-- 문의는 종류 하나(inquiry_type)만 가졌습니다. 이제는 학부모가 토들에 쓴 글 전체를 행정실이
-- 처리하는 일로 보므로, 한 글에 여러 뱃지를 붙이고 «답함»과 «처리 완료»를 나눠 기록합니다.
--
--   badges        글 하나에 붙는 분류 뱃지(여럿). 목록은 src/lib/inquiryBadges.ts 한 곳입니다.
--   replied_*     답함: 학부모에게 답을 했다. 토들에 직원 답글이 달리면 수집기가 자동으로 채웁니다.
--   answered_*    처리 완료: 요청한 일이 끝났다. 사람이 누릅니다(누른 사람·시각이 남습니다).
--   assignees     처리를 맡은 직원(이메일). 맡은 사람 화면의 「오늘 꼭 기억」 맨 위에 뜹니다.
--
-- 학부모가 쓴 시각은 received_at, 앱에 들어온 시각은 created_at 입니다. 화면은 앞의 것만 보여주고,
-- 둘의 차이는 수집이 얼마나 늦는지 재는 데만 씁니다.

alter table public.pickup_requests add column if not exists badges text[] not null default '{}';
alter table public.pickup_requests add column if not exists replied_via text;
alter table public.pickup_requests add column if not exists assignees text[] not null default '{}';
alter table public.pickup_requests add column if not exists assigned_by text;
alter table public.pickup_requests add column if not exists assigned_at timestamptz;

comment on column public.pickup_requests.badges is '분류 뱃지(여럿). 목록: src/lib/inquiryBadges.ts';
comment on column public.pickup_requests.replied_via is '답함을 누가 채웠나: 토들 답글(수집기) | 앱(사람이 누름)';
comment on column public.pickup_requests.assignees is '처리를 맡은 직원 이메일들';

-- 이미 쌓인 줄에 뱃지를 채웁니다. 종류 하나에서 옮기므로 뱃지는 하나씩입니다.
update public.pickup_requests
   set badges = case
     when kind = '픽업' then array['픽업·하원']
     when kind = '기타' then array['인사·감사']
     when inquiry_type = '출결' then array['출결']
     when inquiry_type = '차량·하원' then array['셔틀']
     when inquiry_type in ('수업·학습', '생활·교우', '건강·안전', '행사·일정', '납부·행정') then array[inquiry_type]
     else array['기타']
   end
 where badges = '{}';

-- 예전 자동 답글 표시는 «처리 완료» 칸(answered_*)에 '답글'로 들어갔습니다. 이제 그건 «답함»입니다.
update public.pickup_requests
   set replied_at = coalesce(replied_at, answered_at),
       replied_by = coalesce(replied_by, answered_by),
       replied_via = coalesce(replied_via, '토들 답글'),
       answered_at = null,
       answered_by = null,
       answered_via = null
 where answered_via = '답글';

update public.pickup_requests set replied_via = '토들 답글' where replied_at is not null and replied_via is null;

-- 오늘 목록은 쓴 시각(받은 날)으로 읽습니다.
create index if not exists pickup_requests_received_idx on public.pickup_requests (received_at desc);
-- 내가 맡은 미처리 건을 날짜와 상관없이 찾습니다.
create index if not exists pickup_requests_assignees_idx on public.pickup_requests using gin (assignees);

-- 수집기가 센 «오늘 토들에 학부모가 쓴 글 수»를 남깁니다. 앱에 들어온 수와 견줘 빠진 것이 없는지 봅니다.
alter table public.integration_heartbeats add column if not exists meta jsonb;

notify pgrst, 'reload schema';
