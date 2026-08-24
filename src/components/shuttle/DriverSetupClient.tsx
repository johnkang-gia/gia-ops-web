"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TRACCAR_SETTINGS, storeUrl, type Platform } from "@/lib/driverSetup";

// 기사님이 휴대폰에서 보시는 화면입니다. 설계 원칙 세 가지:
//
//  1. 타자를 한 글자도 치지 않게 한다. 서버 주소는 60자가 넘고 기기 ID는 8자리 무작위라,
//     남의 휴대폰 자판으로 치면 오타가 납니다. 전부 "눌러서 복사"로 바꿨습니다.
//  2. 한 번에 한 단계만 보여준다. 여섯 단계를 한 화면에 펼치면 어디까지 했는지 잃어버립니다.
//     지금 할 것만 크게 보이고, 끝내면 다음이 열립니다.
//  3. 마지막에 "정말 되고 있는지"를 눈으로 확인시킨다. 설정을 마쳤는데 실제로는 안 되는
//     경우가 제일 나쁩니다 - 서버가 위치를 받았는지 직접 확인해서 초록 표시를 띄웁니다.
//
// 글자와 버튼을 크게 잡았습니다. 기사님 연배를 생각하면 기본 크기로는 읽기 어렵습니다.

type Props = {
  platform: Platform;
  routeLabel: string;
  vehicleNo: string | null;
  driverName: string | null;
  deviceId: string;
  serverUrl: string;
  setupCode: string;
  alreadyConnected: boolean;
  enabled: boolean;
};

export default function DriverSetupClient({
  platform,
  routeLabel,
  vehicleNo,
  driverName,
  deviceId,
  serverUrl,
  setupCode,
  alreadyConnected,
  enabled,
}: Props) {
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const [connected, setConnected] = useState(alreadyConnected);
  const [checking, setChecking] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isIOS = platform === "ios";
  const isAndroid = platform === "android";

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 구형 브라우저·비보안 컨텍스트에서는 clipboard API가 막혀 있습니다. 숨은 입력칸을
      // 만들어 선택 후 복사하는 옛 방식으로 넘어갑니다.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        window.prompt("아래 값을 길게 눌러 복사해주세요.", text);
      }
      document.body.removeChild(el);
    }
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  }

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/shuttle/setup/status?code=${encodeURIComponent(setupCode)}`, { cache: "no-store" });
      const json = await res.json();
      setConnected(!!json.connected);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
      setCheckedOnce(true);
    }
  }, [setupCode]);

  // 마지막 단계에 오면 10초마다 스스로 확인합니다. 기사님이 앱 스위치를 켜신 뒤 이 화면으로
  // 돌아오시면 아무것도 누르지 않아도 초록 표시로 바뀝니다.
  useEffect(() => {
    if (step !== 6 || connected) return;
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, [step, connected, check]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      {/* 머리말 - 몇 호차인지가 가장 먼저 보여야 다른 기사님 링크를 열었을 때 바로 아십니다 */}
      <header className="bg-slate-800 px-5 py-5 text-white">
        <p className="text-[13px] font-semibold text-slate-300">GIA 국제학교 하원차량 위치안내</p>
        <h1 className="mt-1 text-2xl font-black">
          {routeLabel}
          {driverName ? ` · ${driverName} 기사님` : ""}
        </h1>
        {vehicleNo && <p className="mt-0.5 text-sm text-slate-300">차량번호 {vehicleNo}</p>}
      </header>

      {/* 무엇을 언제 수집하는지 - 설정을 시작하시기 전에 먼저 보셔야 할 내용입니다 */}
      <section className="mx-4 -mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-[15px] font-bold text-slate-800">잠깐, 이것부터 확인해주세요</h2>
        <ul className="space-y-2 text-[14px] leading-relaxed text-slate-600">
          <li>
            <b className="text-slate-900">켜고 끄는 것은 기사님이 직접 하십니다.</b> 하원 운행 전에 앱 스위치를 켜고, 운행이
            끝나면 <b className="text-slate-900">꺼주세요.</b> 꺼두시면 위치가 전혀 전송되지 않습니다.
          </li>
          <li>
            켜두셔도 위치는 <b className="text-slate-900">평일 오후 3시 30분 ~ 6시 30분</b>에만 저장됩니다. 그 밖의 시간에
            앱이 보낸 위치는 학교 서버가 <b className="text-slate-900">받는 즉시 버립니다.</b>
          </li>
          <li>
            이 위치는 <b className="text-slate-900">하원 차량이 제대로 운행되는지 확인하는 용도로만</b> 씁니다. 근무 평가에
            쓰지 않고, 학부모를 포함해 <b className="text-slate-900">학교 밖 누구에게도 제공하지 않습니다.</b>
          </li>
          <li>
            저장된 기록은 <b className="text-slate-900">90일이 지나면 자동으로 삭제</b>됩니다.
          </li>
        </ul>
        {!enabled && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[13px] font-semibold text-amber-700">
            설정만 해두시면 됩니다. 이후 운행 때 앱 스위치를 직접 켜고, 끝나면 꺼주세요.
          </p>
        )}
      </section>

      <div className="mx-4 mt-4 flex flex-col gap-3">
        <Step n={1} current={step} title="앱 설치하기" onOpen={() => setStep(1)}>
          <p className="mb-3 text-[14px] leading-relaxed text-slate-600">
            <b>Traccar Client</b>라는 무료 앱입니다. 광고도 없고 결제도 없습니다.
          </p>
          <a
            href={storeUrl(platform)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl bg-blue-600 px-4 py-4 text-center text-[17px] font-bold text-white active:bg-blue-700"
          >
            {isIOS ? "App Store에서 설치" : isAndroid ? "Play 스토어에서 설치" : "스토어에서 설치"}
          </a>
          {platform === "unknown" && (
            <p className="mt-2 text-center text-[13px] text-slate-400">
              아이폰이시면{" "}
              <a href={storeUrl("ios")} className="underline" target="_blank" rel="noreferrer">
                여기
              </a>
              를 눌러주세요.
            </p>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
            설치가 끝나면 <b>앱을 열지 마시고</b> 이 화면으로 돌아와 아래 [다음]을 눌러주세요.
          </p>
          <NextButton onClick={() => setStep(2)}>설치했습니다</NextButton>
        </Step>

        <Step n={2} current={step} title="서버 주소 복사하기" onOpen={() => setStep(2)}>
          <p className="mb-3 text-[14px] leading-relaxed text-slate-600">
            아래 상자를 한 번 누르면 복사됩니다. <b>직접 입력하지 마세요</b> - 한 글자만 틀려도 작동하지 않습니다.
          </p>
          <CopyBox label="서버 주소 (Server URL)" value={serverUrl} copied={copied === "url"} onCopy={() => copy(serverUrl, "url")} />
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
            앱을 열고 <b>설정(Settings)</b> → <b>Server URL</b>을 길게 눌러 <b>붙여넣기</b> 하신 뒤, 이 화면으로 돌아오세요.
          </p>
          <NextButton onClick={() => setStep(3)}>넣었습니다</NextButton>
        </Step>

        <Step n={3} current={step} title="기기 번호 복사하기" onOpen={() => setStep(3)}>
          <p className="mb-3 text-[14px] leading-relaxed text-slate-600">
            차량을 구분하는 번호입니다. 이것도 눌러서 복사해주세요.
          </p>
          <CopyBox
            label="기기 식별자 (Device identifier)"
            value={deviceId}
            big
            copied={copied === "id"}
            onCopy={() => copy(deviceId, "id")}
          />
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
            앱의 <b>Device identifier</b> 칸에 붙여넣어 주세요. 원래 적혀 있던 숫자는 지우고 넣으시면 됩니다.
          </p>
          <NextButton onClick={() => setStep(4)}>넣었습니다</NextButton>
        </Step>

        <Step n={4} current={step} title="설정값 맞추기" onOpen={() => setStep(4)}>
          <p className="mb-3 text-[14px] leading-relaxed text-slate-600">
            앱 설정 화면에서 아래처럼 맞춰주세요. <b>★ 표시된 것이 가장 중요합니다.</b>
          </p>
          <div className="flex flex-col gap-2">
            {TRACCAR_SETTINGS.filter((s) => !(s.label === "Wake lock" && isIOS)).map((s) => (
              <div
                key={s.label}
                className={
                  "rounded-xl border p-3 " + (s.critical ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-white")
                }
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-bold text-slate-800">{s.label}</span>
                  <span className="text-[13px] text-slate-500">{s.ko}</span>
                  <span
                    className={
                      "ml-auto rounded-lg px-2.5 py-1 text-[15px] font-black " +
                      (s.critical ? "bg-orange-600 text-white" : "bg-slate-800 text-white")
                    }
                  >
                    {s.value}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{s.why}</p>
              </div>
            ))}
          </div>
          <NextButton onClick={() => setStep(5)}>맞췄습니다</NextButton>
        </Step>

        <Step n={5} current={step} title="휴대폰 권한 열어주기" onOpen={() => setStep(5)}>
          <p className="mb-3 text-[14px] leading-relaxed text-slate-600">
            이 두 가지를 안 하시면 <b>운행 중에 조용히 멈춥니다.</b> 꼭 해주세요.
          </p>
          <div className="flex flex-col gap-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[15px] font-bold text-slate-800">① 위치 권한을 &quot;항상 허용&quot;으로</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                {isIOS
                  ? "설정 → Traccar Client → 위치 → [항상]을 선택하고, [정확한 위치]도 켜주세요."
                  : "설정 → 애플리케이션 → Traccar Client → 권한 → 위치 → [항상 허용]을 선택해주세요."}
                <br />
                &quot;앱 사용 중에만&quot;으로 두면 네비를 보시는 동안 위치가 끊깁니다.
              </p>
            </div>
            {!isIOS && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[15px] font-bold text-slate-800">② 배터리 최적화 예외로</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  설정 → 애플리케이션 → Traccar Client → 배터리 → [제한 없음]을 선택해주세요. 삼성 휴대폰은 설정 → 배터리 →
                  백그라운드 사용 제한에서도 이 앱을 빼주셔야 합니다.
                </p>
              </div>
            )}
            {isIOS && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[15px] font-bold text-slate-800">② 저전력 모드 확인</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  저전력 모드가 켜져 있으면 위치 전송이 느려질 수 있습니다. 운행 중에는 충전기를 꽂아두시는 것을 권합니다.
                </p>
              </div>
            )}
          </div>
          <NextButton onClick={() => setStep(6)}>했습니다</NextButton>
        </Step>

        <Step n={6} current={step} title="켜고 확인하기" onOpen={() => setStep(6)} last>
          <p className="mb-3 text-[14px] leading-relaxed text-slate-600">
            마지막입니다. 앱 맨 위의 <b>스위치를 켜주세요.</b> 그리고 이 화면으로 돌아오시면 아래에 결과가 나옵니다.
          </p>

          <div
            className={
              "rounded-xl border p-4 text-center " +
              (connected ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")
            }
          >
            {connected ? (
              <>
                <div className="text-4xl">✅</div>
                <p className="mt-2 text-[17px] font-black text-emerald-700">연결되었습니다</p>
                <p className="mt-1 text-[14px] leading-relaxed text-emerald-700">
                  설정이 끝났습니다. 이제부터는 <b>기사님이 직접 켜고 끄시면 됩니다.</b> 하원 운행을 시작하기 전에 앱 맨 위
                  <b>스위치를 켜고</b>, 운행이 끝나면 <b>스위치를 꺼주세요(운행 종료)</b>. 스위치를 꺼두시면 위치가 전혀
                  전송되지 않습니다.
                </p>
              </>
            ) : (
              <>
                <div className="text-4xl">{checking ? "⏳" : "📡"}</div>
                <p className="mt-2 text-[16px] font-bold text-slate-700">
                  {checking ? "확인하는 중입니다..." : checkedOnce ? "아직 위치가 오지 않았습니다" : "확인을 기다리는 중"}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  앱 스위치를 켜신 뒤 <b>1분 정도</b> 걸릴 수 있습니다. 이 화면은 10초마다 스스로 다시 확인합니다.
                </p>
                <button
                  type="button"
                  onClick={check}
                  disabled={checking}
                  className="mt-3 w-full rounded-xl bg-slate-800 px-4 py-3 text-[15px] font-bold text-white disabled:opacity-50"
                >
                  지금 다시 확인
                </button>
              </>
            )}
          </div>

          {!connected && checkedOnce && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-800">
              <p className="mb-1 font-bold">잘 안 되면 이 순서로 확인해주세요</p>
              <p>
                1. 앱 맨 위 스위치가 켜져 있는지 · 2. Server URL과 Device identifier가 위 값과 똑같은지 · 3. 위치 권한이
                &quot;항상 허용&quot;인지.
                <br />
                그래도 안 되면 학교 사무실로 연락 주세요. 이 화면을 함께 보면서 도와드리겠습니다.
              </p>
              <p className="mt-2 text-amber-700">
                ※ 이 확인은 아무 시간에나 됩니다. 하원 시간대가 아니면 위치를 저장하지 않을 뿐, 앱이 잘 연결되었는지는
                지금도 확인할 수 있습니다.
              </p>
            </div>
          )}
        </Step>
      </div>

      <p className="mx-4 mt-6 text-center text-[12px] leading-relaxed text-slate-400">
        이 링크는 {routeLabel} 설정 전용입니다. 다른 분께 전달하지 말아주세요.
      </p>
    </main>
  );
}

// ── 화면 조각들 ────────────────────────────────────────────────────────────────

function Step({
  n,
  current,
  title,
  children,
  onOpen,
  last,
}: {
  n: number;
  current: number;
  title: string;
  children: React.ReactNode;
  onOpen: () => void;
  last?: boolean;
}) {
  const open = current === n;
  const done = current > n;
  return (
    <section
      className={
        "overflow-hidden rounded-2xl border shadow-sm " +
        (open ? "border-blue-300 bg-white" : done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white")
      }
    >
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-4 text-left">
        <span
          className={
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-black " +
            (done ? "bg-emerald-500 text-white" : open ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500")
          }
        >
          {done ? "✓" : n}
        </span>
        <span className={"text-[16px] font-bold " + (open ? "text-slate-900" : done ? "text-emerald-700" : "text-slate-500")}>
          {title}
        </span>
        {last && !done && <span className="ml-auto text-[12px] font-semibold text-slate-400">마지막</span>}
      </button>
      {open && <div className="border-t border-slate-100 px-4 pb-4 pt-4">{children}</div>}
    </section>
  );
}

function CopyBox({
  label,
  value,
  copied,
  onCopy,
  big,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className={
        "w-full rounded-xl border-2 border-dashed p-4 text-left transition " +
        (copied ? "border-emerald-400 bg-emerald-50" : "border-blue-300 bg-blue-50 active:bg-blue-100")
      }
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-500">{label}</span>
        <span className={"text-[13px] font-black " + (copied ? "text-emerald-600" : "text-blue-600")}>
          {copied ? "✓ 복사됨" : "눌러서 복사"}
        </span>
      </div>
      <code
        className={
          "block break-all font-mono text-slate-900 " + (big ? "text-2xl font-black tracking-widest" : "text-[15px] font-bold")
        }
      >
        {value}
      </code>
    </button>
  );
}

function NextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 w-full rounded-xl border-2 border-slate-800 px-4 py-3.5 text-[16px] font-bold text-slate-800 active:bg-slate-100"
    >
      {children} →
    </button>
  );
}
