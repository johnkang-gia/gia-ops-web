"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PinPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/pin")
      .then((r) => r.json())
      .then((data) => setHasPin(!!data.hasPin))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!hasPin && pin !== pin2) {
      setError("입력한 PIN이 서로 다릅니다.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin, mode: hasPin ? "verify" : "setup" }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error || "확인하지 못했습니다.");
      return;
    }
    router.push("/home");
    router.refresh();
  }

  if (loading) {
    return <main className="gia-navy-panel flex flex-1 items-center justify-center px-4" />;
  }

  return (
    <main className="gia-navy-panel flex flex-1 items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl"
      >
        <h1 className="mb-1 text-center text-xl font-bold">
          {hasPin ? "보안 PIN 확인" : "보안 PIN 설정"}
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          {hasPin
            ? "구글 로그인 이후 한 번 더 확인하는 단계입니다."
            : "처음 접속하셨네요. 숫자 4~8자리로 PIN을 새로 설정해주세요."}
        </p>

        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="PIN 입력"
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-lg tracking-widest"
        />

        {!hasPin && (
          <input
            type="password"
            inputMode="numeric"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
            placeholder="PIN 다시 입력"
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-lg tracking-widest"
          />
        )}

        {error && <p className="mb-3 text-center text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || pin.length < 4}
          className="w-full rounded-lg bg-gia-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
        >
          {submitting ? "확인 중..." : hasPin ? "확인" : "PIN 설정하기"}
        </button>

        {hasPin && (
          <p className="mt-4 text-center text-xs text-slate-400">
            PIN을 잊어버렸다면 개발자에게 초기화를 요청하세요.
          </p>
        )}
      </form>
    </main>
  );
}
