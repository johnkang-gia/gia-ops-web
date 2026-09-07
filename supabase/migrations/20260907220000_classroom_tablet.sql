-- ===== 교실 태블릿 =====
--
-- 지금까지 사실은 **교실에서** 생기고 입력은 **행정실에서** 했습니다. 결석·다툼·픽업 같은
-- 것이 선생님 기억이나 쪽지를 거쳐 오는 동안 잃어버리는 것이 많았습니다. 반마다 태블릿을
-- 두어 입력 창구를 사실이 생기는 자리로 옮깁니다.
--
-- 태블릿은 학교 계정으로 로그인하지 않습니다. 반마다 다른 와이파이·다른 기기라 로그인
-- 관리가 곧 부담이 되고, 로그인이 풀린 태블릿은 조용히 아무 일도 안 하게 됩니다.
-- 안내보드·도착체크와 같은 방식으로 **반별 토큰 링크** 하나만 띄워둡니다.

-- ── 반별 링크 ──────────────────────────────────────────────────────────────
create table if not exists public.classroom_links (
  id uuid primary key default gen_random_uuid(),
  -- 한 반에 하나. 두 개면 어느 화면이 진짜인지 알 수 없고, 호출이 한쪽에만 뜹니다.
  class_id uuid not null unique references public.wr_classes(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  -- 공용 태블릿 주소창에 손으로 칠 수 있는 짧은 코드. 헷갈리는 글자(0/O, 1/l)는 뺍니다.
  short_code text unique,
  label text,
  enabled boolean not null default true,
  -- 태블릿이 마지막으로 화면을 불러온 시각. 이게 오래되면 그 교실 화면은 꺼져 있거나
  -- 와이파이가 끊긴 것입니다. 호출을 보냈는데 아무도 못 보는 상태를 알아채는 유일한 단서입니다.
  last_seen_at timestamptz,
  -- 차량 도착을 GPS로 잡아 교실에 자동으로 알릴지.
  --
  -- **기본은 꺼둡니다.** 아직 모든 차량에 기기를 단 것이 아니라, 켜두면 기기가 없는 노선은
  -- 영영 신호가 안 옵니다. 그러면 «신호가 없다 = 아직 안 왔다»로 읽히는데 사실은 «모른다»입니다.
  -- 기기를 다 등록한 뒤 반별로 켭니다.
  dismissal_auto boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.classroom_links is
  '교실 태블릿용 반별 토큰 링크. 로그인 없이 이 주소 하나로 그 반 화면이 열립니다.';

alter table public.classroom_links enable row level security;
drop policy if exists classroom_links_staff on public.classroom_links;
create policy classroom_links_staff on public.classroom_links
  for all using (public.is_giamicro_user()) with check (public.is_giamicro_user());

-- ── 교실 호출 ──────────────────────────────────────────────────────────────
--
-- 행정실이 누르면 그 반 화면이 바뀌고 소리가 납니다.
--
-- 중요한 것은 **확인(acked_at)** 입니다. 이게 없으면 «보냈다»는 알아도 «받았다»는 모릅니다.
-- 이 저장소에서 반복해서 나온 형태라, 처음부터 넣습니다.
create table if not exists public.classroom_calls (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.wr_classes(id) on delete cascade,
  -- 픽업: 학부모가 오셨다 / 호출: 그 밖의 용무 / 하원: 차량 도착(지금은 사람이 누를 때만)
  kind text not null default '호출' check (kind in ('픽업', '호출', '하원')),
  -- 누구를. 픽업이면 반드시 있습니다 - 이름 없이 «데리러 오세요»는 아무 뜻이 없습니다.
  student_name text,
  student_id uuid references public.wr_students(id) on delete set null,
  -- 왜. 자주 쓰는 몇 가지는 버튼으로, 나머지는 손으로 적습니다.
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  -- 교실에서 확인을 누른 시각·사람.
  acked_at timestamptz,
  acked_by text,
  -- 잘못 눌렀을 때. 지우지 않고 취소로 남깁니다 - 지우면 «누가 왜 취소했나»가 사라집니다.
  canceled_at timestamptz
);

create index if not exists classroom_calls_live_idx
  on public.classroom_calls (class_id, created_at desc)
  where acked_at is null and canceled_at is null;
create index if not exists classroom_calls_day_idx on public.classroom_calls (created_at desc);

comment on table public.classroom_calls is
  '행정실 → 교실 호출. acked_at 이 차면 교실에서 확인한 것입니다(보냈다와 받았다는 다릅니다).';

alter table public.classroom_calls enable row level security;
drop policy if exists classroom_calls_staff on public.classroom_calls;
create policy classroom_calls_staff on public.classroom_calls
  for all using (public.is_giamicro_user()) with check (public.is_giamicro_user());

-- 태블릿은 로그인이 없어서 위 정책을 통과하지 못합니다. 화면은 서버(service role)를 거쳐
-- 토큰으로만 읽고 씁니다 - 표를 직접 열어주지 않습니다.

-- ── 출결 출처에 «교실» 추가 ────────────────────────────────────────────────
--
-- 교실 태블릿에서 찍은 줄은 담임이 찍은 것이지만, **어디서 찍었는지**는 다릅니다.
-- 시범 기간에 «교실에서 실제로 찍고 있는가»를 확인할 유일한 방법이라 따로 남깁니다.
alter table public.attendance_records drop constraint if exists attendance_records_source_ck;
alter table public.attendance_records
  add constraint attendance_records_source_ck
  check (source in ('담임', '행정', '토들', '구글챗', '교실'));
