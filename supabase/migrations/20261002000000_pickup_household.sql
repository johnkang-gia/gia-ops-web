-- 토들 연락에 **집**을 붙입니다.
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 토들 방은 그 집 방입니다. 사람이 방↔학생을 한 번 이어 두면 그 방에서 온 연락이 **어느
-- 집 것인지는 언제나 확정**입니다. 형제가 둘이어서 아이를 한 명으로 못 좁힐 뿐입니다.
--
-- 그런데 `pickup_requests` 에는 방 이름(`channel_label`)만 글자로 적혀 있고 **방과의 연결이
-- 없었습니다.** 그래서 학생이 안 붙은 줄은 아무에게도 안 보였습니다 - 방은 100% 확정인데
-- 그 확정을 버리고 있었습니다.
--
-- ── 왜 학생만으로는 안 되나 ─────────────────────────────────────────────────
--
-- 남은 52건의 본문을 실제로 읽어 보니 이런 글들입니다.
--
--     "언제까지 노트북 준비 하면 될까요?"
--     "아이들 화목 방과후 다음주부터 부탁드립니다"
--     "감사 인사"
--
-- **아이를 한 명으로 정할 필요가 없는 글**입니다. 「아이들 화목 방과후」를 형 한 명 것으로
-- 찍으면 동생 기록에서 그 연락이 사라집니다 - 찍으면 오히려 틀립니다.
--
-- 학생 한 명이 꼭 필요한 것은 **출결·하원에 반영되는 글**뿐이고, 형제방 52건 중 그런 글은
-- 4건이었습니다. 나머지는 집만 붙으면 됩니다.

-- rls-ok: 새 표를 만들지 않습니다. 있는 표에 칸 하나를 더하고 이어 붙일 뿐이라,
--         `pickup_requests` 에 이미 걸린 정책이 그대로 적용됩니다.
alter table public.pickup_requests
  add column if not exists channel_id uuid references public.toddle_channels(id) on delete set null;

comment on column public.pickup_requests.channel_id is
  '어느 집(토들 방)에서 온 연락인가. 학생을 한 명으로 못 좁혀도 집은 확정입니다.';

-- 방 이름으로 찾을 때 대소문자·공백 차이로 못 찾는 일이 없도록, 코드와 같은 방식으로 납작하게.
create index if not exists pickup_requests_channel_id_idx on public.pickup_requests (channel_id);

-- ── 지난 줄 되짚어 잇기 ─────────────────────────────────────────────────────
--
-- 이름이 정확히 같은 방만 잇습니다. 비슷한 이름을 억지로 이으면 남의 집 연락이 붙는데,
-- 그건 오류가 아니라 «그 집 기록»으로 보입니다.
update public.pickup_requests p
set channel_id = c.id
from public.toddle_channels c
where p.channel_id is null
  and p.channel_label is not null
  and lower(btrim(p.channel_label)) = lower(btrim(c.label));
