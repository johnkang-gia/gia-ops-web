/**
 * 학생 추가 회귀 시험(빌드마다). 같은 이름이 있으면 사람의 확인 없이는 넣지 않는지, 표기(띄어쓰기·가운뎃점)가 달라도
 * 같은 이름으로 보는지, 같은 붙여넣기 안의 중복도 잡는지, 명부 반영이 생일이 다른 동명이인을 덮지 않는지 봅니다.
 */
import { checkSameNames, type SameNameHit } from "../src/lib/studentAdd";
import { planRoster, type StudentLite } from "../src/lib/rosterPlan";

const roster: SameNameHit[] = [
  { id: "a", name: "김재이", grade: "2", class_name: "G2A", birth_date: "2018-01-01", status: "active" },
  { id: "b", name: "제이콥 마", grade: "3", class_name: "G3B", birth_date: null, status: "inactive" },
];
const fail = (m: string) => {
  throw new Error(`test-student-add: ${m}`);
};

// 1. 같은 이름 → 확인 대기. 표기만 다른 이름도 같은 이름(퇴소생 포함).
{
  const r = checkSameNames(roster, [{ name: "김재이" }, { name: "제이콥·마" }, { name: "박새로" }]);
  if (r.needsConfirm.length !== 2 || r.ready.join() !== "2") fail("same name must wait for a person");
  if (r.needsConfirm[1].hits[0].id !== "b") fail("withdrawn student must be compared");
}
// 2. 사람이 «다른 학생»으로 확인하면 넣습니다.
{
  const r = checkSameNames(roster, [{ name: "김재이", homonymOk: true }]);
  if (r.ready.length !== 1 || r.needsConfirm.length) fail("homonymOk must pass");
}
// 3. 같은 붙여넣기 안에서 두 번 나온 이름은 둘째 줄을 묻습니다.
{
  const r = checkSameNames(roster, [{ name: "한도윤" }, { name: "한 도윤" }]);
  if (r.ready.join() !== "0" || r.needsConfirm[0]?.index !== 1 || !r.needsConfirm[0].hits[0].inBatch) fail("in-batch duplicate");
}
// 4. 명부 반영: 이름이 하나 맞아도 생일이 둘 다 있고 다르면 덮지 않고 «확인 필요».
{
  const existing: StudentLite[] = [{ id: "a", name: "김재이", birth_date: "2018-01-01", name_en: null, grade: "2", class_name: "G2A", student_no: null, status: "active" }];
  const p = planRoster(existing, [{ rowNo: 1, values: { name: "김재이", birth_date: "2019-05-05", class_name: "G1A" } }]);
  if (p[0].kind !== "확인 필요") fail(`birthday mismatch must not overwrite (got ${p[0].kind})`);
  const q = planRoster(existing, [{ rowNo: 1, values: { name: "김 재이", class_name: "G2B" } }]);
  if (q[0].kind !== "바뀜" || q[0].studentId !== "a") fail("spacing variant must match the same student");
}
console.log("test-student-add OK");
