-- 셔틀 배정의 학생 연결 상태 — "왜 안 붙었는지"를 적는 칸
--
-- 담당자 확인: "유치부 데이터들은 싹다 무시해야 해. 유치부는 오로지 셔틀 기사님이 정류장을
-- 들르는 이유(유치부 아이가 내리기 때문에)로 데이터베이스에 들어가게 된 거라서."
--
-- 이 한마디가 설계를 바꿉니다. 다른 표들처럼 student_id에 NOT NULL을 걸 수가 없습니다 -
-- 유치부 줄은 **정당하게** 학생과 안 붙기 때문입니다. 억지로 잠그면 그 줄들이 저장이 안 되고,
-- 그러면 기사님이 그 정류장에 들르는 이유가 사라집니다.
--
-- 그렇다고 그냥 비워두면 처음 문제로 되돌아갑니다 - 비어 있는 것이 "유치부라서 원래 안 붙는
-- 것"인지 "아직 못 붙인 것"인지 아무도 모릅니다. 그게 지금 444줄이 쌓인 이유입니다.
--
-- 그래서 **왜 안 붙었는지를 반드시 적게** 합니다.
--
--   student_id 가 있다  → 연결됨. unlinked_reason 은 비어 있어야 함.
--   student_id 가 없다  → unlinked_reason 이 **반드시** 있어야 함.
--
-- 아래 CHECK 제약이 이걸 강제합니다. NOT NULL을 못 걸어도 같은 보장을 얻습니다 -
-- **말 없이 비어 있는 줄이 존재할 수 없습니다.**

alter table public.shuttle_assignments
  add column if not exists unlinked_reason text;

comment on column public.shuttle_assignments.unlinked_reason is
  '학생과 연결되지 않은 이유. ''유치부''=별도 운영이라 연결하지 않음 / ''퇴소''=유치부도 아닌데 명부에 없음(나간 아이) / ''확인필요''=동명이인 등 사람이 봐야 함. student_id가 있으면 비어 있어야 합니다.';

-- 지금 있는 줄들에 임시로 표시를 답니다.
-- 아직 무엇인지 모르므로 전부 '확인필요'입니다. 다음 단계(자동 매칭)에서 대부분 정리됩니다.
update public.shuttle_assignments
   set unlinked_reason = '확인필요'
 where student_id is null
   and unlinked_reason is null;

-- 반대로 이미 연결된 줄에 이유가 남아 있으면 지웁니다(둘 다 있으면 모순).
update public.shuttle_assignments
   set unlinked_reason = null
 where student_id is not null
   and unlinked_reason is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shuttle_assignments_link_ok'
      and conrelid = 'public.shuttle_assignments'::regclass
  ) then
    alter table public.shuttle_assignments
      add constraint shuttle_assignments_link_ok check (
        (student_id is not null and unlinked_reason is null)
        or
        (student_id is null and unlinked_reason is not null)
      );
  end if;
end $$;

-- 연결된 줄은 명부에 실제로 있는 학생이어야 합니다.
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage k
      on k.constraint_name = tc.constraint_name
     and k.constraint_schema = tc.constraint_schema
    where tc.constraint_schema = 'public'
      and tc.table_name = 'shuttle_assignments'
      and tc.constraint_type = 'FOREIGN KEY'
      and k.column_name = 'student_id'
  ) then
    alter table public.shuttle_assignments
      add constraint shuttle_assignments_student_id_fkey
      foreign key (student_id) references public.wr_students(id) on delete restrict;
  end if;
end $$;

create index if not exists shuttle_assignments_student_id_idx
  on public.shuttle_assignments (student_id);
create index if not exists shuttle_assignments_unlinked_idx
  on public.shuttle_assignments (unlinked_reason) where unlinked_reason is not null;

-- 지금 상태
select
  coalesce(unlinked_reason, '연결됨') as "상태",
  count(*)                            as "건수"
from public.shuttle_assignments
group by 1
order by 2 desc;
