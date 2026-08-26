-- 출결내역 판별 학습 - "사람이 고친 것이 곧 규칙이 된다"
--
-- 지금 출결내역은 AI가 아니라 규칙(키워드 + 명부 대조)으로 돌아갑니다. 그래서 빠르고 공짜지만,
-- 명부에 없는 표기(영문 이름 'Maya', 오탈자 '조영운')나 처음 보는 표현("일찍 데려갈게요")은
-- 못 잡고 🔎 표시가 붙습니다. 그런데 그 🔎를 보고 있는 사람은 답을 알고 있습니다.
--
-- 그 답을 한 번 눌러 알려주면 여기 저장되고, 다음부터는 자동으로 적용됩니다. AI 호출이 없어
-- 비용이 들지 않고, 즉시 반영되며, "왜 그렇게 분류됐는지"를 규칙 목록에서 그대로 볼 수 있습니다.
begin;

create table if not exists attendance_learning_rules (
  id uuid primary key default gen_random_uuid(),

  -- alias   : 원문에 이렇게 적히면 이 학생이다      (예: 'Maya' → 김마야)
  -- category: 이 문구가 있으면 이 분류다             (예: '일찍 데려갈게요' → 조퇴)
  -- ignore  : 이 낱말은 학생 이름이 아니다           (예: '선생님', '오늘')
  kind text not null check (kind in ('alias', 'category', 'ignore')),

  -- 원문에서 찾을 표기. 비교는 소문자·공백제거 후 하므로 저장도 그 형태로 합니다.
  pattern text not null,

  -- kind='alias'일 때 연결할 학생. 학생이 지워지면 이 규칙도 함께 지웁니다.
  student_id uuid references wr_students(id) on delete cascade,
  -- 화면 표시·디버깅용으로 그때의 이름도 남겨둡니다(학생 삭제 시 규칙도 사라지므로 참고용).
  student_name text,

  -- kind='category'일 때의 분류.
  category text check (category in ('픽업', '결석', '지각', '조퇴')),

  -- 누가 언제 가르쳤는지. 잘못 배운 규칙을 되짚을 때 필요합니다.
  created_by text,
  created_at timestamptz not null default now(),
  -- 이 규칙이 실제로 몇 번 쓰였는지. 안 쓰이는 규칙은 정리 대상입니다.
  hit_count integer not null default 0,
  last_used_at timestamptz,

  -- 같은 표기를 두 번 가르치면 덮어씁니다(마지막에 가르친 것이 맞습니다).
  unique (kind, pattern)
);

create index if not exists attendance_learning_rules_kind_idx on attendance_learning_rules (kind);

alter table attendance_learning_rules enable row level security;

-- 교직원이면 누구나 보고 가르칠 수 있습니다. 출결을 보는 사람이 곧 고치는 사람입니다.
drop policy if exists "giamicro_all_attendance_learning_rules" on attendance_learning_rules;
create policy "giamicro_all_attendance_learning_rules" on attendance_learning_rules
  for all using (is_giamicro_user()) with check (is_giamicro_user());

-- 규칙이 바뀌면 열려 있는 화면들이 바로 따라오도록 실시간 구독에 넣습니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_learning_rules'
  ) then
    alter publication supabase_realtime add table attendance_learning_rules;
  end if;
end $$;

commit;
