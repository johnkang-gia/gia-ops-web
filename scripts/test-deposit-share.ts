/**
 * 예치금 공유·사용내역서 회귀 시험(빌드마다). 형이 맡긴 돈을 동생 청구서에 쓰고 남은 돈·환불까지 셈이 맞는지,
 * 자기 돈을 먼저 쓰는지, 정한 금액까지만 빼는지 봅니다. 새 사고가 나면 여기 한 줄을 더합니다.
 */
import { buildDepositStatement, type StatementPay } from "../src/lib/depositStatement";
import { planDeduction } from "../src/lib/depositLines";
const base = { method:"계좌", payer_name:null, memo:null, origin:"미리받음", applied_line_id:null, deposit_applied_at:null, split_from_id:null, shared_from_student_id:null };
// A(형) 맡김 500,000 → 동생 B 청구서에 300,000 사용(쪼갬), 나머지 200,000 A 앞으로
const pays: StatementPay[] = [
  { ...base, id:"p1", student_id:"B", shared_from_student_id:"A", invoice_id:"i1", amount:300000, paid_at:"2026-10-01", matched_by:"예치금 차감 · x", applied_line_id:"L1", deposit_applied_at:"2026-10-10T01:00:00Z" },
  { ...base, id:"p2", student_id:"A", invoice_id:null, amount:200000, paid_at:"2026-10-01", matched_by:"예치금", split_from_id:"p1", memo:"선입금 500,000원 중 300,000원을 X 에 충당하고 남은 금액" },
  { ...base, id:"p3", student_id:"B", invoice_id:null, amount:-50000, paid_at:"2026-10-12", matched_by:"예치금", memo:"환불" },
  { ...base, id:"p4", student_id:"B", invoice_id:"i2", amount:100000, paid_at:"2026-10-05", matched_by:"me@x" },
];
const st = buildDepositStatement(pays, { nameOf:(id)=>({A:"형",B:"동생"} as any)[id??""]??"?", invoiceOf:(id)=>({invoice_no:"2026-0001",issue_date:"2026-10-09",student_id:"B"}), lineName:()=> "정규과정" });

if (st.totals.received!==500000||st.totals.used!==300000||st.totals.refunded!==50000||st.totals.balance!==150000||st.totals.mismatch) throw new Error("statement");
if (st.used[0].from!=="형") throw new Error("from");
// plan: own first
const p = planDeduction([{id:"sib",amount:100,paidAt:"1|2026-01-01|00000"},{id:"own",amount:100,paidAt:"0|2026-05-01|00001"}],[{id:"l",amount:150}]);

if (p.lines[0].takes[0].depositId!=="own") throw new Error("own first");
const q = planDeduction([{id:"a",amount:500,paidAt:"0"}],[{id:"l1",amount:300},{id:"l2",amount:300}],350);
if (q.applied!==350||q.partial?.covered!==50) throw new Error("cap");
console.log("OK");
