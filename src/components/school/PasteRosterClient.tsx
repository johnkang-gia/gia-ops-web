"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { FIELD_LABEL, parseRosterPaste, type RosterField } from "@/lib/pasteRoster";

/**
 * 구글시트에서 복사한 줄을 붙여넣어 명부에 넣습니다.
 *
 * **두 걸음입니다.** 붙여넣으면 먼저 「무엇이 새로 생기고 무엇이 바뀌는지」를 보여주고,
 * 사람이 보고 나서 넣습니다. 명부는 되돌리기 어렵기 때문입니다 - 이름을 잘못 넣으면 그
 * 아이의 출결과 관찰기록이 새 줄에 붙기 시작하고, 그때는 합치기로 정리해야 합니다.
 */

const FIELDS: RosterField[] = [
  "name", "name_en", "grade", "class_name", "birth_date", "student_no",
  "mother_phone", "father_phone", "parent_phone",
];

type Plan = {
  rowNo: number;
  name: string;
  kind: "새로 등록" | "바뀜" | "그대로" | "확인 필요";
  changes: { field: string; from: string; to: string }[];
  reason?: string;
};

const KIND_STYLE: Record<Plan["kind"], string> = {
  "새로 등록": "bg-emerald-100 text-emerald-800",
  바뀜: "bg-amber-100 text-amber-800",
  그대로: "bg-slate-100 text-slate-400",
  "확인 필요": "bg-rose-100 text-rose-700",
};

export default function PasteRosterClient() {
  const notify = useToast();
  const [text, setText] = useState("");
  const [manual, setManual] = useState<(RosterField | null)[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);

  const parsed = useMemo(
    () => parseRosterPaste(text, manual ?? undefined, headerOverride ?? undefined),
    [text, manual, headerOverride],
  );
  const usable = parsed.rows.filter((r) => !r.problem);
  const hasName = parsed.mapping.includes("name");
  /** 이 칸에 실제로 무엇이 들어 있는지 - 머리글만 보고 고르면 틀린 칸을 고릅니다. */
  const sampleRow = parsed.table[parsed.headerUsed ? 1 : 0] ?? [];
  const colCount = Math.max(parsed.table[0]?.length ?? 0, parsed.mapping.length);

  async function preview() {
    if (usable.length === 0) return notify("읽을 수 있는 줄이 없습니다.", "error");
    setBusy(true);
    const res = await fetch("/api/school/paste-roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: usable.map((r) => ({ rowNo: r.rowNo, values: r.values })) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return notify("미리보지 못했습니다: " + (body.error ?? res.statusText), "error");
    setPlans(body.plans as Plan[]);
  }

  async function apply() {
    if (!plans) return;
    const n = plans.filter((p) => p.kind === "새로 등록").length;
    const u = plans.filter((p) => p.kind === "바뀜").length;
    if (n + u === 0) return notify("바뀌는 것이 없습니다.", "error");
    if (!confirm(`새로 ${n}명을 등록하고 ${u}명의 칸을 고칩니다. 계속할까요?`)) return;
    setBusy(true);
    const res = await fetch("/api/school/paste-roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: true, rows: usable.map((r) => ({ rowNo: r.rowNo, values: r.values })) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return notify("넣지 못했습니다: " + (body.error ?? res.statusText), "error");
    // 한 명이 실패해도 나머지는 들어가되, 누가 실패했는지 반드시 말합니다.
    if ((body.failed as string[] | undefined)?.length) {
      notify(`일부 실패: ${(body.failed as string[]).join(", ")}`, "error");
    } else {
      notify(`새로 ${n}명 등록 · ${u}명 갱신했습니다.`, "success");
    }
    setPlans(null);
    setText("");
  }

  const counts = plans
    ? {
        새로: plans.filter((p) => p.kind === "새로 등록").length,
        바뀜: plans.filter((p) => p.kind === "바뀜").length,
        그대로: plans.filter((p) => p.kind === "그대로").length,
        확인: plans.filter((p) => p.kind === "확인 필요").length,
      }
    : null;

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPlans(null);
          setManual(null);
          setHeaderOverride(null);
        }}
        rows={8}
        placeholder={"구글시트에서 머리줄까지 함께 복사해서 여기에 붙여넣으세요.\n\n이름\t영문이름\t학년\t반\t생년월일\t어머니 연락처\n김민준\tMinjun Kim\t4\t4-1\t2015.3.4\t010-1111-2222"}
        className="w-full rounded-xl border border-slate-300 p-3 font-mono text-[12px]"
      />

      {/*
        칸 짝짓기는 «언제나» 보이고 «언제나» 고칠 수 있습니다.
        예전에는 머리줄을 하나도 못 알아봤을 때만 고르는 칸이 나왔습니다. 그래서 반만 알아본
        경우 - 시트 머리글이 우리가 모르는 말인 칸 - 는 손댈 방법이 없었고, 그 칸의 값이
        통째로 버려지거나 옆 칸으로 들어갔습니다. 화면에는 오류가 아니라 「읽은 칸: 이름, 학년」
        으로만 보였습니다.
      */}
      {text.trim() !== "" && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-[12px]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <b className="text-slate-700">칸 짝짓기</b>
            <label className="flex items-center gap-1 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={parsed.headerUsed}
                onChange={(e) => {
                  setHeaderOverride(e.target.checked);
                  setManual(null);
                  setPlans(null);
                }}
              />
              첫 줄은 머리줄(이름·학년 …)입니다
            </label>
            {!parsed.headerDetected && parsed.headerUsed && (
              <span className="text-[11px] text-amber-700">머리줄로 쓰라고 직접 정한 상태입니다.</span>
            )}
            {parsed.headerDetected && !parsed.headerUsed && (
              <span className="text-[11px] text-amber-700">머리줄처럼 보이지만 자료로 읽는 중입니다.</span>
            )}
            {manual && (
              <button
                onClick={() => setManual(null)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600"
              >
                앱이 읽은 대로 되돌리기
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <div className="flex gap-2">
              {Array.from({ length: colCount }).map((_, i) => {
                const head = parsed.headerUsed ? parsed.table[0]?.[i] ?? "" : "";
                const picked = parsed.mapping[i] ?? null;
                const changed = manual != null && picked !== (parsed.guess[i] ?? null);
                return (
                  <label key={i} className="flex w-[132px] shrink-0 flex-col gap-0.5">
                    <span className="truncate text-[11px] font-semibold text-slate-700" title={head}>
                      {head || `${i + 1}번째 칸`}
                    </span>
                    <select
                      value={picked ?? ""}
                      onChange={(e) => {
                        const next = [...parsed.mapping];
                        while (next.length < colCount) next.push(null);
                        next[i] = (e.target.value || null) as RosterField | null;
                        setManual(next);
                        setPlans(null);
                      }}
                      className={
                        "rounded-lg border px-2 py-1 text-[12px] " +
                        (picked
                          ? changed
                            ? "border-amber-400 bg-amber-50 text-amber-900"
                            : "border-teal-300 bg-teal-50 text-teal-900"
                          : "border-slate-300 text-slate-400")
                      }
                    >
                      <option value="">— 안 씀</option>
                      {FIELDS.map((f) => (
                        <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                      ))}
                    </select>
                    {/* 머리글은 비슷비슷합니다. 실제 값이 보여야 어느 칸인지 압니다. */}
                    <span className="truncate text-[10px] text-slate-400" title={sampleRow[i] ?? ""}>
                      예: {(sampleRow[i] ?? "").trim() || "(빈칸)"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {!hasName && (
            <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
              이름 칸이 정해지지 않았습니다. 이름 없이는 어느 학생인지 알 수 없어 한 줄도 넣지 않습니다.
            </p>
          )}
          {hasName && parsed.unknownHeaders.length > 0 && (
            // 모르는 칸을 감추면 「내가 넣은 값이 어디 갔지」가 됩니다.
            <p className="mt-2 text-[11px] text-slate-400">
              못 알아본 머리글(위에서 직접 고를 수 있습니다): {parsed.unknownHeaders.join(", ")}
            </p>
          )}
          <p className="mt-1 text-[11px] text-slate-500">
            읽은 줄 <b>{usable.length}줄</b>
            {parsed.rows.length - usable.length > 0 && (
              <span className="ml-1 text-rose-600">
                · 못 읽은 줄 {parsed.rows.length - usable.length}줄({parsed.rows.find((r) => r.problem)?.problem})
              </span>
            )}
          </p>
          <button
            onClick={() => void preview()}
            disabled={busy || usable.length === 0}
            className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
          >
            {busy ? "확인하는 중…" : "무엇이 바뀌는지 먼저 보기"}
          </button>
        </div>
      )}

      {plans && counts && (
        <div className="mt-3 rounded-xl border-2 border-slate-300 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-bold">
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">새로 등록 {counts.새로}</span>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">바뀜 {counts.바뀜}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">그대로 {counts.그대로}</span>
            {counts.확인 > 0 && <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-700">확인 필요 {counts.확인}</span>}
            <button
              onClick={() => void apply()}
              disabled={busy || counts.새로 + counts.바뀜 === 0}
              className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              {busy ? "넣는 중…" : `이대로 넣기 (${counts.새로 + counts.바뀜}건)`}
            </button>
          </div>

          <ul className="max-h-[50vh] overflow-y-auto">
            {plans.map((p) => (
              <li key={p.rowNo} className="border-b border-slate-100 py-1.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + KIND_STYLE[p.kind]}>{p.kind}</span>
                  <b className="text-slate-800">{p.name}</b>
                  <span className="text-[10px] text-slate-300">{p.rowNo}번째 줄</span>
                  {p.reason && <span className="text-[11px] text-rose-600">{p.reason}</span>}
                </div>
                {p.changes.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1.5 pl-1">
                    {p.changes.map((c, i) => (
                      <span key={i} className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                        {c.field}: {c.from ? <s className="text-slate-400">{c.from}</s> : <span className="text-slate-300">(비어 있음)</span>} → <b>{c.to}</b>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
