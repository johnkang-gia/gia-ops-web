-- ===== 새로고침 안내를 «배포할 때마다»가 아니라 «알릴 때만» =====
--
-- 지금은 서버 버전이 화면 버전보다 높기만 하면 노란 띠가 뜹니다. 그런데 배포가 하루에도
-- 여러 번 나가는 날이 있어서, 일하는 중에 계속 「새로고침하세요」가 떴습니다.
--
-- 안내가 잦으면 사람은 그것을 **읽지 않게 됩니다.** 그러면 정작 꼭 새로고침해야 하는 배포
-- (자료가 바뀌었거나 화면이 크게 달라진 경우)에도 아무도 안 누릅니다. 안내를 없앤 것과
-- 같아집니다.
--
-- 그래서 판단을 기계에서 사람으로 옮깁니다. **개발자가 알릴 때만** 띠가 뜹니다.
-- 이 표에 한 줄이 들어가면 그 버전보다 낮은 화면에만 안내가 뜹니다.

create table if not exists public.version_broadcasts (
  id uuid primary key default gen_random_uuid(),
  -- 이 버전 미만인 화면에 안내를 띄웁니다.
  version text not null,
  -- 왜 새로고침해야 하는지. 「그냥 눌러라」보다 「출석부 계산이 바뀌었습니다」가 눌리게 합니다.
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists version_broadcasts_recent_idx
  on public.version_broadcasts (created_at desc);

alter table public.version_broadcasts enable row level security;

-- 읽기는 누구나. 버전 숫자는 비밀이 아니고, 로그인 화면에 머문 사람도 낡은 코드를 쓰고
-- 있을 수 있습니다. 쓰기는 관리자만 - 아무나 전 직원 화면에 띠를 띄울 수 있으면 안 됩니다.
drop policy if exists version_broadcasts_read on public.version_broadcasts;
create policy version_broadcasts_read on public.version_broadcasts for select using (true);

drop policy if exists version_broadcasts_write on public.version_broadcasts;
create policy version_broadcasts_write on public.version_broadcasts
  for insert with check (public.is_app_admin());

comment on table public.version_broadcasts is
  '새로고침 안내를 띄운 기록. 배포할 때마다가 아니라 개발자가 확성기를 눌렀을 때만 한 줄이 생깁니다.';
