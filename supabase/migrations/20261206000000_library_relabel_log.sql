-- ===== 재등록 기록 =====
--
-- 요청: "상품코드로 등록된 책이 총 몇 권인데 그중에 몇 개가 바뀌었다고 표시해서 이게 제대로
-- 전부 교체가 되었는지 알 수 있게 해줘. 같은 코드로 여러 권이 등록된 경우 있기 때문에 한 권
-- 재등록 할 때마다 차감해줘."
--
-- ── 왜 '남은 권수'만으로는 안 되는가 ──────────────────────────────────────
-- 남은 권수는 언제든 셀 수 있습니다(상품코드를 고유 번호로 쓰는 줄들의 보유 권수 합). 그런데
-- 그것만 보면 **27권에서 시작해 24권이 남은 것**과 **처음부터 24권이었던 것**이 똑같아
-- 보입니다. "제대로 전부 교체가 되었나"에 답하려면 **바꾼 쪽도 세어야** 합니다.
--
-- 처음 권수를 어딘가에 적어 두는 방법도 있지만, 그 숫자는 한 번 적으면 썩습니다 - 나중에
-- 상품코드 책이 더 들어오면 "27권 중 30권을 바꿨다"가 됩니다.
--
-- 그래서 **바꿀 때마다 한 줄 남깁니다.** 그러면
--
--     총 권수 = 남은 권수(지금 세기) + 바꾼 권수(이 표의 줄 수)
--
-- 가 되어, 새 책이 들어와도 숫자가 저절로 맞습니다. 덤으로 **무엇을 바꿨는지 목록**이 남아서
-- 눈으로 확인할 수 있습니다 - 숫자만 맞는 것과 실제로 맞는 것은 다릅니다.
--
-- ── 한 코드에 여러 권이 묶여 있습니다 ────────────────────────────────────
-- 상품코드는 '책 한 권'이 아니라 '상품 한 줄'이라 전집 열두 권이 같은 번호를 씁니다(실제로
-- 12권짜리 줄이 있습니다). 그래서 이 표는 **권 단위**로 쌓입니다 - 같은 코드로 열두 줄이
-- 생기고, 그만큼 남은 권수가 줄어듭니다.

create table if not exists public.lib_relabel_log (
  id uuid primary key default gen_random_uuid(),
  /** 찍은 번호(상품코드). 같은 번호가 여러 줄 있을 수 있습니다 - 권마다 한 줄입니다. */
  code text not null,
  /** 사람이 표지에서 읽어 적은 ISBN. */
  isbn text,
  /** 그 한 권이 들어간 줄. 책이 지워지면 기록은 남고 가리키는 곳만 비웁니다. */
  book_id uuid references public.lib_books(id) on delete set null,
  /** replaced(줄을 그대로 고침) · split(한 권 떼어냄) · moved(이미 있던 ISBN 줄로) · created(새로 등록) */
  what text not null,
  /**
   * 이 재등록이 **상품코드 더미에서 한 권을 빼낸 것인지.**
   *
   * 등록조차 안 되어 있던 번호를 새로 등록한 경우(created)는 더미에서 뺀 것이 아닙니다.
   * 그것까지 세면 총 권수가 부풀어서, 다 바꿨는데도 "아직 남았다"로 보입니다.
   */
  from_product boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text
);

comment on table public.lib_relabel_log is
  '상품코드로 등록돼 있던 책을 ISBN 으로 바꿔 적은 기록. 권 단위로 한 줄씩 쌓입니다(한 상품코드에 여러 권이 묶여 있으므로). 총 권수 = 남은 권수 + 이 표의 from_product 줄 수.';

create index if not exists lib_relabel_log_at_idx on public.lib_relabel_log (created_at desc);

alter table public.lib_relabel_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'lib_relabel_log' and policyname = 'lib_relabel_log_rw') then
    create policy lib_relabel_log_rw on public.lib_relabel_log
      for all using (public.is_lib_user()) with check (public.is_lib_user());
  end if;
end $$;

notify pgrst, 'reload schema';
