-- 주간 관찰기록: 담임 선생님들이 한꺼번에 쓰기 시작하기 전 점검·보강
--
-- 담당자: "다음 주부터 담임 선생님들이 대거 (...) 대량의 데이터가 들어가게 될 텐데
--          오류가 없었으면 좋겠어."
--
-- 지금까지는 몇 명이 띄엄띄엄 썼기 때문에 드러나지 않던 것들이 있습니다.
-- 이 파일은 **저장이 실패하지 않도록** 데이터베이스 쪽을 맞춥니다.

-- ── ① 저장(upsert)이 기대는 유일 인덱스 ─────────────────────────────────
--
-- 앱은 (student_id, subject, report_date)로 upsert 합니다. 이 조합의 유일 인덱스가
-- **없거나 조건이 붙어 있으면** 저장이 매번 42P10으로 튕깁니다. 오늘 출결 쪽에서
-- 똑같은 이유로 모든 저장이 조용히 실패하고 있었습니다 - 같은 실수를 반복하지 않도록
-- 여기서 못 박습니다.
--
-- 조건(where)은 절대 붙이지 않습니다. 조건이 붙은 유일 인덱스는 명령문에도 같은 조건을
-- 적어야 인식되는데, Supabase의 upsert는 열쇠 칸 이름만 보냅니다.
do $$
begin
  if to_regclass('public.wr_reports') is null then
    raise notice '건너뜀 · wr_reports 표가 없습니다';
    return;
  end if;

  -- 이미 중복이 있으면 유일 인덱스를 걸 수 없습니다. 있는지 먼저 봅니다.
  if exists (
    select 1 from public.wr_reports
     group by student_id, subject, report_date
    having count(*) > 1
  ) then
    raise exception '중복이 있어 유일 인덱스를 걸 수 없습니다. 아래 ②의 조회로 확인 후 정리해주세요.';
  end if;

  create unique index if not exists wr_reports_student_subject_date_uniq
    on public.wr_reports (student_id, subject, report_date);
end $$;

-- ── ② 조회 속도 ──────────────────────────────────────────────────────────
--
-- 137명 × 과목 × 주차가 쌓이면 한 학기에 수만 줄이 됩니다. 아래 세 가지가 실제로
-- 화면에서 쓰는 조회 모양입니다.
create index if not exists wr_reports_student_date_idx
  on public.wr_reports (student_id, report_date desc);

create index if not exists wr_reports_term_date_idx
  on public.wr_reports (term_id, report_date);

-- 통계 화면: "이번 주, 이 상태" 세기.
create index if not exists wr_reports_status_date_idx
  on public.wr_reports (status, report_date);

-- 반별 보기.
create index if not exists wr_reports_class_date_idx
  on public.wr_reports (class_id, report_date);

-- ── ③ 확인 ───────────────────────────────────────────────────────────────
select indexname as "인덱스",
       case when indexdef like '%WHERE%' then '⚠️ 조건이 붙어 있습니다(upsert 실패 원인)' else '✅ 정상' end as "상태"
  from pg_indexes
 where schemaname = 'public' and tablename = 'wr_reports'
 order by indexname;
