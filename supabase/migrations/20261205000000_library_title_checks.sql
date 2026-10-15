-- ===== 제목 다시 채우기 기록 =====
--
-- 요청: "책 제목을 다시 한번 ISBN 검색을 해서 다시 수정할 수 있는 메뉴를 만들어줘. 내가 카카오톡
-- API 등록 전에 안 나와서 그냥 제목을 내 맘대로 쓴 것도 있거든. 그런 것들도 한번에 전부 검사해서
-- 다시 책 제목을 채워 넣을 수 있는 메뉴를 만들어줘."
--
-- ── 왜 표가 필요한가 ──────────────────────────────────────────────────────
-- 조회할 책이 1,100종이고 한 종마다 바깥 조회처 네 곳에 물어야 합니다. 한 종에 1~7초이니
-- 전부 돌리면 몇 분이 걸립니다. 그 사이에 창을 닫거나 인터넷이 끊기면 처음부터 다시 해야
-- 하는데, **바깥 조회처에 같은 것을 두 번 묻는 것은 그쪽에도 실례**입니다.
--
-- 그래서 조회한 것을 적어 둡니다. 다시 눌러도 **안 본 것부터** 이어서 합니다.
--
-- ── 되돌릴 수 있어야 합니다 ───────────────────────────────────────────────
-- 바꾸기 전 제목(old_title)을 함께 적습니다. 1,100종의 제목을 한꺼번에 바꾸는 일이라,
-- "아까 것이 나았다"는 말이 나왔을 때 돌아갈 자리가 없으면 안 됩니다.
--
-- ── 고르는 규칙은 여기 없습니다 ───────────────────────────────────────────
-- 어느 제목을 쓸지는 앱(src/lib/titlePick.ts)이 정하고 검사가 붙어 있습니다. 이 표는
-- **무엇을 물었고 무엇이 돌아왔는지**만 적습니다. 규칙이 바뀌면 적어 둔 후보로 다시 고를 수
-- 있어야 하므로 후보 전체(candidates)를 그대로 남깁니다.

create table if not exists public.lib_title_checks (
  /** 한 책에 한 줄. 다시 조회하면 덮어씁니다. */
  book_id uuid primary key references public.lib_books(id) on delete cascade,
  isbn text,
  /** 조회한 시점의 제목. 되돌릴 때 이 값으로 돌아갑니다. */
  old_title text,
  /** 쓰자고 제안된 제목. 바꿀 것이 없으면 비어 있습니다. */
  found_title text,
  found_source text,
  /**
   * same  — 조회 결과와 같음(할 일 없음)
   * more  — 지금 제목을 품은 더 자세한 제목이 있음(묶어서 적용해도 안전)
   * diff  — 지금 제목과 겹치지 않음(사람이 봐야 함)
   * none  — 조회처가 못 찾았거나 세트 이름뿐
   */
  kind text not null default 'none',
  why text,
  /** 조회처들이 준 답 전부. [{"title":…,"source":…,"author":…,"publisher":…}] */
  candidates jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  checked_by text,
  /** 실제로 바꾼 시각·바꾼 제목. 비어 있으면 아직 안 바꾼 것입니다. */
  applied_at timestamptz,
  applied_title text
);

comment on table public.lib_title_checks is
  'ISBN 으로 제목을 다시 조회한 기록. 1,100종을 몇 분에 걸쳐 나눠 조회하므로 이어서 하기 위한 자리이고, 바꾸기 전 제목을 남겨 되돌릴 수 있게 합니다.';

-- 아직 사람이 봐야 하는 줄만 빨리 세기 위한 색인(화면이 맨 먼저 하는 일입니다).
create index if not exists lib_title_checks_kind_idx on public.lib_title_checks (kind, applied_at);

alter table public.lib_title_checks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'lib_title_checks' and policyname = 'lib_title_checks_rw') then
    create policy lib_title_checks_rw on public.lib_title_checks
      for all using (public.is_lib_user()) with check (public.is_lib_user());
  end if;
end $$;

notify pgrst, 'reload schema';
