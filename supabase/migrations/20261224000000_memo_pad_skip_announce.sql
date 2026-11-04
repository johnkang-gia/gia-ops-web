-- 업무보드 메모장 · 문의 넘기기 · 문의 전체 공지(확성기)
--
-- 1) 메모장(staff_memo_pads): 전화 받으며 적는 칸. 한 사람에 한 장입니다. 브라우저에만 두면 컴퓨터를 바꾸거나
--    캐시를 지우면 적던 것이 사라지므로 표에도 둡니다. 본인만 읽고 씁니다.
-- 2) 넘기기(pickup_requests.skipped_*): 감사 인사처럼 할 일이 없는 토들 글을 오늘의 문의사항에서 내립니다.
--    답함·처리 완료와 따로 둡니다 - 그 둘은 «누가 어떤 일을 처리했나» 보고·통계에 쓰이는데, 인사 글을 처리
--    완료로 누르면 처리 건수가 부풀려집니다. 줄은 지우지 않습니다(지난 문의 검색에는 남습니다).
-- 3) 확성기(announce_inquiry): 문의 한 건을 전체 공지(work_notices)로 올립니다. 공지 쓰기는 관리자만 할 수
--    있어서, 문의 한 건을 올리는 일만 이 함수가 대신합니다(누가 올렸는지는 로그인 열쇠로 정합니다).

-- ── 1) 메모장 ───────────────────────────────────────────────────────────────
create table if not exists public.staff_memo_pads (
  user_email text primary key,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.staff_memo_pads enable row level security;
drop policy if exists staff_memo_pads_own on public.staff_memo_pads;
create policy staff_memo_pads_own on public.staff_memo_pads
  for all to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'))
  with check (user_email = lower(auth.jwt() ->> 'email'));
revoke all on public.staff_memo_pads from anon;

-- ── 2) 넘기기 · 3) 공지 표시 ────────────────────────────────────────────────
alter table public.pickup_requests add column if not exists skipped_at timestamptz;
alter table public.pickup_requests add column if not exists skipped_by text;
alter table public.pickup_requests add column if not exists announced_at timestamptz;
alter table public.pickup_requests add column if not exists announced_by text;
alter table public.pickup_requests add column if not exists announce_notice_id uuid;

create or replace function public.announce_inquiry(p_id uuid, p_title text, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(nullif(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''), ''));
  v_notice uuid;
begin
  if v_email is null or not public.is_giamicro_user() then
    raise exception '교직원만 공지로 올릴 수 있습니다.';
  end if;
  if not exists (select 1 from public.pickup_requests where id = p_id) then
    raise exception '문의를 찾지 못했습니다.';
  end if;
  insert into public.work_notices (scope, title, body, author_email)
  values ('전체', left(coalesce(nullif(btrim(p_title), ''), '📢 문의'), 120), p_body, v_email)
  returning id into v_notice;
  update public.pickup_requests
     set announced_at = now(), announced_by = v_email, announce_notice_id = v_notice
   where id = p_id;
  return v_notice;
end $$;

revoke all on function public.announce_inquiry(uuid, text, text) from anon, public;
grant execute on function public.announce_inquiry(uuid, text, text) to authenticated;

-- 활동 기록에 넘김·공지를 더합니다(나머지는 20261222000000 과 같습니다).
create or replace function public.trg_activity_pickup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s text := coalesce(new.summary, left(new.raw_text, 60), new.channel_label, '');
begin
  if new.replied_at is not null and old.replied_at is null then
    if coalesce(new.replied_via, '') = '토들 답글' then
      perform public.activity_log_write('문의', '답함(토들 답글)', s, new.student_id, 'pickup_requests', new.id, new.replied_by);
    else
      perform public.activity_log_write('문의', '답함', s, new.student_id, 'pickup_requests', new.id, new.replied_by);
    end if;
  elsif new.replied_at is null and old.replied_at is not null then
    perform public.activity_log_write('문의', '답함 되돌림', s, new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.answered_at is not null and old.answered_at is null then
    perform public.activity_log_write('문의', '처리 완료', s, new.student_id, 'pickup_requests', new.id, new.answered_by);
  elsif new.answered_at is null and old.answered_at is not null then
    perform public.activity_log_write('문의', '처리 완료 되돌림', s, new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.skipped_at is not null and old.skipped_at is null then
    perform public.activity_log_write('문의', '넘김', s, new.student_id, 'pickup_requests', new.id, new.skipped_by);
  elsif new.skipped_at is null and old.skipped_at is not null then
    perform public.activity_log_write('문의', '넘김 되돌림', s, new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.announced_at is not null and old.announced_at is distinct from new.announced_at then
    perform public.activity_log_write('문의', '전체 공지', s, new.student_id, 'pickup_requests', new.id, new.announced_by);
  end if;

  if coalesce(new.assignees, '{}') is distinct from coalesce(old.assignees, '{}') then
    perform public.activity_log_write(
      '문의', '담당 지정',
      s || ' → ' || coalesce((select string_agg(coalesce(u.name, a), ', ') from unnest(new.assignees) a left join public.app_users u on u.email = a), '없음'),
      new.student_id, 'pickup_requests', new.id, new.assigned_by);
  end if;

  if coalesce(new.badges, '{}') is distinct from coalesce(old.badges, '{}') and old.badges <> '{}' then
    perform public.activity_log_write('문의', '분류 수정', s || ' · ' || array_to_string(new.badges, '·'), new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.student_id is distinct from old.student_id and new.student_id is not null then
    perform public.activity_log_write('문의', '학생 연결', s, new.student_id, 'pickup_requests', new.id, null);
  end if;

  if new.status is distinct from old.status and new.kind = '픽업' then
    perform public.activity_log_write('픽업', '픽업 ' || new.status, s, new.student_id, 'pickup_requests', new.id,
      case when new.resolved_by = 'AI' then null else new.resolved_by end);
  end if;
  return new;
exception when others then
  raise warning 'staff activity trigger: %', sqlerrm;
  return new;
end $$;
