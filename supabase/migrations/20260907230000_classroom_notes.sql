-- ===== 교실 → 행정실 (특이사항 · 문의) =====
--
-- 호출은 행정실에서 교실로 가는 한 방향이었습니다. 그런데 실제로 더 자주 생기는 것은
-- 반대 방향입니다 — 다쳤다, 다퉜다, 토했다, 프린터가 안 된다, 이 아이 오늘 어떻게 하나요.
-- 지금은 이것이 선생님 기억에 담겼다가 쉬는 시간에 구두로 전해집니다. 그 사이에 잊히거나,
-- 전했는데 행정실이 못 들은 채로 지나갑니다.
--
-- **양쪽 다 «받았다»가 보여야 합니다.** 보냈다는 사실만으로는 아무것도 보장되지 않습니다.
--   · 교실 → 행정실 : 행정실이 읽으면 교실 화면에 «읽음 15:32» 가 뜹니다
--   · 행정실 → 교실 : 선생님이 확인을 누르면 행정실 화면에서 사라집니다(classroom_calls)
--
-- 한쪽만 있으면 «보냈는데 왜 답이 없지»가 반복됩니다.

create table if not exists public.classroom_notes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.wr_classes(id) on delete cascade,
  -- 특이사항: 아이에게 생긴 일(행정실이 알아야 하는 것) / 문의: 답이 필요한 것
  kind text not null default '특이사항' check (kind in ('특이사항', '문의')),
  -- 누구에 대한 것인가. 반 전체 이야기면 비어 있습니다.
  student_name text,
  student_id uuid references public.wr_students(id) on delete set null,
  body text not null,
  -- 급한 것은 화면에서 빨갛게 뜨고 맨 위로 갑니다. 기본은 보통 - 전부 급함이면 급한 것이
  -- 급해 보이지 않습니다.
  urgency text not null default '보통' check (urgency in ('보통', '급함')),
  created_at timestamptz not null default now(),

  -- 행정실이 읽은 시각. **이 값이 교실 화면에 그대로 보입니다.**
  read_at timestamptz,
  read_by text,
  -- 짧은 답. 벽에 걸린 화면에서 길게 치기 어려워 버튼 몇 개로 답합니다.
  reply text,
  replied_at timestamptz,
  -- 처리 끝. 목록에서 내려갑니다.
  done_at timestamptz,
  done_by text
);

-- 아직 안 읽은 것부터. 행정실 화면이 이 순서로만 읽습니다.
create index if not exists classroom_notes_unread_idx
  on public.classroom_notes (created_at desc)
  where read_at is null and done_at is null;
create index if not exists classroom_notes_class_idx on public.classroom_notes (class_id, created_at desc);

comment on table public.classroom_notes is
  '교실 → 행정실. read_at 이 차면 행정실이 읽은 것이고, 그 시각이 교실 화면에 그대로 보입니다.';

alter table public.classroom_notes enable row level security;
drop policy if exists classroom_notes_staff on public.classroom_notes;
create policy classroom_notes_staff on public.classroom_notes
  for all using (public.is_giamicro_user()) with check (public.is_giamicro_user());

-- 교실 태블릿은 로그인이 없어 이 정책을 통과하지 못합니다. 서버가 토큰으로 확인한 뒤
-- 그 반 것만 읽고 씁니다.

-- ── 짧은 주소를 반 이름으로 ────────────────────────────────────────────────
--
-- 임의의 네 글자(k3xm)는 사람이 «몇 반 주소였더라»를 알 수 없습니다. 태블릿을 옮기거나
-- 다시 설정할 때마다 목록을 열어 대조해야 하는데, 그 한 번이 곧 안 하게 되는 이유가 됩니다.
-- 반 이름을 그대로 씁니다: g2c, g3ju.
--
-- 겹치면(반 이름이 같은 두 반) 뒤에 숫자를 붙입니다. 겹치는 것을 조용히 덮어쓰면 두 반이
-- 같은 화면을 보게 되고, 호출이 엉뚱한 교실에 뜹니다.
do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in
    select l.id, c.grade, c.class_name
      from public.classroom_links l
      join public.wr_classes c on c.id = l.class_id
  loop
    base := lower(regexp_replace(coalesce(r.class_name, ''), '[^A-Za-z0-9가-힣]', '', 'g'));
    if base = '' then
      base := 'g' || lower(regexp_replace(coalesce(r.grade, 'x'), '[^A-Za-z0-9]', '', 'g'));
    end if;
    candidate := base;
    n := 1;
    while exists (select 1 from public.classroom_links where short_code = candidate and id <> r.id) loop
      n := n + 1;
      candidate := base || n::text;
    end loop;
    update public.classroom_links set short_code = candidate where id = r.id;
  end loop;
end $$;
