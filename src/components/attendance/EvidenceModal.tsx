"use client";

import { useEffect, useState } from "react";

/**
 * **이 결석의 근거** — 연락 원문을 그 자리에서 보여줍니다.
 *
 * 「확인」이 붙은 줄은 연락에서 저절로 들어온 것인데, 화면에는 그 사실만 있고 무엇을 보고
 * 그렇게 판단했는지가 없었습니다. 확인하려면 업무보드나 구글챗을 따로 열어야 했고, 그러면
 * 사람은 확인하지 않고 넘깁니다. **확인하지 않은 「확인」은 아무 뜻이 없습니다.**
 */

type Entry = {
  id: string;
  source: string;
  source_message_id: string | null;
  student_name: string;
  status: string;
  date_from: string;
  date_to: string;
  reason: string | null;
  note: string | null;
  raw_text: string | null;
  registered_by: string | null;
  registered_at: string | null;
  created_at: string;
};

type Full = { text: string; sender: string | null; at: string | null; channel: string | null };

const SOURCE_LABEL: Record<string, string> = {
  googlechat: "구글챗",
  toddle: "토들",
  manual: "직접 등록",
};

export default function EvidenceModal({
  entryId,
  studentName,
  onClose,
}: {
  entryId: string;
  studentName: string;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [full, setFull] = useState<Full | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/attendance/evidence?entryId=${encodeURIComponent(entryId)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { entry?: Entry; full?: Full | null; error?: string };
      if (!alive) return;
      setLoading(false);
      if (!res.ok) {
        // 왜 못 보여주는지 적습니다. 빈 창은 「근거가 없는 결석」과 구별되지 않습니다.
        setErr(body.error || "근거를 불러오지 못했습니다.");
        return;
      }
      setEntry(body.entry ?? null);
      setFull(body.full ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [entryId]);

  const span = entry && entry.date_from !== entry.date_to ? `${entry.date_from} ~ ${entry.date_to}` : entry?.date_from;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <b className="text-sm text-slate-800">
            📄 {studentName} — 이 기록의 근거
          </b>
          <button onClick={onClose} className="rounded px-2 text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {loading && <p className="py-6 text-center text-xs text-slate-400">불러오는 중…</p>}

        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{err}</p>}

        {entry && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">
                {SOURCE_LABEL[entry.source] ?? entry.source}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">{entry.status}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{span}</span>
              {full?.channel && <span className="text-slate-400">· {full.channel}</span>}
              {full?.sender && <span className="text-slate-400">· {full.sender}</span>}
              {full?.at && <span className="text-slate-400">· {new Date(full.at).toLocaleString("ko-KR")}</span>}
            </div>

            {/* 원문 그대로. 요약하지 않습니다 - 요약은 자동이 이미 한 번 했고, 지금 보려는 것은
                그 요약이 맞는지입니다. */}
            <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
              {full?.text || entry.raw_text || "원문이 저장되어 있지 않습니다."}
            </p>

            {/* 잘린 글을 온전한 원문인 척 보여주지 않습니다. 뒤쪽에 「아니 취소요」가 적혀
                있어도 모르게 됩니다. */}
            {!full && entry.raw_text && entry.raw_text.length >= 500 && (
              <p className="mt-1 text-[11px] font-semibold text-amber-700">
                원문이 500자에서 잘려 있습니다. 뒷부분은 {SOURCE_LABEL[entry.source] ?? entry.source} 에서 확인해주세요.
              </p>
            )}

            {entry.reason && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                자동이 남긴 말: {entry.reason}
              </p>
            )}
            {entry.note && <p className="mt-1 text-[11px] text-slate-500">메모: {entry.note}</p>}
            <p className="mt-2 text-[11px] text-slate-400">
              등록: {entry.registered_by ?? "자동"}
              {entry.registered_at && ` · ${new Date(entry.registered_at).toLocaleString("ko-KR")}`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
