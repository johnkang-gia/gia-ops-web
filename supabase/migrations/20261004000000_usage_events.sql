-- **누가 언제 어느 화면을 보고 무엇을 했는가.**
--
-- ── 왜 만드나 ─────────────────────────────────────────────────────────────
--
-- 화면이 백 개 가까이 됩니다. 그런데 **어떤 화면이 실제로 쓰이는지 아무도 모릅니다.**
-- 만든 사람은 다 쓰인다고 생각하고, 안 쓰이는 화면은 조용히 남아 메뉴를 늘리고 다음
-- 사람의 눈을 가립니다. 반대로 하루에 스무 번 열리는 화면이 여전히 불편한 채로 있는데
-- 그것도 숫자가 없으면 모릅니다.
--
-- 안 쓰이는 화면을 지우려면 «안 쓰인다»를 보여줄 수 있어야 하고, 고칠 화면을 고르려면
-- «여기가 제일 많이 열린다»를 보여줄 수 있어야 합니다.
--
-- ── 무엇을 담고 무엇을 안 담나 ─────────────────────────────────────────────
--
-- 담습니다: 누가(이메일) · 언제 · 어느 주소 · 얼마나 머물렀나 · 무슨 동작을 했나.
-- **안 담습니다: 화면에 무엇이 떠 있었는지, 무엇을 입력했는지.** 학생·학부모 내용이
-- 이 표로 흘러들면 이 표가 곧 두 번째 명부가 됩니다. 주소에 학생 번호가 붙는 화면은
-- 보내는 쪽에서 번호를 지우고 보냅니다(`usageTrack.ts`).
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  -- 누가. 계정이 지워져도 기록은 남아야 하므로 참조가 아니라 글자로 둡니다.
  user_email text not null,
  user_name text,
  -- 직위(교사·행정직원·관리자·최고관리자). 계정 직위가 나중에 바뀌어도 그때 그 사람이
  -- 어떤 자리에서 썼는지 알아야 하므로, 참조가 아니라 그 순간의 값을 굳힙니다.
  position text,
  -- 한 번 앱을 연 단위. 같은 사람이 하루에 세 번 열면 셋으로 셉니다.
  session_id text not null,
  -- 'view'(화면을 봤다) · 'action'(무엇을 눌렀다)
  kind text not null default 'view',
  -- 주소. 학생 번호 같은 것은 보내는 쪽에서 지웁니다.
  path text not null,
  -- 사람이 읽는 화면 이름('하원 체크표'). 주소만 남기면 나중에 아무도 못 읽습니다.
  label text,
  -- 'action' 일 때 무엇을 했는지 한 마디.
  action text,
  -- 그 화면에 머문 시간(밀리초). 화면을 떠날 때 채웁니다.
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- 「누가 언제」와 「어느 화면이 얼마나」 둘 다 자주 묻습니다.
create index if not exists usage_events_time_idx on public.usage_events (created_at desc);
create index if not exists usage_events_user_idx on public.usage_events (user_email, created_at desc);
create index if not exists usage_events_path_idx on public.usage_events (path, created_at desc);

alter table public.usage_events enable row level security;

-- **읽기는 최고관리자·개발자만.** 누가 무엇을 얼마나 봤는지는 사람에 대한 기록이라,
-- 화면에서 가리는 것으로는 부족합니다(CLAUDE.md §2-8). 주소만 알면 읽히는 표를
-- 「관리자만 보는 화면」에 띄우는 것은 자물쇠가 아니라 예의일 뿐입니다.
drop policy if exists usage_events_read on public.usage_events;
create policy usage_events_read on public.usage_events
  for select to authenticated
  using (
    exists (
      select 1 from public.app_users u
      where lower(u.email) = lower(auth.jwt() ->> 'email')
        and (u.position = '최고관리자' or lower(u.email) = 'johnkang@giamicro.com')
    )
  );

-- **쓰기는 아무도 못 합니다(브라우저에서는).** 기록은 서버 라우트가 서비스 키로 넣습니다.
-- 브라우저에 쓰기를 열어 두면 남의 이메일로 아무 기록이나 넣을 수 있고, 그러면 이 표의
-- 숫자를 아무도 못 믿습니다.

comment on table public.usage_events is
  '교직원 이용 기록(화면 열람·동작). 내용물은 담지 않습니다 — 누가·언제·어디를·얼마나.';
