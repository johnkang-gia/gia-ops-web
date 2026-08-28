-- 이준서의 정류장을 이준우와 같게 맞춥니다.
--
-- 담당자: "붙어있는 이준서 이준우는 형제라 가는 곳은 같아. 정류장은 준서 준우 같게 하고
--          (둘 중에 한 명이라도 있으면 그쪽으로 설정)."
--
-- 지금 상태:
--   이준우  4-2호 → 서초구 동광로 28        ✅ 주소 있음
--   이준우  9호   → 서초구 서초중앙로 63      ✅ 주소 있음
--   이준서  4-2호 → (주소 없음)             ❌
--   이준서  9호   → (주소 없음)             ❌
--   이준서  7호   → (주소 없음)             ❌  ← 준우에게는 없는 노선
--
-- "둘 중 한 명이라도 있으면 그쪽으로"에 따라, **주소가 있는 이준우 쪽 정류장으로**
-- 이준서를 옮깁니다. 이준서 쪽 빈 정류장을 채우는 게 아니라 같은 정류장 줄을 함께
-- 쓰게 만듭니다 - 나중에 주소가 바뀌어도 한 곳만 고치면 둘 다 따라갑니다.

-- ① 옮기기 전 확인. 4-2호와 9호에서 준우의 정류장이 하나씩 잡혀야 합니다.
select r.route_no                       as "호차",
       s.address                        as "이준우 정류장(여기로 맞춥니다)",
       s.id                             as "정류장 id"
  from public.shuttle_assignments a
  join public.shuttle_stops  s on s.id = a.stop_id
  join public.shuttle_routes r on r.id = s.route_id
 where a.student_name_raw like '%이준우%'
   and r.direction = '하원'
 order by r.route_no;

-- ② 이준서를 같은 정류장으로 옮깁니다(4-2호·9호만. 7호는 준우에게 없으므로 그대로 둡니다).
update public.shuttle_assignments seo
   set stop_id = woo_stop.id
  from public.shuttle_stops      seo_stop,
       public.shuttle_routes     seo_route,
       public.shuttle_assignments woo,
       public.shuttle_stops      woo_stop,
       public.shuttle_routes     woo_route
 where seo.student_name_raw like '%이준서%'
   and seo_stop.id  = seo.stop_id
   and seo_route.id = seo_stop.route_id
   and woo.student_name_raw like '%이준우%'
   and woo_stop.id  = woo.stop_id
   and woo_route.id = woo_stop.route_id
   -- 같은 호차끼리만 맞춥니다.
   and seo_route.id = woo_route.id
   and seo_route.direction = '하원'
   -- 이미 같은 정류장이면 건드리지 않습니다.
   and seo.stop_id <> woo.stop_id;

-- ③ 결과 확인. 이준서·이준우가 같은 호차에서 **같은 주소**로 보여야 합니다.
select a.student_name_raw as "학생",
       r.route_no         as "호차",
       coalesce(s.address, '(주소 없음)') as "정류장",
       a.choice_group     as "묶음"
  from public.shuttle_assignments a
  join public.shuttle_stops  s on s.id = a.stop_id
  join public.shuttle_routes r on r.id = s.route_id
 where a.choice_group is not null
 order by r.route_no, a.student_name_raw;


-- ══════════════════════════════════════════════════════════════════════════
-- [선택] 이준서의 7호 배정을 지웁니다
-- ══════════════════════════════════════════════════════════════════════════
--
-- 7호는 **이준우에게 없고, 주소도 없습니다.** 형제가 같은 곳으로 간다면 7호는 남을
-- 이유가 없습니다. 다만 제가 모르는 사정이 있을 수 있어 따로 떼어뒀습니다.
--
-- 그대로 두면 모바일 화면에 [4-2호] [7호] [9호] 세 개가 뜹니다. 위험하진 않지만,
-- 직원분이 7호가 뭔지 모르는 채로 누를 수 있습니다.
--
-- 지워도 된다고 판단되시면 아래 두 줄의 주석(--)을 풀고 실행하세요.

-- delete from public.shuttle_assignments a
--  using public.shuttle_stops s, public.shuttle_routes r
--  where s.id = a.stop_id and r.id = s.route_id
--    and a.student_name_raw like '%이준서%' and r.route_no = '7' and r.direction = '하원';
