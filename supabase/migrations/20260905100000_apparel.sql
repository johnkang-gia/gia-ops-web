-- ===== 의류 — 사이즈는 학생에, 수량은 제작 건에 =====
--
-- 교복이 있고, 행사가 있을 때마다 티셔츠를 만듭니다. 그때마다 **아이들 사이즈를 다시
-- 조사합니다.** 조사한 결과는 그 행사 한 번을 위해 쓰이고 사라지고, 다음 행사에 또
-- 처음부터 조사합니다.
--
-- 그런데 사이즈는 **행사의 성질이 아니라 아이의 성질**입니다. 한 번 적어두면 다음 행사에는
-- 그동안 자란 아이와 새로 온 아이만 물으면 됩니다. 이 표를 나눈 이유가 그것뿐입니다.
--
--   student_apparel_sizes   아이의 사이즈      — 한 번 적으면 계속 씁니다
--   apparel_orders          이번에 만드는 것   — '2026 체육대회 티셔츠', '교복 세트'
--   apparel_order_pieces    그 안의 구성 품목  — 세트면 상의·하의·넥타이, 낱개면 하나
--   apparel_order_items     누가 무엇을 몇 개  — 사이즈는 위에서 자동으로 채워집니다
--
-- 청구는 여기서 하지 않습니다. 돈은 재무 권한을 가진 사람이 인보이스에서 다룹니다 -
-- 청구하는 자리가 둘이 되면 어느 쪽이 진짜인지 아무도 모르게 됩니다.

-- ── ① 아이의 사이즈 ──────────────────────────────────────────────────────
create table if not exists public.student_apparel_sizes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.wr_students(id) on delete cascade,

  -- 무엇의 사이즈인가. '상의' · '하의' · '외투' · '체육복 상의' · '신발'
  -- 목록을 표에 못박지 않습니다 - 학교마다 다르고, 새 종류가 생길 때마다 마이그레이션을
  -- 기다리게 하면 결국 엑셀로 돌아갑니다.
  kind text not null,

  -- **적힌 그대로 둡니다.** 'S' · '110' · '250' · '95(넉넉하게)'
  --
  -- 목록에서 고르게 하면 안 됩니다. 만드는 곳마다 사이즈 체계가 달라서, 이번 티셔츠는
  -- S/M/L 인데 다음 체육복은 100/105/110 입니다. 고르는 목록에 없는 값이 필요한 순간
  -- 사람은 화면 밖(엑셀·쪽지)으로 나가고, 그러면 이 표는 반쪽이 됩니다.
  size text not null,

  -- 언제 잰 것인가. **이것이 이 표의 요점입니다.**
  -- 아이는 자랍니다. 2년 전 사이즈를 그대로 쓰면 안 맞는 옷이 오고, 그 옷은 다시 만들어야
  -- 합니다. 화면은 오래된 것을 색으로 띄워 "다시 물어볼 아이" 를 골라줍니다.
  measured_at date not null default (now() at time zone 'Asia/Seoul')::date,

  note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 한 아이의 한 종류는 하나입니다. 둘이면 어느 쪽으로 만들지 알 수 없습니다.
  unique (student_id, kind)
);

comment on table public.student_apparel_sizes is
  '아이의 옷 사이즈. 행사마다 다시 조사하지 않기 위한 것입니다. measured_at 이 오래되면 화면이 다시 묻자고 띄웁니다.';

create index if not exists student_apparel_sizes_kind_idx on public.student_apparel_sizes (kind);

-- ── ② 이번에 만드는 것 ───────────────────────────────────────────────────
create table if not exists public.apparel_orders (
  id uuid primary key default gen_random_uuid(),

  -- '2026 체육대회 티셔츠', '교복 세트(신입생)'
  name text not null,
  -- '교복' · '행사' · '체육복' · '기타'
  category text not null default '행사',

  term_id uuid references public.terms(id) on delete set null,
  -- 언제까지 걷는가. 지나면 화면에서 흐려집니다.
  due_date date,
  --   준비  : 명단을 짜는 중
  --   진행  : 사이즈를 걷는 중
  --   발주  : 수량을 넘겼음 - 이 뒤로는 고치면 안 됩니다
  --   완료  : 나눠줬음
  status text not null default '준비' check (status in ('준비', '진행', '발주', '완료')),

  note text,
  created_by text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.apparel_orders is
  '한 번의 제작 건. 세트면 구성 품목이 여럿(apparel_order_pieces), 낱개면 하나입니다. 청구는 여기서 하지 않습니다.';

-- ── ③ 세트 구성 ──────────────────────────────────────────────────────────
--
-- 교복은 상의·하의·넥타이가 함께 갑니다. 그런데 **사이즈는 품목마다 따로**입니다 - 상의는
-- M 인데 하의는 L 인 아이가 흔합니다. 그래서 세트를 항목 하나로 두면 사이즈를 하나밖에
-- 못 적고, 품목마다 제작 건을 따로 만들면 같은 명단을 세 번 짜야 합니다.
--
-- 구성 품목을 여기 두면 명단은 한 번, 사이즈는 품목마다입니다.
-- 낱개로 만드는 것(행사 티셔츠)은 품목이 하나뿐인 세트입니다 - 다루는 방식이 같아집니다.
create table if not exists public.apparel_order_pieces (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.apparel_orders(id) on delete cascade,

  -- '상의' · '하의' · '넥타이'
  name text not null,

  -- 어느 사이즈 칸에서 끌어올지(student_apparel_sizes.kind).
  -- 비워두면 이 건에서만 적고 아이에게 남기지 않습니다 - 넥타이처럼 사이즈가 없는 것,
  -- 또는 이번만 쓰는 체계일 때.
  size_kind text,

  -- **고르는 목록이 아니라 거들어주는 보기입니다.** 여기 없는 값도 그대로 적을 수 있습니다.
  -- 사이즈 체계가 만들 때마다 달라서, 목록으로 가두면 필요한 값을 못 적는 순간이 반드시 옵니다.
  size_hints text[] not null default '{}',

  unit_price numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists apparel_order_pieces_order_idx on public.apparel_order_pieces (order_id, sort_order);

comment on column public.apparel_order_pieces.size_hints is
  '거들어주는 보기일 뿐 제한이 아닙니다. 여기 없는 사이즈도 그대로 적을 수 있습니다.';

-- ── ④ 누가 무엇을 몇 개 ──────────────────────────────────────────────────
create table if not exists public.apparel_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.apparel_orders(id) on delete cascade,
  piece_id uuid not null references public.apparel_order_pieces(id) on delete cascade,
  student_id uuid not null references public.wr_students(id) on delete cascade,

  -- 자유 입력. 저장된 사이즈로 채워지고, 다르면 그대로 고쳐 적습니다.
  size text,
  qty integer not null default 1 check (qty >= 1),

  --   대기  : 아직 사이즈를 못 정함
  --   확정  : 사이즈 정함 - 발주 수량에 들어갑니다
  --   제외  : 이 아이는 이 품목을 안 만듭니다(세트 중 하나만 빼는 경우)
  status text not null default '대기' check (status in ('대기', '확정', '제외')),

  note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (piece_id, student_id)
);

create index if not exists apparel_order_items_order_idx on public.apparel_order_items (order_id, status);
create index if not exists apparel_order_items_student_idx on public.apparel_order_items (student_id);

-- ── 사이즈를 정하면 아이에게도 남깁니다 ──────────────────────────────────
--
-- 이 트리거가 이 설계의 핵심입니다. 제작 건에서 사이즈를 적으면 그 값이 **아이의 사이즈로
-- 올라갑니다.** 그래서 다음 행사에는 다시 묻지 않아도 됩니다 - 매번 조사하던 일이 여기서
-- 끊깁니다.
--
-- 품목에 size_kind 가 없으면 올리지 않습니다. 넥타이 길이를 상의 사이즈로 적어두면 다음
-- 티셔츠가 엉뚱하게 나옵니다.
create or replace function public.remember_apparel_size()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  if new.size is null or btrim(new.size) = '' or new.status = '제외' then
    return new;
  end if;
  select size_kind into k from apparel_order_pieces where id = new.piece_id;
  if k is null or btrim(k) = '' then
    return new;
  end if;

  insert into student_apparel_sizes (student_id, kind, size, measured_at, updated_by)
  values (new.student_id, k, btrim(new.size), (now() at time zone 'Asia/Seoul')::date, new.updated_by)
  on conflict (student_id, kind) do update
    set size = excluded.size,
        measured_at = excluded.measured_at,
        updated_by = excluded.updated_by,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists apparel_order_items_remember on public.apparel_order_items;
create trigger apparel_order_items_remember
  after insert or update of size, status on public.apparel_order_items
  for each row execute function public.remember_apparel_size();

comment on function public.remember_apparel_size() is
  '제작 건에서 적은 사이즈를 학생 기록에 남깁니다. 다음 행사에 다시 조사하지 않기 위한 것입니다.';

-- ── 접근 제한 ────────────────────────────────────────────────────────────
-- 사이즈는 담임도 봐야 합니다(체육복을 나눠주는 것은 담임입니다). 고치는 것은 행정실만.
do $$
declare t text;
begin
  foreach t in array array['student_apparel_sizes', 'apparel_orders', 'apparel_order_pieces', 'apparel_order_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (public.is_giamicro_user())', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_wr_manager()) with check (public.is_wr_manager())',
      t || '_write', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['student_apparel_sizes', 'apparel_orders', 'apparel_order_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_touch', t);
  end loop;
end $$;
