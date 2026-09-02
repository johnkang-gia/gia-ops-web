"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { resolveStudentItems, sumLines, won, type StudentLike } from "@/lib/feeItems";
import FinanceTabs from "./FinanceTabs";
import type { FeeItem, Invoice, StudentFeeItem } from "@/lib/types";

// 인보이스 명단 표 — 학생이 행, 항목이 열인 스프레드시트.
//
// 왜 이 모양인가: 재무 일은 "한 아이"가 아니라 **명단 단위**로 돕니다. 반 스무 명이 같은 책을
// 사는지 확인하고, 악기만 아이마다 다른 것을 훑고, 누가 아직 발행 안 됐는지 봅니다. 한 명씩
// 여는 화면으로는 그 일이 안 됩니다 - 스무 번 열고 스무 번 닫아야 하고, 그러면 빠뜨립니다.
//
// 그래서 결제·회계 프로그램들이 쓰는 모양을 그대로 가져왔습니다.
//   · 첫 열(학생)과 머리줄을 고정해서 오른쪽으로 스크롤해도 누구 줄인지 안 잃습니다.
//   · 맨 아래 합계 줄에 **항목마다 몇 명·얼마**가 뜹니다. 열을 보면 그 책이 몇 권인지 압니다.
//   · 맨 오른쪽에 아이별 합계와 발행 상태. 발행 안 된 줄이 한눈에 보입니다.
//   · 고른 줄만 한 번에 발행합니다.

export type Student = { id: string; name: string; nameEn: string | null; grade: string | null; className: string | null };

type Props = {
  students: Student[];
  items: FeeItem[];
  initialOverrides: StudentFeeItem[];
  recentInvoices: Invoice[];
  currentUserEmail: string;
  loadError: string | null;
  today: string;
};

type View = { kind: "반"; value: string } | { kind: "학년"; value: string } | { kind: "전체" };

export default function InvoiceGridClient({
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
  // 항목도 상태로 들고 있습니다. 여기서 바로 만들면 **그 자리에서 열이 생겨야** 합니다 -
  // 화면을 새로 고쳐야 보이면 결국 항목 화면으로 건너가서 만들게 됩니다.
  const [itemList, setItemList] = useState(items);
  const [newOpen, setNewOpen] = useState(false);
  const [newItem, setNewItem] = useState({ category: "", name: "", name_ko: "", unit_price: 0, applyToView: true });
  const [invoices, setInvoices] = useState(recentInvoices);
  const [view, setView] = useState<View>({ kind: "전체" });
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [onlyUnissued, setOnlyUnissued] = useState(false);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(`${today}T12:00:00+09:00`);
    d.setDate(d.getDate() + 11);
    return d.toISOString().slice(0, 10);
  });

  const activeItems = useMemo(
    () =>
      itemList
        .filter((i) => i.active)
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category, "ko") || a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        ),
    [itemList],
  );

  const grades = useMemo(
    () => [...new Set(students.map((s) => (s.grade ?? "").trim()).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
    [students],
  );
  const classes = useMemo(
    () => [...new Set(students.map((s) => (s.className ?? "").trim()).filter(Boolean))].sort(),
    [students],
  );

  const invoiceByStudent = useMemo(() => {
    const m = new Map<string, Invoice>();
    for (const v of invoices) if (v.student_id && v.status === "발행" && !m.has(v.student_id)) m.set(v.student_id, v);
    return m;
  }, [invoices]);

  /** 지금 보고 있는 명단. */
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase().replace(/\s+/g, "");
    let list = students;
    if (view.kind === "반") list = list.filter((s) => (s.className ?? "") === view.value);
    if (view.kind === "학년") list = list.filter((s) => (s.grade ?? "") === view.value);
    if (k) {
      list = list.filter(
        (s) => s.name.toLowerCase().replace(/\s+/g, "").includes(k) || (s.nameEn ?? "").toLowerCase().replace(/\s+/g, "").includes(k),
      );
    }
    if (onlyUnissued) list = list.filter((s) => !invoiceByStudent.has(s.id));
    return list;
  }, [students, view, q, onlyUnissued, invoiceByStudent]);

  /** 이 명단의 아이마다 사는 것. 표 전체가 이 하나에서 나옵니다. */
  const linesByStudent = useMemo(() => {
    const m = new Map<string, ReturnType<typeof resolveStudentItems>>();
    for (const s of rows) m.set(s.id, resolveStudentItems(activeItems, s as StudentLike, overrides));
    return m;
  }, [rows, activeItems, overrides]);

  /** 지금 보이는 명단에서 실제로 쓰이는 항목만 열로 세웁니다. 안 쓰는 열은 자리만 차지합니다. */
  const usedItems = useMemo(() => {
    const used = new Set<string>();
    for (const ls of linesByStudent.values()) for (const l of ls) used.add(l.item.id);
    // 접어둔 분류가 아니면, 쓰이지 않아도 그 분류 항목을 함께 보여줍니다(넣으려면 열이 있어야 합니다).
    return activeItems.filter((i) => used.has(i.id) || openCats.has(i.category));
  }, [activeItems, linesByStudent, openCats]);

  const cats = useMemo(() => [...new Set(usedItems.map((i) => i.category))], [usedItems]);
  const allCats = useMemo(() => [...new Set(activeItems.map((i) => i.category))], [activeItems]);

  const totalOf = (sid: string) => sumLines(linesByStudent.get(sid) ?? []);
  const grandTotal = rows.reduce((n, s) => n + totalOf(s.id), 0);
  const unissued = rows.filter((s) => !invoiceByStudent.has(s.id)).length;

  /** 열 합계 — 이 항목을 몇 명이 사고 얼마인가. */
  const colSummary = useMemo(() => {
    const m = new Map<string, { people: number; qty: number; amount: number }>();
    for (const ls of linesByStudent.values()) {
      for (const l of ls) {
        const cur = m.get(l.item.id) ?? { people: 0, qty: 0, amount: 0 };
        m.set(l.item.id, { people: cur.people + 1, qty: cur.qty + l.qty, amount: cur.amount + l.amount });
      }
    }
    return m;
  }, [linesByStudent]);

  const lineFor = (sid: string, itemId: string) => (linesByStudent.get(sid) ?? []).find((l) => l.item.id === itemId) ?? null;

  async function upsert(sid: string, item: FeeItem, mode: "include" | "exclude", qty: number) {
    const prev = overrides;
    const local: StudentFeeItem = {
      id: `local-${sid}-${item.id}`,
      student_id: sid,
      item_id: item.id,
      term_id: null,
      mode,
      qty,
      note: null,
      updated_by: currentUserEmail,
      created_at: "",
      updated_at: "",
    };
    setOverrides((p) => [...p.filter((o) => !(o.student_id === sid && o.item_id === item.id)), local]);
    const { data, error } = await createClient()
      .from("student_fee_items")
      .upsert({ student_id: sid, item_id: item.id, mode, qty, updated_by: currentUserEmail }, { onConflict: "student_id,item_id" })
      .select()
      .single();
    if (error || !data) {
      notify("저장하지 못했습니다: " + (error?.message ?? ""), "error");
      setOverrides(prev);
      return;
    }
    setOverrides((p) => p.map((o) => (o.id === local.id ? (data as StudentFeeItem) : o)));
  }

  function toggleCell(s: Student, item: FeeItem) {
    const on = !!lineFor(s.id, item.id);
    void upsert(s.id, item, on ? "exclude" : "include", lineFor(s.id, item.id)?.qty ?? 1);
  }

  /** 열 하나를 이 명단 전원에게 넣거나 뺍니다. 반 단위로 교재를 붙일 때 이게 없으면 스무 번 눌러야 합니다. */
  async function fillColumn(item: FeeItem, on: boolean) {
    if (rows.length === 0) return;
    if (!confirm(`지금 보이는 ${rows.length}명에게 "${item.name}"을 ${on ? "넣습니다" : "뺍니다"}.\n\n계속할까요?`)) return;
    setBusy(true);
    try {
      const payload = rows.map((s) => ({
        student_id: s.id,
        item_id: item.id,
        mode: on ? "include" : "exclude",
        qty: lineFor(s.id, item.id)?.qty ?? 1,
        updated_by: currentUserEmail,
      }));
      const { data, error } = await createClient()
        .from("student_fee_items")
        .upsert(payload, { onConflict: "student_id,item_id" })
        .select();
      if (error) {
        notify("일괄 반영에 실패했습니다: " + error.message, "error");
        return;
      }
      const fresh = (data as StudentFeeItem[] | null) ?? [];
      setOverrides((p) => [
        ...p.filter((o) => !(o.item_id === item.id && rows.some((s) => s.id === o.student_id))),
        ...fresh,
      ]);
      notify(`${rows.length}명에게 반영했습니다.`, "success");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 표에서 바로 항목을 만듭니다.
   *
   * 만들면서 **지금 보고 있는 명단에 곧바로 붙일 수 있게** 했습니다(기본 켜짐). 반을 보다가
   * "이 반 교재 하나 더 있었지" 하는 순간에, 항목 화면으로 건너갔다 돌아오면 보던 자리를
   * 다시 찾아야 하고 그 사이에 무엇을 하려 했는지 잊습니다.
   */
  async function createItem() {
    const name = newItem.name.trim();
    const category = newItem.category.trim();
    if (!name || !category) {
      notify("분류와 이름을 적어주세요.", "error");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      // 지금 보기가 반/학년이면 그 값을 기본 대상으로 넣어둡니다 - 다음에 전학 온 아이에게도
      // 자동으로 붙습니다. '표에만 붙이기'와 달리 이건 규칙으로 남습니다.
      const defaults =
        newItem.applyToView && view.kind === "반"
          ? { default_classes: [view.value], default_grades: [] as string[] }
          : newItem.applyToView && view.kind === "학년"
            ? { default_grades: [view.value], default_classes: [] as string[] }
            : { default_grades: [] as string[], default_classes: [] as string[] };

      const { data, error } = await supabase
        .from("fee_items")
        .insert({
          category,
          name,
          name_ko: newItem.name_ko.trim() || null,
          unit_price: Number(newItem.unit_price) || 0,
          ...defaults,
          created_by: currentUserEmail,
        })
        .select()
        .single();
      if (error || !data) {
        notify("항목을 만들지 못했습니다: " + (error?.message ?? ""), "error");
        return;
      }
      const made = data as FeeItem;
      setItemList((p) => [made, ...p]);
      // 새 분류라면 그 열이 바로 보이도록 펼쳐둡니다.
      setOpenCats((p) => new Set([...p, made.category]));
      notify(
        newItem.applyToView && view.kind !== "전체"
          ? `"${made.name}"을 만들고 ${view.value}${view.kind === "학년" ? "학년" : ""}에 붙였습니다.`
          : `"${made.name}"을 만들었습니다. 표에서 눌러 넣어주세요.`,
        "success",
      );
      setNewItem({ category, name: "", name_ko: "", unit_price: 0, applyToView: newItem.applyToView });
    } finally {
      setBusy(false);
    }
  }

  /** 고른 줄을 한 번에 발행합니다. */
  async function issueChecked() {
    const targets = rows.filter((s) => checked.has(s.id) && totalOf(s.id) > 0);
    if (targets.length === 0) {
      notify("발행할 학생을 골라주세요(금액이 0원인 학생은 제외됩니다).", "error");
      return;
    }
    if (!confirm(`${targets.length}명에게 인보이스를 발행합니다.\n납부 기한 ${dueDate}\n\n계속할까요?`)) return;
    setBusy(true);
    const made: Invoice[] = [];
    const failed: string[] = [];
    try {
      for (const s of targets) {
        const res = await fetch("/api/finance/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: s.id, dueDate }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) made.push(body.invoice as Invoice);
        // 한 명이 실패해도 나머지는 계속합니다. 다만 **누가 실패했는지 반드시 말합니다** -
        // 조용히 넘기면 그 아이만 인보이스 없이 남습니다.
        else failed.push(`${s.name}(${body.error ?? res.statusText})`);
      }
      if (made.length > 0) setInvoices((p) => [...made, ...p]);
      if (failed.length > 0) notify(`${made.length}건 발행 · ${failed.length}건 실패: ${failed.join(", ")}`, "error");
      else notify(`${made.length}건 발행했습니다.`, "success");
      setChecked(new Set());
    } finally {
      setBusy(false);
    }
  }

  /** 지금 보이는 표를 그대로 CSV로. 구글시트에 붙여넣어 따로 보관하거나 공유할 수 있습니다. */
  function exportCsv() {
    const head = ["학생", "영문이름", "학년", "반", ...usedItems.map((i) => i.name), "합계", "인보이스"];
    const body = rows.map((s) => [
      s.name,
      s.nameEn ?? "",
      s.grade ?? "",
      s.className ?? "",
      ...usedItems.map((i) => {
        const l = lineFor(s.id, i.id);
        return l ? String(l.qty) : "";
      }),
      String(totalOf(s.id)),
      invoiceByStudent.get(s.id)?.invoice_no ?? "",
    ]);
    const foot = [
      "합계",
      "",
      "",
      "",
      ...usedItems.map((i) => String(colSummary.get(i.id)?.amount ?? 0)),
      String(grandTotal),
      "",
    ];
    const csv = [head, ...body, foot]
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(","))
      .join("\n");
    // 엑셀·구글시트가 한글을 깨뜨리지 않도록 BOM을 붙입니다.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `인보이스_${view.kind === "전체" ? "전체" : view.value}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const tabCls = (on: boolean) =>
    "shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold " +
    (on ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50");

  return (
    <div className="mx-auto max-w-none p-3 sm:p-4">
      <FinanceTabs />
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">🧾 인보이스 명단</h1>
        <span className="text-xs text-slate-400">학비외 · 학생 × 항목</span>
        <a href="/finance/items" className="text-xs font-semibold text-teal-700 underline">
          항목 관리 →
        </a>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        칸을 눌러 넣고 뺍니다. 항목에 정해둔 <b>기본 학년·반</b>은 이미 체크된 채로 나옵니다. 합계는 표가 계산합니다 —
        사람이 더할 자리가 없습니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}
      {activeItems.length === 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          아직 등록된 항목이 없습니다.{" "}
          <a href="/finance/items" className="font-bold underline">
            학비외 항목
          </a>
          에서 먼저 교재·교복 등을 만들어주세요.
        </p>
      )}

      {/* ── 보기 ─────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-slate-400">반</span>
        {classes.map((c) => (
          <button key={c} className={tabCls(view.kind === "반" && view.value === c)} onClick={() => setView({ kind: "반", value: c })}>
            {c}
          </button>
        ))}
        <span className="ml-2 text-[11px] font-bold text-slate-400">학년</span>
        {grades.map((g) => (
          <button key={g} className={tabCls(view.kind === "학년" && view.value === g)} onClick={() => setView({ kind: "학년", value: g })}>
            {g}학년
          </button>
        ))}
        <button className={tabCls(view.kind === "전체")} onClick={() => setView({ kind: "전체" })}>
          전체
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름으로 찾기"
          className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={onlyUnissued} onChange={(e) => setOnlyUnissued(e.target.checked)} />
          아직 발행 안 된 학생만
        </label>
        {/* 안 쓰이는 분류는 열을 접어둡니다. 악기처럼 몇 명만 고르는 것은 펼쳐야 넣을 수 있습니다. */}
        <span className="flex flex-wrap items-center gap-1">
          {allCats.map((c) => {
            const on = openCats.has(c);
            return (
              <button
                key={c}
                onClick={() =>
                  setOpenCats((p) => {
                    const n = new Set(p);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
                className={
                  "rounded px-1.5 py-0.5 text-[11px] font-semibold " +
                  (on ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
                }
                title={on ? "안 쓰는 항목 열까지 보이는 중" : "이 분류의 모든 항목을 열로 펼칩니다"}
              >
                {on ? "▾" : "▸"} {c}
              </button>
            );
          })}
        </span>
        <button onClick={exportCsv} className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          ⬇ CSV (구글시트용)
        </button>
      </div>

      {/* ── 표에서 바로 항목 만들기 ────────────────────────────── */}
      <div className="mb-2 rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setNewOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-bold text-slate-700"
        >
          <span className="text-teal-600">{newOpen ? "▾" : "＋"}</span>
          여기서 바로 항목 만들기
          <span className="font-medium text-slate-400">— 항목 화면으로 건너가지 않아도 됩니다</span>
        </button>
        {newOpen && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-3">
            <label className="text-[11px] text-slate-500">
              분류
              <input
                list="grid-category-list"
                value={newItem.category}
                onChange={(e) => setNewItem((f) => ({ ...f, category: e.target.value }))}
                placeholder="교재 · 악기 · 자유롭게"
                className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <datalist id="grid-category-list">
                {allCats.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="text-[11px] text-slate-500">
              인보이스 이름 (영문)
              <input
                value={newItem.name}
                onChange={(e) => setNewItem((f) => ({ ...f, name: e.target.value }))}
                placeholder="Reveal Math 5"
                className="ml-1 w-52 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              한글 이름
              <input
                value={newItem.name_ko}
                onChange={(e) => setNewItem((f) => ({ ...f, name_ko: e.target.value }))}
                placeholder="5학년 수학"
                className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              단가
              <input
                type="number"
                value={newItem.unit_price}
                onChange={(e) => setNewItem((f) => ({ ...f, unit_price: Number(e.target.value) || 0 }))}
                className="ml-1 w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
              />
            </label>
            {view.kind !== "전체" && (
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={newItem.applyToView}
                  onChange={(e) => setNewItem((f) => ({ ...f, applyToView: e.target.checked }))}
                />
                <b>{view.value}{view.kind === "학년" ? "학년" : ""}</b> 기본으로 붙이기
              </label>
            )}
            <button
              onClick={() => void createItem()}
              disabled={busy}
              className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              + 만들기
            </button>
            <span className="w-full text-[11px] text-slate-400">
              단가·기본 대상을 더 손보려면{" "}
              <a href="/finance/items" className="font-semibold text-teal-700 underline">
                학비외 항목
              </a>{" "}
              탭에서 고칠 수 있습니다.
            </span>
          </div>
        )}
      </div>

      {/* ── 요약 ─────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="text-[12px] text-slate-500">
          {view.kind === "전체" ? "전체" : `${view.value}${view.kind === "학년" ? "학년" : ""}`} <b className="text-slate-800">{rows.length}명</b>
        </span>
        <span className="text-[12px] text-slate-500">
          합계 <b className="text-base font-black tabular-nums text-slate-800">{won(grandTotal)}</b>
        </span>
        <span className={"text-[12px] " + (unissued > 0 ? "font-bold text-amber-700" : "text-slate-400")}>
          미발행 {unissued}명
        </span>
        <label className="ml-auto text-[11px] text-slate-500">
          납부 기한
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <button
          onClick={() => void issueChecked()}
          disabled={busy || checked.size === 0}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          {busy ? "…" : `🧾 고른 ${checked.size}명 발행`}
        </button>
      </div>

      {/* ── 표 ───────────────────────────────────────────────────── */}
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white" style={{ maxHeight: "72vh" }}>
        <table className="min-w-full border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-20">
            {/* 분류 줄 — 열이 많아지면 무엇끼리 묶인 것인지 보여야 합니다. */}
            <tr>
              <th className="sticky left-0 z-30 border-b border-r border-slate-200 bg-slate-100 px-2 py-1" colSpan={2} />
              {cats.map((c) => (
                <th
                  key={c}
                  colSpan={usedItems.filter((i) => i.category === c).length}
                  className="border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-center text-[10px] font-bold text-slate-500"
                >
                  {c}
                </th>
              ))}
              <th className="border-b border-slate-200 bg-slate-100 px-2 py-1" colSpan={2} />
            </tr>
            <tr>
              <th className="sticky left-0 z-30 w-8 border-b border-slate-200 bg-white px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((s) => checked.has(s.id))}
                  onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((s) => s.id)) : new Set())}
                  title="전부 고르기"
                />
              </th>
              <th className="sticky left-8 z-30 min-w-[150px] border-b border-r border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600">
                학생
              </th>
              {usedItems.map((i) => (
                <th key={i.id} className="min-w-[86px] border-b border-r border-slate-100 bg-white px-1 py-1.5 align-bottom">
                  <span className="block truncate text-[11px] font-semibold text-slate-700" title={`${i.name}${i.name_ko ? ` · ${i.name_ko}` : ""}`}>
                    {i.name_ko || i.name}
                  </span>
                  <span className="block text-[10px] tabular-nums text-slate-400">{won(Number(i.unit_price))}</span>
                  {/* 열 하나를 명단 전원에게. 반 단위로 교재를 붙이는 일이 가장 잦습니다. */}
                  <span className="mt-0.5 flex gap-0.5">
                    <button
                      onClick={() => void fillColumn(i, true)}
                      disabled={busy}
                      className="flex-1 rounded bg-teal-50 text-[9px] font-bold text-teal-700 hover:bg-teal-100 disabled:opacity-40"
                      title={`보이는 ${rows.length}명 전원에게 넣기`}
                    >
                      전체 +
                    </button>
                    <button
                      onClick={() => void fillColumn(i, false)}
                      disabled={busy}
                      className="flex-1 rounded bg-slate-50 text-[9px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                      title={`보이는 ${rows.length}명에게서 빼기`}
                    >
                      −
                    </button>
                  </span>
                </th>
              ))}
              <th className="min-w-[92px] border-b border-l border-slate-200 bg-white px-2 py-1.5 text-right font-semibold text-slate-600">
                합계
              </th>
              <th className="min-w-[96px] border-b border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-600">인보이스</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((s) => {
              const total = totalOf(s.id);
              const inv = invoiceByStudent.get(s.id);
              const on = checked.has(s.id);
              return (
                <tr key={s.id} className={on ? "bg-teal-50/40" : "hover:bg-slate-50/60"}>
                  <td className={"sticky left-0 z-10 border-b border-slate-100 px-2 py-1 " + (on ? "bg-teal-50" : "bg-white")}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setChecked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className={"sticky left-8 z-10 border-b border-r border-slate-200 px-2 py-1 " + (on ? "bg-teal-50" : "bg-white")}>
                    <span className="font-semibold text-slate-800">{s.name}</span>
                    <span className="ml-1 text-[10px] text-slate-400">
                      {[s.grade ? `${s.grade}` : null, s.className].filter(Boolean).join(" ")}
                    </span>
                  </td>

                  {usedItems.map((i) => {
                    const l = lineFor(s.id, i.id);
                    const ov = overrides.find((o) => o.student_id === s.id && o.item_id === i.id) ?? null;
                    return (
                      <td
                        key={i.id}
                        className={
                          "border-b border-r border-slate-100 p-0 text-center " + (l ? "bg-teal-50/70" : "")
                        }
                      >
                        <button
                          onClick={() => toggleCell(s, i)}
                          className="flex h-8 w-full items-center justify-center gap-1"
                          title={
                            l
                              ? `${i.name} · ${won(l.amount)}${ov ? (ov.mode === "include" ? " · 직접 넣음" : "") : " · 기본"}`
                              : `${i.name} 넣기`
                          }
                        >
                          {l ? (
                            <>
                              <span className="text-[13px] font-black text-teal-700">✓</span>
                              {l.qty > 1 && <span className="text-[10px] font-bold text-teal-700">×{l.qty}</span>}
                              {/* 사람이 따로 넣은 것은 점 하나로 구분합니다. 기본 세트와 섞이면
                                  "왜 이게 여기 있지"를 매번 묻게 됩니다. */}
                              {ov?.mode === "include" && <span className="text-[8px] text-amber-600">●</span>}
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-200">·</span>
                          )}
                        </button>
                      </td>
                    );
                  })}

                  <td className="border-b border-l border-slate-200 px-2 py-1 text-right">
                    <span className={"font-bold tabular-nums " + (total > 0 ? "text-slate-800" : "text-slate-300")}>
                      {total > 0 ? won(total) : "—"}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-1">
                    {inv ? (
                      <a
                        href={`/finance/invoices/${inv.id}/print`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-bold text-emerald-700 underline"
                      >
                        {inv.invoice_no}
                      </a>
                    ) : total > 0 ? (
                      <span className="text-[11px] font-semibold text-amber-600">미발행</span>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={usedItems.length + 4} className="px-3 py-12 text-center text-sm text-slate-400">
                  학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>

          {/* 합계 줄 — 열을 보면 그 항목이 몇 명·얼마인지 압니다. 발주할 때 이 숫자를 씁니다. */}
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <td className="sticky left-0 z-30 border-t-2 border-slate-300 bg-slate-100 px-2 py-1.5" colSpan={2}>
                <span className="text-[11px] font-bold text-slate-600">합계 · {rows.length}명</span>
              </td>
              {usedItems.map((i) => {
                const c = colSummary.get(i.id);
                return (
                  <td key={i.id} className="border-t-2 border-r border-slate-300 bg-slate-100 px-1 py-1.5 text-center">
                    {c ? (
                      <>
                        <span className="block text-[11px] font-bold text-slate-700">{c.qty}개</span>
                        <span className="block text-[10px] tabular-nums text-slate-500">{won(c.amount)}</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>
                );
              })}
              <td className="border-t-2 border-l border-slate-300 bg-slate-100 px-2 py-1.5 text-right">
                <span className="text-[13px] font-black tabular-nums text-slate-800">{won(grandTotal)}</span>
              </td>
              <td className="border-t-2 border-slate-300 bg-slate-100 px-2 py-1.5">
                <span className="text-[11px] text-slate-500">미발행 {unissued}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        ✓ 는 그 아이가 그 항목을 산다는 뜻입니다. <span className="text-amber-600">●</span> 는 기본 세트가 아니라 사람이 따로
        넣은 것입니다. 열 머리의 <b>전체 +</b> 는 지금 보이는 명단 전원에게 한 번에 넣습니다. 합계 줄의 개수는 그대로
        발주 수량입니다.
      </p>
    </div>
  );
}
