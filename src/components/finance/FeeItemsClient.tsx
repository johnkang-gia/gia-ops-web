"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { targetLabel, won } from "@/lib/feeItems";
import TermPicker, { initialTermId } from "./TermPicker";
import { FEE_ITEM_CATEGORY_SUGGESTIONS, type FeeCategory, type FeeItem, type StudentGroup, type Term } from "@/lib/types";

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
  /** 부서별 학년·반. 초등과 중고등은 학년 표기도 반 이름도 다릅니다. */
  gradesByDept: Record<string, string[]>;
  classesByDept: Record<string, string[]>;
  /** 부서 → 학년 → 그 학년의 반. 학년을 고른 뒤 반을 고르는 데 씁니다. */
  classesByGrade: Record<string, Record<string, string[]>>;
  /** 수강 그룹(방과후·악기반). 항목 대상으로 고를 수 있습니다. */
  groups: StudentGroup[];
  /**
   * 항목별로 손으로 넣거나 뺀 아이가 몇 명인가.
   *
   * 지울 때 보여줍니다. 이 숫자가 크면 그동안 사람이 하나씩 조정해 둔 것이 함께 사라진다는
   * 뜻이라, 지우기 전에 알아야 합니다.
   */
  usageByItem: Record<string, number>;
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
  // 새 항목은 대상을 안 고른 상태로 시작합니다. 미리 학년을 찍어두면 그대로 저장되어,
  // 고를 생각도 못 한 학년에 교재가 붙습니다.
  target_scope: "개별" as "개별" | "부서전체" | "학년" | "반" | "그룹",
  target_group_id: null as string | null,
  // 기본은 '대상 전원'. 지금까지 만든 항목이 전부 그랬고, 대부분의 교재가 그렇습니다.
  auto_apply: true,
  note: "",
};

export default function FeeItemsClient({ initialItems, initialCategories, terms, gradesByDept, classesByDept, classesByGrade, groups, usageByItem, currentUserEmail, loadError }: Props) {
  const notify = useToast();
  const [items, setItems] = useState(initialItems);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * 지울까요 하고 한 번 묻는 창.
   *
   * 항목을 지우면 그 항목을 손으로 넣거나 뺐던 아이별 조정도 함께 사라집니다. 되돌릴 수
   * 없으므로 무엇이 함께 없어지는지 보여주고 묻습니다 - `정말 지울까요?` 만 띄우면 사람은
   * 읽지 않고 누릅니다.
   */
  const [confirming, setConfirming] = useState<FeeItem | null>(null);
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

  /**
   * 지금 부서의 학년·반.
   *
   * 예전에는 한 벌을 초등·중고등에 똑같이 썼습니다. 그래서 중고등부 항목을 만들 때도 초등
   * 학년(2~5)과 초등 반(G2A…)이 떴습니다 - 고를 수 있는 것이 남의 부서 것뿐이면 기본 대상을
   * 제대로 못 정하고, 결국 아이마다 손으로 체크하게 됩니다.
   */
  const grades = gradesByDept[deptTab] ?? [];

  /**
   * 지금 폼에서 고른 학년.
   *
   * `""` 은 개별 지정, `"전체"` 는 부서 전원, 나머지는 그 학년입니다. 학년 칸(배열)에서
   * 되읽지 않고 target_scope 를 함께 봐야 하는 이유: 배열이 비어 있다는 것만으로는 개별인지
   * 전체인지 가릴 수 없습니다. 애초에 target_scope 를 만든 까닭입니다.
   */
  const gradeChoice =
    form.target_scope === "부서전체"
      ? "전체"
      : form.target_scope === "그룹"
        ? `g:${form.target_group_id ?? ""}`
        : form.target_scope === "개별"
          ? ""
          : form.default_grades[0] ?? "";

  /** 고른 학년의 반만. 학년과 상관없는 반을 고르면 그 항목은 아무에게도 안 붙습니다. */
  const gradeClasses = (classesByGrade[deptTab] ?? {})[gradeChoice] ?? [];

  function pickGrade(v: string) {
    if (v === "") {
      setForm((f) => ({ ...f, target_scope: "개별", default_grades: [], default_classes: [] }));
      return;
    }
    // 수강 그룹. 학년·반과 달리 **명단이 바뀌면 대상도 저절로 따라옵니다.**
    if (v.startsWith("g:")) {
      setForm((f) => ({ ...f, target_scope: "그룹", target_group_id: v.slice(2), default_grades: [], default_classes: [] }));
      return;
    }
    if (v === "전체") {
      // 학년을 하나씩 채워두지 않습니다 - 그 목록은 채우던 날의 사진이라, 다음 학기에 학년이
      // 하나 늘면 그 학년만 조용히 빠집니다.
      setForm((f) => ({ ...f, target_scope: "부서전체", default_grades: [], default_classes: [] }));
      return;
    }
    // 학년을 바꾸면 반은 비웁니다. 4학년으로 바꿨는데 G2A 가 남아 있으면 아무에게도 안 붙습니다.
    setForm((f) => ({ ...f, target_scope: "학년", default_grades: [v], default_classes: [] }));
  }

  const deptOfItem = (i: FeeItem): ItemDept => (i.department === "중고등부" ? "중고등부" : i.department === "초등부" ? "초등부" : "공통");
  /** 지금 부서에서 다루는 항목. 공통은 어느 부서에서 보든 함께 나옵니다. */
  /** 이 학기 항목만. 학기가 없던 시절 항목(비어 있음)은 현재 학기에서 함께 보여줍니다. */
  const inTerm = useMemo(
    () => items.filter((i) => (i.term_id ?? "") === termId || (!i.term_id && terms.find((x) => x.id === termId)?.status === "진행중")),
    [items, termId, terms],
  );
  const deptCounts = useMemo(() => {
    const m = new Map<ItemDept, number>();
    for (const i of inTerm) m.set(deptOfItem(i), (m.get(deptOfItem(i)) ?? 0) + 1);
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
    // 항목은 끄지 않고 지웁니다. 여기 있는 것이 전부이고, 안 보이는 줄은 없습니다.
    const list = inDept.filter((i) => tab === "전체" || i.category === tab);
    const dir = asc ? 1 : -1;
    const byName = (a: FeeItem, b: FeeItem) => a.name.localeCompare(b.name, "ko");
    return [...list].sort((a, b) => {
      if (sortBy === "이름") return dir * byName(a, b);
      if (sortBy === "단가") return dir * (Number(a.unit_price) - Number(b.unit_price)) || byName(a, b);
      if (sortBy === "대상") return dir * targetKey(a).localeCompare(targetKey(b)) || byName(a, b);
      // 분류: 분류 이름 → 손으로 정한 순서 → 이름.
      return dir * a.category.localeCompare(b.category, "ko") || a.sort_order - b.sort_order || byName(a, b);
    });
  }, [inDept, tab, sortBy, asc]);
  const activeCount = inDept.length;

  const [cats, setCats] = useState(initialCategories);
  const [newCat, setNewCat] = useState("");
  const [catOpen, setCatOpen] = useState(false);
  /** 새 분류 만드는 창. 폼 안에서 바로 만들 수 있어야 흐름이 안 끊깁니다. */
  const [catModal, setCatModal] = useState(false);

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
  /**
   * 고를 수 있는 분류. **등록된 것과 실제로 쓰이는 것뿐**입니다.
   *
   * 예전에는 예시(교재·교복…)를 함께 넣어뒀는데, 고르는 목록에 예시가 섞이면 등록하지 않은
   * 분류로 항목이 만들어집니다. 그러면 분류 관리 화면에는 없는데 표에는 탭이 뜨는 상태가
   * 됩니다. 예시는 새 분류 만드는 창에서만 보여줍니다.
   */
  const categoryOptions = useMemo(
    () => [...new Set([...registered, ...usedCategories])],
    [registered, usedCategories],
  );

  // 고를 수 있는 것이 없거나 지금 고른 것이 목록에 없으면 첫 번째로 맞춰둡니다.
  // 안 그러면 select 는 첫 항목을 보여주는데 form.category 는 다른 값이라, 화면에 보이는
  // 것과 저장되는 것이 달라집니다.
  useEffect(() => {
    if (categoryOptions.length > 0 && !categoryOptions.includes(form.category)) {
      setForm((f) => ({ ...f, category: categoryOptions[0] }));
    }
  }, [categoryOptions, form.category]);
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
    setCatModal(false);
    notify(`분류 "${name}"을 만들었습니다.`, "success");
  }

  /**
   * 분류를 지웁니다. 항목과 같은 이유로 끄기가 아니라 삭제입니다.
   *
   * 쓰는 항목이 있으면 막습니다 - 분류가 없어지면 그 항목들이 어느 묶음에도 안 속하게 되고,
   * 탭에서 사라져 찾을 수 없게 됩니다.
   */
  async function removeCategory(c: FeeCategory) {
    const using = items.filter((i) => i.category === c.name).length;
    if (using > 0) {
      notify(`"${c.name}"을 쓰는 항목이 ${using}개 있습니다. 항목을 먼저 옮기거나 지워주세요.`, "error");
      return;
    }
    const { error } = await createClient().from("fee_categories").delete().eq("id", c.id);
    if (error) {
      notify("지우지 못했습니다: " + error.message, "error");
      return;
    }
    setCats((p) => p.filter((x) => x.id !== c.id));
    if (tab === c.name) setTab("전체");
    notify(`분류 "${c.name}"을 지웠습니다.`, "success");
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
      target_scope: form.target_scope,
      target_group_id: form.target_scope === "그룹" ? form.target_group_id : null,
      auto_apply: form.auto_apply,
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
      // 칸이 없던 시절 자료는 학년·반 칸을 보고 되짚습니다(마이그레이션과 같은 규칙).
      target_scope:
        i.target_scope ??
        ((i.default_classes ?? []).length > 0 ? "반" : (i.default_grades ?? []).length > 0 ? "학년" : "개별"),
      target_group_id: i.target_group_id ?? null,
      auto_apply: i.auto_apply !== false,
      note: i.note ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * 항목을 지웁니다.
   *
   * **이미 발행한 인보이스는 그대로입니다.** 인보이스는 이 항목을 가리키는 것이 아니라,
   * 발행하는 순간의 이름과 금액을 자기 줄에 베껴 두기 때문입니다. 그래서 지난 청구서가
   * 왜 그 금액이었는지는 항목을 지운 뒤에도 설명됩니다.
   *
   * 함께 사라지는 것은 **아이별 가감**(이 아이는 산다/안 산다)입니다. 항목이 없어지면
   * 그 결정도 뜻이 없어지므로 같이 지웁니다. 단가 이력은 남습니다.
   */
  async function remove(i: FeeItem) {
    setBusy(true);
    const { error } = await createClient().from("fee_items").delete().eq("id", i.id);
    setBusy(false);
    if (error) {
      // 조용히 넘기면 화면에서는 지워진 것처럼 보이는데 다음에 열면 그대로 있습니다.
      notify("지우지 못했습니다: " + error.message, "error");
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== i.id));
    setConfirming(null);
    if (editingId === i.id) reset();
    notify(`"${i.name}"을(를) 지웠습니다.`, "success");
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


  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
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
                      className="flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] text-teal-800"
                    >
                      <b>{c.name}</b>
                      <span className="opacity-60">{used}개</span>
                      <button
                        onClick={() => void removeCategory(c)}
                        className="ml-0.5 font-bold opacity-50 hover:text-red-600 hover:opacity-100"
                        title={used > 0 ? `쓰는 항목이 ${used}개 있어 지울 수 없습니다` : "지우기"}
                      >
                        ×
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
          {/* 분류는 **고르기만** 합니다.
              직접 적게 두면 `교재` 와 `교재비` 와 `교재 ` 가 서로 다른 분류가 되고, 표에서
              탭이 셋으로 갈라집니다. 실제로 그렇게 갈라진 것이 이미 있었습니다. */}
          <label className="text-[11px] text-slate-500">
            분류
            <span className="ml-1 inline-flex items-center gap-1">
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                {categoryOptions.length === 0 && <option value="">— 분류를 먼저 만들어주세요 —</option>}
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setNewCat("");
                  setCatModal(true);
                }}
                className="rounded-lg border border-teal-300 bg-teal-50 px-2 py-1.5 text-[12px] font-bold text-teal-700 hover:bg-teal-100"
                title="새 분류 만들기"
              >
                + 분류
              </button>
            </span>
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

        {/* ── 대상 ────────────────────────────────────────────────
            **이 항목이 누구를 위한 것인가.**

            지금까지는 이것을 한글 이름에 적었습니다 — `4학년 중국어`. 그러면 셋이 어긋납니다.
              · 인보이스에 `4학년 중국어` 가 그대로 찍힙니다(학부모에게는 필요 없는 말입니다)
              · 학년이 바뀌면 이름을 고쳐야 하는데, 고치면 지난 청구서와 이름이 달라집니다
              · 글자로만 있으니 **기계는 못 읽습니다** — 인보이스 표에서 걸러낼 수가 없습니다

            여기에 고르면 표의 열 머리에 뱃지로 뜨고, 상관없는 명단에서는 열을 아예 세우지
            않습니다. 이름에는 `중국어` 만 적으면 됩니다. */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <p className="mb-1.5 text-[12px] font-bold text-slate-700">
            대상 — 이 항목은 누구를 위한 것인가
            <span className="ml-1.5 rounded bg-white px-1.5 py-0.5 text-[11px] font-bold text-teal-700">
              {targetLabel({ default_grades: form.default_grades, default_classes: form.default_classes, target_scope: form.target_scope })}
            </span>
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            이름에 &lsquo;4학년&rsquo;을 적지 마세요 — 인보이스에 그대로 찍히고, 표에서 걸러낼 수도 없습니다.
          </p>

          {/* 대상에 든다고 다 사는 것은 아닙니다.
              3학년 중국어는 3학년 것이 맞지만 3학년 중에도 하는 아이와 안 하는 아이가 있습니다.
              이 둘을 한 칸에 섞으면, 전원에게 붙인 뒤 빼는 것을 잊어 **돈이 잘못 청구됩니다.** */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[
              {
                on: true,
                label: "대상 전원에게",
                hint: "공통 교과서처럼 그 학년·반이면 전부 사는 것",
              },
              {
                on: false,
                label: "고른 아이에게만",
                hint: "선택 과목 교재처럼 대상 안에서도 하는 아이만 사는 것 — 표에는 열이 서고, 살 아이를 체크합니다",
              },
            ].map((o) => (
              <button
                key={String(o.on)}
                type="button"
                title={o.hint}
                onClick={() => setForm((f) => ({ ...f, auto_apply: o.on }))}
                className={
                  "rounded-lg border px-2.5 py-1 text-[12px] font-bold transition " +
                  (form.auto_apply === o.on
                    ? "border-teal-500 bg-teal-600 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")
                }
              >
                {o.label}
              </button>
            ))}
            <span className="self-center text-[11px] text-slate-400">
              {form.auto_apply
                ? "고른 학년·반의 아이 전원에게 자동으로 붙습니다."
                : "자동으로 붙지 않습니다. 인보이스 표에서 살 아이만 체크하세요."}
            </span>
          </div>
          {/* 학년을 먼저, 그 다음 반.
              체크를 여러 개 두면 "4학년과 G2A" 같은 조합이 만들어지는데, 그런 항목은 읽는
              쪽에서 뜻을 정할 수가 없습니다. 한 번에 하나씩 좁혀 들어가면 만들 수 있는 것이
              곧 뜻이 분명한 것들뿐입니다. */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-slate-500">
              학년
              <select
                value={gradeChoice}
                onChange={(e) => pickGrade(e.target.value)}
                className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">개별 지정 (고르지 않음)</option>
                <option value="전체">전체 — {deptTab === "공통" ? "학교 전체" : deptTab} 전원</option>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}학년
                  </option>
                ))}
                {/* 수강 그룹.
                    학년·반과 다른 점: **명단이 바뀌면 대상도 저절로 따라옵니다.** 방과후를
                    그만둔 아이는 그룹에서 빼기만 하면 교재도 함께 빠집니다. */}
                {groups.length > 0 && (
                  <optgroup label="수강 그룹">
                    {groups.map((g) => (
                      <option key={g.id} value={`g:${g.id}`}>
                        {g.name} ({g.kind})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            {/* 반은 **학년을 고른 뒤에만** 나옵니다. 그리고 그 학년의 반만 나옵니다. */}
            {form.target_scope === "학년" || form.target_scope === "반" ? (
              <label className="text-[11px] text-slate-500">
                반
                <select
                  value={form.default_classes[0] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      default_classes: e.target.value ? [e.target.value] : [],
                      target_scope: e.target.value ? "반" : "학년",
                    }))
                  }
                  className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">전체 — {gradeChoice}학년 전원</option>
                  {gradeClasses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {gradeClasses.length === 0 && <span className="ml-1 text-[11px] text-slate-400">이 학년에는 반이 없습니다</span>}
              </label>
            ) : null}

            <span className="pb-1.5 text-[11px] text-slate-500">
              {form.target_scope === "개별"
                ? "아무에게도 자동으로 안 붙습니다. 인보이스 표에서 한 명씩 넣습니다."
                : form.target_scope === "부서전체"
                  ? "학년이 늘어도 저절로 따라옵니다."
                  : form.target_scope === "그룹"
                    ? "이 그룹의 명단이 바뀌면 대상도 저절로 따라옵니다."
                    : form.target_scope === "반"
                      ? `${gradeChoice}학년 ${form.default_classes[0]} 에서만 쓰는 항목입니다.`
                      : `${gradeChoice}학년 것입니다.`}
            </span>
          </div>

          {/* 옛 자료 중에는 학년을 여러 개 체크해 둔 것이 있습니다.
              그것을 말없이 첫 번째 하나로 줄이면, 고치기만 눌렀다 저장해도 나머지 학년에서
              그 교재가 사라집니다. 그런 줄은 미리 알려줍니다. */}
          {form.default_grades.length > 1 && (
            <p className="mt-1.5 text-[11px] text-amber-700">
              이 항목에는 학년이 <b>{form.default_grades.join("·")}</b> 로 여러 개 적혀 있습니다. 위에서 학년을 고르면{" "}
              <b>고른 하나만 남습니다.</b> 여러 학년에 그대로 두려면 학년을 건드리지 말고 저장하세요.
            </p>
          )}
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
            대상을 고르지 않으면 <b>아무에게도 자동으로 붙지 않습니다.</b> 학생 화면에서 한 명씩 넣어야 하고, 인보이스 표에서는
            &lsquo;개별 지정&rsquo;으로 뜹니다.
          </p>
        )}
      </div>

      {/* ── 새 분류 만들기 ─────────────────────────────────────────
          폼 안에서 바로 만들 수 있어야 흐름이 안 끊깁니다. 분류 관리 칸까지 올라갔다 오면
          적던 항목 이름을 잊습니다. */}
      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setCatModal(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-slate-800">새 분류 만들기</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              분류는 인보이스 표의 탭이 되고, 청구서를 나눠 발행하는 단위이기도 합니다. 교재와 교복을 다른 날 보낸다면 분류를
              나누는 것이 맞습니다.
            </p>
            <input
              autoFocus
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addCategory()}
              placeholder="예: 악기 · 체육복 · 현장학습"
              className="mt-3 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            {/* 예시는 여기서만 보여줍니다. 고르는 목록에 섞으면 등록 안 된 분류가 생깁니다. */}
            <div className="mt-2 flex flex-wrap gap-1">
              {FEE_ITEM_CATEGORY_SUGGESTIONS.filter((s) => !registered.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNewCat(s)}
                  className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCatModal(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600">
                그만두기
              </button>
              <button
                onClick={() => void addCategory()}
                disabled={!newCat.trim()}
                className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}

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
        {/* 예전에는 `꺼둔 것도 보기` 가 여기 있었습니다. 이제 안 보이는 항목은 없습니다 -
            쓰지 않는 항목은 지우고, 지운 것은 돌아오지 않습니다. */}
        <span className="ml-auto text-[11px] text-slate-400">{shown.length}개</span>
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
              <tr key={i.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-[11px] font-semibold text-slate-500">{i.category}</td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-slate-800">{i.name}</span>
                  {i.name_ko && <span className="ml-1.5 text-[11px] text-slate-400">{i.name_ko}</span>}
                  {i.note && <span className="ml-1.5 text-[11px] text-slate-400">· {i.note}</span>}
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-700">{won(Number(i.unit_price))}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    {/* 대상은 targetLabel 한 곳에서 만듭니다.
                        화면마다 학년·반 칸을 각자 읽어 글자를 만들면, '전체' 처럼 칸이 비어
                        있는 경우를 한 곳만 고치고 나머지를 잊습니다. */}
                    <span
                      className={
                        "rounded px-1.5 text-[11px] font-semibold " +
                        (i.target_scope === "부서전체"
                          ? "bg-indigo-50 text-indigo-700"
                          : targetLabel(i) === "개별 지정"
                            ? "text-slate-400"
                            : (i.default_classes ?? []).length > 0
                              ? "bg-sky-50 text-sky-700"
                              : "bg-teal-50 text-teal-700")
                      }
                      title={
                        i.target_scope === "부서전체"
                          ? "이 부서 전원. 학년이 늘어도 저절로 따라옵니다"
                          : targetLabel(i) === "개별 지정"
                            ? "아무에게도 자동으로 붙지 않습니다. 인보이스 표에서 한 명씩 넣습니다"
                            : `대상: ${targetLabel(i)}`
                      }
                    >
                      {targetLabel(i)}
                    </span>
                    {/* 대상은 있는데 자동으로는 안 붙는 항목. 이 표시가 없으면 '왜 아무에게도
                        안 붙었지' 를 항목 설정에서 다시 찾아봐야 합니다. */}
                    {i.auto_apply === false && targetLabel(i) !== "개별 지정" && (
                      <span
                        className="rounded bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-700"
                        title="대상 안에서 고른 아이에게만 붙습니다. 인보이스 표에서 체크하세요"
                      >
                        고른 아이만
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => edit(i)} className="mr-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
                    고치기
                  </button>
                  <button
                    onClick={() => setConfirming(i)}
                    className="text-[11px] font-semibold text-red-500 hover:text-red-700"
                    title="지웁니다. 이미 발행한 인보이스는 그대로입니다"
                  >
                    삭제
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

      {/* ── 지울까요 ───────────────────────────────────────────────
          무엇이 함께 없어지고 무엇이 남는지 **먼저 보여주고** 묻습니다. `정말 지울까요?` 만
          띄우면 사람은 읽지 않고 누르고, 그러면 물어본 뜻이 없습니다. */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setConfirming(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-slate-800">항목을 지웁니다</p>
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <b className="text-slate-800">{confirming.name}</b>
              {confirming.name_ko && <span className="ml-1.5 text-[12px] text-slate-500">{confirming.name_ko}</span>}
              <span className="ml-2 font-bold tabular-nums text-slate-600">{won(Number(confirming.unit_price))}</span>
            </p>

            <ul className="mt-3 space-y-1 text-[12px] leading-relaxed text-slate-600">
              <li>
                ✓ <b>이미 발행한 인보이스는 그대로입니다.</b> 청구서는 이 항목을 가리키는 것이 아니라, 보낼 때의 이름과 금액을
                자기 줄에 베껴 두기 때문입니다.
              </li>
              <li>✓ 단가 이력(언제 얼마에서 얼마로 올랐는지)도 남습니다.</li>
              <li className={usageByItem[confirming.id] ? "text-amber-800" : ""}>
                {usageByItem[confirming.id] ? "⚠" : "·"} 손으로 넣거나 뺀 아이 <b>{usageByItem[confirming.id] ?? 0}명</b>의 조정이 함께
                사라집니다.
              </li>
              <li>· 앞으로 만드는 인보이스에는 이 항목이 나오지 않습니다.</li>
            </ul>
            <p className="mt-2 text-[12px] font-semibold text-red-600">되돌릴 수 없습니다.</p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600"
              >
                그만두기
              </button>
              <button
                onClick={() => void remove(confirming)}
                disabled={busy}
                className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                지우기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
