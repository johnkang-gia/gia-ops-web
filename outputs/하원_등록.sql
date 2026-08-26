-- 하원 배정 재등록 - 검증을 통과해야만 들어갑니다.
--
-- 담당자: "앞으로 데이터 무조건 밀어넣지 말고 검증하고 넣어."
-- 그래서 이 파일은 **스스로 검증하고, 하나라도 어긋나면 통째로 되돌립니다.**
-- 한 트랜잭션이라 중간에 멈추면 아무것도 바뀌지 않습니다.
--
-- 들어가는 것
--   학생·요일·특이사항   ← 하원차량 체크 PDF (105줄, 90명)
--   호차·기사님·동승     ← 엑셀 (이미 등록되어 있는 것을 그대로 씁니다. 건드리지 않습니다)
--
-- 요일 표기 규칙(담당자 확인)
--   이름 앞 (요일)  = 그 요일에 타는 아이      → weekdays 에 그 요일만
--   이름 뒤 (요일X) = 그 요일에 안 타는 아이   → weekdays 에서 그 요일만 뺌
--   표기 없음       = 매일                    → weekdays = {1,2,3,4,5}
--
-- 승인받은 보정 3가지
--   임지효  10호 → 월금        (4-2호가 화수목이라 나머지)
--   정서우  22호 → 화수목금    (12-1호가 월이라 나머지)
--   이준서·이준우  4-2호/9호 둘 다 등록. 요일이 아니라 목적지로 갈리므로
--                  특이사항에 '학원 가는 날' / '집·기업은행 가는 날' 을 적어둡니다.

begin;

-- ─────────────────────────────────────────────────────────────
-- ① 백업. 되돌릴 곳이 없으면 이 작업을 하면 안 됩니다.
-- ─────────────────────────────────────────────────────────────
drop table if exists shuttle_assignments_backup_20260826;
create table shuttle_assignments_backup_20260826 as
select a.*, r.route_no, r.direction, s.seq as stop_seq, s.address as stop_address
  from shuttle_assignments a
  join shuttle_stops   s on s.id = a.stop_id
  join shuttle_routes  r on r.id = s.route_id
 where r.direction = '하원' and r.term = '정규학기';

-- ─────────────────────────────────────────────────────────────
-- ② PDF 105줄을 명부와 대조합니다.
-- ─────────────────────────────────────────────────────────────
create temp table _pdf on commit drop as
with 
pdf(route_no, name, cls, dept, alias_en, weekdays, note) as (values
('1-1','김단우','','','','{1,2,3,4,5}'::int[],''),
('1-1','이연우','','','','{1,2,3,4,5}'::int[],''),
('1-2','김서진','','','','{1,3,5}'::int[],''),
('2-1','정레인','','','','{1,2,3,4,5}'::int[],''),
('3','곽세린','','','','{1,2,3,4,5}'::int[],''),
('3','도윤서','','','','{1,2,3,4,5}'::int[],''),
('4','연하윤','','','','{1,2,3,4,5}'::int[],''),
('4','김재이','G3JA','','','{4}'::int[],''),
('4','전준백','','','','{1,2,3,4,5}'::int[],''),
('4-2','이서아','','','','{1,2,3,4,5}'::int[],''),
('4-2','이준서','','중등','','{1,2,3,4,5}'::int[],'학원 가는 날'),
('4-2','이준우','','','','{1,2,3,4,5}'::int[],'학원 가는 날'),
('4-2','임지효','','','','{2,3,4}'::int[],''),
('5','이서준','','','','{1,2,3,4,5}'::int[],''),
('5','임예나','','','','{1,2,3,4,5}'::int[],''),
('5','김도율','','','','{1,2,3,4,5}'::int[],''),
('7','고진우','','','','{1,2,3,4,5}'::int[],''),
('7','이준서','','초등','','{1,2,3,4,5}'::int[],''),
('7','강예성','','','','{1,2,3,4,5}'::int[],''),
('8','홍서형','','','','{1,2,3,4,5}'::int[],''),
('8','김샤론','','','','{1,3}'::int[],''),
('9','황이안','','','','{1,2,3,5}'::int[],''),
('9','이준서','','중등','','{1,5}'::int[],'집·기업은행 가는 날'),
('9','이준우','','','','{1,2,3,4,5}'::int[],'집·기업은행 가는 날'),
('9-1','김서이','','','','{1,2,3,4,5}'::int[],''),
('9-2','김나율','','','','{1,2,3,4,5}'::int[],''),
('10','임지효','','','','{1,5}'::int[],''),
('10','유재이','','','','{2,4,5}'::int[],''),
('11','이준원','','','','{1,2,3,4,5}'::int[],''),
('11','이신원','','','','{1,2,3,4,5}'::int[],''),
('11','마야','','','Maya Amelia','{1,2,3,4,5}'::int[],''),
('12','차봄','','','','{1,3,5}'::int[],''),
('12','황준호','','','','{1,2,3,4,5}'::int[],''),
('12','황라원','','','','{1,2,3,4,5}'::int[],''),
('12','황라윤','','','','{1,2,3,4,5}'::int[],''),
('12-1','남가인','','','','{1,3,4,5}'::int[],''),
('12-1','정서우','','','','{1}'::int[],''),
('12-1','강하라','','','','{1}'::int[],''),
('13','권태이','','','','{1,2,3,4,5}'::int[],''),
('13','이하은','','','','{1,2,3,4,5}'::int[],''),
('13','최온유','','','','{1,2,3,4,5}'::int[],''),
('13','위준완','','','','{1,2,3,4,5}'::int[],''),
('14','박준후','','','','{2,3,5}'::int[],''),
('14','김요한','','','','{1,2,4,5}'::int[],''),
('15','심규민','','','','{1,3,4}'::int[],''),
('16','김승후','','','','{1,2,3,4,5}'::int[],''),
('16-1','김재이','G2A','','','{1,2,3,4,5}'::int[],''),
('16-1','최서아','','','','{2}'::int[],''),
('16-1','문수민','','','','{1,2,3,4,5}'::int[],''),
('16-1','노다은','','','','{1,2,3,4,5}'::int[],''),
('16-1','노다혜','','','','{1,2,3,4,5}'::int[],''),
('18','주이안','','','','{1,2,3,4,5}'::int[],''),
('18','이도후','','','','{1,2,3,4,5}'::int[],''),
('19','곽호율','','','','{1,2,4}'::int[],''),
('19','고서윤','','','','{2,3,4,5}'::int[],''),
('20','김재이','G2C','','','{1,2,3,4,5}'::int[],''),
('20','이서현','','','','{1,2,3,4,5}'::int[],''),
('20','지수','','','','{1,2,4,5}'::int[],''),
('20','곽호율','','','','{5}'::int[],''),
('20','박지음','','','','{2,3,4,5}'::int[],''),
('21','김지민','','','','{1,2,3,4,5}'::int[],''),
('21','강서후','','','','{1,2,3,4,5}'::int[],''),
('21','이현우','','','','{1,3,4,5}'::int[],''),
('21','박준후','','','','{1,4}'::int[],''),
('22','정서우','','','','{2,3,4,5}'::int[],''),
('23-1','민송희','','','','{2,3,4,5}'::int[],''),
('23-2','서민준','','','','{1,2,3,4,5}'::int[],''),
('23-2','심재이','','','','{1,2,3,4,5}'::int[],''),
('24','이온유','','','','{1,2,3,4,5}'::int[],''),
('24','강여명','','','','{1,2,3,4,5}'::int[],''),
('24','강이제','','','','{1,2,3,4,5}'::int[],''),
('26','전지완','','','','{1,3,5}'::int[],''),
('26-1','민송희','','','','{1}'::int[],''),
('26-1','김재이','G3JA','','','{1}'::int[],''),
('26-1','박지음','','','','{1}'::int[],''),
('26-1','김도은','','','','{1,2,3,4,5}'::int[],''),
('26-1','이한범','','','','{1,2,3,4}'::int[],''),
('26-1','원세빈','','','','{1,2,3,4,5}'::int[],''),
('26-1','권수호','','','','{1,2,4,5}'::int[],''),
('26-1','남가인','','','','{2}'::int[],''),
('26-2','황시원','','','','{1,2,3,4,5}'::int[],''),
('26-2','황이준','','','','{1,2,3,4,5}'::int[],''),
('26-2','이예나','','','','{1,2,3,4,5}'::int[],''),
('26-2','고이건','','','','{1,2,3,4,5}'::int[],''),
('27','이예온','','','','{1,2,4}'::int[],''),
('27','임하임','','','','{1,2,3,4,5}'::int[],''),
('27','강하영','','','','{1,2,3,4,5}'::int[],''),
('28','이예온','','','','{3,5}'::int[],''),
('28','이한범','','','','{5}'::int[],''),
('28','문준연','','','','{1,4,5}'::int[],''),
('28','송우진','','','','{1,2,3,4,5}'::int[],''),
('28','송윤진','','','','{1,2,3,4,5}'::int[],''),
('29','노유겸','','','','{1,2,3,4,5}'::int[],''),
('30','이아인','','','','{1,2,3,4,5}'::int[],''),
('30','한우영','','','','{1,2,3,4,5}'::int[],''),
('30','김리안','','','','{1,2,3,4}'::int[],''),
('30','김현수','','','','{1,2,3,4}'::int[],''),
('30-1','백서아','','','','{1,2,3}'::int[],''),
('30-1','이라엘','','','','{1,2,4,5}'::int[],''),
('30-1','박진우','','','','{2,4}'::int[],''),
('31','제이콥','','','Jacob Dylan Ma','{1,2,3,4,5}'::int[],''),
('31','에이바','','','Elliana Ma','{1,2,3,4,5}'::int[],''),
('31','장하영','','','','{1,2,3,4,5}'::int[],''),
('31','강하늘','','','','{1,2,3,4,5}'::int[],''),
('31','강하엘','','','','{1,2,3,4,5}'::int[],'')
),
cand as (
  select p.*, w.id as sid, w.name as w_name, w.name_en, w.grade, w.class_name,
         (p.alias_en <> '' and public.norm_name(w.name_en) like '%' || public.norm_name(p.alias_en) || '%') as ok_en,
         (p.cls <> '' and public.norm_name(w.class_name) = public.norm_name(p.cls)) as ok_cls,
         (p.cls <> '' and regexp_replace(coalesce(w.grade,''),'[^0-9]','','g') = regexp_replace(p.cls,'[^0-9]','','g')) as ok_grade,
         (p.dept='중등' and coalesce(nullif(regexp_replace(coalesce(w.grade,''),'[^0-9]','','g'),'')::int,0) >= 7) as ok_mid,
         (p.dept='초등' and coalesce(nullif(regexp_replace(coalesce(w.grade,''),'[^0-9]','','g'),'')::int,0) between 1 and 6) as ok_ele,
         (p.alias_en='' and p.cls='' and p.dept='') as ok_plain
    from pdf p
    left join wr_students w
      on w.status='active' and w.is_demo=false
     and (public.norm_name(w.name) = public.norm_name(p.name)
          or (p.alias_en <> '' and public.norm_name(w.name_en) like '%' || public.norm_name(p.alias_en) || '%'))
),
flag as (select c.*, bool_or(c.ok_cls) over (partition by c.route_no, c.name) as has_cls from cand c),
matched as (
  select route_no, name, cls, dept, weekdays, note, sid, w_name, grade, class_name,
         (sid is not null and (ok_en or ok_cls or (ok_grade and not has_cls) or ok_mid or ok_ele or ok_plain)) as ok
    from flag
)
select * from matched;

-- ③ 검증 문지기 - 하나라도 어긋나면 여기서 멈춥니다.
do $$
declare bad int; missing text;
begin
  -- (가) 한 명으로 확정되지 않은 줄
  select count(*) into bad from (
    select route_no, name from _pdf group by 1,2 having count(*) filter (where ok) <> 1
  ) t;
  if bad > 0 then
    raise exception '검증 실패: %건이 한 명으로 확정되지 않았습니다. 아무것도 바꾸지 않고 멈춥니다.', bad;
  end if;

  -- (나) PDF에는 있는데 DB에 없는 호차
  select string_agg(distinct p.route_no, ', ') into missing
    from _pdf p
   where not exists (
     select 1 from shuttle_routes r
      where r.direction='하원' and r.term='정규학기' and r.route_no = p.route_no);
  if missing is not null then
    raise exception '검증 실패: 다음 호차가 DB에 없습니다 - %. 노선부터 만들어야 합니다.', missing;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- ④ 정류장. 이 PDF는 배차표라 정류장이 없습니다(호차와 아이 이름뿐).
--    그래서 정류장은 **기존 것을 물려받고**, 없으면 노선마다 '정류장 미지정'을
--    하나 만들어 거기에 답니다. 나중에 화면에서 옮기시면 됩니다.
-- ─────────────────────────────────────────────────────────────
insert into shuttle_stops (route_id, seq, gate, note)
select r.id, 999, '정류장 미지정', 'PDF에 정류장이 없어 임시로 만든 자리입니다. 화면에서 옮겨주세요.'
  from shuttle_routes r
 where r.direction='하원' and r.term='정규학기'
   and r.route_no in (select distinct route_no from _pdf)
   and not exists (select 1 from shuttle_stops s where s.route_id = r.id and s.seq = 999);

-- ─────────────────────────────────────────────────────────────
-- ⑤ 기존 하원 배정을 비우고 PDF 기준으로 다시 넣습니다.
-- ─────────────────────────────────────────────────────────────
delete from shuttle_assignments a
 using shuttle_stops s, shuttle_routes r
 where a.stop_id = s.id and s.route_id = r.id
   and r.direction = '하원' and r.term = '정규학기';

insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, note)
select
  -- 예전에 이 아이가 이 노선에서 서던 정류장이 있으면 그대로 물려받습니다.
  coalesce(
    (select b.stop_id from shuttle_assignments_backup_20260826 b
      where b.student_id = p.sid and b.route_no = p.route_no limit 1),
    (select s.id from shuttle_stops s
       join shuttle_routes r on r.id = s.route_id
      where r.direction='하원' and r.term='정규학기' and r.route_no = p.route_no
        and s.seq = 999 limit 1)
  ),
  p.sid, p.w_name, p.class_name, p.weekdays, nullif(p.note,'')
  from _pdf p
 where p.ok;

commit;

-- ─────────────────────────────────────────────────────────────
-- 결과 확인
-- ─────────────────────────────────────────────────────────────
select '등록 결과' as "구분",
       count(*) as "배정 줄", count(distinct a.student_id) as "학생 수",
       count(*) filter (where a.student_id is null) as "명부 미연결(0이어야 정상)"
  from shuttle_assignments a
  join shuttle_stops s on s.id = a.stop_id
  join shuttle_routes r on r.id = s.route_id and r.direction='하원' and r.term='정규학기';

select r.route_no as "호차", count(*) as "인원",
       string_agg(a.student_name_raw ||
         case when a.weekdays = '{1,2,3,4,5}'::int[] then ''
              else '(' || (select string_agg(x, '' order by ord)
                             from unnest(a.weekdays) with ordinality u(d, ord)
                             join (values (1,'월'),(2,'화'),(3,'수'),(4,'목'),(5,'금')) v(n,x) on v.n = u.d) || ')'
         end, ', ' order by a.student_name_raw) as "명단"
  from shuttle_assignments a
  join shuttle_stops s on s.id = a.stop_id
  join shuttle_routes r on r.id = s.route_id and r.direction='하원' and r.term='정규학기'
 group by 1 order by 1;
