import type { AiFeatureFlag } from "@/lib/types";

// 개발자가 과금 조절을 위해 AI 기능을 끄면(ai_feature_flags.enabled=false), 사이드바 프로필
// 블록 바로 아래에 이 빨간 배너로 어떤 기능이 멈춰있는지 모든 직원에게 보여줍니다(요청:
// "메뉴항목 프로필 아래에 빨간색 바로 무슨 기능 일시정지중 이라고 로그가 뜨도록").
export default function PausedFeaturesBanner({ disabledFeatures }: { disabledFeatures: AiFeatureFlag[] }) {
  if (disabledFeatures.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
      <div className="mb-1 text-[10px] font-bold text-red-600">⏸️ AI 기능 일시정지중</div>
      <ul className="flex flex-col gap-0.5">
        {disabledFeatures.map((f) => (
          <li key={f.key} className="truncate text-[11px] font-medium text-red-700">
            {f.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
