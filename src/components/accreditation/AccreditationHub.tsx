"use client";

import { useEffect, useState } from "react";
import { EXHIBITS } from "@/lib/accreditationExhibits";

/**
 * 인증 자료 목록 — 자료마다 «Ai 기준 몇 번에 넣을지»를 고르고, 영문 한 장을 열어 PDF로 저장합니다.
 *
 * 기준 번호는 Ai 기준표가 정해지면 사람이 맞춥니다. 앱이 미리 정해 두면 틀린 번호가 종이에 찍혀 나갑니다. 고른 번호는
 * 이 브라우저에 기억하고(localStorage), 파일 이름과 종이 머리말에 함께 들어갑니다 - 드라이브 폴더(Standard 1–12)에
 * 그대로 끌어다 놓을 수 있게.
 */
const KEY = "gia_accreditation_std";

export default function AccreditationHub() {
  const [std, setStd] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setStd(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
    } catch {
      setStd({});
    }
  }, []);
  function pick(key: string, n: number) {
    const next = { ...std, [key]: n };
    if (!n) delete next[key];
    setStd(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 기억 못 해도 이번 화면에서는 쓸 수 있습니다 - 번호는 주소로 넘어갑니다. */
    }
  }
  const fileName = (key: string, title: string) => {
    const n = std[key];
    return `${n ? `Standard ${String(n).padStart(2, "0")} - ` : ""}${title}.pdf`;
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="g-panel-solid p-4">
        <h2 className="mb-1 text-sm font-bold text-slate-800">📑 증거 자료 (영문)</h2>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          앱 기록을 심사단이 읽을 영문 한 장으로 뽑습니다. 학생 이름·연락처는 담지 않습니다. 자료마다 Ai 기준 번호를 고르면 종이 머리말과
          파일 이름에 함께 들어갑니다 - 열린 창에서 인쇄 → 「PDF로 저장」 → 아래 파일 이름 그대로 드라이브의 그 기준 폴더에 올리면 됩니다.
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500">
              <th className="py-1.5">자료</th>
              <th className="py-1.5">Ai 기준</th>
              <th className="py-1.5">저장할 파일 이름</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {EXHIBITS.map((e) => (
              <tr key={e.key} className="border-b border-slate-100">
                <td className="py-2 pr-2">
                  <div className="font-bold text-slate-800">{e.ko}</div>
                  <div className="text-[10px] text-slate-400">
                    {e.title} · {e.topic}
                  </div>
                </td>
                <td className="py-2 pr-2">
                  <select value={std[e.key] ?? 0} onChange={(ev) => pick(e.key, Number(ev.target.value))} className="rounded border border-slate-300 px-1.5 py-1 text-xs">
                    <option value={0}>미지정</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        Standard {n}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-2 font-mono text-[10px] text-slate-500">{fileName(e.key, e.title)}</td>
                <td className="py-2 text-right">
                  <a
                    href={`/school/accreditation/${e.key}${std[e.key] ? `?std=${std[e.key]}` : ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-700"
                  >
                    열기 ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="g-panel-solid p-4">
        <h2 className="mb-1 text-sm font-bold text-slate-800">🗓 방문단 수업 참관 일정표 (11월 6일)</h2>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          시간표 자료로 «몇 교시에 어느 반이 어느 교실에서 누구와 무엇을 하는지»를 영문 가로 한 장으로 뽑습니다. 11월 6일은 금요일입니다
          (7일 토요일은 정규 시간표가 없습니다). 시간표가 바뀌면 다시 열기만 하면 됩니다.
        </p>
        <a href="/school/accreditation-visit?day=5&date=2026-11-06" target="_blank" rel="noreferrer" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">
          금요일 시간표로 열기 ↗
        </a>
      </section>
    </div>
  );
}
