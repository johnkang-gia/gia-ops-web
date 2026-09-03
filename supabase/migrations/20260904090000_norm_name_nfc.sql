-- ===== DB 쪽 이름 다듬기를 앱과 같게 =====
--
-- 앱은 `src/lib/studentName.ts` 한 곳에서 이름을 맞댑니다. 그런데 DB 안에서도 같은 일을
-- 하는 함수(`norm_name`)가 따로 있고, **규칙이 서로 달랐습니다.**
--
--   앱  : 자모 합침(NFC) + 공백·괄호 뗌 + 소문자
--   DB  : 공백·괄호 뗌 + 소문자          ← 자모를 안 합침
--
-- 자모 분리는 눈에 안 보이는 차이입니다. `고서윤` 이 ㄱ+ㅗ+ㅅ… 으로 쪼개져 들어오면
-- 사람 눈에는 똑같은데 글자로는 다르고, 그래서 **아무것도 안 맞습니다.** 실제로 학생 사진
-- 137장이 이 이유로 한 명도 안 붙은 적이 있습니다.
--
-- 두 곳이 다르면 "앱에서는 맞는데 SQL 로 세면 안 맞는" 상황이 생깁니다. 어느 쪽이 맞는지
-- 아무도 모르게 되므로, 규칙을 하나로 맞춥니다.

create or replace function public.norm_name(s text)
returns text language sql immutable as $$
  -- normalize(..., NFC) 는 쪼개진 자모를 한 글자로 합칩니다.
  select lower(regexp_replace(normalize(coalesce(s, ''), NFC), '[\s()（）\[\]【】]', '', 'g'));
$$;

comment on function public.norm_name(text) is
  '이름을 맞대볼 수 있는 모양으로. 앱의 src/lib/studentName.ts 의 normalizeName 과 같은 규칙입니다. 한쪽만 고치면 앱과 SQL 의 답이 갈립니다.';

-- 자주 찾는 자리라 색인을 둡니다. 137명이면 없어도 되지만, 이름 대조는 명부를 통째로 훑는
-- 자리라 학생이 늘면 가장 먼저 느려집니다.
create index if not exists wr_students_norm_name_idx
  on public.wr_students (public.norm_name(name))
  where is_demo = false;
