-- 답장 문구 모음.
--
-- 같은 답(결석 확인·픽업 확인·분실물)을 하루에도 여러 번 손으로 다시 씁니다. 문구는 직원 모두가 함께
-- 고치고 늘리는 것이라 브라우저가 아니라 표에 둡니다. 「{이름}」은 화면이 그 문의의 학생 이름으로 바꿉니다.

create table if not exists public.inquiry_reply_templates (
  id uuid primary key default gen_random_uuid(),
  badge text,                -- 이 뱃지의 문의에서 먼저 보입니다. 비면 모든 문의에서 보입니다.
  title text not null,
  body text not null,
  sort_order int not null default 100,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inquiry_reply_templates enable row level security;
drop policy if exists inquiry_reply_templates_staff on public.inquiry_reply_templates;
create policy inquiry_reply_templates_staff on public.inquiry_reply_templates
  for all to authenticated
  using (public.is_giamicro_user())
  with check (public.is_giamicro_user());
revoke all on public.inquiry_reply_templates from anon;

-- 처음 쓸 문구. 표가 비어 있을 때만 넣습니다(두 번 돌려도 같은 결과).
insert into public.inquiry_reply_templates (badge, title, body, sort_order, created_by)
select * from (values
  ('출결', '결석 확인', '안녕하세요, 어머님. {이름} 오늘 결석 확인했습니다. 담임 선생님께도 전달드리겠습니다. 빠른 쾌유 바랍니다.', 10, 'system'),
  ('출결', '지각 확인', '안녕하세요. {이름} 늦게 등교하는 것 확인했습니다. 담임 선생님께 전달드리겠습니다. 조심히 오세요.', 20, 'system'),
  ('픽업·하원', '픽업 확인', '안녕하세요. {이름} 오늘 픽업 확인했습니다. 셔틀에서 제외하고 시간 맞춰 준비시키겠습니다.', 10, 'system'),
  ('셔틀', '셔틀 변경 확인', '안녕하세요. {이름} 셔틀 변경 요청 확인했습니다. 반영 후 다시 안내드리겠습니다.', 10, 'system'),
  ('물건', '물건 확인', '안녕하세요. 말씀하신 {이름}의 물건 확인해 보고 다시 연락드리겠습니다.', 10, 'system'),
  (null, '전달하겠습니다', '안녕하세요. 말씀하신 내용 담당 선생님께 전달드리겠습니다. 감사합니다.', 90, 'system')
) as v(badge, title, body, sort_order, created_by)
where not exists (select 1 from public.inquiry_reply_templates);
