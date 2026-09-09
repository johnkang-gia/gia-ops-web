"use client";

import type { BoardScale, Density } from "@/lib/useBoardDensity";

/**
 * 화면 자체를 다루는 손잡이 — 글자 크기, 전체화면 안내.
 *
 * 보여주는 내용과 상관없이 «화면을 어떻게 볼 것인가»만 다루는 조각이라 갈라 둡니다.
 */

// 글자 크기 손잡이. 자동 배율이 기본이고, 모니터·시력·보는 거리에 따라 한 단계씩 올리거나
// 내릴 수 있습니다. 고른 값은 그 컴퓨터에 저장됩니다.
const DENSITY_LABEL: Record<Density, string> = { auto: "자동", large: "크게", normal: "보통", small: "작게" };

export function DensityPicker({ sc }: { sc: BoardScale }) {
  const order: Density[] = ["auto", "large", "normal", "small"];
  const next = order[(order.indexOf(sc.density) + 1) % order.length];
  return (
    <button
      onClick={() => sc.setDensity(next)}
      title="화면 글자 크기 (자동 → 크게 → 보통 → 작게)"
      style={{
        padding: `${sc.s(6, 4)}px ${sc.s(12, 8)}px`,
        borderRadius: 999,
        border: "1px solid #334155",
        background: "transparent",
        color: "#94a3b8",
        fontSize: sc.s(13, 10),
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      🔍 {DENSITY_LABEL[sc.density]}
    </button>
  );
}

// 브라우저가 자동 전체화면을 거절했을 때 뜨는 안내입니다.
//
// 아무 웹사이트나 시간이 되면 마음대로 화면을 덮지 못하게 하는 브라우저 규칙 때문에, 전체화면은
// "사람이 방금 누른 직후"에만 시작할 수 있습니다. 그래서 하루 한 번 이 버튼을 눌러주셔야 합니다.
// 반대로 되돌아오는 것은 제약이 없어 종료 시각이 되면 저절로 풀립니다.
//
// 화면 전체를 가리지 않고 오른쪽 아래에 띄웁니다 - 누르지 않아도 하원 화면 자체는 이미 잘 보이고
// 있어서, 급할 때는 그냥 무시하고 반반 화면으로 쓰셔도 됩니다.
export function FullscreenPrompt({ onClick, onDismiss }: { onClick: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 60,
        background: "#1d4ed8",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: 420,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>하원 시간입니다 — 전체화면으로 볼까요?</div>
        <div style={{ fontSize: 12, color: "#c7d8ff", marginTop: 2, lineHeight: 1.5 }}>
          브라우저 보안 규칙 때문에 전체화면은 사람이 눌러야 시작됩니다. 종료 시각이 되거나 [하원 종료]를 누르면 저절로 원래
          화면으로 돌아옵니다.
        </div>
      </div>
      <button
        onClick={onClick}
        style={{
          flexShrink: 0,
          background: "#fff",
          color: "#1d4ed8",
          border: "none",
          borderRadius: 10,
          padding: "10px 16px",
          fontSize: 15,
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        전체화면
      </button>
      <button
        onClick={onDismiss}
        title="이번에는 반반 화면으로 두기"
        style={{ flexShrink: 0, background: "transparent", border: "none", color: "#c7d8ff", fontSize: 18, cursor: "pointer" }}
      >
        ✕
      </button>
    </div>
  );
}
