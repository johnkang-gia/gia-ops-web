-- ===== 94. 업무 전체공지 =====
-- 요청: "업무에서 전체공지가 있을경우 바로 상단으로 옮겨지고, 새로운 공지가 있으면 이전공지가
-- 사라지고, 다음공지가 상단으로 옮겨지게 하고, 전체공지 히스토리를 상단오른쪽에 히스토리
-- 아이콘을 눌러서 볼 수 있도록 만들어주고, 공지로 상단에 뜨는경우, 각각의 이용자들이 공지를
-- 접을 수 있게 해줘"
--
-- 공지는 지우지 않고 계속 쌓아두고, "가장 최근 것 하나만" 상단에 띄웁니다(화면에서 created_at
-- 내림차순 첫 행). 그래서 새 공지를 올리면 이전 공지는 자동으로 상단에서 내려가고 히스토리에만
-- 남습니다 - 별도의 '내리기' 처리가 필요 없고, 기록도 사라지지 않습니다.
create table if not exists work_notices (
  id uuid primary key default gen_random_uuid(),
  -- scope='전체'면 부서와 상관없이 모든 부서 탭 상단에, '부서'면 department와 같은 부서에서만
  -- 보입니다(요청: "둘 다 (전체/부서 선택)").
  scope text not null default '전체' check (scope in ('전체', '부서')),
  department text,
  title text not null,
  body text,
  author_email text not null,
  -- 올린 사람이 실수로 올렸을 때 되돌릴 수 있도록 감춤 처리만 합니다(행을 지우지 않아 히스토리
  -- 순서가 흐트러지지 않습니다).
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists work_notices_recent_idx on work_notices(created_at desc);
-- scope='부서'인데 department가 비어 있으면 어느 부서에도 안 뜨는 유령 공지가 되므로 막습니다.
alter table work_notices drop constraint if exists work_notices_scope_department_chk;
alter table work_notices add constraint work_notices_scope_department_chk
  check (scope = '전체' or department is not null);

-- 사용자별로 공지를 접어둔 상태입니다(요청: "각각의 이용자들이 공지를 접을 수 있게"). 공지마다
-- 따로 기록하므로, 접어둔 뒤 새 공지가 올라오면 그 새 공지는 다시 펼쳐진 채로 보입니다.
create table if not exists work_notice_collapses (
  notice_id uuid not null references work_notices(id) on delete cascade,
  user_email text not null,
  created_at timestamptz not null default now(),
  primary key (notice_id, user_email)
);

alter table work_notices enable row level security;
alter table work_notice_collapses enable row level security;

-- 조회는 giamicro.com 계정이면 누구나(공지는 모두가 봐야 함), 작성·수정은 관리자·행정직원만
-- 할 수 있습니다(요청: "관리자·행정직원만").
drop policy if exists "giamicro_select_work_notices" on work_notices;
create policy "giamicro_select_work_notices" on work_notices for select using (is_giamicro_user());
drop policy if exists "wr_manager_write_work_notices" on work_notices;
create policy "wr_manager_write_work_notices" on work_notices for all using (is_wr_manager()) with check (is_wr_manager());

-- 접기 기록은 본인 것만 읽고 쓸 수 있습니다(남의 화면 상태를 건드릴 이유가 없습니다).
drop policy if exists "own_work_notice_collapses" on work_notice_collapses;
create policy "own_work_notice_collapses" on work_notice_collapses for all
  using (user_email = lower(auth.jwt() ->> 'email'))
  with check (user_email = lower(auth.jwt() ->> 'email'));

-- 새 공지가 올라오면 보고 있던 사람들 화면에 새로고침 없이 바로 뜨도록 실시간 구독에 넣습니다.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='work_notices') then
    alter publication supabase_realtime add table work_notices;
  end if;
end $$;
