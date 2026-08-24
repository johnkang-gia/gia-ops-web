-- 같은 연락이 두 경로로 들어올 때 하나로 묶기
--
-- 학부모가 토들로 "유겸이 장염이라 오늘 결석합니다"를 보내고, 담임 선생님이 구글챗 출결방에
-- "유겸 결석(장염)"이라고 올리면, 지금은 인박스에 두 줄이 뜹니다. 같은 일인데 두 번 처리하게
-- 되고, 한쪽만 처리하면 다른 쪽이 미처리로 남아 계속 눈에 걸립니다.
--
-- 그래서 뒤에 들어온 것은 새로 만들지 않고 먼저 들어온 줄에 붙입니다. 어느 경로로 들어왔는지는
-- 남겨둡니다 - 나중에 "토들에도 왔었나?"를 확인할 수 있어야 하고, 어느 경로가 더 빠른지도
-- 이 기록으로 알 수 있습니다.

alter table public.pickup_requests
  add column if not exists merged_sources text[] not null default '{}',
  add column if not exists merged_count integer not null default 0,
  add column if not exists merged_at timestamptz;

comment on column public.pickup_requests.merged_sources is
  '같은 내용으로 뒤늦게 들어온 다른 경로들(토들·전화·교사 등). 화면에는 이 줄 하나만 뜹니다.';
