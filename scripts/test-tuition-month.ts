/**
 * 학비 「이 달에 청구됐나」 회귀 시험 — 지난 사고를 실제 함수에 다시 넣어 봅니다.
 *
 * 사고 1 (2026-10-28): 범위(`plan_scope`)를 안 적고 나간 LMA 30만 한 줄짜리 장이 「학비 전부」로 읽혀,
 * 정규과정 990만을 한 번도 안 낸 학생이 11월 화면에서 완납(초록)으로 떴습니다. 줄이 있으면 줄로 가립니다.
 */
import { invoiceCoversPlan, planBillForMonth } from "../src/lib/tuitionMonth";

let failed = 0;
function ok(name: string, cond: boolean) {
  if (!cond) {
    failed += 1;
    console.error(`  ✗ ${name}`);
  } else console.log(`  ✓ ${name}`);
}

const 정규 = { id: "p-reg", name: "정규과정", unit: "학기" };
const LMA = { id: "p-lma", name: "Learning Management & Assessment Fee(Annual)", unit: "연" };

// 범위 없음 + LMA 줄 하나 → 정규과정은 안 담은 것
const lmaOnly = { id: "v1", issue_date: "2026-10-02", billing_month: "2026-10", plan_scope: null, lines: [{ name: LMA.name, plan_id: LMA.id }] };
ok("LMA 한 줄짜리 장은 정규과정을 덮지 않는다", !invoiceCoversPlan(lmaOnly, 정규));
ok("같은 장은 LMA 는 덮는다", invoiceCoversPlan(lmaOnly, LMA));
const mb = planBillForMonth({ plan: 정규, option: { periods: 1 }, paidFrom: null, invoices: [lmaOnly], month: "2026-11" });
ok("11월 정규과정은 미청구", !mb.covered);

// 번호 없는 옛 줄은 「항목 이름 · 옵션」 모양으로 가린다
const legacy = { id: "v2", issue_date: "2026-09-01", billing_month: "2026-09", plan_scope: null, lines: [{ name: "정규과정 · 직접 기입", plan_id: null }] };
ok("옛 줄은 이름 앞부분으로 정규과정을 덮는다", invoiceCoversPlan(legacy, 정규));
ok("옛 줄은 LMA 를 덮지 않는다", !invoiceCoversPlan(legacy, LMA));

// 줄도 범위도 모르면 예전처럼 전부
const unknown = { id: "v3", issue_date: "2026-09-01", billing_month: "2026-09", plan_scope: null };
ok("줄·범위 둘 다 없으면 학비 전부", invoiceCoversPlan(unknown, 정규));
ok("빈 줄 목록은 «모름»이라 범위 글자로", invoiceCoversPlan({ ...unknown, lines: [], plan_scope: "정규과정" }, 정규) && !invoiceCoversPlan({ ...unknown, lines: [], plan_scope: "방과후 5일반" }, 정규));

// 월 납부는 달마다
const oct = { id: "v4", issue_date: "2026-10-01", billing_month: "2026-10", plan_scope: "방과후 5일반", lines: [{ name: "방과후 5일반 · 월 납부", plan_id: "p-5" }] };
const 방과후 = { id: "p-5", name: "방과후 5일반", unit: "월" };
ok("월 납부 10월 장은 10월만", planBillForMonth({ plan: 방과후, option: { periods: 1 }, paidFrom: null, invoices: [oct], month: "2026-10" }).covered);
ok("월 납부 11월은 미청구", !planBillForMonth({ plan: 방과후, option: { periods: 1 }, paidFrom: null, invoices: [oct], month: "2026-11" }).covered);
// 5개월 납부는 10~2월
const five = planBillForMonth({ plan: 방과후, option: { periods: 5 }, paidFrom: null, invoices: [oct], month: "2027-02" });
ok("5개월 납부는 2월까지 덮는다", five.covered && five.span?.to === "2027-02");
ok("5개월 납부는 3월은 미청구", !planBillForMonth({ plan: 방과후, option: { periods: 5 }, paidFrom: null, invoices: [oct], month: "2027-03" }).covered);

if (failed > 0) {
  console.error(`\ntest-tuition-month: ${failed}건 실패`);
  process.exit(1);
}
console.log("test-tuition-month: 모두 통과");
