-- 데이터 백업 — **데이터베이스 밖으로** 나가는 한 벌
--
-- ── 지금까지 있던 것과 그 한계 ──────────────────────────────────────
--
--   · `npm run backup`           → 코드만. 데이터는 없습니다.
--   · `backups` 표 + create_backup → 사건·회의·업무 등 열 개 표만. 학생 명부·출결·셔틀·
--                                    회계가 통째로 빠져 있습니다.
--   · Supabase 자동 백업          → 전체를 담지만 대시보드 안에만 있습니다.
--
-- 앞의 둘은 **같은 데이터베이스 안**에 있습니다. DB가 통째로 잘못되면 백업도 함께
-- 사라집니다. 그건 백업이 아닙니다.
--
-- ── 그래서 두 가지를 만듭니다 ───────────────────────────────────────
--
--   ① 저장소 통(bucket) `data-backups` — Postgres 밖입니다. 표가 망가져도 파일은 남습니다.
--   ② 내려받은 기록 `data_export_log`   — 학생 개인정보·연락처·회계가 한 파일에 담기므로,
--      「누가 언제 가져갔나」는 반드시 물어보게 됩니다.

-- ── ① 저장소 통 ────────────────────────────────────────────────────
--
-- 공개하지 않습니다(public = false). 이 파일 하나가 학교 전체 자료라, 주소만 알면 열리는
-- 상태로 두면 백업이 곧 유출 통로가 됩니다.
insert into storage.buckets (id, name, public)
values ('data-backups', 'data-backups', false)
on conflict (id) do nothing;

-- 사람 손으로는 읽지 못하게 둡니다. 넣고 꺼내는 것은 서비스 키를 쓰는 서버(크론·관리자
-- 화면)뿐이고, 서비스 키는 RLS를 지나가지 않습니다. 정책을 열어두면 로그인한 아무나
-- 학교 전체 자료를 받아갈 수 있게 됩니다.
drop policy if exists data_backups_no_public_read on storage.objects;
create policy data_backups_no_public_read
  on storage.objects for select
  using (bucket_id <> 'data-backups');

-- ── ② 내려받은 기록 ────────────────────────────────────────────────
create table if not exists public.data_export_log (
  id uuid primary key default gen_random_uuid(),

  -- 누가. 지우지 않습니다 - 지울 수 있는 기록은 기록이 아닙니다.
  actor_email text not null,

  -- 어떻게. '내려받기'(사람) 또는 '자동저장'(매일 크론).
  kind text not null check (kind in ('내려받기', '자동저장')),

  -- 무엇이 담겼나. 표별 줄 수를 그대로 남겨, 나중에 「그때는 몇 명이었나」를 되짚습니다.
  table_count integer,
  row_count integer,

  -- **못 읽은 표.** 비어 있어야 온전한 백업입니다. 여기 이름이 남아 있으면 그 백업은
  -- 그 표가 빠진 채로 만들어진 것입니다 - 열어보기 전에는 알 수 없으므로 적어둡니다.
  failed_tables text[],

  -- 자동저장일 때 저장소의 파일 이름.
  storage_path text,
  bytes bigint,

  created_at timestamptz not null default now()
);

comment on table public.data_export_log is
  '데이터 전체 내려받기·자동저장 기록. 학생 개인정보가 담긴 파일이라 누가 언제 가져갔는지 남깁니다.';
comment on column public.data_export_log.failed_tables is
  '못 읽은 표. 비어 있어야 온전한 백업입니다 - 표가 빠진 백업은 열어보기 전에는 멀쩡해 보입니다.';

create index if not exists data_export_log_at_idx on public.data_export_log (created_at desc);

alter table public.data_export_log enable row level security;

-- 관리자만 봅니다. 「누가 가져갔나」를 아무나 볼 수 있으면 그것대로 문제입니다.
drop policy if exists data_export_log_admin on public.data_export_log;
create policy data_export_log_admin
  on public.data_export_log for select
  using (public.is_app_admin());
