"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import FinanceTabs from "./FinanceTabs";
import TermPicker, { initialTermId } from "./TermPicker";
import { FEE_ITEM_CATEGORY_SUGGESTIONS, type FeeCategory, type FeeItem, type Term } from "@/lib/types";

// 학비외 항목 등록 (교재·악기·악기수리·교복).
//
// 여기서 정하는 것은 두 가지뿐입니다: **얼마인가**, 그리고 **기본으로 누구에게 붙는가**.
// 나머지(누가 실제로 사는가, 합계가 얼마인가)는 전부 자동으로 따라옵니다.
//
// 단가를 여기 한 곳에만 두는 이유: 아이마다 금액을 고칠 수 있게 하면 그 자리가 곧 오타가
// 나는 자리입니다. 받은 구글독스 양식에도 `₩47,,000` 같은 오타가 남아 있었습니다.

type Props = {
  initialItems: FeeItem[];
  initialCategories: FeeCategory[];
  terms: Term[];
  grades: string[];
  classes: string[];
  currentUserEmail: string;
  loadError: string | null;
};

type ItemDept = "초등부" | "중고등부" | "공통";

const EMPTY = {
  department: "초등부" as ItemDept,
  category: "교재" as string,
  name: "",
  name_ko: "",
  unit_price: 0,
  default_grades: [] as string[],
  default_classes: [] as string[],
  note: "",
};

export default function FeeItemsClient({ initialItems, initialCategories, terms, grades, classes, currentUserEmail, loadError }: Props) {
  const notify = useToast();
  const [items, setItems] = useState(initialItems);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const [tab, setTab] = useState<string>("전체");
  /**
   * 부서 탭.
   *
   * 초등과 중고등은 사는 교재가 아예 다릅니다. 한 목록에 섞어두면 등록할 때마다 남의 부서
   * 항목을 지나쳐 읽어야 하고, 실수로 그 위에 덮어쓰게 됩니다. `공통` 은 교복처럼 학교 전체가
   * 사는 것입니다.
   */
  const [deptTab, setDeptTab] = useState<ItemDept>("초등부");
  /**
   * 보고 있는 학기.
   *
   * 다음 학기에는 교재가 또 달라집니다. 학기를 나누지 않으면 지난 학기 교재가 새 학기 표에
   * 계속 열로 서 있고, 그것을 하나씩 끄는 일이 매 학기 반복됩니다.
   */
  const [termId, setTermId] = useState("");
  useEffect(() => {
    setTermId(initialTermId(terms));
  }, [terms]);

  /**
   * 정렬.
   *
   * 항목이 스무 개를 넘으면 눈으로 훑는 것이 안 됩니다. 무엇을 확인하려느냐에 따라 보고 싶은
   * 순서가 다릅니다 - 반별로 붙일 때는 **대상**, 이름이 헷갈릴 때는 **이름**, 교재끼리 견줄
   * 때는 **분류**입니다.
   */
  const [sortBy, setSortBy] = useState<"대상" | "이름" | "분류" | "단가">("분류");
  const [asc, setAsc] = useState(true);

  const deptOfItem = (i: FeeItem): ItemDept => (i.department === "중고등부" ? "중고등부" : i.department === "초등부" ? "초등부" : "공통");
  /** 지금 부서에서 다루는 항목. 공통은 어느 부서에서 보든 함께 나옵니다. */
  /** 이 학기 항목만. 학기가 없던 시절 항목(비어 있음)은 현재 학기에서 함께 보여줍니다. */
  const inTerm = useMemo(
    () => items.filter((i) => (i.term_id ?? "") === termId || (!i.term_id && terms.find((x) => x.id === termId)?.status === "진행중")),
    [items, termId, terms],
  );
  const deptCounts = useMemo(() => {
    const m = new Map<ItemDept, number>();
    for (const i of inTerm) if (i.active) m.set(deptOfItem(i), (m.get(deptOfItem(i)) ?? 0) + 1);
    return m;
  }, [inTerm]);
  const inDept = useMemo(
    () => inTerm.filter((i) => (deptTab === "공통" ? deptOfItem(i) === "공통" : deptOfItem(i) === deptTab || deptOfItem(i) === "공통")),
    [inTerm, deptTab],
  );

  /**
   * 대상을 정렬하기 위한 값.
   *
   * 학년이 먼저, 그 다음 반. 대상이 없는 항목(개별로만 붙이는 것)은 **맨 뒤**로 보냅니다 -
   * 그것들은 목록 중간에 끼어 있으면 학년 흐름을 끊습니다.
   */
  function targetKey(i: FeeItem): string {
    const g = (i.default_grades ?? []).map((v) => String(v).replace(/[^0-9]/g, "")).filter(Boolean).sort();
    const c = [...(i.default_classes ?? [])].sort();
    if (g.length === 0 && c.length === 0) return "zzz";
    const gnum = g.length > 0 ? String(Number(g[0])).padStart(2, "0") : "99";
    return `${gnum}|${c[0] ?? ""}`;
  }

  const shown = useMemo(() => {
    const list = inDept.filter((i) => (showOff || i.active) && (tab === "전체" || i.category === tab));
    const dir = asc ? 1 : -1;
    const byName = (a: FeeItem, b: FeeItem) => a.name.localeCompare(b.name, "ko");
    return [...list].sort((a, b) => {
      if (sortBy === "이름") return dir * byName(a, b);
      if (sortBy === "단가") return dir * (Number(a.unit_price) - Number(b.unit_price)) || byName(a, b);
      if (sortBy === "대상") return dir * targetKey(a).localeCompare(targetKey(b)) || byName(a, b);
      // 분류: 분류 이름 → 손으로 정한 순서 → 이름.
      return dir * a.category.localeCompare(b.category, "ko") || a.sort_order - b.sort_order || byName(a, b);
    });
  }, [inDept, showOff, tab, sortBy, asc]);
  const activeCount = inDept.filter((i) => i.active).length;

  const [cats, setCats] = useState(initialCategories);
  const [newCat, setNewCat] = useState("");
  const [catOpen, setCatOpen] = useState(false);

  /**
   * 고를 수 있는 분류.
   *
   * **등록된 분류가 먼저**입니다. 그 뒤에 항목에만 쓰이고 아직 등록 안 된 것(예전 자료),
   * 마지막으로 처음 쓸 때를 위한 예시가 붙습니다.
   */
  const usedCategories = useMemo(
    () => [...new Set(inDept.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [inDept],
  );
  const registered = useMemo(
    () => cats.filter((c) => c.active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko")).map((c) => c.name),
    [cats],
  );
  const categoryOptions = useMemo(
    () => [...new Set([...registered, ...usedCategories, ...FEE_ITEM_CATEGORY_SUGGESTIONS])],
    [registered, usedCategories],
  );
  /** 탭은 등록된 분류 + 실제로 쓰이는 분류. 둘 중 하나라도 있으면 보여줍니다. */
  const tabCategories = useMemo(() => [...new Set([...registered, ...usedCategories])], [registered, usedCategories]);

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    if (registered.includes(name)) {
      notify("이미 있는 분류입니다.", "error");
      return;
    }
    const { data, error } = await createClient()
      .from("fee_categories")
      .insert({ name, sort_order: cats.length, created_by: currentUserEmail })
      .select()
      .single();
    if (error || !data) {
      notify("분류를 만들지 못했습니다: " + (error?.message ?? ""), "error");
      return;
    }
    setCats((p) => [...p, data as FeeCategory]);
    // 만들자마자 그 분류로 항목을 만들게 됩니다. 폼에 미리 넣어둡니다.
    setForm((f) => ({ ...f, category: name }));
    setNewCat("");
    notify(`분류 "${name}"을 만들었습니다.`, "success");
  }

  async function toggleCategory(c: FeeCategory) {
    const next = !c.active;
    // 쓰는 항목이 있으면 끄지 못하게 막습니다. 끄면 그 항목들이 어느 분류에도 안 속하게 됩니다.
    if (!next && items.some((i) => i.active && i.category === c.name)) {
      notify(`"${c.name}"을 쓰는 항목이 아직 있습니다. 항목을 먼저 옮기거나 꺼주세요.`, "error");
      return;
    }
    setCats((p) => p.map((x) => (x.id === c.id ? { ...x, active: next } : x)));
    const { error } = await createClient().from("fee_categories").update({ active: next }).eq("id", c.id);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      setCats((p) => p.map((x) => (x.id === c.id ? { ...x, active: c.active } : x)));
    }
  }

  function reset() {
    // 지금 보고 있는 부서로 시작합니다. 매번 고르게 두면 결국 잘못된 부서에 등록합니다.
    setForm({ ...EMPTY, department: deptTab });
    setEditingId(null);
  }

  async function save() {
    const name = form.name.trim();
    if (!name) {
      notify("인보이스에 찍힐 이름을 적어주세요.", "error");
      return;
    }
    if (!form.category.trim()) {
      notify("분류를 적어주세요. 표에서 이 이름으로 묶입니다.", "error");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const row = {
      // `공통` 은 비워둡니다 - 비어 있으면 양쪽 모두에 쓰는 항목이라는 뜻입니다.
      department: form.department === "공통" ? null : form.department,
      // 보고 있는 학기의 항목으로 만듭니다. 학기를 안 붙이면 어느 학기에서도 안 보입니다.
      term_id: termId || null,
      category: form.category.trim(),
      name,
      name_ko: form.name_ko.trim() || null,
      unit_price: Number(form.unit_price) || 0,
      default_grades: form.default_grades,
      default_classes: form.default_classes,
      note: form.note.trim() || null,
      created_by: currentUserEmail,
    };
    const res = editingId
      ? await supabase.from("fee_items").update(row).eq("id", editingId).select().single()
      : await supabase.from("fee_items").insert(row).select().single();
    setBusy(false);
    if (res.error || !res.data) {
      notify("저장하지 못했습니다: " + (res.error?.message ?? ""), "error");
      return;
    }
    const saved = res.data as FeeItem;
    setItems((prev) => (editingId ? prev.map((i) => (i.id === saved.id ? saved : i)) : [saved, ...prev]));
    notify(editingId ? "항목을 고쳤습니다." : "항목을 만들었습니다.", "success");
    reset();
  }

  function edit(i: FeeItem) {
    setEditingId(i.id);
    setForm({
      department: deptOfItem(i),
      category: i.category,
      name: i.name,
      name_ko: i.name_ko ?? "",
      unit_price: Number(i.unit_price),
      default_grades: i.default_grades ?? [],
      default_classes: i.default_classes ?? [],
      note: i.note ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleActive(i: FeeItem) {
    const next = !i.active;
    setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, active: next } : x)));
    const { error } = await createClient().from("fee_items").update({ active: next }).eq("id", i.id);
    if (error) {
      notify("바꾸지 못했습니다: " + error.message, "error");
      setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, active: i.active } : x)));
    }
  }

  function sortHead(key: typeof sortBy, label?: string) {
    const on = sortBy === key;
    return (
      <button
        type="button"
        onClick={() => {
          if (on) setAsc((v) => !v);
          else {
            setSortBy(key);
            setAsc(true);
          }
        }}
        className={"inline-flex items-center gap-0.5 " + (on ? "font-bold text-teal-700" : "hover:text-slate-700")}
        title="눌러서 정렬 · 한 번 더 누르면 반대 방향"
      >
        {label ?? key}
        <span className={on ? "" : "opacity-25"}>{on && !asc ? "▾" : "▴"}</span>
      </button>
    );
  }

  const chip = (on: boolean) =>
    "rounded-lg border px-2 py-1 text-[11px] font-semibold transition " +
    (on ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500 hover:bg-slate-50");

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <FinanceTabs />
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">📚 학비외 항목</h1>
        <span className="text-xs text-slate-400">부서별로 따로 등록합니다 · 분류도 직접 등록해서 씁니다</span>
        <span className="ml-auto flex items-center gap-2">
          <TermPicker terms={terms} value={termId} onChange={setTermId} />
          <a href="/terms" className="text-[11px] font-semibold text-teal-700 underline" title="학기는 학교 전체가 함께 움직입니다">
            학기 만들기 →
          </a>
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">
            {deptTab} 쓰는 중 {activeCount}개
          </span>
        </span>
      </div>

      {/* 학기는 학교 전체가 함께 움직입니다. 재무만 따로 새 학기를 만들면 셔틀·업무와
          어긋나므로, 만드는 자리는 학기 화면 한 곳으로 모았습니다. */}
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        단가는 <b>여기 한 곳에만</b> 있습니다. 아이마다 금액을 고칠 수 없게 해서 오타가 생길 자리를 없앴습니다.
        기본 학년·반을 정해두면 그 아이들에게 자동으로 들어가고, 예외만 학생 화면에서 빼면 됩니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          항목을 읽지 못했습니다: {loadError}
        </p>
      )}

      {/* ── 부서 ──────────────────────────────────────────────────
          초등과 중고등은 사는 교재가 아예 다릅니다. 섞어두면 등록할 때마다 남의 부서 항목을
          지나쳐 읽어야 하고, 실수로 그 위에 덮어쓰게 됩니다. */}
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {(["초등부", "중고등부", "공통"] as ItemDept[]).map((d) => (
          <button
            key={d}
            onClick={() => {
              setDeptTab(d);
              setTab("전체");
              setForm((f) => ({ ...f, department: d }));
            }}
            className={
              "-mb-px rounded-t-lg px-3 py-1.5 text-[13px] font-bold transition-colors " +
              (deptTab === d
                ? "border-b-2 border-teal-600 text-teal-700"
                : "border-b-2 border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-700")
            }
            title={d === "공통" ? "교복처럼 학교 전체가 사는 것" : `${d} 항목`}
          >
            {d}
            <span className="ml-1 text-[11px] font-semibold opacity-60">{deptCounts.get(d) ?? 0}</span>
          </button>
        ))}
        <span className="ml-2 text-[11px] text-slate-400">공통 항목은 초등·중고등 어느 쪽에서도 함께 보입니다</span>
      </div>

      {/* ── 분류 관리 ─────────────────────────────────────────────
          분류를 **먼저 만들 수 있어야** "악기"를 세워두고 그 아래 첼로·바이올린을 채우는
          순서가 됩니다. 예전에는 항목에 적힌 글자에서 거꾸로 모았기 때문에, 항목이 하나도
          없는 분류는 존재할 수가 없었습니다. */}
      <div className="mb-3 rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setCatOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-bold text-slate-700"
        >
          <span className="text-teal-600">{catOpen ? "▾" : "▸"}</span>
          분류 관리
          <span className="font-medium text-slate-400">
            {registered.length > 0 ? registered.join(" · ") : "아직 등록된 분류가 없습니다"}
          </span>
        </button>
        {catOpen && (
          <div className="border-t border-slate-100 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addCategory()}
                placeholder="새 분류 이름 (예: 악기 · 체육복 · 현장학습)"
                className="w-64 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button onClick={() => void addCategory()} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white">
                + 분류 만들기
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cats
                .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"))
                .map((c) => {
                  const used = items.filter((i) => i.category === c.name).length;
                  return (
                    <span
                      key={c.id}
                      className={
                        "flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] " +
                        (c.active ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 text-slate-400")
                      }
                    >
                      <b>{c.name}</b>
                      <span className="opacity-60">{used}개</span>
                      <button
                        onClick={() => void toggleCategory(c)}
                        className="ml-0.5 font-bold opacity-60 hover:opacity-100"
                        title={c.active ? "끄기" : "켜기"}
                      >
                        {c.active ? "×" : "＋"}
                      </button>
                    </span>
                  );
                })}
              {/* 아직 등록 안 됐는데 항목에는 쓰이는 분류. 예전 자료입니다. */}
              {usedCategories
                .filter((u) => !cats.some((c) => c.name === u))
                .map((u) => (
                  <span key={u} className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                    <b>{u}</b>
                    <span className="opacity-70">등록 안 됨</span>
                    <button
                      onClick={() => {
                        setNewCat(u);
                        void addCategory();
                      }}
                      className="font-bold underline"
                    >
                      등록
                    </button>
                  </span>
                ))}
              {cats.length === 0 && usedCategories.length === 0 && (
                <span className="text-[11px] text-slate-400">위에서 분류를 하나 만들어보세요.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 등록·수정 ─────────────────────────────────────────────── */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[12px] font-bold text-slate-700">{editingId ? "항목 고치기" : "새 항목"}</p>
        <div className="flex flex-wrap items-end gap-2">
          {/* 분류는 **자유롭게 적습니다.** 목록을 고정해두면 새로 받는 것이 생길 때마다
              개발자를 찾아야 합니다. 이미 쓴 분류와 몇 가지 예시를 아래에 붙여, 고르는 것도
              적는 것도 되게 했습니다. */}
          {/* 부서를 폼 맨 앞에 둡니다. 고르고 나서야 나머지가 무엇을 위한 것인지 정해집니다. */}
          <label className="text-[11px] text-slate-500">
            부서
            <select
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value as ItemDept }))}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="초등부">초등부</option>
              <option value="중고등부">중고등부</option>
              <option value="공통">공통 (양쪽 다)</option>
            </select>
          </label>
          <label className="text-[11px] text-slate-500">
            분류
            <input
              list="fee-category-list"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder={registered[0] ? `${registered[0]} · 골라도 되고 새로 적어도 됩니다` : "분류를 적어주세요"}
              className="ml-1 w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <datalist id="fee-category-list">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-[11px] text-slate-500">
            인보이스 이름 (영문)
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Reveal Math 5"
              className="ml-1 w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-[11px] text-slate-500">
            한글 이름 (화면용)
            <input
              value={form.name_ko}
              onChange={(e) => setForm((f) => ({ ...f, name_ko: e.target.value }))}
              placeholder="5학년 수학"
              className="ml-1 w-40 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-[11px] text-slate-500">
            단가
            <input
              type="number"
              value={form.unit_price}
              onChange={(e) => setForm((f) => ({ ...f, unit_price: Number(e.target.value) || 0 }))}
              className="ml-1 w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-500">기본 학년 (이 학년 전원에게 자동)</p>
            <div className="flex flex-wrap gap-1">
              {grades.map((g) => {
                const on = form.default_grades.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    className={chip(on)}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        default_grades: on ? f.default_grades.filter((x) => x !== g) : [...f.default_grades, g],
                      }))
                    }
                  >
                    {g}학년
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-500">기본 반</p>
            <div className="flex flex-wrap gap-1">
              {classes.map((c) => {
                const on = form.default_classes.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={chip(on)}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        default_classes: on ? f.default_classes.filter((x) => x !== c) : [...f.default_classes, c],
                      }))
                    }
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="메모(선택) — 왜 이 값인지, 어디서 샀는지"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => void save()}
            disabled={busy}
            className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {editingId ? "고치기" : "+ 만들기"}
          </button>
          {editingId && (
            <button onClick={reset} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
              취소
            </button>
          )}
        </div>
        {form.default_grades.length === 0 && form.default_classes.length === 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            기본 학년·반을 고르지 않으면 <b>아무에게도 자동으로 붙지 않습니다.</b> 학생 화면에서 한 명씩 넣어야 합니다.
          </p>
        )}
      </div>

      {/* ── 목록 ──────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {["전체", ...tabCategories].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setTab(c)}
            className={
              "rounded-lg px-2.5 py-1 text-xs font-semibold " +
              (tab === c ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
            }
          >
            {c}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
          꺼둔 것도 보기
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
            <tr>
              {/* 머리줄을 눌러 정렬합니다. 한 번 더 누르면 반대 방향입니다. */}
              <th className="w-20 px-3 py-2">{sortHead("분류")}</th>
              <th className="px-3 py-2">{sortHead("이름")}</th>
              <th className="w-28 px-3 py-2 text-right">{sortHead("단가")}</th>
              <th className="w-56 px-3 py-2">{sortHead("대상", "기본 대상")}</th>
              <th className="w-24 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className={"border-t border-slate-100 " + (i.active ? "" : "opacity-45")}>
                <td className="px-3 py-2 text-[11px] font-semibold text-slate-500">{i.category}</td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-slate-800">{i.name}</span>
                  {i.name_ko && <span className="ml-1.5 text-[11px] text-slate-400">{i.name_ko}</span>}
                  {i.note && <span className="ml-1.5 text-[11px] text-slate-400">· {i.note}</span>}
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-700">{won(Number(i.unit_price))}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {(i.default_grades ?? []).map((g) => (
                      <span key={g} className="rounded bg-teal-50 px-1.5 text-[11px] font-semibold text-teal-700">
                        {g}학년
                      </span>
                    ))}
                    {(i.default_classes ?? []).map((c) => (
                      <span key={c} className="rounded bg-sky-50 px-1.5 text-[11px] font-semibold text-sky-700">
                        {c}
                      </span>
                    ))}
                    {(i.default_grades ?? []).length === 0 && (i.default_classes ?? []).length === 0 && (
                      <span className="text-[11px] text-slate-400">개별 지정</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => edit(i)} className="mr-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
                    고치기
                  </button>
                  <button
                    onClick={() => void toggleActive(i)}
                    className={"text-[11px] font-semibold " + (i.active ? "text-red-500" : "text-emerald-600")}
                    title={i.active ? "끄면 목록에서 빠지지만 지난 인보이스는 그대로입니다" : "다시 씁니다"}
                  >
                    {i.active ? "끄기" : "켜기"}
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">
                  항목이 없습니다. 위에서 하나 만들어보세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
