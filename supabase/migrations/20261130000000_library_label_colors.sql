-- ===== 라벨 등급 색을 실제 책에 붙은 색으로 =====
--
-- 20260828010100 에서 다섯 등급을 미리 만들 때 색은 아무거나 넣어 두고 "화면에서 실제 라벨색으로
-- 바꾸면 됩니다"라고 적어 두었습니다. 그 뒤로 바꾸지 않아서, 앱이 보여주는 색과 책등에 실제로
-- 붙어 있는 색이 **서로 다른 채로** 지내 왔습니다.
--
-- 책등 라벨을 찍은 사진으로 확인한 실제 색:
--
--   2등급 주황 · 3등급 회색 · 4등급 초록 · 5등급 노랑 · 6등급 빨강
--
-- 맞던 것은 4등급(초록) 하나뿐이었습니다. 2등급은 앱에서 빨강으로 보였는데 실제 빨강은 6등급
-- 입니다 - 책장 앞에서 색으로 맞춰 보는 사람에게는 이게 가장 나쁜 종류의 틀림입니다. 틀린 줄도
-- 모르고 엉뚱한 칸을 뒤지게 되니까요.
--
-- ── 색값을 고른 기준 ───────────────────────────────────────────────────────
-- 화면에서는 이 값이 글자색으로도 쓰입니다(옅은 바탕 위의 글자). 그래서 라벨의 색조는 그대로
-- 두되 글자로 읽히는 밝기를 골랐습니다. 노랑을 #eab308 대신 #ca8a04 로 쓴 이유가 그것입니다.
--
-- ── 손으로 바꿔 둔 색은 건드리지 않습니다 ──────────────────────────────────
-- where 절에 예전 기본값을 함께 적었습니다. 도서관에서 이미 색을 고쳐 둔 등급이 있으면 그
-- 줄은 지나갑니다. 이 표는 사람이 고칠 수 있는 표이고, 사람이 고친 값이 마이그레이션보다
-- 우선입니다.

update public.lib_label_levels set color = '#ea580c', name = coalesce(name, '주황'), updated_at = now()
  where level = 2 and color = '#e11d48';
update public.lib_label_levels set color = '#475569', name = coalesce(name, '회색'), updated_at = now()
  where level = 3 and color = '#f59e0b';
update public.lib_label_levels set color = '#16a34a', name = coalesce(name, '초록'), updated_at = now()
  where level = 4 and color = '#16a34a';
update public.lib_label_levels set color = '#ca8a04', name = coalesce(name, '노랑'), updated_at = now()
  where level = 5 and color = '#0284c7';
update public.lib_label_levels set color = '#dc2626', name = coalesce(name, '빨강'), updated_at = now()
  where level = 6 and color = '#7c3aed';

-- 앞으로 만들어질 등급의 기본색도 '아직 안 정함'에 가까운 회색으로 둡니다(지금과 같음).
alter table public.lib_label_levels alter column color set default '#94a3b8';

notify pgrst, 'reload schema';
