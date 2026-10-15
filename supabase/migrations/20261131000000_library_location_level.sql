-- ===== 칸마다 라벨 등급 =====
--
-- 요청: "자리 등록을 할 때, 한 칸에 다른 등급의 책들을 섞어서 놓지는 않을 거라서 그 칸에 등급을
-- 정할 수 있게 해주고 ... 라벨 등급이 다른가요는 매번 묻지 말고, 부득이하게 한 칸에 다른 등급의
-- 책을 넣어야 할 때 설정할 수 있도록 만들어줘."
--
-- ── 왜 칸에 등급이 필요한가 ───────────────────────────────────────────────
-- 책장은 등급별로 꽂습니다. 그러니 **한 칸을 비우며 찍는 동안 나오는 책은 거의 전부 그 칸의
-- 등급**입니다. 그 사실을 자료가 모르면, 찍을 때마다 사람에게 "이 책 등급이 뭐냐"고 물어야
-- 하고, 서른 권을 찍는 사람에게 그 물음은 곧 일입니다.
--
-- 칸이 자기 등급을 알면 반대로 할 수 있습니다: 맞으면 조용히 넘어가고, **다를 때만** 말합니다.
-- 그게 사람이 실제로 보고 싶은 유일한 순간입니다 - 2등급으로 적힌 책이 3등급 칸에서 나왔다는
-- 것은 둘 중 하나가 틀렸다는 뜻이니까요.
--
-- null 은 '등급을 안 쓰는 칸'입니다. 지금까지와 똑같이 동작합니다 - 아무것도 묻지 않고,
-- 아무것도 비교하지 않습니다. 등급을 쓰는 칸만 골라서 적어 두면 됩니다.

alter table public.lib_locations
  add column if not exists label_level smallint;

comment on column public.lib_locations.label_level is
  '이 칸에 꽂는 라벨 등급. 비어 있으면 등급을 가리지 않는 칸입니다. 자리 등록은 이 등급과 다른 책이 나올 때만 알립니다.';

-- 등급은 라벨 표(lib_label_levels)에 있는 값이어야 합니다. 없는 등급을 칸에 적어 두면
-- 화면에서 색도 이름도 못 찾고, 그 칸은 영원히 '다른 등급'이라고 말하게 됩니다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lib_locations_label_level_fk'
  ) then
    alter table public.lib_locations
      add constraint lib_locations_label_level_fk
      foreign key (label_level) references public.lib_label_levels(level)
      on delete set null;
  end if;
end $$;

notify pgrst, 'reload schema';
