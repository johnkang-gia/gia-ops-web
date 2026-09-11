-- 오류를 「해결했다」고 표시하는 자리.
--
-- ── 무엇이 문제였나 ────────────────────────────────────────────────────────
--
-- 오류 화면이 최근 50줄을 그냥 늘어놓았습니다. 한 가지가 고장 나면 같은 줄이 수십 개 쌓여
-- 다른 종류의 오류를 화면 밖으로 밀어내고, 고쳐도 목록은 그대로였습니다. 고쳤는지 안
-- 고쳤는지 화면만 봐서는 알 수 없으니 아무도 그 화면을 안 보게 됩니다.
--
-- ── 왜 「해결됨」 칸을 오류 줄에 달지 않는가 ───────────────────────────────
--
-- 오류 줄은 **일어난 일의 기록**입니다. 고치지도 지우지도 않습니다. 한 번 난 일을 나중에
-- 「해결됨」으로 덧칠하면 그 시각에 무슨 일이 있었는지가 흐려집니다.
--
-- 그리고 해결은 줄 하나가 아니라 **같은 고장 전체**에 대한 판단입니다. 200줄이 같은 고장이면
-- 200줄에 각각 표시하는 것은 뜻이 없습니다. 그래서 고장을 가르는 열쇠(fingerprint = 창구 +
-- 값을 지운 메시지) 하나에 한 줄만 둡니다.
--
-- ── 「해결됐다」의 근거 ────────────────────────────────────────────────────
--
-- 사람이 누른 것은 주장이지 사실이 아닙니다. 사실은 **그 뒤로 다시 안 났는가** 하나뿐입니다.
-- 그래서 여기에는 「언제 해결했다고 했는가」만 적고, 화면이 매번 그 시각 이후의 발생을
-- 견주어 봅니다. 또 났으면 눌렀든 말든 다시 미해결로 올라옵니다.

create table if not exists public.error_resolutions (
  -- 창구 + 값을 지운 메시지. 계산은 src/lib/errorGroup.ts 한 곳에서만 합니다.
  fingerprint text primary key,

  -- 사람이 읽기 위한 값입니다. fingerprint 만 남으면 나중에 이 줄이 무엇이었는지 못 읽습니다.
  route text,
  sample_message text,

  resolved_at timestamptz not null default now(),
  resolved_by text,
  -- 무엇을 고쳤는지. 적어두지 않으면 다시 났을 때 지난번에 무엇을 했는지 아무도 모릅니다.
  note text,
  created_at timestamptz not null default now()
);

comment on table public.error_resolutions is
  '오류 묶음을 해결했다고 표시한 기록. 실제 해결 여부는 이 시각 이후 재발로 판단합니다.';

alter table public.error_resolutions enable row level security;

-- 오류 화면은 개발자 전용이지만, 자물쇠는 화면과 별개입니다(CLAUDE.md 2-8).
-- 관리자 판정 함수 하나만 봅니다 - 기준이 두 곳에 있으면 반드시 어긋납니다.
drop policy if exists "admin_read_error_resolutions" on public.error_resolutions;
create policy "admin_read_error_resolutions" on public.error_resolutions
  for select using (public.is_app_admin());

drop policy if exists "admin_write_error_resolutions" on public.error_resolutions;
create policy "admin_write_error_resolutions" on public.error_resolutions
  for insert with check (public.is_app_admin());

drop policy if exists "admin_update_error_resolutions" on public.error_resolutions;
create policy "admin_update_error_resolutions" on public.error_resolutions
  for update using (public.is_app_admin()) with check (public.is_app_admin());

-- 지우기 정책은 일부러 두지 않습니다. 「해결 취소」는 지우는 것이 아니라 **다시 나는 것**
-- 으로 저절로 됩니다.
