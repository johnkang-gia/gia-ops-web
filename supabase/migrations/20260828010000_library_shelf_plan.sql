-- ===== 도서관: 임시구역 → 도서정리 계획 =====
-- 요청: "지금 책들을 우선 그냥 무작정 일정구역에 꽂아놨어. 그래서 우선은 지금 무작위로 꽂은 책을
-- 기준으로 섹션을 구분해서 책을 일단 바코드로 전부 등록하고, 그 이후에 용도별·작가별·카테고리별로
-- 책을 분류하도록해서 그 책들이 어디있고 어디로 옮겨야 하는지를 분류해서 알려주게끔 해서 도서정리가
-- 한번에 되도록" + 분류 순서는 "대상 연령 → 분류 → 작가".
--
-- 핵심 생각: 책의 자리를 두 개로 나눠서 들고 있습니다.
--   location_id        - 지금 실제로 꽂혀 있는 자리 (임시구역)
--   target_location_id - 정리 후에 가야 할 자리 (계획)
-- 이 둘이 다른 책이 곧 "옮겨야 할 책"입니다. 계획을 세워도 실제로 옮기기 전까지는 location_id가
-- 그대로라, 정리하는 중간에 학생이 "그 책 어디 있어요?" 하고 물어도 지금 자리를 정확히 답할 수
-- 있습니다. 책을 실제로 옮기고 스캔하면 그때 location_id가 target으로 바뀝니다.

-- ── ① 책: 대상 연령 + 가야 할 자리 ─────────────────────────────────────────
-- audience - 분류의 첫 단계(가장 큰 덩어리). 등록할 때 인터넷 조회 결과로 자동 추정하고,
--            틀리면 화면에서 손으로 고칩니다. 비어 있으면 '아직 안 정함'입니다.
alter table lib_books add column if not exists audience text
  check (audience is null or audience in ('유치부', '초등부', '중고등부', '전체'));

alter table lib_books add column if not exists target_location_id uuid
  references lib_locations(id) on delete set null;

create index if not exists lib_books_target_idx on lib_books(target_location_id);
create index if not exists lib_books_audience_idx on lib_books(audience);

-- ── ② 구역: 임시/정식 구분 + 수용 권수 + 배정 내용 ─────────────────────────
-- kind     - '임시'는 지금 무작정 꽂아둔 칸(사진 보고 나눈 구역), '정식'은 정리 후에 쓸 칸입니다.
--            정리 계획은 '정식' 구역에만 책을 배정하고, '임시' 구역은 비워지는 것이 목표입니다.
-- capacity - 이 칸에 몇 권이 들어가는지. 요청: "일단 임시구역을 나누고 나서 한칸에 책을 찍어주면
--            그것을 바탕으로 어느정도 들어갈지 파악해줘" — 임시구역 등록이 끝나면 그 칸에서 나온
--            실제 권수를 여기에 넣습니다. 그 숫자가 곧 그 칸의 실측 용량입니다.
alter table lib_locations add column if not exists kind text not null default '정식'
  check (kind in ('임시', '정식'));

alter table lib_locations add column if not exists capacity integer
  check (capacity is null or capacity >= 0);

-- 계획을 확정하면 "이 칸은 초등부 · 과학·자연" 처럼 무엇을 담는 칸인지 적어둡니다.
-- 책장 라벨을 뽑을 때와, 반납한 책을 제자리에 꽂을 때 사람이 읽는 안내가 됩니다.
alter table lib_locations add column if not exists plan_audience text;
alter table lib_locations add column if not exists plan_category text;

-- ── ③ 계획 자체의 기록 ─────────────────────────────────────────────────────
-- 어떤 기준으로 언제 계획을 세웠는지 한 줄만 남깁니다. 계획은 언제든 다시 세울 수 있고,
-- 다시 세우면 target_location_id가 통째로 새로 계산됩니다.
alter table lib_settings add column if not exists plan_rule text;
alter table lib_settings add column if not exists plan_made_at timestamptz;

-- ── ④ 정리 진행 상황을 한눈에 보는 뷰 ──────────────────────────────────────
-- "지금 어디 있고, 어디로 가야 하는지"를 그대로 담은 목록입니다. 인쇄용 이동 목록과 정리 실행
-- 화면이 이 뷰 하나만 보면 되도록 만들었습니다.
--
-- 보안: 뷰는 만든 사람 권한으로 도는 대신, 아래에서 도서관 앱을 쓸 수 있는 계정인지 직접
--       확인합니다(lib_students 뷰와 같은 방식).
drop view if exists lib_move_plan;
create view lib_move_plan as
select
  b.id                as book_id,
  b.title,
  b.author,
  b.isbn,
  b.item_code,
  b.cover_url,
  b.category,
  b.audience,
  b.language,
  b.location_id       as from_id,
  fl.code             as from_code,
  fl.name             as from_name,
  fl.color            as from_color,
  fl.kind             as from_kind,
  b.target_location_id as to_id,
  tl.code             as to_code,
  tl.name             as to_name,
  tl.color            as to_color,
  tl.sort_order       as to_sort,
  -- 옮겨야 하는 책인지: 갈 곳이 정해져 있고, 지금 자리와 다르면 이동 대상입니다.
  (b.target_location_id is not null and b.target_location_id is distinct from b.location_id) as needs_move
from lib_books b
left join lib_locations fl on fl.id = b.location_id
left join lib_locations tl on tl.id = b.target_location_id
where b.status = '보유'
  and is_lib_user();

revoke all on lib_move_plan from anon;
grant select on lib_move_plan to authenticated;
