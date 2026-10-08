-- ===== 인쇄 기록 =====
--
-- 요청: "바코드 노트북에서 바로 뽑을려고 했는데 도저히 안되서 다른 곳에서 뽑으려고 하거든.
-- 기록 저장해서 다른 컴퓨터에서도 도서관앱 들어가서 기록으로 눌러서 뽑을 수 있게".
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────
-- 지금은 "무엇을 뽑을지"가 **주소창에만** 있습니다. 장서 관리에서 책 마흔 권을 골라 라벨
-- 인쇄를 누르면 /print/labels?ids=...(uuid 마흔 개) 로 열립니다. 그 화면을 닫거나, 프린터가
-- 안 잡혀서 다른 컴퓨터로 옮기려 하면 **고른 목록이 통째로 사라집니다.** 다시 처음부터
-- 마흔 권을 골라야 합니다. 책을 한 칸씩 빼서 정리하는 중이라면 어디까지 했는지도 잃습니다.
--
-- ── 무엇을 저장하는가 ───────────────────────────────────────────────────
-- 종이 자체가 아니라 **"무엇을 어떤 설정으로 뽑으려 했는지"** 만 저장합니다. 그러면 다른
-- 컴퓨터에서 로그인해 기록을 누르는 것만으로 같은 화면이 그대로 열립니다.
--   · targets  - 라벨이면 책 id, 도서카드면 학생 고유번호
--   · options  - 도서카드의 사진 포함 여부·용지·접이식 같은 선택들(라벨은 비어 있습니다)
--
-- 주소에 uuid 수십 개를 싣지 않아도 되는 건 덤입니다. 긴 주소는 메신저로 옮기다 잘리고,
-- 서버마다 받아주는 길이도 달라서 어느 날 조용히 실패합니다.
--
-- ── 같은 목록을 또 열면 ─────────────────────────────────────────────────
-- 기록이 한 줄씩 쌓이면 금세 쓸모없어집니다(프린터가 안 잡혀 다섯 번 열면 다섯 줄). 그래서
-- 목록의 '지문'(signature)이 같으면 새로 만들지 않고 연 시각만 갱신합니다.

create table if not exists public.lib_print_jobs (
  id uuid primary key default gen_random_uuid(),
  -- 무엇을 뽑는 기록인지. labels = 책 바코드 라벨, cards = 학생 도서카드.
  kind text not null check (kind in ('labels', 'cards')),
  -- 목록에 보일 이름. 자동으로 지어 두고 사람이 고칠 수 있습니다.
  title text not null,
  -- 뽑을 대상들(라벨이면 책 id, 도서카드면 학생 고유번호).
  targets text[] not null,
  -- 인쇄 화면의 선택들(용지·크기·사진 포함 여부 등).
  options jsonb not null default '{}'::jsonb,
  -- 같은 목록을 또 열었는지 보는 지문.
  signature text not null,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  -- 마지막으로 이 기록을 연 시각(목록을 최근 순으로 보여 주는 데 씁니다).
  opened_at timestamptz not null default now(),
  -- 사람이 "뽑았다"고 표시한 시각. 아직 못 뽑은 것과 구별하려고 둡니다.
  printed_at timestamptz
);

comment on table public.lib_print_jobs is
  '인쇄할 목록을 저장해 둔 기록. 프린터가 없는 자리에서 고르고, 프린터가 있는 컴퓨터에서 로그인해 그대로 뽑기 위한 것입니다.';

-- 같은 목록을 또 열면 줄을 늘리지 않고 그 줄을 갱신합니다.
create unique index if not exists lib_print_jobs_signature_idx
  on public.lib_print_jobs (kind, signature);
create index if not exists lib_print_jobs_opened_idx
  on public.lib_print_jobs (opened_at desc);

alter table public.lib_print_jobs enable row level security;

drop policy if exists lib_all_print_jobs on public.lib_print_jobs;
create policy lib_all_print_jobs on public.lib_print_jobs
  for all using (public.is_lib_user()) with check (public.is_lib_user());

notify pgrst, 'reload schema';
