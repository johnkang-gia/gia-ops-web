-- 되돌리기 기록
--
-- 되돌리기는 **살아 있는 자료를 덮어씁니다.** 몇 달 뒤 「이 학생 기록이 왜 이렇게 되어
-- 있지?」를 물었을 때, 그날 누군가 되돌렸다는 사실을 모르면 아무도 설명하지 못합니다.
-- 되돌린 사실 자체가 그 자료의 내력입니다.
--
-- 직전에 남긴 안전망 백업의 이름도 함께 적습니다. 「되돌렸더니 더 나빠졌다」가 됐을 때
-- 어느 파일로 다시 되돌려야 하는지가 여기 있어야 합니다.

create table if not exists public.data_restore_log (
  id uuid primary key default gen_random_uuid(),

  actor_email text not null,

  -- 어느 시점의 백업으로 되돌렸나.
  backup_exported_at timestamptz,

  -- 어떤 표를 되돌렸나.
  tables text[],

  rows_written integer,
  rows_deleted integer,

  -- 되돌리지 못한 표. 비어 있어야 온전히 끝난 것입니다 - 절반만 들어간 상태는 원래 상태도
  -- 되돌린 상태도 아닙니다.
  failed_tables text[],

  -- 되돌리기 **직전**에 남긴 지금 상태. 되돌린 것을 다시 되돌릴 때 씁니다.
  safety_backup_path text,

  created_at timestamptz not null default now()
);

comment on table public.data_restore_log is
  '백업 파일로 되돌린 기록. 되돌린 사실 자체가 그 자료의 내력이라 지우지 않습니다.';
comment on column public.data_restore_log.safety_backup_path is
  '되돌리기 직전에 남긴 그때 상태. 되돌린 것을 다시 되돌릴 때 이 파일을 씁니다.';

create index if not exists data_restore_log_at_idx on public.data_restore_log (created_at desc);

alter table public.data_restore_log enable row level security;

drop policy if exists data_restore_log_admin on public.data_restore_log;
create policy data_restore_log_admin
  on public.data_restore_log for select
  using (public.is_app_admin());
