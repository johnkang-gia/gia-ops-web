-- 휴가계획서·병결기록 — 학생별로 받은 서류를 보관합니다
--
-- ── 왜 필요한가 ─────────────────────────────────────────────────────────────
--
-- 아이가 길게 여행을 가거나 아파서 빠지면 학교가 **휴가계획서**나 **진단서·소견서**를
-- 받습니다. 지금은 그 파일이 메일함이나 담당자 컴퓨터에 있어서, 나중에 「이 결석은 승인된
-- 것인가」를 물으면 받은 사람만 답할 수 있습니다.
--
-- 출결 기록에는 「결석」이라고만 남고 **근거 서류가 어디에도 안 붙어 있습니다.**
--
-- ── 무엇을 담나 ─────────────────────────────────────────────────────────────
--
-- 파일 자체는 저장소(`student-docs` 버킷)에 두고, 이 표에는 **어느 학생의 · 어느 기간의 ·
-- 무슨 서류인지**만 적습니다. 파일을 표에 넣으면 백업 파일이 통째로 무거워지고, 표를
-- 읽을 때마다 파일까지 딸려옵니다.
--
-- ── 출결과의 관계 ───────────────────────────────────────────────────────────
--
-- **출결 기록을 이 표가 바꾸지 않습니다.** 서류는 근거이고 출결은 판단입니다 - 서류가
-- 들어왔다고 자동으로 출석 인정이 되면, 학교가 검토하기 전에 결정이 나버립니다. 대신
-- 기간이 겹치는 결석이 출석부에서 이 서류를 찾아 보여줄 수 있게 날짜를 함께 담습니다.

create table if not exists public.student_absence_docs (
  id uuid primary key default gen_random_uuid(),

  -- **학생 번호로 붙입니다.** 이름으로 붙이면 김재이 셋 중 누구 서류인지 알 수 없습니다.
  student_id uuid not null references public.wr_students(id) on delete cascade,

  -- 휴가계획서 / 병결기록 / 진단서 / 소견서 / 기타
  kind text not null check (kind in ('휴가계획서', '병결기록', '진단서', '소견서', '기타')),

  -- 이 서류가 덮는 기간. 하루짜리면 시작=끝.
  --
  -- 기간을 안 받으면 「언제 것인지」를 파일을 열어봐야 알 수 있습니다. 출석부에서 그날의
  -- 결석에 이 서류를 붙여 보여주려면 날짜가 표에 있어야 합니다.
  date_from date not null,
  date_to date not null,

  -- 사유 한 줄. 파일을 열지 않고도 목록에서 무슨 일인지 알 수 있게 합니다.
  reason text,

  -- 저장소 경로(`student-docs` 버킷). 원본 파일 이름은 따로 남깁니다 - 경로는 겹치지
  -- 않도록 시각·난수로 만들어서, 그것만 보면 무슨 파일인지 알 수 없습니다.
  file_path text not null,
  file_name text not null,
  file_size integer,

  -- 학교가 이 서류를 보고 정한 것. **기본은 「접수」입니다** - 받았다는 사실과 인정했다는
  -- 판단은 다릅니다. 자동으로 인정으로 두면 아무도 검토하지 않게 됩니다.
  status text not null default '접수' check (status in ('접수', '승인', '반려')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,

  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 기간이 거꾸로 들어오면 출석부가 아무 날도 못 찾습니다. 화면 오류로 안 보이므로 표가 막습니다.
  constraint student_absence_docs_range check (date_to >= date_from)
);

create index if not exists student_absence_docs_student_idx
  on public.student_absence_docs (student_id, date_from desc);
-- 출석부가 「이 날짜에 걸친 서류」를 찾을 때 씁니다.
create index if not exists student_absence_docs_range_idx
  on public.student_absence_docs (date_from, date_to);

-- 같은 학생에게 같은 파일을 두 번 올리는 것을 막습니다. 두 줄이 되면 목록에 같은 서류가
-- 두 번 뜨고, 어느 쪽을 지워야 하는지 알 수 없습니다.
create unique index if not exists student_absence_docs_uniq
  on public.student_absence_docs (student_id, file_path);

-- ── 자물쇠 ──────────────────────────────────────────────────────────────────
--
-- 진단서에는 아이의 병명이 적혀 있습니다. **화면에서 안 보여주는 것은 예의이지 자물쇠가
-- 아닙니다**(CLAUDE.md 2-8) - 표를 열어두면 주소만 알면 그대로 읽힙니다.
--
-- 교직원은 담임·행정이 함께 봐야 하므로 로그인한 사람으로 잠급니다. 학부모 계정은 이 앱에
-- 없습니다.
alter table public.student_absence_docs enable row level security;

drop policy if exists "absence_docs_read" on public.student_absence_docs;
create policy "absence_docs_read" on public.student_absence_docs
  for select to authenticated using (true);

drop policy if exists "absence_docs_write" on public.student_absence_docs;
create policy "absence_docs_write" on public.student_absence_docs
  for insert to authenticated with check (true);

drop policy if exists "absence_docs_update" on public.student_absence_docs;
create policy "absence_docs_update" on public.student_absence_docs
  for update to authenticated using (true);

drop policy if exists "absence_docs_delete" on public.student_absence_docs;
create policy "absence_docs_delete" on public.student_absence_docs
  for delete to authenticated using (true);

-- ── 저장소 ──────────────────────────────────────────────────────────────────
--
-- **공개 버킷을 쓰지 않습니다.** 진단서가 공개 주소를 가지면 그 주소를 아는 누구나 봅니다.
-- 프로젝트 설정에 따라 마이그레이션에서 저장소를 못 건드릴 수 있어 감쌉니다 - 그런 경우
-- Supabase 대시보드에서 버킷만 만들면 됩니다.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('student-docs', 'student-docs', false)
  on conflict (id) do nothing;
exception when others then
  raise notice 'student-docs 버킷을 만들지 못했습니다(대시보드에서 직접 만들어 주세요): %', sqlerrm;
end $$;

do $$
begin
  execute $p$drop policy if exists "student_docs_read" on storage.objects$p$;
  execute $p$create policy "student_docs_read" on storage.objects
    for select to authenticated using (bucket_id = 'student-docs')$p$;

  execute $p$drop policy if exists "student_docs_write" on storage.objects$p$;
  execute $p$create policy "student_docs_write" on storage.objects
    for insert to authenticated with check (bucket_id = 'student-docs')$p$;

  execute $p$drop policy if exists "student_docs_delete" on storage.objects$p$;
  execute $p$create policy "student_docs_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'student-docs')$p$;
exception when others then
  raise notice '저장소 권한 설정을 건너뜁니다(대시보드에서 설정해 주세요): %', sqlerrm;
end $$;
