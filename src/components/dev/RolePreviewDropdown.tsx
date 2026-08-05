"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PREVIEW_POSITIONS } from "@/lib/rolePreview";

// 요청("개발자 계정의 경우 로그아웃 바로위에 드롭다운메뉴로 권한을 변경할 수 있게 해주고,
// 변경하면 그 권한에서만 볼 수 있는 화면으로 나오도록"). 실제 계정은 그대로 두고 쿠키만 바꾸는
// 방식이라(@/lib/rolePreview, @/app/api/dev/preview-role), 선택 즉시 페이지를 새로고침해서
// 서버 컴포넌트가 미리보기 직위 기준으로 다시 렌더링되게 합니다.
export default function RolePreviewDropdown({ currentPreview }: { currentPreview: string | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function setPreview(position: string) {
    setSaving(true);
    try {
      await fetch("/api/dev/preview-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position }),
      });
      router.refresh();
      // 네비게이션 구조(교사/관리자 등 메뉴 목록)까지 바뀌므로 새로고침만으로는 부족할 수 있어
      // 확실하게 전체 리로드합니다 - 미리보기는 자주 쓰는 기능이 아니라 속도보다 정확함이 중요합니다.
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-card-bg)] p-2">
      <label className="mb-1 block text-[10px] font-bold text-[var(--shell-text-muted)]">🎭 권한 미리보기 (QA용)</label>
      <select
        value={currentPreview ?? ""}
        disabled={saving}
        onChange={(e) => setPreview(e.target.value)}
        className="w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-bg)] px-2 py-1 text-xs text-[var(--shell-text)]"
      >
        <option value="">개발자 화면 (미리보기 끔)</option>
        {PREVIEW_POSITIONS.map((p) => (
          <option key={p} value={p}>
            {p} 화면으로 보기
          </option>
        ))}
      </select>
      {currentPreview && (
        <p className="mt-1 text-[10px] font-semibold text-amber-500">
          ⚠️ 지금 &quot;{currentPreview}&quot; 권한으로 보는 중입니다. 실제 데이터 변경은 하지 마세요.
        </p>
      )}
    </div>
  );
}
