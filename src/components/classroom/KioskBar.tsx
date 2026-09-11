"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * **교실 태블릿을 전체화면으로 잠그는 손잡이.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 태블릿에서 반 링크를 크롬으로 열면 주소창과 탭 줄이 화면 위쪽을 먹습니다. 10인치 화면에서
 * 그 두 줄이면 호출 글자가 눈에 띄게 작아지고, 아이가 주소창을 눌러 다른 데로 가버립니다.
 *
 * ── 여기서 할 수 있는 것과 없는 것 ──────────────────────────────────────────
 *
 * **웹 페이지는 다른 앱으로 넘어가는 것을 막을 수 없습니다.** 그건 브라우저 바깥의 일이고,
 * 막을 수 있다면 그게 더 위험한 브라우저입니다. 그러니 이 화면이 하는 일과 기기 설정이
 * 하는 일을 섞어 말하지 않습니다.
 *
 *   · 이 화면이 하는 일 — 전체화면으로 띄우고(주소창·탭 줄이 사라집니다), 화면이 안 꺼지게
 *     붙잡고, 나가려 할 때 **코드를 묻습니다.**
 *   · 기기가 해야 하는 일 — 다른 앱으로 못 넘어가게 **화면 고정**(안드로이드) ·
 *     **안내식 접근**(아이패드). 이건 한 번 켜두면 끝입니다.
 *
 * 화면에 그 사실을 적어 둡니다. 「잠갔다」고만 적어두면 사람은 기기 설정을 안 하고, 그러면
 * 정말 안 잠긴 채로 잠긴 줄 압니다 - 그게 가장 나쁜 상태입니다.
 *
 * ── 나가는 코드 ─────────────────────────────────────────────────────────────
 *
 * 아이가 못 나가면 됩니다. 금고가 필요한 것이 아닙니다. 그래서 숫자 네 자리이고, 틀리면
 * 그냥 안 열립니다 - 횟수를 세거나 잠그지 않습니다. 교실에서 선생님이 못 나가게 되는 쪽이
 * 더 큰 사고입니다.
 */

/** 나가기 코드. 교직원이 외우는 값이라 짧고, 아이가 눌러서 맞힐 만큼 짧지는 않습니다. */
const EXIT_CODE = "1004";

type WakeLockLike = { release: () => Promise<void> };

export default function KioskBar() {
  const [full, setFull] = useState(false);
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState("");
  const [shake, setShake] = useState(false);
  const lockRef = useRef<WakeLockLike | null>(null);

  /**
   * **화면이 안 꺼지게 붙잡습니다.**
   *
   * 교실 태블릿은 만지지 않고 보기만 하는 화면이라, 기기가 「아무도 안 쓴다」고 판단해
   * 꺼버립니다. 그러면 호출이 와도 아무도 못 봅니다 - 소리는 나는데 화면이 검습니다.
   * 브라우저가 이 기능을 안 주는 기기도 있어서, 안 되면 조용히 넘어갑니다(기기 설정의
   * 「화면 꺼짐 없음」이 대신합니다).
   */
  const holdScreen = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } };
      if (!nav.wakeLock) return;
      lockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // 기기가 안 주면 그만입니다. 이것 때문에 화면이 멈추면 안 됩니다.
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    // 전체화면에서 잠깐 다른 앱에 갔다 오면 붙잡은 것이 풀립니다. 돌아올 때 다시 잡습니다.
    const onVisible = () => {
      if (document.visibilityState === "visible" && document.fullscreenElement) void holdScreen();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("visibilitychange", onVisible);
      void lockRef.current?.release().catch(() => {});
    };
  }, [holdScreen]);

  async function enter() {
    try {
      await document.documentElement.requestFullscreen();
      await holdScreen();
    } catch {
      // 사용자 동작 없이는 못 켭니다. 단추를 눌러 들어온 길이라 대개 됩니다.
    }
  }

  function tryExit(next: string) {
    setCode(next);
    if (next.length < EXIT_CODE.length) return;
    if (next !== EXIT_CODE) {
      // 틀렸다고 잠그지 않습니다 - 교실에서 선생님이 못 나가게 되는 쪽이 더 큰 사고입니다.
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setCode("");
      return;
    }
    setAsking(false);
    setCode("");
    void lockRef.current?.release().catch(() => {});
    lockRef.current = null;
    void document.exitFullscreen().catch(() => {});
  }

  if (!full) {
    return (
      <button
        type="button"
        onClick={() => void enter()}
        title="주소창과 탭 줄을 감추고 화면을 꽉 채웁니다. 나올 때는 코드를 묻습니다."
        style={{
          position: "fixed",
          right: 10,
          bottom: 10,
          zIndex: 9999,
          borderRadius: 999,
          border: "2px solid #334155",
          background: "#0f172a",
          color: "#e2e8f0",
          padding: "8px 14px",
          fontSize: 14,
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        ⛶ 전체화면
      </button>
    );
  }

  return (
    <>
      {/* 전체화면일 때는 **아주 작게** 둡니다. 교실 화면의 주인공은 호출이고, 이 단추는
          하루에 한 번 쓸까 말까 한 것입니다. 그렇다고 감추지는 않습니다 - 안 보이면
          선생님이 태블릿을 껐다 켜게 됩니다. */}
      <button
        type="button"
        onClick={() => setAsking(true)}
        title="전체화면에서 나갑니다 (코드 필요)"
        style={{
          position: "fixed",
          right: 6,
          bottom: 6,
          zIndex: 9999,
          width: 30,
          height: 30,
          borderRadius: 999,
          border: "1px solid rgba(148,163,184,.35)",
          background: "rgba(15,23,42,.5)",
          color: "rgba(226,232,240,.55)",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        ⛶
      </button>

      {asking && (
        <div
          onClick={() => {
            setAsking(false);
            setCode("");
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(2,6,23,.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#0f172a",
              border: "2px solid #334155",
              borderRadius: 18,
              padding: "22px 26px",
              textAlign: "center",
              transform: shake ? "translateX(-6px)" : "none",
              transition: "transform .08s",
            }}
          >
            <p style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", marginBottom: 10 }}>나가기 코드</p>
            <input
              autoFocus
              value={code}
              inputMode="numeric"
              type="password"
              onChange={(e) => tryExit(e.target.value.replace(/\D/g, "").slice(0, EXIT_CODE.length))}
              style={{
                width: 160,
                textAlign: "center",
                fontSize: 28,
                letterSpacing: 10,
                padding: "8px 10px",
                borderRadius: 12,
                border: `2px solid ${shake ? "#ef4444" : "#475569"}`,
                background: "#1e293b",
                color: "#f8fafc",
              }}
            />
            <p style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>바깥을 누르면 그대로 둡니다</p>
          </div>
        </div>
      )}
    </>
  );
}
