-- 픽업 업무가 한 연락에서 **두 줄** 생기던 문제.
--
-- ── 무엇이 났나 ────────────────────────────────────────────────────────────
--
-- 9월 11일 업무 달력에 「지수 14:20 픽업」이 두 번 떴습니다. 학부모 연락은 한 건뿐이었고,
-- 업무만 두 줄이었습니다. 두 줄은 4밀리초 차이로 만들어졌습니다.
--
-- ── 왜 났나 ────────────────────────────────────────────────────────────────
--
-- 픽업 인박스를 열면 「아직 업무가 없는 확정 픽업」을 훑어 업무를 만듭니다. 두 번 만들지
-- 않는 장치는 `pickup_requests.task_id` 하나였는데, 그것은 **읽을 때** 보는 값입니다.
--
--   ① 두 사람이(또는 한 사람이 두 창에서) 거의 같은 순간에 인박스를 엽니다
--   ② 둘 다 「task_id 가 비어 있다」를 읽습니다
--   ③ 둘 다 업무를 만듭니다
--   ④ 나중에 쓴 쪽이 task_id 를 덮어씁니다 - 다른 한 줄은 아무도 안 가리키는 채로 남습니다
--
-- 읽고 나서 쓰는 사이에 남이 끼어들 수 있으면, 그 검사는 **지켜지는 것처럼 보일 뿐**입니다.
-- 화면에는 오류가 아니라 「픽업이 두 건」으로 뜨고, 사람은 아이를 두 번 데리러 갑니다.
--
-- ── 무엇을 고쳤나 ──────────────────────────────────────────────────────────
--
-- 판단을 데이터베이스로 옮깁니다. 업무 줄에 「어느 연락에서 나왔나」를 적고, 그 값에 유일
-- 색인을 겁니다. 동시에 둘이 넣으면 **한 줄만 들어가고 다른 하나는 실패**합니다 - 실패한
-- 쪽은 이미 있는 줄을 찾아 이어 붙입니다.
--
-- 되풀이 업무에서 이미 같은 방식을 씁니다(recurrence_group_id + due_at 유일 제약). 한 번
-- 통한 방법을 두 번째 자리에서 다시 만들지 않습니다.

alter table public.tasks
  add column if not exists origin_ref text;

comment on column public.tasks.origin_ref is
  '이 업무를 만들어 낸 바깥 자료의 열쇠(픽업이면 pickup_requests.id). 같은 것으로 두 번 만들지 않기 위한 값입니다.';

-- ── 이미 생긴 짝 없는 줄 정리 ──────────────────────────────────────────────
--
-- 먼저 진짜 연결을 채웁니다. `pickup_requests.task_id` 가 가리키는 줄이 「그 연락의 업무」입니다.
update public.tasks t
   set origin_ref = r.id::text
  from public.pickup_requests r
 where r.task_id = t.id
   and t.origin = '픽업'
   and t.origin_ref is null;

-- 그러고도 남는 픽업 업무 중, **아무 연락도 가리키지 않으면서 제목·마감이 똑같은 줄**이
-- 곧 이번 사고로 생긴 여분입니다.
--
-- **지우지 않고 휴지통에 넣습니다.** 되돌릴 수 없게 지우면, 판단이 틀렸을 때 남는 것이
-- 없습니다. 7일 안에는 휴지통 화면에서 되살릴 수 있습니다.
update public.tasks t
   set deleted_at = now()
 where t.origin = '픽업'
   and t.origin_ref is null
   and t.deleted_at is null
   and t.completed_at is null
   and exists (
     select 1 from public.tasks k
      where k.origin = '픽업'
        and k.origin_ref is not null
        and k.deleted_at is null
        and k.title = t.title
        and k.due_at is not distinct from t.due_at
        and k.id <> t.id
   );

-- ── 다시 안 나게 ───────────────────────────────────────────────────────────
--
-- 부분 색인입니다. `origin_ref` 가 없는 옛 줄과 사람이 손으로 만든 업무는 건드리지 않습니다.
-- 휴지통에 들어간 줄도 세지 않습니다 - 잘못 만든 것을 버린 뒤 다시 만들 수 있어야 합니다.
create unique index if not exists tasks_origin_ref_uniq
  on public.tasks (origin_ref)
  where origin_ref is not null and deleted_at is null;
