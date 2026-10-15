/** 인증 증거 자료 목록. 화면(클라이언트)도 읽으므로 데이터 읽기 코드와 떼어 둡니다. */
export type ExhibitKey = "enrollment" | "faculty" | "attendance" | "progress" | "safety" | "governance" | "parents" | "data";

export const EXHIBITS: { key: ExhibitKey; title: string; ko: string; topic: string }[] = [
  { key: "enrollment", title: "Student Enrollment & Class Composition", ko: "재학생 구성(부서·학년·반)", topic: "Students" },
  { key: "faculty", title: "Class Organization & Faculty Assignment", ko: "반 편성·담임·과목 담당", topic: "Personnel / Program" },
  { key: "attendance", title: "Student Attendance Summary", ko: "출석 현황(학기)", topic: "Students" },
  { key: "progress", title: "Student Progress Monitoring (Weekly Observation Reports)", ko: "주간 관찰기록 작성 현황", topic: "Assessment" },
  { key: "safety", title: "Student Transportation & Dismissal Safety", ko: "셔틀·하원 안전 기록", topic: "Health & Safety" },
  { key: "governance", title: "Meetings, Incident Management & School Events", ko: "회의·사건 처리·행사 기록", topic: "Governance / Operations" },
  { key: "parents", title: "Parent Communication & Conferences", ko: "학부모 문의 응대·상담", topic: "Community" },
  { key: "data", title: "Student Data Protection & Continuity", ko: "학생 정보 보호·백업", topic: "Technology" },
];

