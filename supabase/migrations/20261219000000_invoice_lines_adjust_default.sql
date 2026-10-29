-- 청구서 줄의 정정 표시(is_adjustment)가 비어서 들어오면 «정정 아님»으로 채웁니다.
--
-- 여러 줄을 한 번에 넣을 때 한 줄에만 있는 칸은 나머지 줄에서 기본값이 아니라 null 로 들어갑니다.
-- 그래서 «다음 달에 얹을 차액»(정정 줄)이 있는 학생의 학비 청구서가 줄 전체 실패로 발행되지 않았습니다.
-- 코드에서도 칸을 맞췄지만, 넣는 창구가 다섯 곳이라 다음 창구가 또 빠뜨릴 수 있어 마지막 관문을
-- 데이터베이스에 둡니다. NOT NULL 검사는 BEFORE 트리거 뒤에 하므로 여기서 채우면 통과합니다.

create or replace function public.invoice_lines_fill_adjust()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_adjustment := coalesce(new.is_adjustment, false);
  return new;
end;
$$;

drop trigger if exists invoice_lines_fill_adjust on public.invoice_lines;
create trigger invoice_lines_fill_adjust
  before insert or update on public.invoice_lines
  for each row execute function public.invoice_lines_fill_adjust();
