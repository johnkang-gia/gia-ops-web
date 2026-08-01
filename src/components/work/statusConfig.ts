import type { TaskStatus } from "@/lib/types";

// GIA WorkFlatform 참조 소스코드의 칸반 순서(진행 대기→진행 중→보류/이슈→완료)에 맞춰 정렬했습니다.
// 기존 DB의 status 값(예정/진행중/완료/보류)은 그대로 두고, 화면에 보여주는 라벨만 참조와
// 동일하게 바꿔서 마이그레이션 없이 구성만 맞췄습니다.
export const STATUS_ORDER: TaskStatus[] = ["예정", "진행중", "보류", "완료"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  예정: "진행 대기",
  진행중: "진행 중",
  보류: "보류/이슈",
  완료: "완료",
};

// 참조 소스코드 COLUMNS의 색상(#94a3b8/#3b82f6/#f59e0b/#10b981)을 그대로 가져왔습니다.
export const STATUS_COLOR: Record<TaskStatus, string> = {
  예정: "#94a3b8",
  진행중: "#3b82f6",
  보류: "#f59e0b",
  완료: "#10b981",
};
