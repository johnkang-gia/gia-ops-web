"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WrComment, WrReport, WrStudent } from "@/lib/types";
import ReportFormModal from "./ReportFormModal";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export default function StudentProfileClient({
  student,
  reports,
  initialComments,
  userEmail,
}: {
  student: WrStudent;
  reports: WrReport[];
  initialComments: WrComment[];
  userEmail: string;
}) {
  const [opening, setOpening] = useState<{ subject: string } | null>(null);
  const [comments, setComments] = useState<WrComment[]>(initialComments);
  const [commentText, setCommentText] = useState("");
  const [saving, setSaving] = useState(false);

  const bySubject = new Map<string, WrReport[]>();
  for (const r of reports) {
    const list = bySubject.get(r.subject) ?? [];
    list.push(r);
    bySubject.set(r.subject, list);
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("wr_comments")
      .insert({ student_id: student.id, author_email: userEmail, content: commentText.trim() })
      .select()
      .single();
    setSaving(false);
    if (data) {
      setComments((prev) => [data as WrComment, ...prev]);
      setCommentText("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {[...bySubject.entries()].map(([subject, list]) => (
        <div key={subject}>
          <h2 className="mb-2 text-sm font-bold text-slate-600">{subject}</h2>
          <div className="flex flex-col gap-1.5">
            {list
              .sort((a, b) => b.report_date.localeCompare(a.report_date))
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => setOpening({ subject })}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="text-slate-600">{r.report_date}</span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                      (r.status === "published" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")
                    }
                  >
                    {r.status === "published" ? "발행됨" : "임시저장"}
                  </span>
                </button>
              ))}
          </div>
        </div>
      ))}
      {bySubject.size === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          아직 작성된 리포트가 없습니다.
        </p>
      )}

      <div>
        <h2 className="mb-2 text-sm font-bold text-slate-600">💬 담당자 코멘트</h2>
        <form onSubmit={addComment} className="mb-3 flex gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="이 학생에 대한 메모를 남겨보세요..."
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            disabled={saving || !commentText.trim()}
            className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            등록
          </button>
        </form>
        <div className="flex flex-col gap-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
              <div className="mb-0.5 flex items-center justify-between">
                <span className="font-semibold text-slate-600">{c.author_email}</span>
                <span className="text-[11px] text-slate-300">{timeAgo(c.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-slate-700">{c.content}</p>
            </div>
          ))}
          {comments.length === 0 && <p className="text-xs text-slate-300">아직 코멘트가 없습니다.</p>}
        </div>
      </div>

      {opening && (
        <ReportFormModal
          student={student}
          reports={reports}
          termId={bySubject.get(opening.subject)?.[0]?.term_id ?? null}
          userEmail={userEmail}
          mode="archive"
          mySubject={opening.subject}
          onClose={() => setOpening(null)}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}
