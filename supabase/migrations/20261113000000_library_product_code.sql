-- ===== 상품코드(UPC)로 등록한 책 바로잡기 =====
--
-- 책 뒤에 찍힌 바코드가 늘 ISBN인 것은 아닙니다. 특히 전집·학습만화·수입 페이퍼백은 **상품코드**
-- 가 찍혀 있는데, 이 번호는 '책 한 권'이 아니라 '상품 한 줄'을 가리킵니다. 그래서 시리즈 1권과
-- 5권의 바코드가 **똑같습니다.**
--
-- 지금 구조는 그 번호를 item_code(=이 책의 고유 번호) 자리에 넣고 있었습니다. 그러니 2권을
-- 찍으면 1권이 나오고, 등록할 때도 "같은 책 또 찍었네요"가 되어 권수만 올라갔습니다. 실제로는
-- 다른 책인데 한 줄로 합쳐진 것입니다.
--
-- 바코드만 보고 1권과 5권을 구별할 방법은 **없습니다.** 같은 숫자이기 때문입니다. 그래서
-- 할 수 있는 일은 둘입니다.
--   ① 상품코드를 '이 책의 고유 번호'로 쓰지 않습니다. 따로 적어 두고, 찍었을 때 후보가
--      여럿이면 사람에게 고르게 합니다.
--   ② 그런 책에는 도서관 라벨(GIA-B-00001)을 새로 발급해 붙입니다. 그러면 그 뒤로는
--      한 권 한 권이 확실히 구별됩니다.

alter table public.lib_books add column if not exists product_code text;

comment on column public.lib_books.product_code is
  '책에 찍혀 있던 상품코드(UPC 등). ISBN이 아니고 시리즈가 공유하는 경우가 많아, 이 번호만으로는 책을 특정하지 못합니다. 찾기용 단서로만 씁니다.';

create index if not exists lib_books_product_code_idx on public.lib_books (product_code);

-- 이미 상품코드가 item_code 자리에 들어간 책들을 product_code 로도 복사해 둡니다.
-- item_code 는 지우지 않습니다 - 지우면 그 책을 가리키는 번호가 아예 없어져서, 라벨을 붙이기
-- 전까지 찾을 수 없게 됩니다. 라벨 발급은 화면에서 사람이 확인하며 합니다.
update public.lib_books
   set product_code = item_code
 where item_code is not null
   and item_code !~* '^GIA-B-'
   and product_code is null;

notify pgrst, 'reload schema';
