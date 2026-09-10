"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { uploadStudentDoc, getStudentDocUrl, deleteStudentDoc } from "@/lib/storage";
import { todayKst } from "@/lib/kst";

/**
 * **휴가계획서·병결기록** — 학생별로 받은 서류를 여기 둡니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 아이가 길게 여행을 가거나 아파서 빠지면 휴가계획서·진단서를 받습니다. 그 파일이 메일함과
 * 담당자 컴퓨터에 흩어져 있어서, 나중에 「이 결석은 승인된 것인가」를 물으면 **받은 사람만**
 * 답할 수 있었습니다. 출결에는 「결석」이라고만 남고 근거가 어디에도 안 붙어 있습니다.
 *
 * ── 서류와 판단을 갈라 둡니다 ────────────────────────────────────────
 *
 * 서류가 들어왔다고 출결이 저절로 바뀌지는 않습니다. 상태는 **접수 → 승인/반려**이고,
 * 기본값은 「접수」입니다. 자동으로 승인해두면 학교가 검토하기 전에 결정이 나버리고,
 * 그 결정은 화면에 오류로 보이지 않습니다.
 *
 * ── 파일은 표에 담지 않습니다 ────────────────────────────────────────
 *
 * 파일은 비공개 저장소(`student-docs`)에 두고 표에는 경로만 적습니다. 여는 주소는 그때그때
 * 1시간짜리로 발급합니다 - 링크를 복사해 나눠줘도 곧 막힙니다. 진단서에는 아이의 병명이
 * 적혀 있습니다.
 */

type Doc = {
  id: string;
  kind: string;
  date_from: string;
  date_to: string;
  reason: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  status: string;
  reviewed_by: string | null;
  review_note: string | null;
  uploaded_by: string | null;
  created_at: string;
};

const KINDS = ["휴가계획서", "병결기록", "진단서", "소견서", "기타"] as const;

const STATUS_STYLE: Record<string, string> = {
  접수: "bg-amber-100 text-amber-800",
  승인: "bg-emerald-100 text-emerald-700",
  반려: "bg-red-100 text-red-700",
};

function sizeLabel(n: number | null): string {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

export default function AbsenceDocsPanel({
  studentId,
  studentName,
  me,
}: {
  studentId: string;
  studentName: string;
  me: string;
}) {
  const notify = useToast();
  const [rows, setRows] = useState<Doc[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [kind, setKind] = useState<string>("휴가계획서");
  const [from, setFrom] = useState(todayKst());
  const [to, setTo] = useState(todayKst());
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("student_absence_docs")
      .select("*")
      .eq("student_id", studentId)
      .order("date_from", { ascending: false });
    // 못 읽으면 **빈 목록으로 두지 않습니다.** 「서류가 없다」와 「못 읽었다」가 화면에서
    // 똑같아 보이면, 서류를 받아둔 건도 안 받은 것으로 처리됩니다.
    if (error) return setLoadError(error.message);
    setLoadError(null);
    setRows((data as Doc[] | null) ?? []);
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!file) return notify("파일을 골라주세요.", "error");
    if (to < from) return notify("끝나는 날이 시작하는 날보다 앞섭니다.", "error");
    setBusy(true);
    try {
      const path = await uploadStudentDoc(file, studentId);
      const { error } = await createClient().from("student_absence_docs").insert({
        student_id: studentId,
        kind,
        date_from: from,
        date_to: to,
        reason: reason.trim() || null,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        uploaded_by: me,
      });
      if (error) {
        // 표에 못 넣었으면 올린 파일을 도로 지웁니다. 안 지우면 저장소에 주인 없는 파일이
        // 쌓이고, 그건 아무도 못 찾습니다.
        await deleteStudentDoc(path).catch(() => {});
        throw new Error(error.message);
      }
      notify(`${studentName} · ${kind}을(를) 등록했습니다.`, "success");
      setFile(null);
      setReason("");
      setOpen(false);
      await load();
    } catch (e) {
      notify("등록하지 못했습니다: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function openDoc(d: Doc) {
    const url = await getStudentDocUrl(d.file_path);
    if (!url) return notify("파일을 열지 못했습니다. 저장소에서 지워졌을 수 있습니다.", "error");
    window.open(url, "_blank", "noopener");
  }

  async function review(d: Doc, status: "승인" | "반려") {
    setBusy(true);
    const { error } = await createClient()
      .from("student_absence_docs")
      .update({ status, reviewed_by: me, reviewed_at: new Date().toISOString() })
      .eq("id", d.id);
    setBusy(false);
    if (error) return notify("바꾸지 못했습니다: " + error.message, "error");
    await load();
  }

  async function remove(d: Doc) {
    setBusy(true);
    const { error } = await createClient().from("student_absence_docs").delete().eq("id", d.id);
    if (error) {
      setBusy(false);
      return notify("지우지 못했습니다: " + error.message, "error");
    }
    // 표에서 지웠으면 파일도 지웁니다. 한쪽만 지우면 저장소에 주인 없는 파일이 남습니다.
    await deleteStudentDoc(d.file_path).catch(() => {});
    setBusy(false);
    await load();
  }

  return (
    <section className="g-panel-solid p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">📄 휴가계획서 · 병결기록</h2>
        <span className="text-[11px] text-slate-400">{rows.length}건</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded-lg bg-slate-900 px-3 py-1 text-[11px] font-bold text-white"
        >
          {open ? "닫기" : "서류 등록"}
        </button>
      </div>

      {loadError && (
        <p className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          서류 목록을 읽지 못했습니다: {loadError}
        </p>
      )}

      {open && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={
                  "rounded-lg px-2.5 py-1 text-[11px] font-bold " +
                  (kind === k ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-100")
                }
              >
                {k}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
            <label className="font-semibold text-slate-600">기간</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
            <span className="text-slate-400">~</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
            <span className="text-slate-400">하루면 같은 날로 두세요</span>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유 한 줄 (예: 가족 여행 · 독감)"
            className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[11px]"
            />
            <button
              type="button"
              disabled={busy || !file}
              onClick={() => void submit()}
              className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
            >
              {busy ? "올리는 중…" : "등록"}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">받은 서류가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((d) => (
            <div key={d.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{d.kind}</span>
                <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (STATUS_STYLE[d.status] ?? "")}>{d.status}</span>
                <b className="text-slate-700">
                  {d.date_from}
                  {d.date_to !== d.date_from && ` ~ ${d.date_to}`}
                </b>
                {d.reason && <span className="text-slate-500">{d.reason}</span>}
                <button
                  type="button"
                  onClick={() => void openDoc(d)}
                  className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-bold text-blue-600 underline"
                >
                  {d.file_name} {sizeLabel(d.file_size)}
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                <span>올린 사람 {d.uploaded_by ?? "-"}</span>
                {d.reviewed_by && <span>· 확인 {d.reviewed_by}</span>}
                {d.status === "접수" && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" disabled={busy} onClick={() => void review(d, "승인")} className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white disabled:opacity-40">
                      승인
                    </button>
                    <button type="button" disabled={busy} onClick={() => void review(d, "반려")} className="rounded bg-slate-400 px-2 py-0.5 font-bold text-white disabled:opacity-40">
                      반려
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(d)}
                  className={"rounded px-1 font-bold text-slate-300 hover:text-red-500 disabled:opacity-40 " + (d.status === "접수" ? "" : "ml-auto")}
                  title="서류와 파일을 함께 지웁니다"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
