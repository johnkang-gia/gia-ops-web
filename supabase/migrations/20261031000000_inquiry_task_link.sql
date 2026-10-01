-- 학부모 문의 ↔ 업무를 **양쪽으로** 잇습니다.
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 문의에서 「업무로 등록」을 누르면 업무가 생기고 `pickup_requests.task_id` 가 채워집니다.
-- 그 업무를 끝내도 문의는 그대로 「확인대기」였습니다. 담당자는 일을 끝냈는데 문의 목록에는
-- 아직 남아 있고, 그래서 다른 사람이 또 처리하려 들거나, 아니면 목록을 아무도 안 믿게 됩니다.
-- 확인대기에 298건이 쌓인 이유의 하나입니다.
--
-- 업무를 「완료」로 바꾸는 자리가 화면 둘(흐름판 · 상세 창)이라 코드로 잇자면 두 곳에 같은
-- 줄을 적어야 하고, 세 번째 화면이 생기면 거기서는 빠집니다. 빠진 화면은 오류를 내지 않습니다.
--
-- ── 그래서 ───────────────────────────────────────────────────────────────────
--
-- 트리거 하나가 합니다. 업무가 완료되면(또는 휴지통에 가면) 그 업무를 가리키는 문의에 답한
-- 때를 적고, 완료를 되돌리면 **이 트리거가 적은 것만** 되돌립니다(`answered_via = '업무완료'`).
-- 사람이 손으로 「답변 완료」를 누른 것은 건드리지 않습니다.

create or replace function public.inquiry_follow_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.status = '완료' or new.deleted_at is not null)
     and (old.status is distinct from '완료' and old.deleted_at is null) then
    update public.pickup_requests
       set answered_at = coalesce(new.completed_at, now()),
           answered_by = coalesce(new.updated_by, '업무'),
           answered_via = '업무완료'
     where task_id = new.id
       and answered_at is null;
  elsif new.status is distinct from '완료' and new.deleted_at is null
        and (old.status = '완료' or old.deleted_at is not null) then
    update public.pickup_requests
       set answered_at = null, answered_by = null, answered_via = null
     where task_id = new.id
       and answered_via = '업무완료';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_inquiry_follow on public.tasks;
create trigger tasks_inquiry_follow
  after update of status, deleted_at on public.tasks
  for each row execute function public.inquiry_follow_task();

-- ── 이미 끝난 업무의 문의 ───────────────────────────────────────────────────
--
-- 지금까지 업무로 넘긴 문의 중 그 업무가 이미 완료된 것은 답한 것으로 적습니다. 한 번만 합니다.
update public.pickup_requests r
   set answered_at = coalesce(t.completed_at, t.updated_at, now()),
       answered_by = coalesce(t.updated_by, '업무'),
       answered_via = '업무완료'
  from public.tasks t
 where t.id = r.task_id
   and r.answered_at is null
   and (t.status = '완료' or t.deleted_at is not null);

-- ── 같은 문의로 업무 두 번 안 만들기 ─────────────────────────────────────────
--
-- 「업무로 등록」도 읽고-나서-쓰는 검사(`task_id` 가 비었나)뿐이었습니다. 픽업과 같은 방식으로
-- `origin_ref` 에 문의 번호를 적어 유일 색인(`tasks_origin_ref_uniq`)이 막게 합니다.
update public.tasks t
   set origin = coalesce(t.origin, '문의'),
       origin_ref = r.id::text
  from public.pickup_requests r
 where r.task_id = t.id
   and t.origin_ref is null
   and t.deleted_at is null
   and not exists (select 1 from public.tasks k where k.origin_ref = r.id::text and k.deleted_at is null);
