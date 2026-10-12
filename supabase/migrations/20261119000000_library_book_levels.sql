-- ─────────────────────────────────────────────────────────────────────────────
-- 같은 책을 등급별로 나눠 등록할 수 있게 합니다.
--
-- 요청: "같은 책인데도 등급을 나눠서, 골고루 등급에 들어가도록 한 책들도 있어. 지금은 등급이
-- 한번 정해지면 중복책을 등록하는 순간 등급이 없어지던데 ... 같은 책도 등급 나눠서 등록할 수
-- 있도록 만들어줘."
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
-- lib_books 는 ISBN 하나에 한 줄만 허용했습니다(lib_books_isbn_idx). 그래서 같은 책을 또
-- 등록하면 그 줄의 보유 권수만 올랐고, 등급 칸은 그 줄에 하나뿐이라 이미 적혀 있던 등급 위에
-- 새 등급을 쓸 수도 없었습니다. 결과적으로 **새로 고른 등급은 조용히 버려졌습니다.**
--
-- ── 어떻게 바꾸는가 ─────────────────────────────────────────────────────────
-- 라벨 등급은 그 책이 어느 칸에 꽂히는지를 정합니다. 같은 책 두 권이 다른 등급 칸에 꽂힌다면
-- 그건 사실상 따로 관리되는 두 묶음입니다. 그래서 '한 줄'의 기준을 ISBN 하나에서
-- **(ISBN, 등급)** 으로 넓힙니다.
--
-- coalesce(label_level, 0) 으로 감싼 이유: Postgres 는 unique 색인에서 NULL 끼리는 서로 다른
-- 값으로 봅니다. 그대로 두면 등급 없는 줄이 ISBN 하나에 여러 개 생길 수 있고, 그러면 등급을
-- 쓰지 않는 책들이 검색 결과에 같은 제목으로 여러 줄 뜨게 됩니다. 0 으로 바꿔 두면 '등급 없음'
-- 도 하나의 값이 되어, 등급을 안 쓰는 책은 지금까지와 똑같이 ISBN 하나당 한 줄입니다.
-- ─────────────────────────────────────────────────────────────────────────────

-- 먼저 지금 자료가 새 규칙에 맞는지 봅니다. 예전 규칙이 더 엄격했으므로 맞아야 정상이지만,
-- 혹시 어긋나면 색인 만들기가 실패하면서 왜인지 알 수 없는 메시지가 나오므로 미리 확인합니다.
do $$
declare
  dup integer;
begin
  select count(*) into dup from (
    select isbn, coalesce(label_level, 0) as lv
    from lib_books
    where isbn is not null
    group by isbn, coalesce(label_level, 0)
    having count(*) > 1
  ) t;
  if dup > 0 then
    raise exception '같은 ISBN·등급이 겹치는 줄이 % 건 있습니다. 먼저 정리해 주세요.', dup;
  end if;
end $$;

drop index if exists lib_books_isbn_idx;

create unique index if not exists lib_books_isbn_level_idx
  on lib_books (isbn, coalesce(label_level, 0))
  where isbn is not null;

comment on index lib_books_isbn_level_idx is
  '같은 책도 라벨 등급이 다르면 따로 한 줄입니다. 등급이 없는 줄은 ISBN 하나당 하나뿐입니다.';

notify pgrst, 'reload schema';
