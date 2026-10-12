-- 올톡 대조 — 올톡페이 「청구서관리목록」과 운영앱 회계를 한 화면에서 맞추기
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────
-- 청구는 운영앱에서 만들지만 발송·결제는 올톡페이에서 일어납니다. 올톡에서 결제된 돈은 앱에
-- 저절로 들어오지 않아서, 9/1~10/8 결제 103건 중 앱에 들어온 것은 5건뿐이었고 앱의 미납·연체
-- 숫자가 그만큼 부풀어 있었습니다.
--
-- 기존 「결제내역 올리기」는 청구사유에 앱 청구서 번호가 없으면 청구서를 **새로 만듭니다.**
-- 실제 파일의 청구사유는 「초등 10월 인보이스」처럼 사람이 쓴 글자라, 그대로 올리면 이미 있는
-- 청구서 옆에 같은 청구서가 한 장씩 더 생깁니다.
--
-- ── 무엇을 저장하는가 ───────────────────────────────────────────────────
-- 대조 자체는 매번 계산합니다(src/lib/alltalkSync.ts). 저장하는 것은 두 가지뿐입니다.
--   · alltalk_sync_files — 올린 파일의 줄. 다른 사람·다른 컴퓨터가 같은 대조 화면을 열 수 있게.
--   · alltalk_sync_marks — 사람이 내린 판단. 「이 올톡 이름은 이 학생」(link)과 「이 건은 앱에
--     안 넣음」(decision). 다음 달 파일을 올려도 같은 판단을 또 하지 않게 합니다.
-- 돈(청구서·입금)은 여기에 없습니다. 수납은 기존 입금 창구가 넣고, 승인번호를 source_key 로
-- 남겨 같은 결제가 두 번 들어가지 않게 합니다(payments_source_key_uniq).

create table if not exists public.alltalk_sync_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  row_count integer not null default 0,
  -- 파일의 줄(RawImportRow 모양). 보호자 번호가 들어 있어 재무 권한으로만 읽힙니다.
  rows jsonb not null default '[]'::jsonb
);

create index if not exists alltalk_sync_files_uploaded_idx on public.alltalk_sync_files (uploaded_at desc);

comment on table public.alltalk_sync_files is
  '올톡 대조 화면에 올린 청구서관리목록. 대조는 매번 다시 계산하고, 이 표는 파일의 줄만 담습니다.';

alter table public.alltalk_sync_files enable row level security;
drop policy if exists alltalk_sync_files_finance on public.alltalk_sync_files;
create policy alltalk_sync_files_finance on public.alltalk_sync_files
  for all to authenticated using (public.is_finance_user()) with check (public.is_finance_user());
revoke all on public.alltalk_sync_files from anon;

create table if not exists public.alltalk_sync_marks (
  -- link|올톡이름|번호  또는  g|학생(또는 올톡이름)|청구사유|첫 등록일  또는  inv|청구서번호
  key text primary key,
  kind text not null check (kind in ('link', 'decision')),
  student_id uuid references public.wr_students(id) on delete set null,
  decision text check (decision is null or decision in ('앱에 넣음', '앱에 안 넣음', '해당없음', '확인필요', '학생 아님')),
  memo text,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

comment on table public.alltalk_sync_marks is
  '올톡 대조에서 사람이 내린 판단. 올톡 이름→학생 연결과, 앱에 넣을지 말지. 다음 파일에도 그대로 적용됩니다.';

alter table public.alltalk_sync_marks enable row level security;
drop policy if exists alltalk_sync_marks_finance on public.alltalk_sync_marks;
create policy alltalk_sync_marks_finance on public.alltalk_sync_marks
  for all to authenticated using (public.is_finance_user()) with check (public.is_finance_user());
revoke all on public.alltalk_sync_marks from anon;

-- 다른 사람이 같은 화면에서 판단을 바꾸면 내 화면도 바뀌어야 합니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alltalk_sync_marks'
  ) then
    execute 'alter publication supabase_realtime add table public.alltalk_sync_marks';
  end if;
exception when others then
  raise notice 'realtime publication 추가 생략: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
