-- ===== 재등록 기록 한 줄 채우기 =====
--
-- 재등록 기록 목록에 「제목 기록 없음」으로 뜨던 줄이 있었습니다. 그 줄은 기록표가 생기기
-- **전에** 하신 첫 재등록을 나중에 되살려 적은 것이라, 어느 책으로 들어갔는지(book_id)와
-- ISBN 이 비어 있었습니다. 제목은 기록이 아니라 책에 있으므로, 가리키는 책이 없으면 그
-- 줄은 "무슨 일이 있었는지 모르는 기록"이 됩니다.
--
-- ── 어느 책인지 어떻게 아는가 ─────────────────────────────────────────────
-- 재등록은 찍었던 상품코드를 그 책의 product_code 칸에 적어 둡니다. 상품코드
-- 090129003990 을 달고 있는 ISBN 줄은 넷인데, 그중 셋은 기록표에 이미 각자의 줄이
-- 있습니다. 남는 하나가 이 기록의 책입니다 - Dingoes at Dinnertime(9780679890669).
--
-- 짐작으로 적지 않도록, 아래 update 는 **그 책이 실제로 그 상품코드를 달고 있고 다른
-- 기록이 그 책을 가리키고 있지 않을 때만** 바뀌도록 조건을 걸었습니다. 조건이 맞지 않으면
-- 아무것도 하지 않습니다(틀린 제목을 적어 두는 것보다 빈칸이 낫습니다).

update public.lib_relabel_log l
   set book_id = b.id,
       isbn    = b.isbn
  from public.lib_books b
 where l.id = '143ae15c-e00c-45fb-9e6a-f34fb99bb87a'
   and l.book_id is null
   and l.isbn is null
   and b.product_code = l.code
   and b.isbn = '9780679890669'
   and not exists (select 1 from public.lib_relabel_log x where x.book_id = b.id);

-- ── 되돌린 재등록이 남긴 자국 지우기 ─────────────────────────────────────
-- 되돌리기를 시험하며 한 재등록이 상대 줄에 상품코드를 적어 두고 갔습니다. 되돌릴 때 권수는
-- 돌아갔지만 이 칸은 그대로였습니다(앱 쪽도 함께 고쳤습니다). 되돌린 기록만 남고 살아 있는
-- 기록이 없는 줄에서만 지웁니다.
update public.lib_books b
   set product_code = null
 where b.id = '1780481e-58d3-4847-a96a-e2ef557d7711'
   and b.product_code = '090129003990'
   and not exists (
     select 1 from public.lib_relabel_log x
      where x.book_id = b.id and x.undone_at is null
   );
