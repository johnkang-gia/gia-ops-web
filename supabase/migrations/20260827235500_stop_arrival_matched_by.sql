-- 정류장 도착을 "어떤 좌표로, 어떤 반경에서" 잡았는지 남깁니다.
--
-- 담당자: "정류장 반경을 너무 빡빡하게 잡지 말고 (...) 날짜별로 계속 대조해서 점차
--          줄여나가면 될 것 같아."
--
-- 줄여나가려면 지금 어느 단계인지가 보여야 합니다. 이 칸에 '주소/250m' → '학습중/150m'
-- → '학습됨/80m'이 그대로 남으므로, 날짜별로 훑어보면 정확도가 실제로 올라가는지
-- 눈으로 확인할 수 있습니다. 안 올라가면 그것도 그 자리에서 드러납니다.

alter table public.shuttle_stop_arrivals
  add column if not exists matched_by text;

comment on column public.shuttle_stop_arrivals.matched_by is
  '도착을 인정한 근거. "좌표출처/허용반경" 형식(예: 주소/250m, 학습됨/80m).';

-- 확인
select column_name as "칸", data_type as "형식"
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shuttle_stop_arrivals'
 order by ordinal_position;
