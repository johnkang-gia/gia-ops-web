"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/common/AppLink";
import { createClient } from "@/lib/supabase/client";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { useToast } from "@/components/common/ToastProvider";
import { Who } from "@/components/common/HomonymProvider";
import StudentLedgerModal from "@/components/finance/StudentLedgerModal";
import AlltalkpayExport from "@/components/finance/AlltalkpayExport";
import { BILL_STATUS } from "@/lib/billStatus";
import { readAlltalkFile } from "@/lib/alltalkFile";
import { DECISIONS, SYNC_CODES, type SyncCode, type SyncRow, type SyncSummary } from "@/lib/alltalkSync";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}`;
const md = (d: string | null) => (d ? d.slice(5).replace("-", "/") : "");

type FileInfo = { id: string; file_name: string; uploaded_by: string; uploaded_at: string; row_count: number };
type Data = {
  files: FileInfo[];
  file: FileInfo | null;
  rows: SyncRow[];
  summary: SyncSummary | null;
  students: { id: string; name: string; where: string }[];
};

/** 탭마다 이름·색·한 줄 설명. 손이 가는 것부터 왼쪽에 둡니다. */
const CODE_INFO: Record<SyncCode, { label: string; tone: string; help: string }> = {
  수납: { label: "수납 넣기", tone: "bg-emerald-100 text-emerald-800 border-emerald-300", help: "올톡에서 결제됨 · 앱 청구서는 미납 → [수납 넣기]" },
  올톡표시: { label: "올톡 표시", tone: "bg-sky-100 text-sky-800 border-sky-300", help: "올톡으로 보냄(미결제) · 금액 일치 → [올톡 표시]" },
  학생확인: { label: "학생 확인", tone: "bg-violet-100 text-violet-800 border-violet-300", help: "올톡 이름이 누구인지 골라 주세요. 한 번 고르면 다음부터 자동" },
  확인: { label: "금액 확인", tone: "bg-rose-100 text-rose-800 border-rose-300", help: "금액이 다르거나 같은 금액이 두 번 결제됨" },
  앱에없음: { label: "앱에 없음", tone: "bg-amber-100 text-amber-800 border-amber-300", help: "올톡에는 있는데 앱에 같은 금액 청구서가 없음 → 판단 표시" },
  앱에만: { label: "앱에만 있음", tone: "bg-slate-200 text-slate-700 border-slate-300", help: "앱에서 발행했는데 올톡으로 나간 기록 없음" },
  참고: { label: "참고", tone: "bg-slate-100 text-slate-500 border-slate-200", help: "결제중단·발송실패만 남음 — 앱은 그대로" },
  일치: { label: "일치", tone: "bg-white text-slate-500 border-slate-200", help: "이미 맞음" },
};

/** 사람이 버튼을 눌러야 끝나는 줄. 나머지는 판단만 표시하면 끝납니다. */
const ACTION_CODES: SyncCode[] = ["수납", "올톡표시"];

/** 「앱에 넣음」으로 판단해서 이제 청구서로 만들 수 있는 줄. */
const canInsert = (r: SyncRow) => r.code === "앱에없음" && r.mark?.decision === "앱에 넣음" && !!r.studentId && !/로 넣음$/.test(r.mark?.memo ?? "");
/** 앱에만 있어서 올톡 파일로 보낼 수 있는 줄. */
const canExport = (r: SyncRow) => r.code === "앱에만" && r.invoices.length > 0;
const isPickable = (r: SyncRow) => ACTION_CODES.includes(r.code) || canInsert(r) || canExport(r);

export default function AlltalkSyncClient() {
  useFinanceLive(["alltalk_sync_marks", "alltalk_sync_files"]);
  const notify = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<SyncCode | "전체">("수납");
  const [hideDone, setHideDone] = useState(true);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ledger, setLedger] = useState<{ id: string; month: string | null } | null>(null);
  const [exporting, setExporting] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = data?.file?.id ?? null;

  const load = useCallback(async (id?: string | null) => {
    const res = await fetch(`/api/finance/alltalk-sync${id ? `?file=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as (Data & { error?: string }) | null;
    if (!res.ok || !json) {
      setLoadErr(json?.error ?? "대조 결과를 읽지 못했습니다.");
      return;
    }
    setLoadErr(null);
    setData(json);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 다른 사람이 금전 창에서 넣었거나 다른 컴퓨터에서 판단을 바꾸면 이 표도 다시 맞춥니다.
  // 표가 자기 상태를 들고만 있으면, 이미 넣은 수납이 계속 「수납 넣기」로 남아 두 번 누르게 됩니다.
  const fileIdRef = useRef<string | null>(null);
  fileIdRef.current = fileId;
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const again = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(fileIdRef.current), 800);
    };
    const ch = supabase.channel("alltalk-sync");
    for (const table of ["invoices", "payments", "alltalk_sync_marks"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, again);
    }
    ch.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [load]);

  async function upload(file: File) {
    setBusy("upload");
    try {
      const rows = await readAlltalkFile(file);
      if (rows.length === 0) {
        notify("읽을 줄이 없습니다. 첫 시트에 고객명·청구금액 칸이 있는지 확인해주세요.", "error");
        return;
      }
      const res = await fetch("/api/finance/alltalk-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, rows }),
      });
      const json = (await res.json().catch(() => null)) as (Data & { error?: string }) | null;
      if (!res.ok || !json) {
        notify(json?.error ?? "올리지 못했습니다.", "error");
        return;
      }
      setData(json);
      setPicked(new Set());
      notify(`${rows.length}줄을 읽어 대조했습니다. 아직 아무것도 바뀌지 않았습니다 — 줄마다 확인하고 누르세요.`, "success");
    } catch (e) {
      notify("파일을 읽지 못했습니다: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; already?: boolean };
    return { ok: res.ok, status: res.status, error: json.error ?? null, already: !!json.already };
  }

  /** 한 줄 처리. 실패는 모아서 돌려줍니다 - 일부만 들어간 줄을 「완료」로 보이게 두지 않습니다. */
  async function runRow(r: SyncRow): Promise<string[]> {
    const fails: string[] = [];
    if (r.code === "수납") {
      for (const p of r.pays) {
        const res = await post("/api/finance/invoices/pay", {
          invoiceId: p.invoiceId,
          action: "pay",
          method: "올톡페이",
          paidAt: r.paidAt,
          amount: p.amount,
          memo: `올톡페이 결제${r.approvals.length ? ` · 승인 ${r.approvals.join(", ")}` : ""} (올톡 대조)`,
          sourceKey: r.sourceKey ? `${r.sourceKey}#${p.invoiceNo}` : undefined,
        });
        if (!res.ok && !res.already) fails.push(`${r.studentName} ${p.invoiceNo}: ${res.error}`);
      }
    }
    if ((r.code === "수납" || r.code === "올톡표시" || r.code === "일치") && r.markExported.length > 0 && fails.length === 0) {
      const res = await post("/api/finance/ledger/exported", { invoiceIds: r.markExported, exported: true });
      if (!res.ok) fails.push(`${r.studentName} 올톡 표시: ${res.error}`);
    }
    return fails;
  }

  async function runOne(r: SyncRow) {
    setBusy(r.key);
    try {
      const fails = await runRow(r);
      if (fails.length) notify(`처리하지 못했습니다 — ${fails.join(" / ")}`, "error");
      else notify(r.code === "수납" ? `${r.studentName} 수납 ${won(r.pays.reduce((n, p) => n + p.amount, 0))}원을 넣었습니다.` : `${r.studentName} 올톡 표시를 켰습니다.`, "success");
    } finally {
      setBusy(null);
      await load(fileId);
    }
  }

  async function runPicked() {
    const list = (data?.rows ?? []).filter((r) => picked.has(r.key) && ACTION_CODES.includes(r.code));
    if (list.length === 0) return;
    const payN = list.filter((r) => r.code === "수납");
    const sum = payN.reduce((n, r) => n + r.pays.reduce((m, p) => m + p.amount, 0), 0);
    const markN = list.length - payN.length;
    if (!confirm(`고른 ${list.length}줄을 처리합니다.\n\n· 수납 ${payN.length}건 · ${won(sum)}원 (수납일은 각 줄의 올톡 결제일)\n· 올톡 표시 ${markN}건\n\n계속할까요?`)) return;
    setBusy("bulk");
    const fails: string[] = [];
    try {
      for (const r of list) fails.push(...(await runRow(r)));
    } finally {
      setBusy(null);
      setPicked(new Set());
      await load(fileId);
    }
    if (fails.length) notify(`${list.length - fails.length}건 처리 · 실패 ${fails.length}건: ${fails.slice(0, 5).join(" / ")}${fails.length > 5 ? " …" : ""}`, "error");
    else notify(`${list.length}줄을 처리했습니다.`, "success");
  }

  /** 「앱에 넣음」 줄을 청구서로. 서버가 다시 판정해서 여전히 넣을 줄만 넣습니다. */
  async function insertRows(list: SyncRow[]) {
    if (!fileId || list.length === 0) return;
    const sum = list.reduce((n, r) => n + (r.paidAmount || r.openAmount), 0);
    const paidN = list.filter((r) => r.paidAmount > 0).length;
    if (
      !confirm(
        `${list.length}건을 운영앱 청구서로 만듭니다(합계 ${won(sum)}원).\n\n· 결제된 ${paidN}건은 입금까지 함께 넣습니다(올톡 결제일·승인번호).\n· 나머지는 미납 청구서가 되어 미납금에 잡힙니다.\n· 「올톡」 표시는 켜진 채로 만듭니다(이미 올톡으로 나간 청구).\n\n계속할까요?`,
      )
    )
      return;
    setBusy("insert");
    try {
      const res = await fetch("/api/finance/alltalk-sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, keys: list.map((r) => r.key) }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; made?: string[]; failures?: string[]; skipped?: string[] } | null;
      if (!res.ok || !json) {
        notify(json?.error ?? "넣지 못했습니다.", "error");
        return;
      }
      const made = json.made?.length ?? 0;
      const bad = [...(json.failures ?? []), ...(json.skipped ?? [])];
      if (bad.length) notify(`${made}건을 넣었습니다. 못 넣은 ${bad.length}건: ${bad.slice(0, 4).join(" / ")}${bad.length > 4 ? " …" : ""}`, "error");
      else notify(`${made}건을 청구서로 넣었습니다.`, "success");
    } finally {
      setBusy(null);
      setPicked(new Set());
      await load(fileId);
    }
  }

  async function saveMark(body: { key: string; kind: "link" | "decision"; studentId?: string | null; decision?: string | null; memo?: string | null }) {
    setBusy(body.key);
    try {
      const res = await post("/api/finance/alltalk-sync/mark", body);
      if (!res.ok) notify(`저장하지 못했습니다: ${res.error}`, "error");
    } finally {
      setBusy(null);
      await load(fileId);
    }
  }

  // 「앱에 넣음」은 판단만 끝났고 넣는 일이 남아 있어서 끝난 줄이 아닙니다.
  const isDone = (r: SyncRow) => r.code === "일치" || (!ACTION_CODES.includes(r.code) && r.code !== "학생확인" && !!r.mark?.decision && !canInsert(r));

  const shown = useMemo(() => {
    const term = q.trim();
    return (data?.rows ?? []).filter((r) => {
      if (tab !== "전체" && r.code !== tab) return false;
      if (hideDone && isDone(r) && tab !== "일치") return false;
      if (term && !`${r.studentName} ${r.where} ${r.why} ${r.history.map((h) => h.name).join(" ")}`.includes(term)) return false;
      return true;
    });
  }, [data, tab, hideDone, q]);

  const left = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      action: rows.filter((r) => ACTION_CODES.includes(r.code)).length,
      who: rows.filter((r) => r.code === "학생확인").length,
      judge: rows.filter((r) => ["확인", "앱에없음", "앱에만"].includes(r.code) && !r.mark?.decision).length,
      insert: rows.filter(canInsert).length,
    };
  }, [data]);

  const pickable = shown.filter(isPickable);
  const pickedRows = (data?.rows ?? []).filter((r) => picked.has(r.key));
  const pickedAct = pickedRows.filter((r) => ACTION_CODES.includes(r.code));
  const pickedIns = pickedRows.filter(canInsert);
  const pickedExp = pickedRows.filter(canExport);

  // 번호로 맞은 비율. 금액으로 짐작한 짝이 많으면 다음 발송부터 앱에서 만든 파일을 쓰도록 권합니다.
  const matchedRows = (data?.rows ?? []).filter((r) => ["수납", "올톡표시", "일치"].includes(r.code) && r.history.length > 0);
  const byNumberN = matchedRows.filter((r) => r.byNumber).length;
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(r.key));

  return (
    <div className="mx-auto max-w-[1500px] p-3 sm:p-5">
      {/* ── 머리: 파일 · 남은 일 ───────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">🔁 올톡 결과 맞추기</h1>
        <span className="text-[12px] text-slate-500">올톡페이 「청구서관리목록」을 올리면 학생마다 운영앱과 맞춰 봅니다.</span>
        <Link href="/finance/send" className="text-[12px] font-semibold text-teal-700 underline">← 올톡 보내기</Link>
        <span className="ml-auto flex items-center gap-2">
          {data && data.files.length > 0 && (
            <select
              value={fileId ?? ""}
              onChange={(e) => void load(e.target.value)}
              className="max-w-[320px] rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
              title="예전에 올린 파일로 다시 대조합니다(그 파일 기준, 지금 앱 상태와 비교)"
            >
              {data.files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.file_name} · {f.uploaded_at.slice(5, 10).replace("-", "/")} {f.uploaded_by.split("@")[0]} · {f.row_count}줄
                </option>
              ))}
            </select>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={busy !== null} className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40">
            {busy === "upload" ? "읽는 중…" : "📤 올톡 파일 올리기"}
          </button>
        </span>
      </div>

      {loadErr && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{loadErr}</p>}

      {data && !data.file && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-[13px] text-slate-500">
          올톡페이 관리자 화면 → 청구서관리 → 목록을 엑셀로 받아 그대로 올리세요. 올려도 운영앱은 바뀌지 않습니다 — 줄마다 확인하고 누른 것만 들어갑니다.
        </div>
      )}

      {data?.file && data.summary && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px]">
            <b className="text-slate-800">남은 일</b>
            <span className={left.action ? "font-bold text-emerald-700" : "text-slate-400"}>누를 것 {left.action}</span>
            <span className={left.who ? "font-bold text-violet-700" : "text-slate-400"}>학생 고르기 {left.who}</span>
            <span className={left.judge ? "font-bold text-amber-700" : "text-slate-400"}>판단 표시 {left.judge}</span>
            <span className={left.insert ? "font-bold text-amber-700" : "text-slate-400"}>앱에 넣을 것 {left.insert}</span>
            {left.action + left.who + left.judge + left.insert === 0 && <span className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white">이 파일은 다 맞췄습니다 ✓</span>}
            <span className="ml-auto text-[11px] text-slate-400">
              {data.file.file_name} · {data.file.row_count}줄 → 청구 {data.rows.filter((r) => r.code !== "앱에만").length}건
            </span>
          </div>

          {matchedRows.length > 0 && byNumberN < matchedRows.length && (
            <p className="mb-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] leading-relaxed text-violet-900">
              이 파일은 앱 청구서와 맞은 {matchedRows.length}건 중 <b>{byNumberN}건만 청구서 번호로</b> 맞았고, 나머지는 금액으로 짐작해 맞췄습니다.
              다음 발송부터는 <b>올톡페이 › 보내기</b>(또는 학생 회계 창의 「📤 올톡 보내기」)로 만든 파일을 올톡에 올리세요 — 청구사유 앞에 번호가 붙어
              결과를 받으면 금액이 같은 형제·정산 건도 엇갈리지 않습니다. 「앱에만 있음」 탭에서 바로 보낼 수도 있습니다.
            </p>
          )}

          {/* ── 탭 ─────────────────────────────────────────────────────── */}
          <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-1 bg-slate-50/95 px-1 py-1.5 backdrop-blur">
            {(["전체", ...SYNC_CODES] as const).map((c) => {
              const s = c === "전체" ? { count: data.rows.length, amount: 0, decided: 0 } : data.summary![c];
              const info = c === "전체" ? null : CODE_INFO[c];
              const active = tab === c;
              return (
                <button
                  key={c}
                  onClick={() => {
                    setTab(c);
                    setPicked(new Set());
                  }}
                  title={info?.help}
                  className={
                    "rounded-lg border px-2.5 py-1 text-[12px] font-bold " +
                    (active ? "border-slate-900 bg-slate-900 text-white" : info ? info.tone : "border-slate-300 bg-white text-slate-700")
                  }
                >
                  {info?.label ?? "전체"} {s.count}
                  {s.amount > 0 && <span className="ml-1 text-[10px] font-semibold opacity-75">{won(s.amount)}</span>}
                </button>
              );
            })}
            <label className="ml-2 flex items-center gap-1 text-[11px] text-slate-600">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              끝난 줄 숨기기
            </label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·반·사유 찾기" className="ml-auto w-44 rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
            {pickedAct.length > 0 && (
              <button onClick={() => void runPicked()} disabled={busy !== null} className="rounded-lg bg-emerald-700 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-40">
                {busy === "bulk" ? "처리 중…" : `고른 ${pickedAct.length}줄 처리`}
              </button>
            )}
            {pickedIns.length > 0 && (
              <button onClick={() => void insertRows(pickedIns)} disabled={busy !== null} className="rounded-lg bg-amber-600 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-40">
                {busy === "insert" ? "넣는 중…" : `고른 ${pickedIns.length}줄 앱에 넣기`}
              </button>
            )}
            {pickedExp.length > 0 && (
              <button
                onClick={() => setExporting(pickedExp.flatMap((r) => r.invoices.map((v) => v.id)))}
                disabled={busy !== null}
                className="rounded-lg bg-violet-700 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-40"
                title="고른 청구서로 올톡페이 등록 파일을 만듭니다. 청구사유 앞에 청구서 번호가 붙어, 결과를 다시 올리면 번호로 정확히 맞춰집니다."
              >
                고른 {pickedExp.length}장 올톡 파일 만들기
              </button>
            )}
          </div>
          {tab !== "전체" && <p className="mb-2 px-1 text-[11px] text-slate-500">{CODE_INFO[tab].help}</p>}

          {/* ── 표 ─────────────────────────────────────────────────────── */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1100px] text-[12px]">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-1.5">
                    {pickable.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allPicked}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(pickable.map((r) => r.key)))}
                        title="이 탭에서 누를 것을 모두 고릅니다"
                      />
                    )}
                  </th>
                  <th className="px-2 py-1.5 text-left">학생</th>
                  <th className="px-2 py-1.5 text-left">올톡페이</th>
                  <th className="px-2 py-1.5 text-left">운영앱</th>
                  <th className="px-2 py-1.5 text-left">할 일</th>
                  <th className="w-[230px] px-2 py-1.5 text-left">처리</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <SyncLine
                    key={r.key}
                    r={r}
                    busy={busy === r.key || busy === "bulk"}
                    picked={picked.has(r.key)}
                    onPick={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(r.key)) n.delete(r.key);
                        else n.add(r.key);
                        return n;
                      })
                    }
                    onRun={() => void runOne(r)}
                    onMark={(b) => void saveMark(b)}
                    onInsert={() => void insertRows([r])}
                    onExport={() => setExporting(r.invoices.map((v) => v.id))}
                    onOpen={() => r.studentId && setLedger({ id: r.studentId, month: r.invoices[0]?.billingMonth ?? null })}
                    students={data.students}
                  />
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[13px] text-slate-400">
                      {hideDone ? "남은 줄이 없습니다. (끝난 줄은 숨겨 두었습니다)" : "줄이 없습니다."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate-400">
            같은 청구를 다시 보낸 줄은 하나로 묶었습니다(→ 는 보낸 순서). 수납일은 올톡 결제일, 수단은 올톡페이, 메모에 승인번호가 들어갑니다. 같은 승인번호는 두 번
            들어가지 않습니다. 이 파일을 <Link href="/finance/import" className="underline">앱 밖 청구 가져오기</Link>에 다시 올리지 마세요 — 그쪽은 청구서를 새로 만듭니다.
          </p>
        </>
      )}

      {exporting && (
        <AlltalkpayExport
          invoiceIds={exporting}
          onClose={() => setExporting(null)}
          onMarked={() => {
            setPicked(new Set());
            void load(fileId);
          }}
        />
      )}
      {ledger && <StudentLedgerModal studentId={ledger.id} month={ledger.month} onClose={() => setLedger(null)} onChanged={() => void load(fileId)} />}
    </div>
  );
}

function SyncLine({
  r,
  busy,
  picked,
  onPick,
  onRun,
  onMark,
  onOpen,
  onInsert,
  onExport,
  students,
}: {
  r: SyncRow;
  busy: boolean;
  picked: boolean;
  onPick: () => void;
  onRun: () => void;
  onMark: (b: { key: string; kind: "link" | "decision"; studentId?: string | null; decision?: string | null; memo?: string | null }) => void;
  onOpen: () => void;
  onInsert: () => void;
  onExport: () => void;
  students: { id: string; name: string; where: string }[];
}) {
  const info = CODE_INFO[r.code];
  const [memo, setMemo] = useState(r.mark?.kind === "decision" ? r.mark.memo ?? "" : "");
  const [find, setFind] = useState("");
  const canAct = isPickable(r);
  const found = find.trim().length >= 1 ? students.filter((s) => s.name.includes(find.trim())).slice(0, 8) : [];

  return (
    <tr className={"border-t border-slate-100 align-top " + (picked ? "bg-emerald-50/60" : "")}>
      <td className="px-2 py-1.5 text-center">{canAct && <input type="checkbox" checked={picked} onChange={onPick} disabled={busy} />}</td>

      {/* 학생 */}
      <td className="px-2 py-1.5">
        <span className={"mb-0.5 inline-block rounded border px-1 text-[10px] font-bold " + info.tone}>{info.label}</span>
        <div className="flex items-center gap-1">
          {r.studentId ? (
            <button onClick={onOpen} className="font-bold text-slate-800 underline decoration-slate-300 hover:decoration-slate-700" title="학생 회계 창 열기">
              <Who id={r.studentId} name={r.studentName} plain />
            </button>
          ) : (
            <b className="text-slate-800">{r.studentName}</b>
          )}
          <span className="text-[10px] text-slate-400">{r.where}</span>
        </div>
        {r.tentative && (
          <div className="mt-0.5 text-[10px] font-semibold text-amber-700" title={r.matchWhy}>
            ⚠ 짐작 연결 — {r.matchWhy}
          </div>
        )}
        {r.department === "중고등부" && <div className="text-[10px] text-slate-400">중고등부</div>}
      </td>

      {/* 올톡 */}
      <td className="px-2 py-1.5">
        <div className="text-slate-700">{r.why || "—"}</div>
        {r.code !== "앱에만" && (
          <div className="font-bold">
            {r.paidAmount > 0 ? (
              <span className="text-emerald-700">결제 {won(r.paidAmount)} ({md(r.paidAt)})</span>
            ) : r.openAmount > 0 ? (
              <span className="text-slate-700">미결제 {won(r.openAmount)}</span>
            ) : (
              <span className="text-slate-400">유효 청구 없음</span>
            )}
          </div>
        )}
        {r.history.length > 1 && (
          <div className="mt-0.5 text-[10px] leading-snug text-slate-400">
            {r.history.map((h, i) => (
              <span key={i}>
                {i > 0 && " → "}
                {md(h.issuedAt)} {won(h.amount)} {h.status}
              </span>
            ))}
          </div>
        )}
        {r.approvals.length > 0 && <div className="text-[10px] text-slate-400">승인 {r.approvals.join(", ")}</div>}
      </td>

      {/* 운영앱 */}
      <td className="px-2 py-1.5">
        {r.invoices.length === 0 && <span className="text-slate-400">같은 금액 청구서 없음</span>}
        {r.invoices.length > 0 && r.history.length > 0 && ["수납", "올톡표시", "일치"].includes(r.code) && (
          <div className={"text-[10px] font-semibold " + (r.byNumber ? "text-emerald-700" : "text-slate-400")}>{r.byNumber ? "번호로 맞음" : "금액으로 맞춤"}</div>
        )}
        <div className="flex flex-col gap-0.5">
          {r.invoices.map((v) => (
            <span key={v.id} className="whitespace-nowrap">
              <b className="text-slate-700">{v.invoiceNo}</b> <span className="text-slate-500">{v.billingMonth ? `${Number(v.billingMonth.slice(5))}월` : ""} {v.stream}</span>{" "}
              <span className="tabular-nums">{won(v.total)}</span>{" "}
              {/* 색은 재무 공통 표(BILL_STATUS) - 학비·학비외 표와 같은 아이가 같은 색으로 보여야 합니다. */}
              {v.balance === 0 ? (
                <span className={"rounded px-1 text-[10px] font-bold " + BILL_STATUS.완납.cls}>완납</span>
              ) : v.balance < v.total ? (
                <span className={"rounded px-1 text-[10px] font-bold " + BILL_STATUS.일부.cls}>일부 · 남음 {won(v.balance)}</span>
              ) : (
                <span className={"rounded px-1 text-[10px] font-bold " + BILL_STATUS.청구됨.cls}>남음 {won(v.balance)}</span>
              )}
              {v.offline && <span className="ml-0.5 text-[10px] text-sky-600">직접수납</span>}
              {v.exported && <span className="ml-0.5 text-[10px] text-violet-600">올톡✓</span>}
            </span>
          ))}
        </div>
      </td>

      {/* 할 일 */}
      <td className="px-2 py-1.5 text-[11px] leading-snug text-slate-600">{r.note}</td>

      {/* 처리 */}
      <td className="px-2 py-1.5">
        {r.code === "수납" && (
          <button onClick={onRun} disabled={busy} className="w-full rounded-lg bg-emerald-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-40">
            {busy ? "넣는 중…" : `수납 넣기 ${won(r.pays.reduce((n, p) => n + p.amount, 0))}`}
          </button>
        )}
        {r.code === "올톡표시" && (
          <button onClick={onRun} disabled={busy} className="w-full rounded-lg bg-sky-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-40">
            {busy ? "…" : "올톡 표시"}
          </button>
        )}
        {r.code === "일치" && r.markExported.length > 0 && (
          <button onClick={onRun} disabled={busy} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600" title="수납은 맞고 올톡 표시만 꺼져 있습니다">
            올톡 표시 켜기
          </button>
        )}

        {r.code === "학생확인" && r.linkKey && (
          <div className="space-y-1">
            {r.candidates.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {r.candidates.map((c) => (
                  <button key={c.id} onClick={() => onMark({ key: r.linkKey!, kind: "link", studentId: c.id })} disabled={busy} className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[11px] font-bold text-violet-800">
                    {c.name} {c.where}
                  </button>
                ))}
              </div>
            )}
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="다른 학생 찾기" className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-[11px]" />
            {found.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {found.map((s) => (
                  <button key={s.id} onClick={() => onMark({ key: r.linkKey!, kind: "link", studentId: s.id })} disabled={busy} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]">
                    {s.name} <span className="text-slate-400">{s.where}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => onMark({ key: r.linkKey!, kind: "link", decision: "학생 아님" })} disabled={busy} className="text-[10px] text-slate-500 underline">
              학생 아님(교직원·외부)
            </button>
          </div>
        )}

        {canInsert(r) && (
          <button onClick={onInsert} disabled={busy} className="mb-1 w-full rounded-lg bg-amber-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-40" title="이 금액으로 운영앱 청구서를 만듭니다(결제됐으면 입금까지)">
            앱에 넣기 {won(r.paidAmount || r.openAmount)}
          </button>
        )}
        {canExport(r) && !r.invoices.every((v) => v.exported) && (
          <button onClick={onExport} disabled={busy} className="mb-1 w-full rounded-lg bg-violet-600 px-2 py-1 text-[12px] font-bold text-white disabled:opacity-40" title="이 청구서를 올톡페이 등록 파일로 만듭니다(청구서 번호가 붙습니다)">
            올톡 파일 만들기
          </button>
        )}
        {["확인", "앱에없음", "앱에만", "참고"].includes(r.code) && (
          <div className="space-y-1">
            <select
              value={r.mark?.kind === "decision" ? r.mark.decision ?? "" : ""}
              disabled={busy}
              onChange={(e) => onMark({ key: r.key, kind: "decision", decision: e.target.value || null, memo: memo || null })}
              className={"w-full rounded border px-1 py-0.5 text-[11px] " + (r.mark?.decision ? "border-emerald-400 bg-emerald-50 font-bold" : "border-slate-300")}
            >
              <option value="">판단 고르기…</option>
              {DECISIONS.filter((d) => d !== "학생 아님").map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onBlur={() => {
                const prev = r.mark?.kind === "decision" ? r.mark.memo ?? "" : "";
                if (memo !== prev) onMark({ key: r.key, kind: "decision", decision: r.mark?.decision ?? null, memo: memo || null });
              }}
              placeholder="메모(무엇에 대한 돈인지 등)"
              className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
            />
            {r.mark && <div className="text-[10px] text-slate-400">{r.mark.updatedBy.split("@")[0]} · {r.mark.updatedAt.slice(5, 10).replace("-", "/")}</div>}
          </div>
        )}
        {r.code === "학생확인" || !r.linkKey || r.code === "참고" ? null : (
          !r.tentative ? null : (
            <button onClick={() => onMark({ key: r.linkKey!, kind: "link", studentId: r.studentId })} disabled={busy} className="mt-1 text-[10px] text-amber-700 underline" title="이 올톡 이름·번호를 이 학생으로 기억합니다">
              이 학생이 맞음
            </button>
          )
        )}
      </td>
    </tr>
  );
}
