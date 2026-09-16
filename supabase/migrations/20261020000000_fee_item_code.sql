-- 납부항목에 **분류별 고유 번호**를 붙입니다.
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
--
-- 「《加油(Go for it)-小学中文 3》」은 2·3·4·5학년 네 항목의 **이름이 똑같습니다**(다른 것은
-- 한국어 이름뿐). 화면에도 넷이 같은 글자로 줄줄이 뜨고, 청구서에도 같은 글자가 찍힙니다.
--
-- 그래서 두 가지가 났습니다.
--
--   · 사람이 넷 중 어느 것을 고르는지 화면만 보고는 알 수 없습니다.
--   · 청구서 줄에 이름만 남아서, 하나를 「이미 받음」으로 적었더니 넷이 모두 잠겼습니다 -
--     아직 안 나간 교재가 「받음」으로 보이고 발행에서도 빠져, 받을 돈이 조용히 사라졌습니다.
--
-- 판정은 이제 번호(`invoice_lines.item_id`)로 합니다. 다만 **사람이 읽는 번호**가 따로
-- 있어야 합니다 - uuid 는 화면에 적을 수 없고, 적어도 아무도 못 외웁니다.
--
-- ── 무엇을 붙이나 ────────────────────────────────────────────────────
--
-- 분류 안에서 도는 일련번호입니다: 「교재-004」 · 「교복-001」.
--
-- 분류를 앞에 두는 이유는, 사람이 항목을 찾을 때 언제나 분류부터 좁히기 때문입니다(화면도
-- 부서 → 분류 → 항목 순입니다). 번호만 세 자리로 도는 것보다 「교재-004」가 눈에 걸립니다.
--
-- **한 번 붙은 번호는 바꾸지 않습니다.** 분류를 옮겨도 그대로 둡니다 - 번호는 그 항목을
-- 가리키는 이름이고, 이름이 바뀌면 지난 대화와 지난 종이가 가리키는 곳이 사라집니다.

alter table public.fee_items
  add column if not exists code text;

comment on column public.fee_items.code is
  '사람이 읽는 고유 번호(분류-일련번호, 예: 교재-004). 이름이 같은 항목이 여럿이라 이름으로는 못 가립니다. 한 번 붙으면 바꾸지 않습니다 - 분류를 옮겨도 그대로입니다.';

-- ── 번호를 매기는 함수 ───────────────────────────────────────────────
--
-- 분류 안에서 이미 쓴 가장 큰 번호 다음을 씁니다. 지운 항목의 번호는 **다시 쓰지
-- 않습니다** - 지난 종이가 「교재-004」를 가리키는데 다른 책이 그 번호를 물려받으면,
-- 그 종이는 조용히 다른 책을 가리키게 됩니다.
create or replace function public.next_fee_item_code(p_category text)
returns text
language plpgsql
as $$
declare
  cat text := coalesce(nullif(btrim(p_category), ''), '기타');
  n integer;
begin
  -- 글자 비교로 앞을 맞춥니다. `like` 는 분류 이름에 % 나 _ 가 들어가면 엉뚱하게 걸립니다.
  select coalesce(max((substring(code from '([0-9]+)$'))::integer), 0)
    into n
    from public.fee_items
   where left(code, length(cat) + 1) = cat || '-'
     and substring(code from '([0-9]+)$') is not null;
  return cat || '-' || lpad((n + 1)::text, 3, '0');
end;
$$;

-- ── 넣을 때 저절로 붙습니다 ──────────────────────────────────────────
--
-- 화면이 번호를 만들게 두면 화면마다 규칙이 생기고, 한 화면을 빠뜨리면 그 항목만 번호가
-- 없습니다. 번호 없는 항목은 오류로 안 보이고 그냥 빈 칸으로 보입니다.
create or replace function public.fee_items_fill_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.next_fee_item_code(new.category);
  end if;
  return new;
end;
$$;

drop trigger if exists fee_items_fill_code_trg on public.fee_items;
create trigger fee_items_fill_code_trg
  before insert on public.fee_items
  for each row execute function public.fee_items_fill_code();

-- ── 이미 있는 항목에 번호 붙이기 ─────────────────────────────────────
--
-- 만든 순서대로 매깁니다. 사람이 만든 순서가 곧 사람이 기억하는 순서입니다.
do $$
declare
  r record;
  cat text;
  n integer;
  last_cat text := null;
begin
  for r in
    select id, coalesce(nullif(btrim(category), ''), '기타') as cat, created_at
      from public.fee_items
     where code is null
     order by coalesce(nullif(btrim(category), ''), '기타'), created_at, id
  loop
    if last_cat is distinct from r.cat then
      last_cat := r.cat;
      n := 0;
    end if;
    n := n + 1;
    update public.fee_items set code = r.cat || '-' || lpad(n::text, 3, '0') where id = r.id;
  end loop;
end $$;

-- 같은 번호가 둘이면 번호가 없는 것만 못합니다 - 있는데 안 맞는 것이 더 나쁩니다.
create unique index if not exists fee_items_code_uniq on public.fee_items (code);

-- ── 옛 청구서 줄에 항목 번호 채우기 ──────────────────────────────────
--
-- `invoice_lines.item_id` 는 오늘부터 적힙니다. 그 전에 나간 줄은 이름만 있습니다.
--
-- **이름이 한 항목에만 쓰이는 줄만** 채웁니다. 이름이 겹치는 줄(학년별 중국어 교재)은
-- 넷 중 어느 것이었는지 알 수 없으므로 비워 둡니다 - 찍어서 채우면 틀린 번호가 「확인된
-- 사실」로 굳어 버리고, 그 뒤로는 아무도 의심하지 않습니다. 화면은 비어 있는 줄을
-- 「확인 필요」로 적어 사람에게 묻습니다.
update public.invoice_lines l
   set item_id = f.id
  from public.fee_items f
 where l.item_id is null
   and l.name = f.name
   and (select count(*) from public.fee_items f2 where f2.name = l.name) = 1;
