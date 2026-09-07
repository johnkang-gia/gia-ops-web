"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { FIELD_LABEL, fieldOf, parseRosterPaste, type RosterField } from "@/lib/pasteRoster";

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
  // 머리줄과 자료를 **따로** 받습니다.
  //
  // 한 상자에 같이 붙여넣던 때는 「첫 줄이 머리줄인가」를 앱이 알아맞혀야 했고, 틀리면
  // 머리줄이 학생 한 명으로 들어가거나 첫 학생이 머리줄로 버려졌습니다. 어느 쪽도 화면에는
  // 오류로 보이지 않았습니다. 사람이 어디에 무엇을 넣는지 정해주면 알아맞힐 일이 없습니다.
  const [headText, setHeadText] = useState("");
  const [text, setText] = useState("");
  const [manual, setManual] = useState<(RosterField | null)[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState(false);

  // 머리줄 상자에 여러 줄이 들어와도 첫 줄만 씁니다(시트에서 끌어 복사하면 딸려옵니다).
  const headLine = headText.replace(/\r/g, "").split("\n").find((l) => l.trim() !== "") ?? "";
  const hasHead = headLine.trim() !== "";
  const joined = hasHead ? `${headLine}\n${text}` : text;

  const parsed = useMemo(
    () => parseRosterPaste(joined, manual ?? undefined, hasHead),
    [joined, manual, hasHead],
  );
  // 머리줄을 따로 받으므로 줄 번호도 「학생 줄 상자의 몇 번째」로 셉니다. 화면에서 「3번째 줄」
  // 이라고 짚었는데 상자에서는 2번째면 사람이 엉뚱한 줄을 고칩니다.
  const rows = parsed.rows.map((r) => ({ ...r, rowNo: r.rowNo - (hasHead ? 1 : 0) }));

  // 학생 줄 상자의 첫 줄이 머리줄처럼 보이는가. 상자를 나눠도 습관대로 통째로 붙여넣는
  // 일이 생깁니다. 그러면 머리줄이 학생 한 명으로 들어가는데, 화면에는 「새로 등록 1명」
  // 으로만 보입니다.
  const bodyHeadLike = (() => {
    const l = text.replace(/\r/g, "").split("\n").find((x) => x.trim() !== "") ?? "";
    if (!l) return false;
    const sep = l.includes("\t") ? "\t" : ",";
    return l.split(sep).filter((c) => fieldOf(c)).length >= 2;
  })();
  const usable = rows.filter((r) => !r.problem);
  const hasName = parsed.mapping.includes("name");
  /** 이 칸에 실제로 무엇이 들어 있는지 - 머리글만 보고 고르면 틀린 칸을 고릅니다. */
  const sampleRow = parsed.table[hasHead ? 1 : 0] ?? [];
  const headColCount = hasHead ? parsed.table[0]?.length ?? 0 : 0;
  const bodyColCount = parsed.table[hasHead ? 1 : 0]?.length ?? 0;
  const colCount = Math.max(headColCount, bodyColCount, parsed.mapping.length);

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
      <label className="mb-0.5 block text-[12px] font-bold text-slate-700">
        ① 머리줄 <span className="font-normal text-slate-400">(시트의 제목 줄 한 줄만)</span>
      </label>
      <textarea
        value={headText}
        onChange={(e) => {
          setHeadText(e.target.value);
          setPlans(null);
          setManual(null);
        }}
        rows={2}
        placeholder={"이름\t영문이름\t학년\t반\t생년월일\t어머니 연락처"}
        className="w-full rounded-xl border border-slate-300 p-3 font-mono text-[12px]"
      />
      {!hasHead && (
        <p className="mt-0.5 text-[11px] text-slate-500">
          머리줄이 없으면 아래에서 <b>칸을 직접 골라</b> 넣을 수 있습니다. 짐작해서 넣지 않습니다.
        </p>
      )}

      <label className="mb-0.5 mt-3 block text-[12px] font-bold text-slate-700">
        ② 학생 줄 <span className="font-normal text-slate-400">(제목 줄 빼고, 몇 줄이든)</span>
      </label>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPlans(null);
        }}
        rows={8}
        placeholder={"김민준\tMinjun Kim\t4\t4-1\t2015.3.4\t010-1111-2222\n이서연\tSeoyeon Lee\t4\t4-2\t2015.7.19\t010-3333-4444"}
        className="w-full rounded-xl border border-slate-300 p-3 font-mono text-[12px]"
      />
      {bodyHeadLike && (
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          <b>학생 줄 첫 줄이 머리줄처럼 보입니다.</b>
          {hasHead ? "이대로 두면 머리줄이 학생 한 명으로 등록됩니다." : "위 머리줄 상자로 옮기면 칸을 알아서 읽습니다."}
          <button
            onClick={() => {
              const ls = text.replace(/\r/g, "").split("\n");
              const at = ls.findIndex((x) => x.trim() !== "");
              if (at < 0) return;
              const [first] = ls.splice(at, 1);
              if (!hasHead) setHeadText(first);
              setText(ls.join("\n"));
              setManual(null);
              setPlans(null);
            }}
            className="rounded border border-amber-400 bg-white px-1.5 py-0.5 font-bold"
          >
            {hasHead ? "그 줄 빼기" : "머리줄 상자로 옮기기"}
          </button>
        </div>
      )}

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
            <b className="text-slate-700">③ 칸 짝짓기</b>
            <span className="text-[11px] text-slate-500">
              {hasHead ? "머리줄을 읽은 결과입니다. 틀린 곳은 바꾸세요." : "머리줄이 없으니 직접 고르세요."}
            </span>
            {hasHead && headColCount !== bodyColCount && (
              // 칸 수가 다르면 값이 한 칸씩 밀려 들어갑니다. 조용히 넘기면 안 됩니다.
              <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">
                머리줄 {headColCount}칸 · 학생 줄 {bodyColCount}칸 — 칸 수가 다릅니다
              </span>
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
                const head = hasHead ? parsed.table[0]?.[i] ?? "" : "";
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
            {rows.length - usable.length > 0 && (
              <span className="ml-1 text-rose-600">
                · 못 읽은 줄 {rows.length - usable.length}줄({rows.find((r) => r.problem)?.problem})
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
