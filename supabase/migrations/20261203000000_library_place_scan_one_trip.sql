-- ===== 자리 등록을 한 번의 왕복으로 =====
--
-- 요청: "또 느려졌어. 바코드 읽는 속도랑 반응이 느려졌어 이것부터 고쳐줘."
--
-- ── 재어 본 결과 ──────────────────────────────────────────────────────────
-- 느린 곳은 SQL이 아니었습니다. **왕복 횟수**였습니다.
--
-- Supabase 로 한 번 다녀오는 데 드는 고정 비용을 재어 보면(x-envoy-upstream-service-time):
--
--     질의                          걸린 시간
--     ────────────────────────────  ─────────
--     아무 질의도 없는 요청          30~40ms
--     lib_locations 1줄             30~38ms
--     isbn 로 lib_books (인덱스)     32~34ms
--     title 로 lib_books (전수)      31~40ms
--     lib_shelf_check 652줄 전체     35~41ms
--
-- 무엇을 묻든 **같습니다.** 질의 자체는 1ms 도 안 걸리고, 30~40ms 는 요청 한 번을 처리하는
-- 데 드는 고정 비용입니다. 여기에 Vercel↔Supabase 망 왕복이 붙어 한 번이 55~90ms 가 됩니다.
--
-- 그런데 책 한 권을 찍으면 예전 코드는 이렇게 다녀왔습니다:
--
--     ① 로그인 확인 ∥ 이 칸 읽기    ② isbn 으로 책 찾기    ③ 이 책의 자리 기록 전부
--     ④ 기록 쓰기                   ⑤ 같은 제목·시리즈      ⑥ 그 책들의 자리 기록
--
-- 다섯~여섯 번. 55~90ms × 5 = **300~500ms.** 실제로 재어 보니 없는 ISBN 하나를 찍는 것만으로도
-- 250~330ms 가 나왔습니다(③④⑤⑥ 없이 ①②만 한 경우입니다).
--
-- 기능을 하나씩 더할 때마다 왕복이 한 번씩 늘었고, 그래서 "또 느려졌다"가 반복됐습니다.
-- 질의를 더 빠르게 만들어도 소용이 없습니다 - 질의는 이미 1ms 입니다.
--
-- ── 그래서 읽는 것을 전부 한 번에 ─────────────────────────────────────────
-- 이 함수는 ①②③⑤⑥ 을 **한 번의 왕복**으로 끝냅니다. 안에서는 질의 여섯 개가 돌지만 전부
-- 데이터베이스 안에서 도므로 합쳐 2~3ms 입니다. 남는 왕복은 '기록 쓰기' 하나뿐입니다.
--
--     전:  55~90ms × 5~6 = 300~500ms
--     후:  55~90ms × 2    = 110~180ms
--
-- ── 판단은 여기서 하지 않습니다 ───────────────────────────────────────────
-- 이 함수는 **아무것도 고르지 않고 아무것도 쓰지 않습니다**(stable). 묻느냐 세느냐, 권수를
-- 올리느냐는 전부 앱(shelfCount.ts)에 그대로 남아 있습니다 - 그 규칙에는 검사가 붙어 있고,
-- 같은 규칙을 SQL 로 한 번 더 적으면 언젠가 두 쪽이 서로 다른 말을 하게 됩니다.
-- 여기서 하는 일은 "앱이 보던 자료를 똑같이, 한 번에 모아 주기"뿐입니다.
--
-- ── ISBN 변형도 앱에서 계산합니다 ─────────────────────────────────────────
-- 10자리↔13자리 바꿈(isbnVariants)은 검사가 붙은 앱 함수에 있습니다. SQL 로 옮겨 적지 않고
-- 계산된 결과를 p_isbns 로 받습니다. 체크숫자 계산을 두 군데 두지 않기 위한 것입니다.

-- title 로 바로 찾는 길. 기존 인덱스는 lower(title) 이라서 `title = ?` 에는 쓰이지 않습니다.
-- 지금은 1151종이라 전수로 훑어도 몇 ms 이지만, 장서가 늘면 이 함수 안에서 가장 먼저 비싸질
-- 질의가 이것입니다.
create index if not exists lib_books_title_exact_idx on public.lib_books (title);

create or replace function public.lib_place_lookup(
  /** 지금 찍고 있는 칸. */
  p_location_id uuid,
  /** 찍힌 값(다듬은 뒤). 자체 번호(GIA-B-…)·상품코드로 찾을 때 씁니다. */
  p_code text default null,
  /** 사람이 이미 줄을 골랐을 때(등급 고르기 등). 주면 찾기를 건너뜁니다. */
  p_book_id uuid default null,
  /** 같은 책을 가리키는 ISBN 들(10자리·13자리). 앱의 isbnVariants 결과. */
  p_isbns text[] default '{}',
  /** 옛 번호(lib_book_aliases)로 찾을 때 쓸 번호들. */
  p_alias_codes text[] default '{}',
  /** 찍힌 값이 ISBN 모양인지(앱의 isIsbn). */
  p_is_isbn boolean default false,
  /** 찍힌 값이 도서관 라벨 번호 모양인지(앱의 isItemCode, GIA-B-…). */
  p_is_item_code boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_book_id   uuid;
  v_title     text;
  v_series    text;
  v_same_isbn jsonb := '[]'::jsonb;
  v_book      jsonb;
  v_rel_ids   uuid[];
  v_titles    bigint := 0;
  v_copies    bigint := 0;
begin
  -- ── 어느 줄의 책인지 ───────────────────────────────────────────────────
  -- 순서는 앱의 findBooksByIsbn → findBook 과 **똑같습니다.** 지금 쓰는 번호가 언제나 먼저,
  -- 옛 번호(alias)는 맨 끝입니다. 순서를 바꾸면 합치면서 사라진 번호가 현재 번호를 이깁니다.
  if p_book_id is not null then
    v_book_id := p_book_id;
  else
    if p_is_isbn and coalesce(array_length(p_isbns, 1), 0) > 0 then
      -- 같은 ISBN 이 등급별로 여러 줄일 수 있습니다. 여럿이면 앱이 사람에게 고르게 합니다.
      select coalesce(jsonb_agg(t.x order by t.lvl asc nulls first, t.id), '[]'::jsonb)
        into v_same_isbn
      from (
        select b.id,
               b.label_level as lvl,
               to_jsonb(b) || jsonb_build_object(
                 'shelf', (select to_jsonb(l) from lib_locations l where l.id = b.location_id)
               ) as x
        from lib_books b
        where b.isbn = any(p_isbns)
        order by b.label_level asc nulls first, b.id
        limit 20
      ) t;
      if jsonb_array_length(v_same_isbn) > 0 then
        v_book_id := (v_same_isbn -> 0 ->> 'id')::uuid;
      end if;
    end if;

    if v_book_id is null then
      if p_is_item_code then
        select b.id into v_book_id from lib_books b where b.item_code = p_code limit 1;
      else
        if coalesce(array_length(p_isbns, 1), 0) > 0 then
          select b.id into v_book_id from lib_books b where b.isbn = any(p_isbns) limit 1;
        end if;
        if v_book_id is null and p_code is not null then
          select b.id into v_book_id from lib_books b where b.item_code = p_code limit 1;
        end if;
      end if;
      -- 옛 번호. 합치면서 주인을 잃은 라벨이 아직 책에 붙어 있습니다.
      if v_book_id is null and coalesce(array_length(p_alias_codes, 1), 0) > 0 then
        select a.book_id into v_book_id
        from lib_book_aliases a
        where a.code = any(p_alias_codes)
        limit 1;
      end if;
    end if;
  end if;

  if v_book_id is not null then
    select to_jsonb(b) || jsonb_build_object(
             'shelf', (select to_jsonb(l) from lib_locations l where l.id = b.location_id)
           ),
           b.title,
           b.series
      into v_book, v_title, v_series
    from lib_books b
    where b.id = v_book_id;
    -- 골라 준 id 가 없는 책일 수 있습니다(지워진 뒤 화면이 남아 있는 경우).
    if v_book is null then
      v_book_id := null;
    end if;
  end if;

  -- 같은 제목 · 같은 시리즈. 손에 책을 들고 있는 지금이 제자리로 보낼 수 있는 유일한 순간이라
  -- 앱이 매번 함께 보여 줍니다. 그래서 여기서 같이 모아 둡니다.
  if v_book_id is not null then
    select array_agg(id) into v_rel_ids
    from (
      (select b.id from lib_books b where b.title = v_title and b.id <> v_book_id limit 40)
      union
      (select b.id from lib_books b
        where v_series is not null and b.series = v_series and b.id <> v_book_id limit 40)
    ) r;
  end if;

  -- 이 칸에 지금까지 몇 종 · 몇 권이 세어져 있는지. 찍은 뒤 화면 숫자를 맞추려고 예전에는
  -- 화면 전체를 서버에서 다시 그렸습니다(190ms). 그 숫자 하나면 되는 일이었습니다.
  select count(*), coalesce(sum(c.copies), 0)
    into v_titles, v_copies
  from lib_shelf_check c
  where c.location_id = p_location_id;

  return jsonb_build_object(
    'location', (select to_jsonb(l) from lib_locations l where l.id = p_location_id),
    'book', v_book,
    'same_isbn', v_same_isbn,
    -- 이 책의 자리 기록 전부. 이 칸에 있나 / 다른 칸에 몇 권인가 / 원래 칸이 어디인가가
    -- 모두 이 한 덩이에서 나옵니다.
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'book_id', c.book_id, 'location_id', c.location_id, 'copies', c.copies,
               'location', case when l.id is null then null
                           else jsonb_build_object('code', l.code, 'sort_order', l.sort_order) end
             ) order by l.sort_order asc nulls last, c.id)
      from lib_shelf_check c
      left join lib_locations l on l.id = c.location_id
      where c.book_id = v_book_id
    ), '[]'::jsonb),
    'rel_books', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'title', b.title, 'series', b.series,
               'label_level', b.label_level, 'total_copies', b.total_copies
             ) order by b.id)
      from lib_books b where b.id = any(coalesce(v_rel_ids, '{}'::uuid[]))
    ), '[]'::jsonb),
    'rel_checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'book_id', c.book_id, 'copies', c.copies, 'location_id', c.location_id,
               'location', case when l.id is null then null
                           else jsonb_build_object('code', l.code, 'sort_order', l.sort_order) end
             ) order by l.sort_order asc nulls last, c.id)
      from lib_shelf_check c
      left join lib_locations l on l.id = c.location_id
      where c.book_id = any(coalesce(v_rel_ids, '{}'::uuid[]))
    ), '[]'::jsonb),
    'shelf_titles', v_titles,
    'shelf_copies', v_copies
  );
end;
$$;

comment on function public.lib_place_lookup(uuid, text, uuid, text[], text[], boolean, boolean) is
  '자리 등록 화면이 한 권을 찍을 때 필요한 읽기를 한 번의 왕복으로 모아 돌려줍니다. 아무것도 쓰지 않고 아무것도 판단하지 않습니다 - 묻느냐 세느냐는 앱(shelfCount.ts)에 그대로 있습니다.';

-- security invoker 이므로 RLS 가 그대로 걸립니다. 도서관 계정이 아니면 안의 질의들이
-- 아무것도 못 보고, 책도 칸도 null 로 나옵니다 - 예전과 같은 결과입니다.
grant execute on function public.lib_place_lookup(uuid, text, uuid, text[], text[], boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
