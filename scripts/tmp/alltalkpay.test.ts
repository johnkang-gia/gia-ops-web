import {
  normalizePhone,
  buildBillPlan,
  memoFor,
  toAoa,
  resolveRecipient,
  availableRoles,
  ymd,
  hourLabel,
  COLUMNS,
  SHEET_NAME,
  type BillInvoice,
  type GuardianPhones,
} from "../../src/lib/alltalkpay";

let pass = 0,
  fail = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) pass++;
  else {
    fail++;
    console.log("✗", m, "\n  받음:", JSON.stringify(a), "\n  기대:", JSON.stringify(b));
  }
};

// ── 번호 정리 ──────────────────────────────────────────────────────────────
eq(normalizePhone("010-8654-7611"), "01086547611", "하이픈 제거");
eq(normalizePhone(" 010 8654 7611 "), "01086547611", "공백 제거");
eq(normalizePhone("+82 10-8654-7611"), "01086547611", "국가번호 → 0");
eq(normalizePhone("02-555-1234"), null, "유선번호는 거절");
eq(normalizePhone(""), null, "빈 값");
eq(normalizePhone(null), null, "null");

// ── 청구 내용 문구 ─────────────────────────────────────────────────────────
eq(memoFor(["Grade 2 Textbook Set", "Cello Rental", "Uniform"]), "Grade 2 Textbook Set, Cello Rental 외 1건", "길이를 넘으면 줄임");
eq(memoFor(["Grade 2 Textbook Set Extended Edition", "Cello Rental", "Uniform"]), "Grade 2 Textbook Set Extended Edition 외 2건", "첫 항목이 길면 하나만");
eq(memoFor(["교재", "악기"]), "교재, 악기", "짧으면 그대로");
eq(memoFor([]), "학비외 납부", "항목 없음");

// ── 누구에게 보낼지 ────────────────────────────────────────────────────────
const phones = (m: string | null, f: string | null, g: string | null): GuardianPhones => ({
  mother_phone: m,
  father_phone: f,
  parent_phone: g,
});

eq(resolveRecipient(phones("010-1111-1111", "010-2222-2222", null), null), { role: "mother", phone: "01011111111" }, "안 고르면 어머니가 먼저");
eq(resolveRecipient(phones(null, "010-2222-2222", null), null), { role: "father", phone: "01022222222" }, "어머니가 없으면 아버지");
eq(resolveRecipient(phones(null, null, "010-3333-3333"), null), { role: "guardian", phone: "01033333333" }, "둘 다 없으면 보호자");
eq(resolveRecipient(phones("010-1111-1111", "010-2222-2222", null), "father"), { role: "father", phone: "01022222222" }, "고른 대로");
eq(
  resolveRecipient(phones("010-1111-1111", null, null), "father"),
  { role: "mother", phone: "01011111111" },
  "아버지로 골랐는데 번호가 없으면 있는 번호로 - 그 아이만 빠지면 안 됩니다",
);
eq(resolveRecipient(phones(null, null, null), "mother"), null, "하나도 없으면 null");
eq(availableRoles(phones("010-1111-1111", null, "010-3333-3333")), ["mother", "guardian"], "고를 수 있는 대상만");

// ── 명단 만들기 ────────────────────────────────────────────────────────────
const inv = (o: Partial<BillInvoice> & { invoice_no: string }): BillInvoice => ({
  id: "i-" + o.invoice_no,
  student_id: "s",
  student_name: "X",
  student_name_ko: "학생",
  grade_label: null,
  total_amount: 10000,
  due_date: "2026-09-12",
  guardian_phone: "010-1111-2222",
  guardian_role: null,
  exported_at: null,
  phones: phones("010-1111-2222", null, null),
  itemNames: ["교재"],
  ...o,
});

const p1 = buildBillPlan(
  [inv({ invoice_no: "A", student_name_ko: "고서윤" }), inv({ invoice_no: "B", student_name_ko: "고진우" })],
  { mergeSiblings: false },
);
eq(p1.rows.length, 2, "합치지 않으면 두 줄");
eq(p1.sharedPhones.length, 1, "같은 번호는 합치지 않아도 세어 알려줌");
eq(p1.total, 20000, "합계");
eq(p1.rows[0].role, "mother", "기본은 어머니");

const p2 = buildBillPlan(
  [inv({ invoice_no: "A", student_name_ko: "고서윤" }), inv({ invoice_no: "B", student_name_ko: "고진우", due_date: "2026-09-20" })],
  { mergeSiblings: true },
);
eq(p2.rows.length, 1, "형제 합치면 한 줄");
eq(p2.rows[0].amount, 20000, "형제 금액 합산");
eq(p2.rows[0].dueDate, "2026-09-12", "납부기한은 빠른 쪽");
eq(p2.rows[0].invoiceNos, ["A", "B"], "청구번호 둘 다");

const p3 = buildBillPlan(
  [
    inv({ invoice_no: "A", guardian_phone: null, phones: phones(null, null, null), student_name_ko: "홍길동" }),
    inv({ invoice_no: "B" }),
  ],
  { mergeSiblings: false },
);
eq(p3.rows.length, 1, "연락처 없는 건은 파일에 안 넣음");
eq(p3.missing.length, 1, "대신 따로 모음");
eq(p3.missing[0].name, "홍길동", "누가 빠졌는지");

const p4 = buildBillPlan([inv({ invoice_no: "A", exported_at: "2026-09-01T00:00:00Z" })], { mergeSiblings: false });
eq(p4.rows[0].resent, true, "이미 보낸 건은 표시");

// 화면에서 아버지로 바꾼 경우
const withBoth = inv({ invoice_no: "C", phones: phones("010-1111-1111", "010-2222-2222", null) });
const p5 = buildBillPlan([withBoth], { mergeSiblings: false, roleOverrides: { [withBoth.id]: "father" } });
eq(p5.rows[0].phone, "01022222222", "화면에서 바꾼 대상이 이깁니다");
eq(p5.rows[0].role, "father", "바뀐 대상이 표시됨");

// 발행할 때 굳혀 둔 대상
const frozen = inv({ invoice_no: "D", guardian_role: "father", phones: phones("010-1111-1111", "010-2222-2222", null) });
eq(buildBillPlan([frozen], { mergeSiblings: false }).rows[0].phone, "01022222222", "발행할 때 고른 대상을 따름");

// 명부에 없는 번호를 손으로 적은 경우
const manual = inv({ invoice_no: "E", guardian_role: "manual", guardian_phone: "010-9999-8888", phones: phones("010-1111-1111", null, null) });
eq(buildBillPlan([manual], { mergeSiblings: false }).rows[0].phone, "01099998888", "직접 입력한 번호가 명부보다 우선");

// 명부가 통째로 비었지만 발행 때 번호가 굳어 있는 경우 - 그 번호라도 살려 씁니다.
const onlyFrozen = inv({ invoice_no: "F", guardian_phone: "010-7777-6666", phones: phones(null, null, null) });
eq(buildBillPlan([onlyFrozen], { mergeSiblings: false }).rows[0].phone, "01077776666", "명부가 비면 굳은 번호로");

// ── 올톡페이 양식 ──────────────────────────────────────────────────────────
eq(SHEET_NAME, "청구서등록", "시트 이름");
eq(ymd("2026-09-30"), 20260930, "날짜는 YYYYMMDD 숫자");
eq(hourLabel(9), "09시", "한 자리 시각도 두 자리로");
eq(hourLabel(23), "23시", "두 자리 시각");

const aoa = toAoa(p1.rows, { dueHour: 23 });
eq(aoa[0], [...COLUMNS], "머리글 — 올톡페이 양식 그대로");
eq(aoa[0].length, 8, "여덟 칸 (양식에 없는 열을 더 붙이지 않습니다)");
eq(
  aoa[0],
  ["*상품명 (청구사유)", "*고객명", "*핸드폰번호", "*청구금액", "*결제만료일자(년월일)", "*결제만료시간(00시)", " 예약일(년월일)", "예약시간(00시)"],
  "별표와 띄어쓰기까지 원본 그대로",
);
eq(typeof aoa[1][2], "string", "번호는 글자 (앞의 0이 날아가지 않게)");
eq(typeof aoa[1][3], "number", "금액은 숫자");
eq(aoa[1][4], 20260912, "결제만료일자");
eq(aoa[1][5], "23시", "결제만료시간");
eq(aoa[1][6], "", "예약을 안 쓰면 비워 둡니다");

const reserved = toAoa(p1.rows, { dueHour: 20, reserveDate: "2026-09-01", reserveHour: 9 });
eq(reserved[1][6], 20260901, "예약일");
eq(reserved[1][7], "09시", "예약시간");

// ── 올톡페이 청구서관리목록에서 실제로 나온 이름 칸들 ──────────────────────
import { cleanPayerName } from "../../src/lib/payments";
let np = 0,
  nf = 0;
const eq2 = (a: string, b: string, m: string) => {
  if (a === b) np++;
  else {
    nf++;
    console.log("✗", m, "받음:", a, "기대:", b);
  }
};
eq2(cleanPayerName("강하라/치과진료비12,900원포함"), "강하라", "빗금 메모");
eq2(cleanPayerName("조장훈(13,000잔돈차감)"), "조장훈", "괄호 메모");
eq2(cleanPayerName("조하윤(역사교재비1만원포함)"), "조하윤", "괄호 메모2");
eq2(cleanPayerName("김재이(Ms.Aimie)"), "김재이", "괄호 영문");
eq2(cleanPayerName("송우진,윤진"), "송우진", "형제는 앞 아이");
eq2(cleanPayerName("심규민2세트(A,B)"), "심규민", "숫자 뒤 절단");
eq2(cleanPayerName("황시원2세트"), "황시원", "숫자 뒤 절단2");
eq2(cleanPayerName("권수호"), "권수호", "그냥 이름");
console.log(`이름 정리 ${np}개 통과${nf ? `, ${nf}개 실패` : ""}`);

console.log(`\n전체 ${pass + np}개 통과${fail + nf ? `, ${fail + nf}개 실패` : ""}`);
process.exit(fail + nf ? 1 : 0);
