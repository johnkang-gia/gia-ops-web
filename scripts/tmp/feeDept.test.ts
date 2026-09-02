import { inDepartment, isDefaultFor, resolveStudentItems } from "../../src/lib/feeItems";
import { departmentOf } from "../../src/lib/department";
import type { FeeItem, StudentFeeItem } from "../../src/lib/types";
let pass = 0, fail = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log("✗", m, "받음:", JSON.stringify(a), "기대:", JSON.stringify(b)); }
};

// 6학년은 중고등부입니다(학교 운영 기준).
eq(departmentOf({ grade: "5" }), "초등부", "5학년은 초등부");
eq(departmentOf({ grade: "6" }), "중고등부", "6학년은 중고등부");
eq(departmentOf({ grade: "6학년" }), "중고등부", "'6학년' 표기");
eq(departmentOf({ grade: "7" }), "중고등부", "7학년");
// 명부에 부서가 적혀 있으면 그 값이 먼저입니다.
eq(departmentOf({ department: "초등부", grade: "6" }), "초등부", "명부 값이 학년 추측보다 먼저");

const item = (o: Partial<FeeItem> & { id: string }): FeeItem => ({
  category: "교재", name: "책", name_ko: null, unit_price: 10000, default_grades: [], default_classes: [],
  term_id: null, active: true, sort_order: 0, note: null, created_by: null, created_at: "", updated_at: "",
  department: null, ...o,
} as FeeItem);

const 초등책 = item({ id: "a", department: "초등부", default_grades: ["5", "6"] });
const 중고책 = item({ id: "b", department: "중고등부", default_grades: ["6"] });
const 교복 = item({ id: "c", department: null, default_grades: ["5", "6"] });

const 오학년 = { id: "s5", grade: "5", className: "G5E", department: null };
const 육학년 = { id: "s6", grade: "6", className: null, department: "중고등부" };

eq(inDepartment(초등책, 오학년), true, "초등 항목 → 초등 아이");
eq(inDepartment(중고책, 오학년), false, "중고 항목은 초등 아이에게 안 붙음");
eq(inDepartment(교복, 오학년), true, "공통 항목은 양쪽 다");
eq(inDepartment(교복, 육학년), true, "공통 항목은 양쪽 다 (중고)");
eq(inDepartment(초등책, 육학년), false, "초등 항목은 6학년(중고)에게 안 붙음");
eq(isDefaultFor(중고책, 육학년), true, "중고 항목 → 6학년 기본");

// 아이별로 잘못 체크해둔 것이 있어도 부서가 다르면 붙지 않습니다.
const 잘못체크: StudentFeeItem[] = [{
  id: "o1", student_id: "s5", item_id: "b", term_id: null, mode: "include", qty: 1,
  note: null, updated_by: null, created_at: "", updated_at: "",
}];
const lines = resolveStudentItems([초등책, 중고책, 교복], 오학년, 잘못체크);
eq(lines.map((l) => l.item.id).sort(), ["a", "c"], "부서 다른 항목은 체크해뒀어도 제외");

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ""}`);
process.exit(fail ? 1 : 0);
