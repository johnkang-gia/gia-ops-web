"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";

/**
 * 구글시트 → 명부 자동 수신.
 *
 * 시트는 직원 여럿이 함께 편집합니다. 시트에 붙인 스크립트는 **편집 권한이 있는 사람이면
 * 코드도 토큰도 볼 수 있으므로**, 두 가지를 겁니다.
 *
 *   ① 스크립트를 시트에 붙이지 않고 담당자 한 분 소유의 **별도 스크립트**로 둡니다.
 *      시트를 고치는 직원들은 스크립트가 있다는 것조차 모릅니다.
 *   ② 들어온 줄은 명부를 바로 고치지 않고 **대기함**에 쌓입니다. 토큰이 새더라도 최악이
 *      「대기함에 쓰레기 줄이 쌓이는 것」으로 끝납니다.
 */

type Link = {
  id: string;
  label: string;
  token: string;
  enabled: boolean;
  last_push_at: string | null;
  last_row_count: number | null;
  last_queued: number | null;
  last_error: string | null;
};

type Inbox = {
  id: string;
  name: string;
  kind: "새로 등록" | "바뀜" | "확인 필요";
  reason: string | null;
  changes: { field: string; from: string; to: string }[];
  created_at: string;
};

const KIND_STYLE: Record<Inbox["kind"], string> = {
  "새로 등록": "bg-emerald-100 text-emerald-800",
  바뀜: "bg-amber-100 text-amber-800",
  "확인 필요": "bg-rose-100 text-rose-700",
};

export default function RosterSyncClient() {
  const notify = useToast();
  const [links, setLinks] = useState<Link[]>([]);
  const [inbox, setInbox] = useState<Inbox[]>([]);
  const [busy, setBusy] = useState(false);
  const [openLink, setOpenLink] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/school/roster-sync/manage");
    const body = await res.json().catch(() => ({}));
    // 못 읽었으면 빈 화면이 아니라 이유를 띄웁니다. 빈 화면은 「연결이 없다」로 읽힙니다.
    if (!res.ok) return setLoadError(body.error ?? res.statusText);
    setLoadError(null);
    setLinks(body.links ?? []);
    setInbox(body.inbox ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await fetch("/api/school/roster-sync/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return notify((body.error as string) ?? res.statusText, "error");
    if ((body.failed as string[] | undefined)?.length) notify(`일부 실패: ${(body.failed as string[]).join(", ")}`, "error");
    else notify(done, "success");
    await load();
  }

  const pending = inbox.filter((r) => r.kind !== "확인 필요");

  return (
    <div className="rounded-xl border-2 border-slate-200 bg-white p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-bold text-slate-800">연결</h2>
        <button
          onClick={() => void act({ action: "create" }, "연결을 만들었습니다.")}
          disabled={busy}
          className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40"
        >
          연결 만들기
        </button>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        시트에 붙이지 말고 <b>담당자 한 분 소유의 별도 스크립트</b>로 두세요. 시트를 편집하는 직원은 스크립트도 토큰도 볼 수
        없습니다. 들어온 줄은 <b>바로 반영되지 않고 아래 대기함에 쌓입니다</b> — 토큰이 새더라도 명부가 조용히 바뀌지 않습니다.
      </p>

      {loadError && (
        <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
          연결 목록을 읽지 못했습니다: {loadError}
        </p>
      )}

      {links.length === 0 && !loadError && (
        // 「연결 만들기」를 누른 다음 무엇을 해야 하는지 여기서 말해줍니다. 버튼만 있고
        // 다음 걸음이 안 보이면, 누르고 나서 화면 앞에서 멈춥니다.
        <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600">
          <p className="mb-1 font-bold text-slate-800">아직 연결이 없습니다. 순서는 이렇습니다.</p>
          <p>
            <b>1.</b> 위 [연결 만들기] → <b>2.</b> 생긴 줄에서 [스크립트 보기] → <b>3.</b> [스크립트 복사] →{" "}
            <b>4.</b> script.google.com 에 붙여넣고 시트 ID·시트 이름만 고치기 → <b>5.</b> 10분마다 돌게 트리거 걸기.
          </p>
          <p className="mt-1 text-slate-400">자세한 순서는 [스크립트 보기]를 누르면 코드 아래에 그대로 나옵니다.</p>
        </div>
      )}

      {links.map((l) => (
        <div key={l.id} className="mb-2 rounded-lg border border-slate-200 p-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <b className="text-slate-800">{l.label}</b>
            <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (l.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-500")}>
              {l.enabled ? "켜짐" : "꺼짐"}
            </span>
            <span className="text-[11px] text-slate-500">
              마지막 수신{" "}
              {l.last_push_at ? (
                <>
                  {new Date(l.last_push_at).toLocaleString("ko-KR")} · 받은 줄 {l.last_row_count ?? 0} · 대기함에 {l.last_queued ?? 0}
                </>
              ) : (
                <span className="text-slate-400">아직 없음</span>
              )}
            </span>
            <button onClick={() => setOpenLink(openLink === l.id ? null : l.id)} className="ml-auto rounded border border-slate-300 px-1.5 py-0.5 text-[11px]">
              {openLink === l.id ? "스크립트 접기" : "스크립트 보기"}
            </button>
            <button
              onClick={() => void act({ action: "toggle", id: l.id, enabled: !l.enabled }, l.enabled ? "껐습니다." : "켰습니다.")}
              disabled={busy}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
            >
              {l.enabled ? "끄기" : "켜기"}
            </button>
            <button
              onClick={() => {
                if (!confirm("토큰을 새로 발급하면 지금 스크립트는 더 이상 보내지 못합니다. 스크립트의 TOKEN도 바꿔야 합니다. 계속할까요?")) return;
                void act({ action: "rotate", id: l.id }, "토큰을 새로 발급했습니다. 스크립트의 TOKEN을 바꿔주세요.");
              }}
              disabled={busy}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
            >
              토큰 재발급
            </button>
          </div>

          {l.last_error && (
            // 스크립트가 조용히 실패하면 아무도 모르는 채로 명부가 몇 주씩 뒤처집니다.
            <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">마지막 수신 오류: {l.last_error}</p>
          )}

          {openLink === l.id && <ScriptBox token={l.token} />}
        </div>
      ))}

      <div className="mt-3 border-t border-slate-200 pt-2">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <b className="text-[12px] text-slate-800">반영 대기 {inbox.length}줄</b>
          {inbox.length > 0 && (
            <>
              <button
                onClick={() => void act({ action: "apply", ids: pending.map((r) => r.id) }, "명부에 넣었습니다.")}
                disabled={busy || pending.length === 0}
                className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40"
              >
                이대로 넣기 ({pending.length}건)
              </button>
              <button
                onClick={() => void act({ action: "ignore", ids: inbox.map((r) => r.id) }, "대기함을 비웠습니다.")}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px]"
              >
                전부 무시
              </button>
            </>
          )}
        </div>

        {inbox.length === 0 ? (
          <p className="text-[11px] text-slate-400">대기 중인 줄이 없습니다.</p>
        ) : (
          <ul className="max-h-[40vh] overflow-y-auto">
            {inbox.map((r) => (
              <li key={r.id} className="border-b border-slate-100 py-1.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + KIND_STYLE[r.kind]}>{r.kind}</span>
                  <b className="text-slate-800">{r.name}</b>
                  {r.reason && <span className="text-[11px] text-rose-600">{r.reason}</span>}
                  <button
                    onClick={() => void act({ action: "ignore", ids: [r.id] }, "무시했습니다.")}
                    disabled={busy}
                    className="ml-auto rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500"
                  >
                    무시
                  </button>
                </div>
                {r.changes?.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1.5 pl-1">
                    {r.changes.map((c, i) => (
                      <span key={i} className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                        {c.field}: {c.from ? <s className="text-slate-400">{c.from}</s> : <span className="text-slate-300">(비어 있음)</span>} → <b>{c.to}</b>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ScriptBox({ token }: { token: string }) {
  const notify = useToast();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const code = `// GIA 명부 보내기 — 담당자 개인 소유의 «별도 스크립트»로 두세요.
// script.google.com > 새 프로젝트 > 아래를 붙여넣고 SHEET_ID / SHEET_NAME 만 고칩니다.
// 저장 후 [명부보내기]를 한 번 실행해 권한을 허용하고,
// 왼쪽 ⏰ 트리거 > 트리거 추가 > 시간 기반 > 분 단위 타이머 > 10분마다 로 걸어둡니다.

const SHEET_ID   = '시트주소의 /d/ 와 /edit 사이 글자';
const SHEET_NAME = '시트1';
const ENDPOINT   = '${origin}/api/school/roster-sync';
const TOKEN      = '${token}';

function 명부보내기() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('그런 이름의 시트가 없습니다: ' + SHEET_NAME);
  const v = sh.getDataRange().getDisplayValues();
  if (v.length < 2) throw new Error('머리줄 말고는 아무 줄도 없습니다.');

  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ token: TOKEN, header: v[0], rows: v.slice(1) }),
    muteHttpExceptions: true,
  });
  const out = res.getContentText();
  Logger.log(out);
  // 실패를 삼키지 않습니다. 조용히 실패하면 명부가 몇 주씩 뒤처집니다.
  if (res.getResponseCode() >= 300) throw new Error(out);
}`;

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-2">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => notify("스크립트를 복사했습니다.", "success"),
              () => notify("복사하지 못했습니다. 아래 글을 직접 선택해 복사해주세요.", "error"),
            );
          }}
          className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-bold text-white"
        >
          스크립트 복사
        </button>
        <span className="text-[11px] text-slate-500">
          토큰이 들어 있습니다. <b>시트에 붙이지 마세요</b> — 편집 권한이 있는 직원이 볼 수 있습니다.
        </span>
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900 p-2 text-[10px] leading-relaxed text-slate-100">{code}</pre>
      <SetupSteps />
    </div>
  );
}

/**
 * 설치 순서를 화면에 그대로 적어둡니다.
 *
 * 가이드(물음표) 안에만 적어두면 결국 아무도 안 봅니다. 이 일은 **한 번만 하는 설정**이라
 * 아무도 외우고 있지 않고, 다음에 하는 사람은 처음 하는 사람입니다. 구글 화면의 버튼 이름을
 * 그대로 적어 두어야 눈으로 따라갈 수 있습니다.
 */
function SetupSteps() {
  const steps: { t: string; d: React.ReactNode }[] = [
    {
      t: "① 스크립트를 복사합니다",
      d: <>바로 위의 [스크립트 복사]를 누릅니다. 토큰이 이미 들어 있어 따로 적을 것이 없습니다.</>,
    },
    {
      t: "② script.google.com 에서 새 프로젝트를 만듭니다",
      d: (
        <>
          <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer" className="font-bold text-teal-700 underline">
            script.google.com
          </a>{" "}
          에 <b>담당자 본인 계정</b>으로 들어가 [+ 새 프로젝트]. <b>시트 안에서 만들지 마세요</b> — 시트를 편집할 수 있는
          직원이면 코드도 토큰도 꺼내 볼 수 있습니다.
        </>
      ),
    },
    {
      t: "③ 원래 있던 코드를 지우고 붙여넣습니다",
      d: <>가운데 칸의 <code className="rounded bg-slate-100 px-1">function myFunction() {}</code> 를 모두 지우고 붙여넣습니다.</>,
    },
    {
      t: "④ 맨 위 두 줄만 고칩니다",
      d: (
        <>
          <b>SHEET_ID</b> — 시트 주소에서 <code className="rounded bg-slate-100 px-1">/d/</code> 와{" "}
          <code className="rounded bg-slate-100 px-1">/edit</code> 사이의 긴 글자.
          <br />
          <b>SHEET_NAME</b> — 시트 «아래쪽 탭»에 적힌 이름(예: 시트1). 나머지는 건드리지 않습니다.
        </>
      ),
    },
    {
      t: "⑤ 저장하고 한 번 실행합니다",
      d: (
        <>
          💾 저장 → 위쪽 함수 목록에서 <b>명부보내기</b>를 고르고 [실행].
        </>
      ),
    },
    {
      t: "⑥ 권한을 허용합니다 (처음 한 번)",
      d: (
        <>
          [권한 검토] → 계정 선택 → 「이 앱은 확인되지 않았습니다」가 뜨면 <b>고급</b> → <b>(프로젝트 이름)(으)로 이동</b> →
          [허용]. 담당자 본인 계정의 시트를 읽는 것이라 이 절차가 한 번 필요합니다.
        </>
      ),
    },
    {
      t: "⑦ 10분마다 저절로 돌게 걸어둡니다",
      d: (
        <>
          왼쪽 ⏰(트리거) → [트리거 추가] → 실행할 함수 <b>명부보내기</b>, 이벤트 소스 <b>시간 기반</b>, <b>분 단위 타이머</b>,{" "}
          <b>10분마다</b> → 저장.
        </>
      ),
    },
    {
      t: "⑧ 이 화면에서 확인합니다",
      d: (
        <>
          위 연결 줄의 <b>마지막 수신</b>에 시각과 줄 수가 뜨면 된 것입니다. 오류가 나면 그 자리에 빨갛게 적힙니다.
          들어온 줄은 아래 <b>반영 대기</b>에 쌓이고, [이대로 넣기]를 눌러야 명부가 바뀝니다.
        </>
      ),
    },
  ];

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <p className="mb-1.5 text-[12px] font-bold text-slate-800">📖 처음 한 번만 하는 설정</p>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <li key={s.t} className="text-[11px] leading-relaxed text-slate-600">
            <b className="text-slate-800">{s.t}</b>
            <br />
            {s.d}
          </li>
        ))}
      </ol>
      <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
        토큰을 재발급하면 <b>스크립트의 TOKEN 도 바꿔야</b> 합니다. 안 바꾸면 시트는 계속 보내는데 앱이 받지 않고, 그 사실은
        위 연결 줄의 「마지막 수신 오류」에만 뜹니다.
      </p>
    </div>
  );
}
