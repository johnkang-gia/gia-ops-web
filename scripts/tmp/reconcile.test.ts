import { toBillLines, reconcile, noteOf, type StudentSide } from "../../src/lib/reconcileBills";
let pass = 0, fail = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log("✗", m, "\n  받음:", JSON.stringify(a), "\n  기대:", JSON.stringify(b)); }
};

eq(noteOf("강하라/치과진료비12,900원포함"), "치과진료비12,900원포함", "빗금 메모 추출");
eq(noteOf("조장훈(13,000잔돈차감)"), "13,000잔돈차감", "괄호 메모 추출");
eq(noteOf("권수호"), null, "메모 없음");

const row = (name: string, amount: number, phone: string, reason = "1학기 교재비", status = "발송완료") => ({
  고객명: name, 청구핸드폰: phone, 청구사유: reason, 청구금액: amount, 상태: status,
});
const stu = (id: string, name: string, phone: string, ours: number): StudentSide =>
  ({ id, name, parentPhone: phone, gradeLabel: "2학년", ours });

const lines = toBillLines([
  row("홍서형", 167700, "010-3512-1353"),
  row("강하라/치과진료비12,900원포함", 182900, "010-7678-2718"),
  row("박보은", 8000, "010-8877-5932", "GIA교복"),
  row("박보은", 100000, "010-8877-5932", "GIA교복", "결제중단"),
  row("이름없는아이", 50000, "010-0000-0000"),
]);
eq(lines.length, 5, "줄 읽기");
eq(lines[1].name, "강하라", "이름 정리");
eq(lines[1].note, "치과진료비12,900원포함", "사연 보존");

const students = [
  stu("s1", "홍서형", "010-3512-1353", 167700),
  stu("s2", "강하라", "010-7678-2718", 170000),
  stu("s3", "박보은", "010-8877-5932", 8000),
  stu("s4", "청구없는아이", "010-1111-1111", 90000),
  stu("s5", "항목없는아이", "010-2222-2222", 0),
];
const r = reconcile(lines, students);
eq(r.skipped, 1, "결제중단 1줄 제외");
eq(r.same.map((g) => g.student!.name), ["박보은", "홍서형"], "금액 같음");
eq(r.differ.length, 1, "금액 다름 1명");
eq(r.differ[0].student!.name, "강하라", "차이 나는 아이");
eq(r.differ[0].diff, 12900, "차이 금액 = 치과진료비");
eq(r.differ[0].lines[0].note, "치과진료비12,900원포함", "이유가 같이 보임");
eq(r.unknown.map((g) => g.billName), ["이름없는아이"], "명부에 없는 이름");
eq(r.missingBill.map((s) => s.name), ["청구없는아이"], "청구서 없는 아이 (0원인 아이는 제외)");

// 형제: 같은 번호 두 명이면 이름으로 좁힙니다.
const sib = toBillLines([row("송우진,윤진", 10000, "010-9999-9999"), row("송윤진", 20000, "010-9999-9999")]);
const rs = reconcile(sib, [stu("a", "송우진", "010-9999-9999", 10000), stu("b", "송윤진", "010-9999-9999", 20000)]);
eq(rs.same.length, 2, "형제를 이름으로 갈라 붙임");

// 한 아이의 여러 줄은 합산합니다 (교재비 + 교복).
const multi = toBillLines([row("김리안", 100000, "010-5555-5555"), row("김리안(2차주문)", 30000, "010-5555-5555", "GIA교복")]);
const rm = reconcile(multi, [stu("k", "김리안", "010-5555-5555", 130000)]);
eq(rm.same.length, 1, "여러 줄 합산 후 일치");
eq(rm.same[0].billed, 130000, "합산 금액");

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ""}`);
process.exit(fail ? 1 : 0);
