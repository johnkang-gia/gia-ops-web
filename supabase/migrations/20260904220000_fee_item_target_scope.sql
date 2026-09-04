-- ===== 학비외 항목: 대상을 '어디까지인가' 한 칸으로 =====
--
-- 대상은 학년 칸과 반 칸 두 곳에 나뉘어 있는데, 그 둘만으로는 **가릴 수 없는 경우가 하나**
-- 있습니다.
--
--   학년 비었고 반도 비었음  →  개별 지정인가? 아니면 전체인가?
--
-- 지금은 둘 다 비면 무조건 '개별 지정' 입니다. 그래서 교복처럼 **학교 전체가 사는 것**을
-- 적을 방법이 없어, 학년을 하나씩 다 체크해 두는 수밖에 없었습니다. 그러면 다음 학기에
-- 학년이 하나 늘 때 그 학년만 조용히 빠집니다 - 체크해 둔 목록은 그때의 사진이라서요.
--
-- 그래서 '어디까지인가' 를 한 칸으로 적습니다.
--
--   개별     아무에게도 자동으로 안 붙음. 인보이스 표에서 한 명씩 넣습니다
--   부서전체 이 항목의 부서 전원 (교복). 학년이 늘어도 저절로 따라옵니다
--   학년     고른 학년 전원
--   반       고른 학년의 고른 반만

alter table public.fee_items
  add column if not exists target_scope text;

alter table public.fee_items
  drop constraint if exists fee_items_target_scope_ck;
alter table public.fee_items
  add constraint fee_items_target_scope_ck
  check (target_scope is null or target_scope in ('개별', '부서전체', '학년', '반'));

comment on column public.fee_items.target_scope is
  '대상의 범위. 개별=자동 안 붙음 / 부서전체=부서 전원 / 학년=default_grades / 반=default_grades+default_classes. 비어 있으면(옛 자료) 학년·반 칸을 보고 판단합니다.';

-- 지금 있는 항목에 값을 채웁니다.
--
-- '부서전체' 로 바뀌는 줄은 **없습니다.** 그런 뜻으로 적은 항목이 있더라도 지금 자료만
-- 보고서는 "학년을 전부 체크한 것" 과 구별할 수 없고, 짐작으로 바꾸면 그 항목이 갑자기
-- 새 학년에도 붙습니다. 사람이 화면에서 골라야 할 자리입니다.
update public.fee_items
   set target_scope = case
     when coalesce(array_length(default_classes, 1), 0) > 0 then '반'
     when coalesce(array_length(default_grades, 1), 0) > 0 then '학년'
     else '개별'
   end
 where target_scope is null;
