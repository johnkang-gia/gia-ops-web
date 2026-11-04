/**
 * 새 문의 알림 소리 — 「띠링」 두 음. 소리 파일을 두지 않고 브라우저가 그 자리에서 만듭니다(받을 파일이 없으면
 * 못 받아 조용해질 일도 없습니다).
 *
 * 브라우저는 사람이 화면을 한 번이라도 누르기 전에는 소리를 막습니다. 그래서 첫 클릭 때 소리 장치를 깨워 둡니다.
 * 켜기/끄기는 이 브라우저에 기억합니다(사람마다 자리마다 다릅니다).
 */
const KEY = "gia-inquiry-chime-v1";
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

/** 첫 클릭·키 입력에 소리 장치를 깨웁니다. 한 번만 걸면 됩니다. */
export function primeChime(): void {
  if (typeof window === "undefined") return;
  const wake = () => {
    const a = audio();
    if (a && a.state === "suspended") void a.resume();
  };
  window.addEventListener("pointerdown", wake, { once: true });
  window.addEventListener("keydown", wake, { once: true });
}

export function chimeEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setChimeEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* 시크릿 창 - 이번 화면에서만 */
  }
}

/** 띠링. 꺼져 있거나 브라우저가 막으면 아무 일도 안 합니다(소리는 덤이고, 빨간 점이 본 신호입니다). */
export function playChime(): void {
  if (!chimeEnabled()) return;
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume();
  const t0 = a.currentTime;
  for (const [freq, at] of [
    [1318.5, 0],
    [1760, 0.16],
  ] as const) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.5);
    o.connect(g).connect(a.destination);
    o.start(t0 + at);
    o.stop(t0 + at + 0.55);
  }
}
