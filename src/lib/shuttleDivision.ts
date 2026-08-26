// 셔틀 배차표의 "반" 표기로 소속(유치부/초등부/중고등부)을 판정합니다.
//
// 담당자 확인: "노선·배정 탭 배차표에서 하원 27호를 보니까 이예온·임하임·강하영인데 다 명부에
// 있는 애들인데도 반이 중고등부 미상으로 되어 있어."
//
// 원인이 두 겹이었습니다.
//
//   ① 이 파일의 옛 규칙이 "학교"라는 **글자**만 초등부로 알아봤습니다. 실제 반 표기는
//      "G5A"·"6TH GRADE" 형식인데 그건 모르니 전부 "중고등부·미상"으로 떨어졌습니다.
//   ② 배정이 명부와 연결(student_id)돼 있어도 이 함수는 **반 문자열만** 보고 있었습니다.
//      명부에 그 아이의 학년이 적혀 있는데도 굳이 문자열을 추측한 셈입니다.
//
// 그래서 규칙을 셔틀 매칭에서 쓰는 것과 하나로 합치고(아래 departmentFromClassName),
// **연결된 아이는 명부를 우선**하도록 divisionFor를 따로 뒀습니다. 명부가 절대 기준이라는
// 원칙이 화면에도 그대로 적용돼야 합니다.

export type ShuttleDivision = "유치부" | "초등부" | "중고등부" | "미상";

/**
 * 반 이름으로 부서를 읽습니다. 못 읽으면 null.
 *
 * 담당자가 알려준 형식은 셋뿐입니다.
 *   유치부   "4 sparrow"   숫자 + 영단어(새 이름)
 *   초등부   "G3A" "G5AB"  G + 학년 + 알파벳 1~2개
 *   중고등부 "6TH GRADE"   숫자 + TH/ST/ND/RD
 *
 * 실제 데이터는 훨씬 지저분합니다 - "5Falcon"(공백 없음), "Pelican 4"(순서 뒤바뀜),
 * "7Crane/5Toucan"(두 반 겹침), "Swan/"(잘림), "7 Albatorss"(오타). 그래서 유치부를
 * 일일이 맞추려 하지 않고 **앞의 둘이 아니면서 영문이 있으면 유치부**로 뒤집었습니다.
 * 유치부에 새 반 이름이 생겨도 이 함수를 안 고쳐도 됩니다.
 */
export function departmentFromClassName(cls: string | null | undefined): "유치부" | "초등부" | "중고등부" | null {
  if (!cls) return null;
  const c = cls.trim();
  if (!c) return null;

  // 예전 표기 - 반 칸에 그냥 "학교"라고 적던 시절의 데이터가 남아 있습니다.
  if (c.includes("학교")) return "초등부";

  // 중고등부: 숫자 뒤 서수 어미가 **단어로 끊겨야** 합니다.
  // (이 조건이 없으면 "5Starling"의 "5St"가 서수로 걸립니다.)
  if (/\b\d+\s*(st|nd|rd|th)\b/i.test(c)) return "중고등부";

  // 초등부: G + 학년 + 알파벳 1~2개
  if (/\bg\s*\d+\s*[a-z]{1,2}\b/i.test(c)) return "초등부";

  // 나머지 중 영문이 있으면 유치부(새 이름).
  if (/[a-z]{2,}/i.test(c)) return "유치부";

  return null;
}

/** 학년 표기에서 부서를 읽습니다("3"→초등부, "9"→중고등부). */
export function departmentFromGrade(grade: string | null | undefined): "초등부" | "중고등부" | null {
  const n = parseInt((grade ?? "").replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 7) return "중고등부";
  if (n >= 1) return "초등부";
  return null;
}

/**
 * 배정 한 줄의 소속.
 *
 * **명부에 연결돼 있으면 명부를 믿습니다.** 반 문자열은 사람이 손으로 적은 것이고 명부는
 * 확정된 사실이라, 둘이 다르면 명부가 맞습니다. 연결이 없을 때만 문자열로 추측합니다.
 */
export function divisionFor(
  classRaw: string | null | undefined,
  student?: { grade?: string | null; department?: string | null } | null,
): ShuttleDivision {
  if (student) {
    const d =
      (student.department === "유치부" || student.department === "초등부" || student.department === "중고등부"
        ? student.department
        : null) ?? departmentFromGrade(student.grade);
    if (d) return d;
  }
  return departmentFromClassName(classRaw) ?? "미상";
}

/** 예전 이름 유지(반 문자열만 보고 판정). 새 코드는 divisionFor를 쓰세요. */
export function divisionFromClassRaw(classRaw: string | null): ShuttleDivision {
  return departmentFromClassName(classRaw) ?? "미상";
}

/**
 * 명부 연결이 안 된 것이 "진짜 확인이 필요한 건"인지.
 *
 * 유치부는 연결하지 않는 게 정상이라 경고 대상이 아닙니다. 초등·중고등인데 연결이 없다면
 * 표기 차이거나 퇴소한 아이라 사람이 봐야 합니다.
 */
export function needsRosterAttention(classRaw: string | null, studentId: string | null): boolean {
  if (studentId) return false;
  const d = departmentFromClassName(classRaw);
  return d === "초등부" || d === "중고등부";
}

export const DIVISION_BADGE: Record<ShuttleDivision, string> = {
  유치부: "bg-amber-50 text-amber-600",
  초등부: "bg-blue-50 text-blue-600",
  중고등부: "bg-violet-50 text-violet-600",
  미상: "bg-slate-100 text-slate-500",
};
