-- ═══════════════════════════════════════════════════════════════════════════
-- 보호자 연락처 채우기 — Supabase SQL Editor 붙여넣기용
--
-- 주신 명단 PDF 두 개에서 읽은 어머니(M)·아버지(F) 번호입니다(초등 102명 · 중고등 33명).
--
-- **덮어쓰지 않습니다.** 이미 채워져 있는 칸은 그대로 두고 빈 칸만 채웁니다 - 사람이 앱에서
-- 고쳐둔 번호를 파일이 되돌리면 안 됩니다.
--
-- 이름은 공백과 괄호를 떼고 맞춥니다. 동명이인(김재이·이준서)은 **반까지 같아야** 고칩니다.
-- 반이 다르면 건드리지 않고 아래 확인 질의에 남습니다.
--
-- 먼저 guardian_phones 마이그레이션이 실행돼 있어야 합니다(mother_phone·father_phone 칸).
-- 여러 번 실행해도 됩니다.
-- ═══════════════════════════════════════════════════════════════════════════

create temporary table if not exists roster_in (
  name text, cls text, dept text, mother text, father text, name_en text
) on commit drop;

truncate roster_in;
insert into roster_in (name, cls, dept, mother, father, name_en) values
  ('이신원', 'G2J', '초등부', '010-9282-2232', null, 'Max Lee'),
  ('노유겸', 'G2J', '초등부', '010-3200-6207', '010-7746-7060', 'Noah Roh'),
  ('주이안', 'G2J', '초등부', '010-9120-5718', null, 'Ian Ju'),
  ('문준연', 'G2J', '초등부', '010-9136-4946', '010-9255-1940', 'Joon Moon'),
  ('김서준', 'G2J', '초등부', '010-4726-9877', null, 'Leo Kim'),
  ('김준영', 'G2J', '초등부', '010-5253-8530', null, 'Junyoung Kim'),
  ('이연우', 'G2J', '초등부', '010-5045-2915', null, 'Yeni Lee'),
  ('심규민', 'G2J', '초등부', '010-7794-4865', '010-5554-4865', 'Gyumin Shim'),
  ('황라원', 'G2J', '초등부', '010-2264-1478', null, 'Sophia Hwang'),
  ('신민하', 'G2J', '초등부', '010-5351-2123', null, 'Brooklyn Shin'),
  ('이예나', 'G2J', '초등부', '010-8754-2684', null, 'Eliana Lee'),
  ('김나율', 'G2J', '초등부', '010-7389-0228', null, 'Anna Kim'),
  ('이라엘', 'G2J', '초등부', '010-6538-6529', null, 'Lael Lee'),
  ('권태이', 'G2C', '초등부', '010-8722-3060', null, 'Tay Kwon'),
  ('전준백', 'G2C', '초등부', '010-3050-8681', null, 'Justin Jeon'),
  ('전지완', 'G2C', '초등부', '010-8875-4490', null, 'Eric Jeon'),
  ('황이안', 'G2C', '초등부', '010-3176-4702', null, 'Ian Hwang'),
  ('이현우', 'G2C', '초등부', '010-9143-8857', '010-9100-9946', 'Harry Lee'),
  ('김준원', 'G2C', '초등부', '010-5253-8530', null, 'Junwon Kim'),
  ('박하솜', 'G2C', '초등부', '010-4592-5945', null, 'Hasom Park'),
  ('김재이', 'G2C', '초등부', '010-5321-0324', '010-6816-3031', 'Jay Kim'),
  ('이아인', 'G2C', '초등부', '010-6889-2937', null, 'Ayn Lee'),
  ('고서윤', 'G2C', '초등부', '010-8654-7611', '010-4173-7364', 'Jenny Go'),
  ('이은재', 'G2C', '초등부', '010-4005-2413', '010-4845-2413', 'Ellie Lee'),
  ('김사랑', 'G2C', '초등부', '010-6222-6037', '010-6222-6074', 'Benecia Kim'),
  ('백서아', 'G2C', '초등부', '010-4785-9973', null, 'Ruby Paik'),
  ('황라윤', 'G2C', '초등부', '010-2264-1478', null, 'Bella Hwang'),
  ('김도은', 'G2A', '초등부', '010-4739-6231', '010-5031-6231', 'Rogan Kim'),
  ('고진우', 'G2A', '초등부', '010-8972-2394', null, 'Jinwoo Ko'),
  ('김단우', 'G2A', '초등부', '010-3442-0078', null, 'Danu Kim'),
  ('이서준', 'G2A', '초등부', '010-4866-8100', '010-5227-9339', 'Seojun Lee'),
  ('서민준', 'G2A', '초등부', '010-2186-6134', '010-2522-6134', 'Eden Seo'),
  ('박세인', 'G2A', '초등부', '010-2050-9828', null, 'Clara Park'),
  ('한우영', 'G2A', '초등부', '010-5148-3885', '010-9469-2435', 'Zoe Han'),
  ('곽세린', 'G2A', '초등부', '010-8843-5196', '010-9232-1492', 'Celine Kwak'),
  ('박세주', 'G2A', '초등부', '010-6380-8798', null, 'Reina Park'),
  ('김재이', 'G2A', '초등부', '010-9048-6336', '010-8669-5994', 'Jay Kim'),
  ('원세빈', 'G2A', '초등부', '010-5813-0000', null, 'Sophia Won'),
  ('심재이', 'G2A', '초등부', '010-9253-3303', null, 'Jay Shim'),
  ('조하윤', 'G2A', '초등부', '010-8617-9529', null, 'Esther Jo'),
  ('연하윤', 'G2A', '초등부', '010-7121-9559', null, 'Hayoon Yon'),
  ('황이준', 'G3J', '초등부', '010-8686-8118', null, 'June Hwang'),
  ('이준원', 'G3J', '초등부', '010-9282-2232', null, 'Jun Lee'),
  ('유한솔', 'G3J', '초등부', '010-8786-0409', null, 'Kai Yoo'),
  ('엄하율', 'G3J', '초등부', '010-3244-8902', null, 'Henry Hayule Eom'),
  ('강이제', 'G3J', '초등부', '010-5826-8910', null, 'Ije Kang'),
  ('김현수', 'G3J', '초등부', '010-8760-9264', null, 'Hans Kim'),
  ('홍서형', 'G3J', '초등부', '010-7176-5490', '010-3512-1353', 'Danny Hong'),
  ('민노엘', 'G3J', '초등부', '010-5576-0201', null, 'Noel Min'),
  ('정세진', 'G3J', '초등부', '010-7140-2415', null, 'Emma Jung'),
  ('최서아', 'G3J', '초등부', '010-2723-2046', null, 'Sarah Choi'),
  ('민송희', 'G3J', '초등부', '010-3151-2767', null, 'Sophia Min'),
  ('임다현', 'G3J', '초등부', '010-3165-8055', '010-8716-8602', 'Diane Lim'),
  ('임예나', 'G3J', '초등부', '010-9901-7999', null, 'Grace Lim'),
  ('이서아', 'G3J', '초등부', '010-5703-2692', null, 'Vivian Lee'),
  ('차봄', 'G3J', '초등부', '010-2811-0707', '010-9129-1443', 'Bom Cha'),
  ('황시원', 'G3J', '초등부', '010-8686-8118', null, 'Sean Hwang'),
  ('지수', 'G3J', '초등부', '010-9087-8430', null, 'Soo Ji'),
  ('임주한', 'G3J', '초등부', '010-5760-1866', null, 'Juhan Lim'),
  ('이주원', 'G3J', '초등부', '010-3575-2841', null, 'Benny Lee'),
  ('이준서', 'G3J', '초등부', '010-4655-2574', '010-8942-2580', 'Justin Lee'),
  ('정레인', 'G3J', '초등부', '010-4806-4862', '010-5443-4862', 'Rain Jung'),
  ('강서후', 'G3J', '초등부', '010-6645-8648', null, 'Seohu Kang'),
  ('송윤진', 'G3J', '초등부', '010-9142-9438', null, 'Diana Song'),
  ('이예온', 'G3J', '초등부', '010-4256-8836', null, 'Grace Lee'),
  ('정이엘', 'G3J', '초등부', '010-8736-8363', null, 'E.L. Jeong'),
  ('이서현', 'G3J', '초등부', '010-8908-4893', null, 'Elizabeth Lee'),
  ('김재이', 'G3J', '초등부', '010-4569-0657', null, 'Jay Kim'),
  ('정겨울', 'G3J', '초등부', '010-3819-2137', '010-6825-2515', 'Wynter Jeong'),
  ('곽호율', 'G4R', '초등부', '010-6602-2947', null, 'James Kwak'),
  ('유재이', 'G4R', '초등부', '010-4181-3216', '010-4082-2942', 'Jay Yu'),
  ('고이건', 'G4R', '초등부', '010-9098-9949', null, 'Eagon Koh'),
  ('홍동은', 'G4R', '초등부', '010-3239-9213', null, 'Jaden Hong'),
  ('조장훈', 'G4R', '초등부', '010-3251-0300', '010-9686-0304', 'Janghoon Cho'),
  ('김태오', 'G4R', '초등부', '010-8947-2001', null, 'Theo Kim'),
  ('정서우', 'G4R', '초등부', '010-9406-2143', null, 'Stella Jung'),
  ('강하라', 'G4R', '초등부', '010-7678-2718', '010-7183-2357', 'Hara Kang'),
  ('마리아파즈마누키안', 'G4R', '초등부', '010-2718-9975', null, 'Maria Paz Manoukian'),
  ('장예나', 'G4R', '초등부', '010-4604-8717', '010-2408-3969', 'Yeana Jang'),
  ('임하임', 'G4R', '초등부', '010-9389-6648', null, 'Blaire Lim'),
  ('권수호', 'G4S', '초등부', '010-2748-9949', null, 'Teddy Kwon'),
  ('김동하', 'G4S', '초등부', '010-8554-3130', null, 'Dongha Kim'),
  ('황준호', 'G4S', '초등부', '010-2264-1478', '010-6654-7857', 'June Hwang'),
  ('김서진', 'G4S', '초등부', '010-5047-7094', null, 'Seojin Kim'),
  ('임선우', 'G4S', '초등부', '010-3165-8055', '010-8716-8602', 'Sunwoo Lim'),
  ('홍선우', 'G4S', '초등부', '010-6804-1165', null, 'Sunwoo Hong'),
  ('정하임', 'G4S', '초등부', '010-4754-6919', null, 'Hayim (Peyton) Jung'),
  ('김서이', 'G4S', '초등부', '010-8582-7165', null, 'Victoria Kim'),
  ('김지민', 'G4S', '초등부', '010-5100-7847', null, 'Jimin Kim'),
  ('남가인', 'G4S', '초등부', '010-5485-3270', null, 'Gahin Nam'),
  ('임지효', 'G4S', '초등부', '010-6347-0288', '010-8986-0289', 'Jihyo Yim'),
  ('최서연', 'G4S', '초등부', '010-4254-3565', null, 'Seoyeon Choi'),
  ('강예성', 'G4S', '초등부', '010-4114-3788', null, 'Yesung Kang'),
  ('이한범', 'G4S', '초등부', '010-7722-2879', null, 'Danny Lee'),
  ('김리안', 'G4S', '초등부', '010-8760-9264', null, 'Rian Kim'),
  ('강하늘', 'G5E', '초등부', '010-2900-6454', null, 'Skye (Haneul) Kang'),
  ('김태윤', 'G5E', '초등부', '010-9125-7874', null, 'Teddy Kim'),
  ('이온유', 'G5E', '초등부', '010-7293-7118', '010-7239-8383', 'Roy Lee'),
  ('송우진', 'G5E', '초등부', '010-9142-9438', null, 'Daniel Song'),
  ('김요한', 'G5E', '초등부', '010-3549-1402', null, 'John Kim'),
  ('도윤서', 'G5E', '초등부', '010-3395-6988', null, 'Yoonseo Doh'),
  ('박준후', null, '중고등부', '010-8927-2138', null, 'Justin Park'),
  ('문수민', null, '중고등부', '010-2656-9604', null, 'Clara Moon'),
  ('정도현', null, '중고등부', '010-7140-2415', null, 'Aaron Jung'),
  ('강하엘', null, '중고등부', '010-2900-6454', '010-3256-7938', 'Hael Kang'),
  ('제이콥', null, '중고등부', '010-3497-8172', '010-9725-7489', 'Jacob Dylan Ma'),
  ('강여명', null, '중고등부', '010-5826-8910', null, 'Ryeomyeong Kang'),
  ('후안이그나시오마누키안', null, '중고등부', '010-2718-9975', '010-9660-8975', 'Juan Ignacio Manoukian'),
  ('이도후', null, '중고등부', '010-3772-3110', null, 'Henry Lee'),
  ('박지음', null, '중고등부', '010-5160-9872', null, 'Jeum Park'),
  ('최온유', null, '중고등부', '010-4270-6404', '010-3227-8270', 'Onyu Choi'),
  ('정이건', null, '중고등부', '010-8736-8363', '010-8614-5388', 'Egeon Jeong'),
  ('김엘리사', null, '중고등부', '010-5624-4428', '010-7570-8102', 'Elisha Kim'),
  ('김도율', null, '중고등부', '010-3729-8503', '010-3038-6090', 'Doyul Kim'),
  ('김승후', null, '중고등부', '010-8010-4949', '010-5389-8867', 'Seunghoo Kim'),
  ('김샤론', null, '중고등부', '010-6802-1105', '010-2533-4777', 'Sharon Kim'),
  ('고영', null, '중고등부', '010-3095-2687', null, 'Young Ko'),
  ('이준우', null, '중고등부', '010-4768-7070', '010-4768-7070', 'Roy Lee'),
  ('유하이', null, '중고등부', '010-4181-3216', '010-4082-2942', 'Heather Yu'),
  ('위준완', null, '중고등부', '010-4946-9137', '010-8738-3461', 'Jade We'),
  ('강하영', null, '중고등부', '010-2839-0180', '010-2784-1322', 'Maria Kang'),
  ('노다혜', null, '중고등부', '010-9703-6553', '010-2703-0873', 'Grace Noh'),
  ('박진우', null, '중고등부', '010-9466-9779', '010-4781-9779', 'Jinwoo Park'),
  ('김에스더', null, '중고등부', '010-3880-0283', '010-5697-1400', 'Esther Kim'),
  ('이하은', null, '중고등부', '010-9877-4057', '010-3585-4057', 'Karis Lee'),
  ('이준서', null, '중고등부', '010-4768-7070', '010-8100-0316', 'Paul Lee'),
  ('정에린', null, '중고등부', '010-2971-7758', null, 'Elin Jung'),
  ('노다은', null, '중고등부', '010-9703-6553', '010-2703-0873', 'Daeun Noh'),
  ('장하영', null, '중고등부', '010-4604-8717', '010-2408-3969', 'Hayoung Jang'),
  ('정하담', null, '중고등부', '010-8736-8363', '010-8614-5388', 'Elizabeth Jeong'),
  ('한이준', null, '중고등부', null, '010-4344-3323', 'Leejun Han'),
  ('김태훈', null, '중고등부', '010-6636-6696', '010-4928-3249', 'Tae Hoon Kim'),
  ('신혁', null, '중고등부', '010-5453-3326', '010-6336-3326', 'Shin Hyuck'),
  ('강윤영', null, '중고등부', '010-7678-2718', '010-7183-2357', 'Jennifer Kang'),
  ('마야', 'G3J', '초등부', '010-5302-2929', '010-4657-8467', 'Maya Amelia Dowding');

-- 이름 다듬기: 공백·괄호 제거. 맥에서 온 자모 분리(NFD)도 합쳐 둡니다.
create or replace function pg_temp.flat_name(v text) returns text
language sql immutable as $$
  select lower(regexp_replace(regexp_replace(normalize(coalesce(v,''), NFC), '\(.*?\)', '', 'g'), '[^0-9A-Za-z가-힣]', '', 'g'));
$$;

-- ── 채우기 ─────────────────────────────────────────────────────────────
with pick as (
  select s.id, r.mother, r.father,
         row_number() over (partition by s.id order by (r.cls is not null and s.class_name like r.cls || '%') desc) as rn
  from public.wr_students s
  join roster_in r
    on pg_temp.flat_name(s.name) = pg_temp.flat_name(r.name)
   and (
     -- 동명이인이 아니면 이름만으로 붙입니다.
     (select count(*) from roster_in r2 where pg_temp.flat_name(r2.name) = pg_temp.flat_name(r.name)) = 1
     -- 동명이인이면 반이 같아야 합니다.
     or (r.cls <> '' and coalesce(s.class_name,'') like r.cls || '%')
   )
  where s.is_demo = false and s.status in ('active','재학')
)
update public.wr_students s
set mother_phone = coalesce(s.mother_phone, p.mother),
    father_phone = coalesce(s.father_phone, p.father)
from pick p
where s.id = p.id and p.rn = 1;

-- ── 확인 ① 명단에는 있는데 우리 앱에 없는 아이 (새로 넣어야 할 후보) ──
select r.dept as 부서, r.cls as 반, r.name as 이름, r.name_en as 영문, r.mother as 어머니, r.father as 아버지
from roster_in r
where not exists (
  select 1 from public.wr_students s
  where s.is_demo = false and s.status in ('active','재학')
    and pg_temp.flat_name(s.name) = pg_temp.flat_name(r.name)
)
order by r.dept, r.cls, r.name;

-- ── 확인 ② 우리 앱에는 있는데 명단에 없는 아이 (빼야 할 후보) ──────────
select coalesce(s.department,'') as 부서, coalesce(s.grade,'') as 학년,
       coalesce(s.class_name,'') as 반, s.name as 이름, s.name_en as 영문
from public.wr_students s
where s.is_demo = false and s.status in ('active','재학')
  and not exists (
    select 1 from roster_in r where pg_temp.flat_name(s.name) = pg_temp.flat_name(r.name)
  )
order by 1, 2, 3, 4;

-- ── 확인 ③ 아직 번호가 비어 있는 아이 ─────────────────────────────────
select coalesce(s.grade,'') as 학년, coalesce(s.class_name,'') as 반, s.name as 이름
from public.wr_students s
where s.is_demo = false and s.status in ('active','재학')
  and coalesce(s.mother_phone,'') = '' and coalesce(s.father_phone,'') = '' and coalesce(s.parent_phone,'') = ''
order by 1, 2, 3;
