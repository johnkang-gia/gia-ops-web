"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { SHARED_ACCOUNT_DOMAIN, SHARED_ACCOUNT_KINDS, type SharedAccountKind } from "@/lib/sharedAccounts";

type Item = {
  email: string;
  kind: SharedAccountKind | null;
  name: string | null;
  position: string | null;
  status: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  disabled: boolean;
};

// 비밀번호를 브라우저에서 직접 만듭니다. 서버가 만들어 내려주면 그 값이 네트워크 응답과
// 서버 로그에 남을 수 있는데, 여기서 만들면 화면 밖으로 나가는 건 "이걸로 정해달라"는 요청
// 한 번뿐입니다. crypto.getRandomValues는 브라우저가 제공하는 암호학적 난수라 Math.random과
// 달리 다음 값을 예측할 수 없습니다.
//
// 헷갈리는 글자(0/O, 1/l/I)는 뺐습니다. 이 비밀번호는 종이에 적어 여러 사람이 옮겨 적게 되는데,
// 그때 가장 흔한 사고가 0과 O를 잘못 읽는 것입니다.
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 16): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length]).join("");
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export default function SharedAccountsClient() {
  const notify = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  // 방금 정한 비밀번호. 저장 직후 한 번만 크게 보여줍니다 - 다시는 꺼내볼 수 없어서, 이 화면을
  // 닫기 전에 적어두시라고 안내합니다.
  const [lastIssued, setLastIssued] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/shared-accounts");
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? "목록을 불러오지 못했습니다.", "error");
      setItems([]);
      return;
    }
    setItems(data.items as Item[]);
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId.trim() || !password) {
      notify("아이디와 비밀번호를 모두 입력해주세요.", "error");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/shared-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: accountId.trim(), password }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      notify(data.error ?? "저장하지 못했습니다.", "error");
      return;
    }
    setLastIssued({ email: data.email, password });
    notify(data.created ? "계정을 만들었습니다." : "비밀번호를 새로 정했습니다.", "success");
    setPassword("");
    setAccountId("");
    load();
  }

  async function toggleDisabled(item: Item) {
    setBusyEmail(item.email);
    const res = await fetch("/api/admin/shared-accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: item.email, disabled: !item.disabled }),
    });
    const data = await res.json();
    setBusyEmail(null);
    if (!res.ok) {
      notify(data.error ?? "변경하지 못했습니다.", "error");
      return;
    }
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 새 계정 만들기 / 비밀번호 바꾸기 */}
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">계정 만들기 · 비밀번호 바꾸기</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          아이디가 이미 있으면 비밀번호만 새로 정하고, 없으면 계정을 새로 만듭니다. 비밀번호는 저장하고 나면 다시 꺼내볼 수
          없으니, 아래에 표시될 때 꼭 적어두세요.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">아이디</label>
            <div className="flex items-center rounded-lg border border-slate-300 focus-within:border-gia-navy">
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="gia-demo"
                className="min-w-0 flex-1 rounded-l-lg px-3 py-2.5 text-sm outline-none"
              />
              <span className="shrink-0 pr-3 text-xs text-slate-400">{SHARED_ACCOUNT_DOMAIN}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SHARED_ACCOUNT_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => setAccountId(k.defaultId)}
                  className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                >
                  {k.defaultId}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">비밀번호</label>
            <div className="flex gap-1.5">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-sm outline-none focus:border-gia-navy"
              />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="shrink-0 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                자동 생성
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              길이 제한은 없습니다. 여러 사람이 하루에도 몇 번씩 입력하는 계정이라면 짧고 외우기 쉬운 편이 오히려 낫습니다 — 길고 복잡하면
              결국 모니터에 붙여두게 됩니다. 다만 <strong>개인 계정에 쓰는 비밀번호는 절대 쓰지 마세요.</strong>
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-lg bg-gia-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </form>

      {lastIssued && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <h3 className="text-sm font-bold text-amber-900">지금 적어두세요</h3>
          <p className="mt-1 text-xs text-amber-800">
            이 비밀번호는 이 화면을 벗어나면 다시 볼 수 없습니다. 잊어버리면 새로 정하는 방법밖에 없습니다.
          </p>
          <div className="mt-3 flex flex-col gap-1 rounded-lg bg-white p-3 font-mono text-sm">
            <div>
              <span className="mr-2 font-sans text-xs text-slate-400">아이디</span>
              {lastIssued.email}
            </div>
            <div>
              <span className="mr-2 font-sans text-xs text-slate-400">비밀번호</span>
              <strong className="text-base tracking-wide">{lastIssued.password}</strong>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLastIssued(null)}
            className="mt-3 rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            적어뒀습니다 · 숨기기
          </button>
        </div>
      )}

      {/* 계정 목록 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">등록된 공용 계정</h2>
        {items === null ? (
          <p className="mt-3 text-sm text-slate-400">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">아직 만들어진 공용 계정이 없습니다.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {items.map((item) => {
              const kindInfo = SHARED_ACCOUNT_KINDS.find((k) => k.kind === item.kind);
              return (
                <div
                  key={item.email}
                  className={
                    "rounded-xl border p-3 " + (item.disabled ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white")
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={"font-mono text-sm font-semibold " + (item.disabled ? "text-slate-400" : "text-slate-800")}>
                      {item.email}
                    </span>
                    {kindInfo && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {kindInfo.labelKo}
                      </span>
                    )}
                    {item.disabled && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">사용중지</span>
                    )}
                    <button
                      type="button"
                      disabled={busyEmail === item.email}
                      onClick={() => toggleDisabled(item)}
                      className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {item.disabled ? "다시 사용" : "사용중지"}
                    </button>
                  </div>
                  {kindInfo && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{kindInfo.descriptionKo}</p>}
                  <div className="mt-1.5 text-[11px] text-slate-400">
                    마지막 로그인 {formatDate(item.lastSignInAt)} · 만든 날짜 {formatDate(item.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
