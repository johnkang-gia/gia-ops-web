import type { TaskStatus } from "@/lib/types";

// GIA WorkFlatform 참조 소스코드의 칸반 순서(진행 대기→진행 중→보류/이슈→완료)에 맞춰 정렬했습니다.
// 기존 DB의 status 값(예정/진행중/완료/보류)은 그대로 두고, 화면에 보여주는 라벨만 참조와
// 동일하게 바꿔서 마이그레이션 없이 구성만 맞췄습니다.
export const STATUS_ORDER: TaskStatus[] = ["예정", "진행중", "보류", "완료"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  예정: "진행 대기",
  진행중: "진행 중",
  보류: "보류·이슈",
  완료: "완료",
};

export const STATUS_STYLE: Record<TaskStatus, { header: string; drop: string }> = {
  예정: { header: "text-slate-600", drop: "bg-slate-100" },
  진행중: { header: "text-gia-navy", drop: "bg-gia-navy/10" },
  보류: { header: "text-amber-600", drop: "bg-amber-100" },
  완료: { header: "text-emerald-600", drop: "bg-emerald-100" },
};
