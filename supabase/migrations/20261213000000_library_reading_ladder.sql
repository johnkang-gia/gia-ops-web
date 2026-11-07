/*
  ── 독서 등급 사다리와 등급 완료증 ─────────────────────────────────────────

  "학생이 점진적으로 독서능력을 키울 수 있도록 학생이 대여한 책들을 기준으로 같은 레벨의
  도서를 몇 권 정도 추천하고(시리즈라면 다음 편을 우선 추천), 어느 정도 권수를 채우게 되면
  다음 레벨의 도서를 추천해주는 시스템을 만들어줘. ... 단계가 올라가면 등급 완료증도 발급할
  수 있도록(상장 같은 건데, 이 등급 책들을 다 읽었음을 증명해주는 증명서)."

  ── 사다리를 새로 만들지 않고, 있는 것을 씁니다 ───────────────────────────
  책에는 이미 **색 라벨 등급(2~6)** 이 붙어 있고 책장도 그 등급으로 나뉘어 있습니다. 아이가
  서가 앞에서 보는 것도 그 색입니다. 그래서 독서 사다리를 따로 만들지 않고 **그 등급을 그대로
  단계로 씁니다** - 2등급을 다 읽으면 3등급, 그다음 4등급. 증명서에 적는 말도 「이 등급 책들을
  읽었다」가 되어 아이가 서가에서 확인할 수 있습니다.

  여기서 더하는 것은 두 가지뿐입니다.

    ① 등급마다 **몇 권을 읽으면 올라가는지**(goal_books)
    ② 올라갔을 때 주는 **완료증 발급 기록**(lib_reading_certs)

  누가 몇 권 읽었는지는 **대출 기록에서 셉니다**(반납된 책 = 읽은 책). 따로 적어 두면 두 숫자가
  어긋나고, 어느 쪽이 맞는지 아무도 모르게 됩니다.
*/

-- ① 등급마다 올라가는 데 필요한 권수 ---------------------------------------
alter table public.lib_label_levels
  add column if not exists goal_books integer not null default 10;

comment on column public.lib_label_levels.goal_books is
  '이 등급에서 몇 권을 읽으면 다음 등급으로 올라가는지. 화면(설정)에서 고칠 수 있습니다.';

/*
  등급 이름과 아이콘 - 아이에게 보여 줄 말입니다. 지금은 색 이름(주황·회색…)만 있어서
  「주황 등급을 마쳤습니다」가 되는데, 그건 색이지 도전이 아닙니다. 새싹에서 별까지 자라는
  이름을 붙여 두면 아이가 다음 단계를 바라봅니다. 비어 있으면 화면이 색 이름을 씁니다.
*/
alter table public.lib_label_levels
  add column if not exists badge_name text,
  add column if not exists badge_icon text;

comment on column public.lib_label_levels.badge_name is
  '아이에게 보여 줄 등급 이름(예: 새싹 독서가). 비어 있으면 색 이름을 씁니다.';

update public.lib_label_levels set badge_name = '새싹 독서가', badge_icon = '🌱' where level = 2 and badge_name is null;
update public.lib_label_levels set badge_name = '잎새 독서가', badge_icon = '🌿' where level = 3 and badge_name is null;
update public.lib_label_levels set badge_name = '나무 독서가', badge_icon = '🌳' where level = 4 and badge_name is null;
update public.lib_label_levels set badge_name = '숲 독서가',   badge_icon = '🏞️' where level = 5 and badge_name is null;
update public.lib_label_levels set badge_name = '별 독서가',   badge_icon = '⭐' where level = 6 and badge_name is null;

-- ② 등급 완료증 발급 기록 ---------------------------------------------------
create table if not exists lib_reading_certs (
  id uuid primary key default gen_random_uuid(),
  -- 학생 고유번호로 잡습니다. 학생 행이 지워져도 기록은 남아야 하므로 외래키를 걸지 않습니다
  -- (도서카드 발급 기록과 같은 이유입니다).
  student_no text not null,
  level integer not null,
  -- 그때의 이름·반. 나중에 반이 바뀌어도 「언제 어느 반일 때 받았는지」가 남습니다.
  student_name text,
  student_class text,
  -- 그 등급에서 읽은 권수(발급 시점). 증명서에 적는 숫자이므로 함께 굳혀 둡니다.
  book_count integer not null default 0,
  issued_at timestamptz not null default now(),
  issued_by text,
  reason text not null default '최초' check (reason in ('최초', '재발급')),
  note text
);

create index if not exists lib_reading_certs_student_idx
  on lib_reading_certs(student_no, level, issued_at desc);

alter table lib_reading_certs enable row level security;

drop policy if exists lib_all_reading_certs on lib_reading_certs;
create policy lib_all_reading_certs on lib_reading_certs
  for all using (is_lib_user()) with check (is_lib_user());

notify pgrst, 'reload schema';
