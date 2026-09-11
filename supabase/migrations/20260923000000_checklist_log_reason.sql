-- 활동 기록에 **근거 원문**을 함께 남깁니다.
--
-- 지금까지 기록에는 「토들 · 홍길동 픽업」만 남았습니다. 누가 바꿨는지는 알 수 있지만
-- **왜 바꿨는지**는 알 수 없습니다. 「토들」은 사람이 아니라 창구 이름이라, 물어볼 곳조차
-- 없습니다. 확인하려면 인박스로 넘어가 그 아이의 연락을 다시 찾아야 했고, 그 연락이
-- 나중에 정리되면 근거는 아예 사라집니다.
--
-- 근거는 **판단이 일어난 그 순간에** 함께 굳혀야 합니다. 나중에 다른 표를 뒤져 맞추는
-- 방식은 그 표가 바뀌는 순간 틀린 답을 하게 됩니다.
--
-- 요약이 아니라 **원문**을 담습니다. 요약은 이미 한 번 해석된 것이라, 해석이 틀렸을 때
-- 그 사실을 알아볼 방법이 요약 안에는 없습니다.

alter table public.shuttle_checklist_log
  add column if not exists reason_text text,
  add column if not exists reason_source text,
  add column if not exists reason_from text,
  add column if not exists reason_url text;

comment on column public.shuttle_checklist_log.reason_text is
  '이 변경의 근거가 된 연락 원문. 요약이 아니라 받은 글 그대로.';
comment on column public.shuttle_checklist_log.reason_source is
  '근거가 어디서 왔나 — 토들 · 구글챗 · 출석부 · 하원수단 · 예약 등.';
comment on column public.shuttle_checklist_log.reason_from is
  '누구의 연락인가 — 방 이름·보낸 사람. 되물을 곳을 적어 둡니다.';
comment on column public.shuttle_checklist_log.reason_url is
  '원본으로 돌아가는 길(구글챗 링크 등). 없으면 비웁니다.';

-- rls-ok: 표는 이미 RLS가 켜져 있고 정책도 있습니다. 여기서는 칸만 더합니다.
