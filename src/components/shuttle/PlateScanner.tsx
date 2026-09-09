"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { matchPlate, type PlateCandidate, type PlateMatch } from "@/lib/plateMatch";

/**
 * **번호판을 비추면 도착으로 찍습니다.**
 *
 * ── 왜 만들었나 ──────────────────────────────────────────────────────
 *
 * 하원 시간에는 차가 몇 대씩 한꺼번에 들어옵니다. 그때 화면에서 호차를 찾아 누르는 것은
 * 짧지만, 아이를 보며 하는 일이라 **자꾸 미뤄지고 나중에 몰아서 누릅니다.** 그러면 도착
 * 시각이 실제와 달라지고, 안내보드는 아직 안 온 차를 온 것으로 띄웁니다.
 *
 * 카메라를 들어 번호판에 대는 동작 하나로 끝나면 그 자리에서 하게 됩니다.
 *
 * ── 왜 이렇게 만들었나 ───────────────────────────────────────────────
 *
 * **글자를 잘 읽는 것보다 좁히기를 잘하는 편이 낫습니다.** 가려낼 대상이 우리 학교 차
 * 십수 대뿐이라, 뒤 네 자리만 읽혀도 어느 차인지 정해집니다(`@/lib/plateMatch`).
 *
 * 읽는 도구(tesseract)는 **누를 때 내려받습니다.** 도착 체크는 하루에 몇 분 쓰는 화면인데
 * 열 때마다 몇 MB를 받으면, 정작 급할 때 화면이 안 뜹니다.
 *
 * 못 읽는 날이 있습니다 - 비 오는 날, 역광, 번호판이 더러운 날. 그때는 **평소처럼 호차를
 * 손으로 누르면 됩니다.** 이 기능은 빠른 길이지 유일한 길이 아닙니다.
 */

type Props = {
  routes: PlateCandidate[];
  /** 이 호차를 도착으로 찍습니다. */
  onArrive: (routeId: string) => void | Promise<void>;
  onClose: () => void;
};

type Phase = "준비" | "카메라" | "읽는중" | "결과";

export default function PlateScanner({ routes, onArrive, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("준비");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlateMatch | null>(null);
  /** 되돌릴 수 있는 동안 남은 시간(초). 0이면 되돌리기 끝. */
  const [undoLeft, setUndoLeft] = useState(0);
  const [done, setDone] = useState<{ routeId: string; routeNo: string } | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setError(null);
    try {
      // 뒷면 카메라를 씁니다. 앞면이 켜지면 사람이 자기 얼굴을 보고 당황합니다.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("카메라");
    } catch (e) {
      // 무엇이 막혔는지 그대로 적습니다. 「카메라 오류」만 뜨면 아무도 고칠 수 없습니다.
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("NotAllowed") || msg.includes("Permission")
          ? "카메라를 쓸 수 없습니다. 브라우저 주소창의 자물쇠를 눌러 카메라를 허용해주세요."
          : `카메라를 열지 못했습니다: ${msg}`,
      );
    }
  }

  async function readPlate() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    setPhase("읽는중");
    setError(null);

    try {
      // 화면 가운데 띠만 잘라 읽습니다. 번호판 말고 다른 글자(차종·스티커)를 함께 읽으면
      // 엉뚱한 숫자가 섞이고, 그러면 좁히기가 오히려 나빠집니다.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = Math.round(vw * 0.86);
      const ch = Math.round(vh * 0.28);
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("화면을 읽을 수 없습니다.");
      ctx.drawImage(video, Math.round((vw - cw) / 2), Math.round((vh - ch) / 2), cw, ch, 0, 0, cw, ch);

      // 흑백으로 세게 눌러 글자만 남깁니다. 컬러 그대로 넣으면 번호판 바탕색 때문에
      // 숫자 경계가 흐려집니다.
      const img = ctx.getImageData(0, 0, cw, ch);
      for (let i = 0; i < img.data.length; i += 4) {
        const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        const v = g > 135 ? 255 : 0;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);

      // 읽는 도구는 여기서 처음 내려받습니다.
      const { default: Tesseract } = await import("tesseract.js");
      const { data } = await Tesseract.recognize(canvas, "eng", {});
      const text = String(data?.text ?? "");
      const m = matchPlate(text, routes);
      setResult(m);
      setPhase("결과");

      // 한 대로 정해졌으면 **바로 찍고 되돌릴 시간을 줍니다.** 하원 시간에는 손이
      // 바빠서, 「맞나요?」를 한 번 더 물으면 그 한 번이 부담입니다.
      if (m.kind === "찾음") {
        stopCamera();
        setDone({ routeId: m.routeId, routeNo: m.routeNo });
        setUndoLeft(5);
        void onArrive(m.routeId);
      }
    } catch (e) {
      setPhase("카메라");
      setError(`번호판을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 되돌리기 남은 시간. 0이 되면 창을 닫습니다 - 다 된 일에 화면이 남아 있으면
  // 다음 차를 찍으러 가는 길을 막습니다.
  useEffect(() => {
    if (undoLeft <= 0) return;
    const t = setTimeout(() => setUndoLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [undoLeft]);
  useEffect(() => {
    if (done && undoLeft === 0) onClose();
  }, [done, undoLeft, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center gap-2 px-3 py-2">
        <b className="text-sm text-white">📷 번호판 비추기</b>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="ml-auto rounded-lg bg-white/20 px-3 py-1 text-xs font-bold text-white"
        >
          닫기
        </button>
      </div>

      {/* 다 됐을 때. 되돌릴 수 있는 동안만 뜹니다. */}
      {done && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-3">
          <b className="text-lg text-white">{done.routeNo}호 도착</b>
          <span className="text-xs text-emerald-50">{undoLeft}초 뒤 닫힘</span>
          <button
            type="button"
            onClick={() => {
              // 되돌리기는 도착을 취소하는 것이 아니라 **화면을 되돌리는 것**입니다.
              // 실제 취소는 호차 카드를 한 번 더 눌러 「출발 → 되돌리기」로 합니다 -
              // 여기서 조용히 지우면 무엇이 지워졌는지 아무 데도 안 남습니다.
              setDone(null);
              setUndoLeft(0);
              setResult(null);
              setPhase("준비");
            }}
            className="ml-auto rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-emerald-700"
          >
            ↩ 아니었어요
          </button>
        </div>
      )}

      <div className="relative mx-3 flex-1 overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {/* 읽는 자리를 띠로 표시합니다. 어디에 대야 하는지 안 보이면 사람마다 다르게 댑니다. */}
        {phase !== "준비" && !done && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[28%] w-[86%] rounded-lg border-4 border-amber-300/90" />
          </div>
        )}
        {phase === "준비" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-white/80">번호판이 노란 띠에 가득 차도록 가까이 대주세요.</p>
            <button
              type="button"
              onClick={() => void startCamera()}
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-900"
            >
              카메라 켜기
            </button>
          </div>
        )}
      </div>

      {error && <p className="mx-3 mt-2 rounded-lg bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-800">{error}</p>}

      {/* 못 읽었거나 여럿이면 이유를 그대로 적고, 여럿이면 그 자리에서 고르게 합니다. */}
      {result && result.kind !== "찾음" && !done && (
        <div className="mx-3 mt-2 rounded-lg bg-amber-100 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">{result.reason}</p>
          {result.kind === "여럿" && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {result.candidates.map((c) => (
                <button
                  key={c.routeId}
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setDone({ routeId: c.routeId, routeNo: c.routeNo });
                    setUndoLeft(5);
                    void onArrive(c.routeId);
                  }}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white"
                >
                  {c.routeNo}호 · {c.vehicleNo}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {phase !== "준비" && !done && (
        <button
          type="button"
          onClick={() => void readPlate()}
          disabled={phase === "읽는중"}
          className="mx-3 my-3 rounded-xl bg-amber-400 py-3.5 text-base font-black text-slate-900 disabled:opacity-60"
        >
          {phase === "읽는중" ? "읽는 중…" : "번호판 읽기"}
        </button>
      )}

      {/* 이 기능은 빠른 길이지 유일한 길이 아닙니다. 안 되는 날이 있다는 것을 미리 적어둡니다. */}
      <p className="px-4 pb-3 text-center text-[10px] text-white/50">
        비 오는 날·역광에서는 안 읽힐 수 있습니다. 그때는 닫고 호차를 손으로 눌러주세요.
      </p>
    </div>
  );
}
