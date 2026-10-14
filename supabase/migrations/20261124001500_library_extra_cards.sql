-- ===== 학생이 아닌 도서카드(개발·점검용, 교직원) =====
--
-- 요청: "책 대여와 반납체크 등이 제대로 되는지 확인하기 위해서 개발자 도서카드도 하나 만들 수
-- 있게 해줘, 나중에는 교직원들도 카드 만들 수 있게 할거야."
--
-- ── 왜 표가 하나 더 필요한가 ───────────────────────────────────────────────
-- 지금 도서관이 아는 사람은 lib_students 뷰에 있는 **학생뿐**입니다. 그 뷰는 학교 명부
-- (wr_students)를 그대로 비춘 것이라, 점검용 카드를 만들자고 가짜 학생을 명부에 넣을 수는
-- 없습니다. 명부는 출결·상담·통지표가 함께 보는 자료입니다.
--
-- ── 어떻게 붙이는가 ────────────────────────────────────────────────────────
-- 따로 둔 표를 **lib_students 뷰에 union 으로 얹습니다.** 도서관 앱의 모든 화면(대출·반납·
-- 이름 검색·카드 인쇄·도서기록)이 그 뷰 하나만 보기 때문에, 여기 몇 줄이면 앱을 고치지 않고도
-- 똑같이 동작합니다.
--
-- ── 카드 번호를 '있을 수 없는 연도'로 ──────────────────────────────────────
-- 스캐너가 읽는 값의 모양은 GIA-<네 자리>-<번호> 로 이미 정해져 있습니다(STUDENT_CODE_RE).
-- 그래서 새 모양을 만들지 않고 **입학 연도로 쓸 수 없는 숫자**를 가져다 씁니다.
--   · GIA-9000-#### — 개발·점검용
--   · GIA-9001-#### — 교직원
-- 9000년도 입학생은 없으므로 학생 번호와 영원히 겹치지 않고, 번호만 봐도 사람 카드가 아님을
-- 알 수 있습니다. 스캐너·화면·인쇄는 하나도 고치지 않아도 됩니다.

create table if not exists public.lib_extra_cards (
  id uuid primary key default gen_random_uuid(),
  -- 카드에 찍히는 번호. GIA-9000-0001 / GIA-9001-0007 처럼 씁니다.
  card_no text not null unique
    check (card_no ~ '^GIA-900[01]-[0-9]{4}$'),
  name text not null,
  kind text not null default '교직원' check (kind in ('개발', '교직원')),
  -- 교직원이면 부서나 담당(예: '초등부 담임'). 화면에서 학년 자리에 들어갑니다.
  role text,
  note text,
  -- 끄면 카드가 안 먹습니다. 지우지 않는 이유는 지난 대출 기록이 이 번호를 가리키기 때문입니다.
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.lib_extra_cards is
  '학생이 아닌 도서카드(개발·점검용, 교직원). lib_students 뷰에 얹혀 도서관 앱에서 학생과 똑같이 동작합니다.';

alter table public.lib_extra_cards enable row level security;

drop policy if exists lib_all_extra_cards on public.lib_extra_cards;
create policy lib_all_extra_cards on public.lib_extra_cards
  for all using (public.is_lib_user()) with check (public.is_lib_user());

-- ── lib_students 뷰에 얹습니다 ────────────────────────────────────────────
-- 앞의 절(학생)은 20260903030000 의 것을 그대로 둡니다. 뒤에 union all 한 절만 새로 붙습니다.
-- kind 칸을 하나 더 내보내는 이유: 대출 기록의 student_id 는 wr_students 를 가리키는 외래키라
-- 학생이 아닌 카드의 id 를 넣으면 저장이 거절됩니다. 앱이 '학생일 때만' 그 칸을 채우도록
-- 구분할 단서가 필요합니다.
drop view if exists public.lib_students;
create view public.lib_students as
select
  s.id,
  s.student_no,
  s.name,
  s.name_en,
  s.grade,
  s.class_name,
  s.department,
  s.status,
  s.photo_path,
  '학생'::text as kind
from public.wr_students s
where public.is_lib_user()
  and coalesce(s.is_demo, false) = false
union all
select
  c.id,
  c.card_no            as student_no,
  c.name,
  null::text           as name_en,
  c.role               as grade,
  null::text           as class_name,
  c.kind               as department,
  case when c.active then 'active' else 'inactive' end as status,
  null::text           as photo_path,
  c.kind::text         as kind
from public.lib_extra_cards c
where public.is_lib_user();

revoke all on public.lib_students from anon;
grant select on public.lib_students to authenticated;

-- 점검용 카드 한 장을 미리 만들어 둡니다. 요청: "개발자 도서카드도 하나 만들 수 있게".
-- 이 카드로 빌리고 반납해 보면 실제 아이 기록을 건드리지 않고 전 과정을 확인할 수 있습니다.
insert into public.lib_extra_cards (card_no, name, kind, role, note)
values ('GIA-9000-0001', '점검용 카드', '개발', '대출·반납 점검', '빌리고 반납하는 과정을 확인하는 카드입니다. 실제 학생 기록과 섞이지 않습니다.')
on conflict (card_no) do nothing;

notify pgrst, 'reload schema';
