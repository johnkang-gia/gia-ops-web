-- 담임/과목 선생님이 행정실에 도움을 요청하거나 문의하는 창구(요청 4). 여기 남긴 글은 업무
-- 대시보드 상단에 실시간으로 뜨고, 해당 반에 빨간 느낌표로 표시됩니다. 교사는 자기 글만,
-- 관리자·행정직원은 전체를 봅니다(조회 자체는 서비스 롤 API로 좁혀서 넘깁니다).
create table if not exists public.teacher_office_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_email text not null,
  teacher_name text,
  class_label text,            -- 예: "G3J" 또는 "3학년 J반"(담임이 아닌 과목 교사는 비어 있을 수 있음)
  category text not null default '문의',   -- 도움요청 · 문의 · 기타
  message text not null,
  status text not null default '접수',      -- 접수 · 확인 · 완료
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists teacher_office_requests_open_idx
  on public.teacher_office_requests (status, created_at desc);
create index if not exists teacher_office_requests_teacher_idx
  on public.teacher_office_requests (teacher_email, created_at desc);

alter table public.teacher_office_requests enable row level security;

-- 내부 도구라 로그인 사용자에게 열람/작성을 허용합니다(교사 화면은 API에서 본인 것만 걸러
-- 넘기고, 업무 대시보드는 관리자·행정직원만 접근할 수 있는 화면입니다).
drop policy if exists teacher_office_requests_select on public.teacher_office_requests;
create policy teacher_office_requests_select on public.teacher_office_requests
  for select using (auth.role() = 'authenticated');
drop policy if exists teacher_office_requests_insert on public.teacher_office_requests;
create policy teacher_office_requests_insert on public.teacher_office_requests
  for insert with check (auth.role() = 'authenticated');
drop policy if exists teacher_office_requests_update on public.teacher_office_requests;
create policy teacher_office_requests_update on public.teacher_office_requests
  for update using (auth.role() = 'authenticated');
