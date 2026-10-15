"use client";

import { useState } from "react";
import { hitLabel, type NeedsConfirm, type NewStudentInput } from "@/lib/studentAdd";

/**
 * **같은 이름이 이미 있을 때 사람에게 묻는 창** — 학생을 새로 만드는 화면 모두가 이 창 하나를 씁니다.
 *
 * 기본값은 «같은 학생 — 넣지 않음»입니다. 잘못 넣은 줄은 나중에 합치기(되돌릴 수 없음)로만 지울 수 있고, 넣지
 * 않은 줄은 한 번 더 넣으면 됩니다. 그래서 사람이 일부러 고를 때만 새 줄이 생깁니다.
 */
export default function SameNameConfirm({
  items,
  onDone,
  onCancel,
}: {
  items: NeedsConfirm[];
  /** «다른 학생»으로 고른 줄(homonymOk 표시가 붙음). 비어 있으면 아무것도 안 넣습니다. */
  onDone: (add: NewStudentInput[], skipped: string[]) => void;
  onCancel: () => void;
}) {
  const [diff, setDiff] = useState<Record<number, boolean>>({});
  const chosen = items.filter((it) => diff[it.index]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
        <h2 className="text-sm font-bold text-slate-800">같은 이름의 학생이 이미 있습니다</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          같은 아이가 두 줄로 생기면 출결·청구가 두 줄에 나뉘어 쌓입니다. 반·생일을 보고 골라주세요. 고르지 않은 줄은 넣지 않습니다.
        </p>
        <ul className="mt-3 space-y-2">
          {items.map((it) => (
            <li key={it.index} className="rounded-lg border border-slate-200 p-2 text-xs">
              <div className="font-bold text-slate-800">
                {it.row.name}
                <span className="ml-1 font-normal text-slate-500">
                  {[it.row.grade && `${it.row.grade}학년`, it.row.class_name, it.row.birth_date && `생일 ${it.row.birth_date}`].filter(Boolean).join(" · ") || "반·생일 없음"}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-600">
                이미 있는 학생:
                <ul className="ml-3 list-disc">
                  {it.hits.map((h, i) => (
                    <li key={h.id || i}>
                      {h.name} — {hitLabel(h)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setDiff((d) => ({ ...d, [it.index]: false }))}
                  className={`rounded px-2 py-1 font-bold ring-1 ${!diff[it.index] ? "bg-slate-700 text-white ring-slate-700" : "bg-white text-slate-600 ring-slate-300"}`}
                >
                  같은 학생 — 넣지 않음
                </button>
                <button
                  type="button"
                  onClick={() => setDiff((d) => ({ ...d, [it.index]: true }))}
                  className={`rounded px-2 py-1 font-bold ring-1 ${diff[it.index] ? "bg-amber-600 text-white ring-amber-600" : "bg-white text-slate-600 ring-slate-300"}`}
                >
                  다른 학생 — 새로 추가
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300">
            닫기
          </button>
          <button
            type="button"
            onClick={() =>
              onDone(
                chosen.map((it) => ({ ...it.row, homonymOk: true })),
                items.filter((it) => !diff[it.index]).map((it) => it.row.name),
              )
            }
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white"
          >
            {chosen.length > 0 ? `${chosen.length}명 새로 추가` : "넣지 않고 닫기"}
          </button>
        </div>
      </div>
    </div>
  );
}
