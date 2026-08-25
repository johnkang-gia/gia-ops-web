"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/common/LanguageProvider";
import TeacherTabs from "./TeacherTabs";

type Req = {
  id: string;
  category: string;
  message: string;
  status: string;
  class_label: string | null;
  created_at: string;
};

const CATEGORIES = ["도움요청", "문의", "기타"] as const;

export default function OfficeRequestClient({ isHomeroom }: { isHomeroom: boolean }) {
  const t = useT();
  const [category, setCategory] = useState<string>("문의");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/office-request");
      if (res.ok) {
        const json = (await res.json()) as { requests: Req[] };
        setReqs(json.requests ?? []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    const res = await fetch("/api/office-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, message: message.trim() }),
    });
    setSending(false);
    if (res.ok) {
      setMessage("");
      setToast(t("행정실에 전달되었습니다.", "Sent to the office."));
      setTimeout(() => setToast(null), 2500);
      load();
    } else {
      setToast(t("전송에 실패했습니다. 다시 시도해주세요.", "Failed to send. Please try again."));
      setTimeout(() => setToast(null), 2500);
    }
  }

  const catLabel = (c: string) => t(c, c === "도움요청" ? "Help" : c === "문의" ? "Question" : "Other");
  const statusLabel = (s: string) => t(s, s === "접수" ? "Received" : s === "확인" ? "Seen" : "Done");
  const statusTone = (s: string) => (s === "완료" ? "bg-emerald-50 text-emerald-600" : s === "확인" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700");

  return (
    <div className="mx-auto max-w-2xl">
      <TeacherTabs isHomeroom={isHomeroom} />

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="mb-1 text-base font-bold text-slate-800">💬 {t("행정실 문의·도움요청", "Office Request")}</h1>
        <p className="mb-3 text-xs text-slate-500">{t("남기신 글은 행정실 업무 화면에 바로 표시됩니다.", "Your message appears on the office work board immediately.")}</p>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={"rounded-full px-3 py-1 text-xs font-semibold " + (category === c ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}
              >
                {catLabel(c)}
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder={t("어떤 도움이 필요하신가요?", "How can the office help?")}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={sending || !message.trim()}
            className="self-end rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {sending ? t("전송 중…", "Sending…") : t("행정실에 보내기", "Send to Office")}
          </button>
        </form>
        {toast && <p className="mt-2 text-xs font-semibold text-teal-700">{toast}</p>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-bold text-slate-700">{t("내 요청 내역", "My Requests")}</h2>
        {loading ? (
          <p className="py-6 text-center text-xs text-slate-400">{t("불러오는 중…", "Loading…")}</p>
        ) : reqs.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">{t("아직 남긴 요청이 없습니다.", "No requests yet.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {reqs.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{catLabel(r.category)}</span>
                  <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + statusTone(r.status)}>{statusLabel(r.status)}</span>
                  <span className="ml-auto text-[10px] text-slate-400">{new Date(r.created_at).toLocaleString(t("ko-KR", "en-US"), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{r.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
