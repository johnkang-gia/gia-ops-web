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

  const parsed = useMemo(() => parseRosterPaste(text, manual ?? undefined), [text, manual]);
  const usable = parsed.rows.filter((r) => !r.problem);
  const needsMapping = text.trim() !== "" && parsed.mapping.filter(Boolean).length === 0;

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
        }}
        rows={8}
        placeholder={"구글시트에서 머리줄까지 함께 복사해서 여기에 붙여넣으세요.\n\n이름\t영문이름\t학년\t반\t생년월일\t어머니 연락처\n김민준\tMinjun Kim\t4\t4-1\t2015.3.4\t010-1111-2222"}
        className="w-full rounded-xl border border-slate-300 p-3 font-mono text-[12px]"
      />

      {/* 무엇을 읽었는지 바로 보여줍니다. 짐작만 하고 넣으면 어느 칸이 어디로 갔는지 모릅니다. */}
      {text.trim() !== "" && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-[12px]">
          {needsMapping ? (
            <>
              <p className="mb-2 font-bold text-amber-800">
                머리줄을 못 찾았습니다. 어느 칸이 무엇인지 정해주세요 — 짐작해서 넣지 않습니다.
              </p>
              <div className="flex flex-wrap gap-2">
                {(parsed.rows[0]?.rowNo ? text.split("\n")[0].split(text.includes("\t") ? "\t" : ",") : []).map((sample, i) => (
                  <label key={i} className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-400">{i + 1}번째 칸 · 예: {sample.trim() || "(빈칸)"}</span>
                    <select
                      value={manual?.[i] ?? ""}
                      onChange={(e) => {
                        const next = [...(manual ?? [])];
                        next[i] = (e.target.value || null) as RosterField | null;
                        setManual(next);
                      }}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
                    >
                      <option value="">— 안 씀</option>
                      {FIELDS.map((f) => (
                        <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-700">
                읽은 칸:{" "}
                {parsed.mapping.map((f, i) => (f ? <span key={i} className="mr-1.5 rounded bg-teal-50 px-1.5 py-0.5 text-teal-800">{FIELD_LABEL[f]}</span> : null))}
              </p>
              {parsed.unknownHeaders.length > 0 && (
                // 모르는 칸을 감추면 「내가 넣은 값이 어디 갔지」가 됩니다.
                <p className="mt-1 text-[11px] text-slate-400">
                  못 알아본 칸(넣지 않음): {parsed.unknownHeaders.join(", ")}
                </p>
              )}
              <p className="mt-1 text-[11px] text-slate-500">
                읽은 줄 <b>{usable.length}줄</b>
                {parsed.rows.length - usable.length > 0 && (
                  <span className="ml-1 text-rose-600">· 못 읽은 줄 {parsed.rows.length - usable.length}줄(이름 없음)</span>
                )}
              </p>
            </>
          )}
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
