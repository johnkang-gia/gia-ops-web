"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import { FEE_ITEM_CATEGORIES, type FeeItem } from "@/lib/types";

// 학비외 항목 등록 (교재·악기·악기수리·교복).
//
// 여기서 정하는 것은 두 가지뿐입니다: **얼마인가**, 그리고 **기본으로 누구에게 붙는가**.
// 나머지(누가 실제로 사는가, 합계가 얼마인가)는 전부 자동으로 따라옵니다.
//
// 단가를 여기 한 곳에만 두는 이유: 아이마다 금액을 고칠 수 있게 하면 그 자리가 곧 오타가
// 나는 자리입니다. 받은 구글독스 양식에도 `₩47,,000` 같은 오타가 남아 있었습니다.

type Props = {
  initialItems: FeeItem[];
  grades: string[];
  classes: string[];
  currentUserEmail: string;
  loadError: string | null;
};

const EMPTY = {
  category: "교재" as string,
  name: "",
  name_ko: "",
  unit_price: 0,
  default_grades: [] as string[],
  default_classes: [] as string[],
  note: "",
};

export default function FeeItemsClient({ initialItems, grades, classes, currentUserEmail, loadError }: Props) {
  const notify = useToast();
  const [items, setItems] = useState(initialItems);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const [tab, setTab] = useState<string>("전체");

  const shown = useMemo(
    () => items.filter((i) => (showOff || i.active) && (tab === "전체" || i.category === tab)),
    [items, showOff, tab],
  );
  const activeCount = items.filter((i) => i.active).length;

  function reset() {
    setForm({ ...EMPTY });
    setEditingId(null);
  }

  async function save() {
    const name = form.name.trim();
    if (!name) {
      notify("인보이스에 찍힐 이름을 적어주세요.", "error");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const row = {
      category: form.category,
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

  const chip = (on: boolean) =>
    "rounded-lg border px-2 py-1 text-[11px] font-semibold transition " +
    (on ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500 hover:bg-slate-50");

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">📚 학비외 항목</h1>
        <span className="text-xs text-slate-400">교재 · 악기 · 악기수리 · 교복</span>
        <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">
          쓰는 중 {activeCount}개
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        단가는 <b>여기 한 곳에만</b> 있습니다. 아이마다 금액을 고칠 수 없게 해서 오타가 생길 자리를 없앴습니다.
        기본 학년·반을 정해두면 그 아이들에게 자동으로 들어가고, 예외만 학생 화면에서 빼면 됩니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          항목을 읽지 못했습니다: {loadError}
        </p>
      )}

      {/* ── 등록·수정 ─────────────────────────────────────────────── */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[12px] font-bold text-slate-700">{editingId ? "항목 고치기" : "새 항목"}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-slate-500">
            분류
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {FEE_ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
        {["전체", ...FEE_ITEM_CATEGORIES].map((c) => (
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
              <th className="w-20 px-3 py-2">분류</th>
              <th className="px-3 py-2">이름</th>
              <th className="w-28 px-3 py-2 text-right">단가</th>
              <th className="w-56 px-3 py-2">기본 대상</th>
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
