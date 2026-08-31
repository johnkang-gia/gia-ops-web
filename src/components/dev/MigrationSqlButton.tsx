"use client";

import { useState } from "react";

// 안 걸린 마이그레이션의 SQL을 그 자리에서 복사합니다.
//
// 지금까지 진단 화면은 "20260831120000_....sql 실행 필요"라고 **파일 이름만** 알려줬습니다.
// 그러면 담당자님은 그 파일을 어디서 찾아야 하는지부터 막힙니다 - 깃허브에 들어가서, 폴더를
// 뒤져서, 원문 보기를 눌러서, 전체 선택해서 복사해야 합니다. 다섯 단계입니다.
//
// 화면이 이미 어느 파일이 필요한지 알고 있으니, 그 내용까지 들고 있다가 한 번에 넘겨줍니다.
// 자동 적용(GitHub Actions)이 어떤 이유로든 안 돌았을 때 **막히지 않고 넘어갈 길**입니다.

export default function MigrationSqlButton({ file, sql }: { file: string; sql: string | null }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  if (!sql) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // 클립보드가 막힌 브라우저에서는 창을 열어 직접 고르게 합니다.
      setOpen(true);
    }
  }

  return (
    <>
      <span className="ml-1 inline-flex gap-1">
        <button
          type="button"
          onClick={copy}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
        >
          {copied ? "✓ 복사됨" : "SQL 복사"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
        >
          보기
        </button>
      </span>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <b className="font-mono text-xs text-slate-700">{file}</b>
              <div className="flex items-center gap-2">
                <button onClick={copy} className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-bold text-white">
                  {copied ? "✓ 복사됨" : "전체 복사"}
                </button>
                <button onClick={() => setOpen(false)} className="px-2 text-slate-400 hover:text-slate-700">
                  ✕
                </button>
              </div>
            </div>
            <p className="mb-2 text-[11px] text-slate-500">
              Supabase → SQL Editor에 붙여넣고 실행한 뒤, 이 화면에서 <b>[🔄 다시 진단하기]</b>를 누르면 초록으로 바뀝니다.
            </p>
            <textarea
              readOnly
              value={sql}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-[45vh] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed"
            />
          </div>
        </div>
      )}
    </>
  );
}
