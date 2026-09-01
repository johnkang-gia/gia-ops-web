"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { gradeLabel, resolveStudentItems, sumLines, won, type StudentLike } from "@/lib/feeItems";
import type { FeeItem, Invoice, StudentFeeItem } from "@/lib/types";

// 인보이스 만들기.
//
// 왼쪽에서 아이를 고르면, 그 아이가 사는 것이 **이미 채워진 채로** 나옵니다(항목에 적어둔
// 기본 학년·반). 다른 것만 눌러 고치고, 발행을 누르면 그 순간의 값이 굳어 인보이스가 됩니다.
//
// 합계는 화면이 계산합니다. 사람이 더할 자리를 아예 만들지 않았습니다 - 받은 구글독스
// 양식에서도 항목 합(191,000원)과 총액 칸(191,200원)이 어긋나 있었습니다.

export type Student = { id: string; name: string; nameEn: string | null; grade: string | null; className: string | null };

type Props = {
  students: Student[];
  items: FeeItem[];
  initialOverrides: StudentFeeItem[];
  recentInvoices: Invoice[];
  currentUserEmail: string;
  loadError: string | null;
  /** 오늘(한국). 서버에서 계산해 내려줍니다 - 브라우저 시계는 사람마다 다릅니다. */
  today: string;
};

export default function InvoiceBuilderClient({
  students,
  items,
  initialOverrides,
  recentInvoices,
  currentUserEmail,
  loadError,
  today,
}: Props) {
  const notify = useToast();
  const [overrides, setOverrides] = useState(initialOverrides);
  const [invoices, setInvoices] = useState(recentInvoices);
  const [selectedId, setSelectedId] = useState<string | null>(students[0]?.id ?? null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  // 납부 기한. 발행할 때마다 손으로 고치는 대신 기본값을 두고 필요할 때만 바꿉니다.
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(`${today}T12:00:00+09:00`);
    d.setDate(d.getDate() + 11);
    return d.toISOString().slice(0, 10);
  });

  const selected = students.find((s) => s.id === selectedId) ?? null;
  const activeItems = useMemo(() => items.filter((i) => i.active), [items]);

  const shownStudents = useMemo(() => {
    const k = q.trim().toLowerCase().replace(/\s+/g, "");
    if (!k) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().replace(/\s+/g, "").includes(k) ||
        (s.nameEn ?? "").toLowerCase().replace(/\s+/g, "").includes(k) ||
        (s.className ?? "").toLowerCase().includes(k) ||
        (s.grade ?? "").includes(k),
    );
  }, [students, q]);

  /** 이 아이가 사는 것. 화면과 발행이 같은 함수를 씁니다 - 다르면 본 것과 보낸 것이 달라집니다. */
  const lines = useMemo(
    () => (selected ? resolveStudentItems(activeItems, selected as StudentLike, overrides) : []),
    [activeItems, selected, overrides],
  );
  const total = sumLines(lines);

  /** 학생별 합계(왼쪽 목록에 미리 보여줍니다 — 누가 얼마인지 한눈에). */
  const totalByStudent = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of students) m.set(s.id, sumLines(resolveStudentItems(activeItems, s as StudentLike, overrides)));
    return m;
  }, [students, activeItems, overrides]);

  const invoiceByStudent = useMemo(() => {
    const m = new Map<string, Invoice>();
    for (const v of invoices) if (v.student_id && v.status === "발행" && !m.has(v.student_id)) m.set(v.student_id, v);
    return m;
  }, [invoices]);

  const overrideOf = (itemId: string) =>
    overrides.find((o) => o.student_id === selectedId && o.item_id === itemId) ?? null;

  /** 항목 하나를 켜고 끕니다. 기본 세트와 다른 것만 DB에 남습니다. */
  async function toggle(item: FeeItem) {
    if (!selected) return;
    const on = lines.some((l) => l.item.id === item.id);
    const mode: "include" | "exclude" = on ? "exclude" : "include";
    const prev = overrides;
    const existing = overrideOf(item.id);
    const optimistic: StudentFeeItem = existing
      ? { ...existing, mode }
      : {
          id: `local-${item.id}`,
          student_id: selected.id,
          item_id: item.id,
          term_id: null,
          mode,
          qty: 1,
          note: null,
          updated_by: currentUserEmail,
          created_at: "",
          updated_at: "",
        };
    setOverrides((p) => [...p.filter((o) => !(o.student_id === selected.id && o.item_id === item.id)), optimistic]);

    const { data, error } = await createClient()
      .from("student_fee_items")
      .upsert(
        { student_id: selected.id, item_id: item.id, mode, qty: optimistic.qty, updated_by: currentUserEmail },
        { onConflict: "student_id,item_id" },
      )
      .select()
      .single();
    if (error || !data) {
      notify("저장하지 못했습니다: " + (error?.message ?? ""), "error");
      setOverrides(prev);
      return;
    }
    setOverrides((p) => p.map((o) => (o.id === optimistic.id ? (data as StudentFeeItem) : o)));
  }

  async function setQty(item: FeeItem, qty: number) {
    if (!selected || qty < 1) return;
    const prev = overrides;
    setOverrides((p) =>
      p.some((o) => o.student_id === selected.id && o.item_id === item.id)
        ? p.map((o) => (o.student_id === selected.id && o.item_id === item.id ? { ...o, qty } : o))
        : [
            ...p,
            {
              id: `local-${item.id}`,
              student_id: selected.id,
              item_id: item.id,
              term_id: null,
              mode: "include" as const,
              qty,
              note: null,
              updated_by: currentUserEmail,
              created_at: "",
              updated_at: "",
            },
          ],
    );
    const { data, error } = await createClient()
      .from("student_fee_items")
      .upsert(
        { student_id: selected.id, item_id: item.id, mode: "include", qty, updated_by: currentUserEmail },
        { onConflict: "student_id,item_id" },
      )
      .select()
      .single();
    if (error || !data) {
      notify("수량을 저장하지 못했습니다: " + (error?.message ?? ""), "error");
      setOverrides(prev);
      return;
    }
    setOverrides((p) => p.map((o) => (o.student_id === selected.id && o.item_id === item.id ? (data as StudentFeeItem) : o)));
  }

  /** 발행 — 이 순간의 이름과 금액을 베껴 굳힙니다. */
  async function issue() {
    if (!selected || lines.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/finance/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selected.id, dueDate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify("발행하지 못했습니다: " + (body.error ?? res.statusText), "error");
        return;
      }
      setInvoices((p) => [body.invoice as Invoice, ...p]);
      notify(`${body.invoice.invoice_no} 발행했습니다.`, "success");
      window.open(`/finance/invoices/${body.invoice.id}/print`, "_blank");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">🧾 인보이스</h1>
        <span className="text-xs text-slate-400">학비외 (교재 · 악기 · 악기수리 · 교복)</span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        아이를 고르면 그 아이가 사는 것이 <b>이미 채워진 채로</b> 나옵니다. 다른 것만 눌러 고치고 발행을 누르면 PDF로
        뽑을 수 있는 인보이스가 됩니다. 합계는 화면이 계산합니다 — 사람이 더할 자리가 없습니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}
      {activeItems.length === 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          아직 등록된 항목이 없습니다. <a href="/finance/items" className="font-bold underline">학비외 항목</a>에서 먼저
          교재·교복 등을 만들어주세요.
        </p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* ── 왼쪽: 학생 ─────────────────────────────────────────── */}
        <div className="w-full shrink-0 lg:w-72">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 · 영문이름 · 학년 · 반"
            className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {shownStudents.map((s) => {
              const amount = totalByStudent.get(s.id) ?? 0;
              const issued = invoiceByStudent.get(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={
                    "flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 " +
                    (selectedId === s.id ? "bg-teal-50" : "hover:bg-slate-50")
                  }
                >
                  <span className="min-w-0">
                    <span className="text-sm font-bold text-slate-800">{s.name}</span>
                    <span className="ml-1 text-[10px] text-slate-400">
                      {[s.grade ? `${s.grade}학년` : null, s.className].filter(Boolean).join(" ")}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-right">
                    <span className={"block text-[12px] font-bold tabular-nums " + (amount > 0 ? "text-slate-700" : "text-slate-300")}>
                      {amount > 0 ? won(amount) : "—"}
                    </span>
                    {issued && <span className="block text-[9px] font-semibold text-emerald-600">발행 {issued.invoice_no}</span>}
                  </span>
                </button>
              );
            })}
            {shownStudents.length === 0 && <p className="p-6 text-center text-[12px] text-slate-400">찾는 학생이 없습니다.</p>}
          </div>
        </div>

        {/* ── 오른쪽: 이 아이의 인보이스 ──────────────────────────── */}
        <div className="min-w-0 flex-1">
          {!selected ? (
            <p className="py-20 text-center text-sm text-slate-400">왼쪽에서 학생을 골라주세요.</p>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
                <span className="text-base font-black text-slate-800">{selected.name}</span>
                {selected.nameEn && <span className="text-[12px] text-slate-400">{selected.nameEn}</span>}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                  {gradeLabel(selected)}
                </span>
                <label className="ml-auto text-[11px] text-slate-500">
                  납부 기한
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              </div>

              <div className="p-3">
                <p className="mb-2 text-[11px] font-bold text-slate-500">
                  이 학생이 사는 것 <span className="text-slate-400">— 눌러서 넣고 뺍니다</span>
                </p>
                <div className="flex flex-col gap-1">
                  {activeItems.map((item) => {
                    const line = lines.find((l) => l.item.id === item.id);
                    const on = !!line;
                    const o = overrideOf(item.id);
                    return (
                      <div
                        key={item.id}
                        className={
                          "flex items-center gap-2 rounded-lg border px-2 py-1.5 " +
                          (on ? "border-teal-300 bg-teal-50/60" : "border-slate-100 bg-white")
                        }
                      >
                        <button
                          type="button"
                          onClick={() => void toggle(item)}
                          className={
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold " +
                            (on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 text-transparent")
                          }
                          aria-label={on ? "빼기" : "넣기"}
                        >
                          ✓
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className={"text-sm " + (on ? "font-semibold text-slate-800" : "text-slate-500")}>{item.name}</span>
                          {item.name_ko && <span className="ml-1.5 text-[11px] text-slate-400">{item.name_ko}</span>}
                          <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">
                            {item.category}
                          </span>
                          {/* 기본 세트로 들어온 것인지, 사람이 따로 넣은 것인지. 화면에서 구분돼야
                              "왜 이게 여기 있지"를 묻지 않게 됩니다. */}
                          {line?.fromDefault && (
                            <span className="ml-1.5 text-[10px] text-teal-700">기본</span>
                          )}
                          {o && (
                            <span className="ml-1.5 text-[10px] font-semibold text-amber-700">
                              {o.mode === "exclude" ? "직접 뺌" : "직접 넣음"}
                            </span>
                          )}
                        </span>
                        {on && (
                          <span className="flex shrink-0 items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              value={line?.qty ?? 1}
                              onChange={(e) => void setQty(item, Number(e.target.value) || 1)}
                              className="w-12 rounded border border-slate-200 px-1 py-0.5 text-center text-[12px]"
                              title="수량"
                            />
                            <span className="w-24 text-right text-[13px] font-bold tabular-nums text-slate-700">
                              {won(line!.amount)}
                            </span>
                          </span>
                        )}
                        {!on && (
                          <span className="w-24 shrink-0 text-right text-[12px] tabular-nums text-slate-300">
                            {won(Number(item.unit_price))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 p-3">
                <span className="text-[12px] font-semibold text-slate-500">{lines.length}개 항목</span>
                <span className="text-lg font-black tabular-nums text-slate-800">{won(total)}</span>
                <button
                  onClick={() => void issue()}
                  disabled={busy || lines.length === 0}
                  className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  {busy ? "…" : "🧾 발행하고 PDF 열기"}
                </button>
              </div>

              {invoiceByStudent.get(selected.id) && (
                <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                  이미 발행된 것이 있습니다:{" "}
                  <a
                    className="font-bold text-teal-700 underline"
                    href={`/finance/invoices/${invoiceByStudent.get(selected.id)!.id}/print`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {invoiceByStudent.get(selected.id)!.invoice_no}
                  </a>{" "}
                  · 다시 발행하면 새 번호로 한 장 더 만들어집니다.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
