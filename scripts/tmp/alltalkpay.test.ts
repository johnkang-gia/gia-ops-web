import { normalizePhone, buildBillPlan, memoFor, toAoa, DEFAULT_HEADERS, type BillInvoice } from "../../src/lib/alltalkpay";
let pass = 0, fail = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) pass++; else { fail++; console.log("✗", m, "\n  받음:", JSON.stringify(a), "\n  기대:", JSON.stringify(b)); }
};
eq(normalizePhone("010-8654-7611"), "01086547611", "하이픈 제거");
eq(normalizePhone(" 010 8654 7611 "), "01086547611", "공백 제거");
eq(normalizePhone("+82 10-8654-7611"), "01086547611", "국가번호 → 0");
eq(normalizePhone("02-555-1234"), null, "유선번호는 거절");
eq(normalizePhone(""), null, "빈 값");
eq(normalizePhone(null), null, "null");
eq(memoFor(["Grade 2 Textbook Set", "Cello Rental", "Uniform"]), "Grade 2 Textbook Set, Cello Rental 외 1건", "길이를 넘으면 줄임");
eq(memoFor(["Grade 2 Textbook Set Extended Edition", "Cello Rental", "Uniform"]), "Grade 2 Textbook Set Extended Edition 외 2건", "첫 항목이 길면 하나만");
eq(memoFor(["교재", "악기"]), "교재, 악기", "짧으면 그대로");
eq(memoFor([]), "학비외 납부", "항목 없음");

const inv = (o: Partial<BillInvoice> & { invoice_no: string }): BillInvoice => ({
  id: "i-" + o.invoice_no, student_id: "s", student_name: "X", student_name_ko: "학생", grade_label: null,
  total_amount: 10000, due_date: "2026-09-12", guardian_phone: "010-1111-2222", exported_at: null, itemNames: ["교재"], ...o,
});

const p1 = buildBillPlan([inv({ invoice_no: "A", student_name_ko: "고서윤" }), inv({ invoice_no: "B", student_name_ko: "고진우" })], { mergeSiblings: false });
eq(p1.rows.length, 2, "합치지 않으면 두 줄");
eq(p1.sharedPhones.length, 1, "같은 번호는 합치지 않아도 세어 알려줌");
eq(p1.total, 20000, "합계");

const p2 = buildBillPlan([inv({ invoice_no: "A", student_name_ko: "고서윤" }), inv({ invoice_no: "B", student_name_ko: "고진우", due_date: "2026-09-20" })], { mergeSiblings: true });
eq(p2.rows.length, 1, "형제 합치면 한 줄");
eq(p2.rows[0].amount, 20000, "형제 금액 합산");
eq(p2.rows[0].dueDate, "2026-09-12", "납부기한은 빠른 쪽");
eq(p2.rows[0].invoiceNos, ["A", "B"], "관리번호 둘 다");

const p3 = buildBillPlan([inv({ invoice_no: "A", guardian_phone: null, student_name_ko: "홍길동" }), inv({ invoice_no: "B" })], { mergeSiblings: false });
eq(p3.rows.length, 1, "연락처 없는 건은 파일에 안 넣음");
eq(p3.missing.length, 1, "대신 따로 모음");
eq(p3.missing[0].name, "홍길동", "누가 빠졌는지");

const p4 = buildBillPlan([inv({ invoice_no: "A", exported_at: "2026-09-01T00:00:00Z" })], { mergeSiblings: false });
eq(p4.rows[0].resent, true, "이미 보낸 건은 표시");

const aoa = toAoa(p1.rows, { ...DEFAULT_HEADERS });
eq(aoa[0], ["고객명", "휴대폰번호", "청구금액", "청구내용", "납부기한", "관리번호"], "머리글");
eq(typeof aoa[1][1], "string", "번호는 글자 (앞의 0이 날아가지 않게)");
eq(typeof aoa[1][2], "number", "금액은 숫자");

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ""}`);
process.exit(fail ? 1 : 0);
