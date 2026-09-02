-- ═══════════════════════════════════════════════════════════════════════════
-- 학기를 나머지 기록에도 — Supabase SQL Editor 붙여넣기용
--
-- 문서·메뉴얼·시간표·당번표·공지·출결에 학기 칸을 만들고, 지금 있는 줄을 전부 진행중인
-- 학기로 넘깁니다. 그리고 **새로 들어오는 줄은 저절로 지금 학기에 붙게** 합니다.
--
-- 먼저 학기_통합.sql 을 실행해주세요. 여러 번 실행해도 됩니다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 나머지 기록도 학기에 붙입니다
--
-- 업무·회의·사건기록·관찰기록은 이미 학기에 붙어 있었습니다. 문서·메뉴얼·시간표·당번표·
-- 공지·출결은 아직 아니었습니다. 지금은 자료가 얼마 없어서 옮기기 쉽습니다 - 한 학기만 더
-- 지나도 수천 줄을 나중에 갈라야 합니다.
--
-- 그리고 **새로 들어오는 줄은 저절로 지금 학기에 붙게** 합니다. 넣는 자리마다 학기를 적게
-- 하면 반드시 어딘가에서 빠뜨리고, 빠뜨린 줄은 어느 학기에서도 안 보입니다.

-- ── 1. 학기 칸 ─────────────────────────────────────────────────────────
alter table public.documents        add column if not exists term_id uuid references public.terms(id) on delete set null;
alter table public.manual_sections  add column if not exists term_id uuid references public.terms(id) on delete set null;
alter table public.wr_timetable     add column if not exists term_id uuid references public.terms(id) on delete set null;
alter table public.duty_roster      add column if not exists term_id uuid references public.terms(id) on delete set null;
alter table public.work_notices     add column if not exists term_id uuid references public.terms(id) on delete set null;
alter table public.attendance_records add column if not exists term_id uuid references public.terms(id) on delete set null;

create index if not exists documents_term_idx          on public.documents (term_id);
create index if not exists manual_sections_term_idx    on public.manual_sections (term_id);
create index if not exists wr_timetable_term_idx       on public.wr_timetable (term_id);
create index if not exists duty_roster_term_idx        on public.duty_roster (term_id);
create index if not exists work_notices_term_idx       on public.work_notices (term_id);
create index if not exists attendance_records_term_idx on public.attendance_records (term_id);

-- ── 2. 넣을 때 학기를 저절로 붙입니다 ──────────────────────────────────
--
-- 넣는 자리가 수십 곳입니다. 사람이 매번 적게 하면 빠뜨리고, 빠뜨린 줄은 어느 학기에서도
-- 보이지 않습니다. **화면이 아니라 DB가** 붙입니다.
create or replace function public.stamp_current_term()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.term_id is null then
    new.term_id := (select id from public.terms where status = '진행중' order by start_date desc nulls last limit 1);
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'documents', 'manual_sections', 'wr_timetable', 'duty_roster', 'work_notices',
    'attendance_records', 'tasks', 'meetings', 'incidents', 'wr_reports',
    'fee_items', 'invoices', 'shuttle_routes'
  ]
  loop
    execute format('drop trigger if exists %I_stamp_term on public.%I', t, t);
    execute format(
      'create trigger %I_stamp_term before insert on public.%I for each row execute function public.stamp_current_term()',
      t, t
    );
  end loop;
end $$;

-- ── 3. 이미 있는 줄을 지금 학기로 ──────────────────────────────────────
do $$
declare cur uuid;
begin
  select id into cur from public.terms where status = '진행중' order by start_date desc nulls last limit 1;
  if cur is null then return; end if;

  update public.documents          set term_id = cur where term_id is null;
  update public.manual_sections    set term_id = cur where term_id is null;
  update public.wr_timetable       set term_id = cur where term_id is null;
  update public.duty_roster        set term_id = cur where term_id is null;
  update public.work_notices       set term_id = cur where term_id is null;
  update public.attendance_records set term_id = cur where term_id is null;
  update public.tasks              set term_id = cur where term_id is null;
  update public.meetings           set term_id = cur where term_id is null;
  update public.incidents          set term_id = cur where term_id is null;
  update public.wr_reports         set term_id = cur where term_id is null;
end $$;

-- ── 4. 학기별로 무엇이 쌓였는지 ────────────────────────────────────────
-- 학기를 넘긴 뒤 "그때 자료가 남아 있나"를 한 줄로 확인합니다.
create or replace view public.term_archive as
select
  t.id, t.year, t.term_type, t.status, t.start_date, t.end_date, t.shuttle_label,
  (select count(*) from public.shuttle_routes r where r.term = t.shuttle_label) as 노선,
  (select count(*) from public.fee_items i     where i.term_id = t.id) as 학비외항목,
  (select count(*) from public.invoices v      where v.term_id = t.id) as 청구서,
  (select count(*) from public.tasks k         where k.term_id = t.id) as 업무,
  (select count(*) from public.meetings m      where m.term_id = t.id) as 회의,
  (select count(*) from public.incidents c     where c.term_id = t.id) as 사건기록,
  (select count(*) from public.wr_reports w    where w.term_id = t.id) as 관찰기록,
  (select count(*) from public.documents d     where d.term_id = t.id) as 문서,
  (select count(*) from public.manual_sections s where s.term_id = t.id) as 메뉴얼,
  (select count(*) from public.wr_enrollments e where e.term_id = t.id) as 학생소속
from public.terms t;

revoke all on public.term_archive from anon;
grant select on public.term_archive to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260902300000', 'term_everywhere')
on conflict (version) do nothing;

-- 확인 — 학기별로 무엇이 쌓였는지. 지금은 진행중인 학기 한 줄에 전부 모여 있어야 합니다.
select * from public.term_archive order by status, start_date desc nulls last;
