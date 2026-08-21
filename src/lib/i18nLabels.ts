import type { Lang } from "@/lib/lang";

// DB에 한글 문자열로 저장되는 값들(직위·부서·출결상태 등)을 화면 언어에 맞춰 바꿉니다.
//
// 이 값들은 화면 문구가 아니라 "데이터"라서, 각 화면에서 t("교사","Teacher")로 일일이 적을 수
// 없습니다(어떤 값이 올지 렌더링 시점에야 알기 때문). 그래서 값→영어 표기 사전을 한곳에 모아두고
// 어디서든 같은 번역이 나오게 합니다. 사전에 없는 값은 원본을 그대로 돌려줍니다 - 새 직위나
// 새 상태값이 생겨도 화면이 빈칸으로 깨지지 않습니다.

function lookup(dict: Record<string, string>, value: string | null | undefined, lang: Lang): string {
  if (!value) return "";
  if (lang !== "en") return value;
  return dict[value] ?? value;
}

const POSITION_EN: Record<string, string> = {
  교사: "Teacher",
  관리자: "Admin",
  행정직원: "Office Staff",
  개발자: "Developer",
};

const DEPARTMENT_EN: Record<string, string> = {
  유치부: "Kindergarten",
  초등부: "Elementary",
  중고등부: "Secondary",
  행정부: "Administration",
};

const ATTENDANCE_EN: Record<string, string> = {
  출석: "Present",
  지각: "Late",
  결석: "Absent",
  조퇴: "Early leave",
  병결: "Sick leave",
  체험학습: "Field trip",
};

// 하원 셔틀 탑승 상태 - 픽업 체크·하원 체크표에서 씁니다.
const BOARDING_EN: Record<string, string> = {
  예정: "Scheduled",
  탑승: "Boarded",
  픽업: "Pickup",
  결석: "Absent",
};

export function positionLabel(value: string | null | undefined, lang: Lang): string {
  return lookup(POSITION_EN, value, lang);
}

export function departmentLabel(value: string | null | undefined, lang: Lang): string {
  return lookup(DEPARTMENT_EN, value, lang);
}

export function attendanceLabel(value: string | null | undefined, lang: Lang): string {
  return lookup(ATTENDANCE_EN, value, lang);
}

export function boardingLabel(value: string | null | undefined, lang: Lang): string {
  return lookup(BOARDING_EN, value, lang);
}

// "3학년 A반" 같은 반 이름을 영어로는 "Grade 3 A" 형태로 보여줍니다. 학년 값이 "중1"·"고2"처럼
// 한글이 섞인 경우도 있어서, 숫자만 있는 경우에만 "Grade N"으로 바꾸고 나머지는 그대로 둡니다
// (중고등부 학년 표기는 학교 내부에서 한글 그대로 통용됩니다).
export function classLabel(grade: string | null | undefined, className: string | null | undefined, lang: Lang): string {
  const g = (grade ?? "").trim();
  const c = (className ?? "").trim();
  if (lang !== "en") return [g && `${g}학년`, c].filter(Boolean).join(" ");
  const gradeText = g ? (/^\d+$/.test(g) ? `Grade ${g}` : g) : "";
  return [gradeText, c].filter(Boolean).join(" ");
}
