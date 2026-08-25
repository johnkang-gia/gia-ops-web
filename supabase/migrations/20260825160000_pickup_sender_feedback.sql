-- 픽업 인박스 학습(요청 ⑩: 픽업/픽업아님 정정을 학습해 점점 정확하게). 발신자(어머니/채널)별로
-- "픽업으로 확정한 횟수"와 "픽업 아님으로 넘긴 횟수"를 누적합니다. 이 이력을 ingest 분류의
-- 신뢰도(자동확정 여부)에 반영해, 늘 픽업인 발신자는 더 빨리 자동확정하고, 대개 픽업이
-- 아니었던 발신자는 사람이 한 번 더 확인하도록 유도합니다(오분류를 만들지 않는 안전한 방향).
create table if not exists public.pickup_sender_feedback (
  sender_key text primary key,
  pickup_count integer not null default 0,
  not_pickup_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.pickup_sender_feedback enable row level security;
drop policy if exists pickup_sender_feedback_select on public.pickup_sender_feedback;
create policy pickup_sender_feedback_select on public.pickup_sender_feedback
  for select using (auth.role() = 'authenticated');

-- 정정 1건을 원자적으로 누적합니다(서비스 롤/로그인 사용자가 호출).
create or replace function public.bump_pickup_feedback(p_sender text, p_is_pickup boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pickup_sender_feedback (sender_key, pickup_count, not_pickup_count)
  values (p_sender, case when p_is_pickup then 1 else 0 end, case when p_is_pickup then 0 else 1 end)
  on conflict (sender_key) do update set
    pickup_count = public.pickup_sender_feedback.pickup_count + (case when p_is_pickup then 1 else 0 end),
    not_pickup_count = public.pickup_sender_feedback.not_pickup_count + (case when p_is_pickup then 0 else 1 end),
    updated_at = now();
$$;

grant execute on function public.bump_pickup_feedback(text, boolean) to authenticated, service_role;
