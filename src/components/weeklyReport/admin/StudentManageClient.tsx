"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WrStudent, WrStudentFieldDef } from "@/lib/types";
import { useConfirm } from "@/components/common/ConfirmProvider";

type SortKey =
  | "grade"
  | "class_name"
  | "name"
  | "name_en"
  | "gender"
  | "birth_date"
  | "parent_phone"
  | "parent_email"
  | "address"
  | "allergies"
  | { custom: string };

function sortKeyEq(a: SortKey | null, b: SortKey) {
  if (a === null) return false;
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.custom === b.custom;
}

function sortValue(s: WrStudent, key: SortKey): string {
  if (typeof key !== "string") return s.custom_fields?.[key.custom] ?? "";
  switch (key) {
    case "grade":
      return s.grade ?? "";
    case "class_name":
      return s.class_name ?? "";
    case "name":
      return s.name;
    case "name_en":
      return s.name_en ?? "";
    case "gender":
      return s.gender ?? "";
    case "birth_date":
      return s.birth_date ?? "";
    case "parent_phone":
      return s.parent_phone ?? "";
    case "parent_email":
      return s.parent_email ?? "";
    case "address":
      return s.address ?? "";
    case "allergies":
      return s.allergies ?? "";
  }
}

// 새 커스텀 칼럼의 field_key는 화면에서 무작위로 만들어 절대 겹치지 않게 합니다(한글 라벨을
// 그대로 컬럼키로 쓰면 충돌·인코딩 문제가 생길 수 있어서, 키와 라벨을 분리했습니다).
function randomFieldKey() {
  return "custom_" + Math.random().toString(36).slice(2, 10);
}

export default function StudentManageClient({
  initialStudents,
  initialFieldDefs,
  currentUserEmail,
}: {
  initialStudents: WrStudent[];
  initialFieldDefs: WrStudentFieldDef[];
  currentUserEmail: string;
}) {
  const confirmAction = useConfirm();
  const [students, setStudents] = useState<WrStudent[]>(initialStudents);
  const [fieldDefs, setFieldDefs] = useState<WrStudentFieldDef[]>(initialFieldDefs);

  // ── 새 학생 등록 폼 ──────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [address, setAddress] = useState("");
  const [allergies, setAllergies] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  // ── 칼럼 추가 ────────────────────────────────────────────────────
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number" | "date">("text");

  // ── 정렬(구글시트처럼 칼럼 제목 클릭) ─────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ── 학년/반 필터 (요청: "학년별, 반별로도 볼 수 있도록") ───────────
  const [gradeFilter, setGradeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");

  // ── 이름 검색 (요청: "학생추가와 리스트 사이에 검색창도 넣어주고") ──
  const [nameQuery, setNameQuery] = useState("");

  function toggleSort(key: SortKey) {
    if (sortKeyEq(sortKey, key)) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function resetForm() {
    setName("");
    setNameEn("");
    setGrade("");
    setClassName("");
    setGender("");
    setBirthDate("");
    setParentPhone("");
    setParentEmail("");
    setAddress("");
    setAllergies("");
  }

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("wr_students")
      .insert({
        name: name.trim(),
        name_en: nameEn.trim() || null,
        grade: grade.trim() || null,
        class_name: className.trim() || null,
        gender: gender || null,
        birth_date: birthDate || null,
        parent_phone: parentPhone.trim() || null,
        parent_email: parentEmail.trim() || null,
        address: address.trim() || null,
        allergies: allergies.trim() || null,
      })
      .select()
      .single();
    setSaving(false);
    if (data) {
      setStudents((prev) => [...prev, data as WrStudent]);
      resetForm();
      setShowAddForm(false);
    }
  }

  async function bulkAdd() {
    // 한 줄에 "이름,영어이름,학년,반,보호자연락처" 형식 - 대량 등록은 자주 쓰는 5개 항목만
    // 받고, 나머지(보호자이메일/주소/생일/성별/알러지/커스텀칼럼)는 등록 후 표에서 바로
    // 채워 넣을 수 있습니다.
    const rows = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [n, ne, g, c, p] = line.split(",").map((v) => v?.trim() ?? "");
        return { name: n, name_en: ne || null, grade: g || null, class_name: c || null, parent_phone: p || null };
      })
      .filter((r) => r.name);
    if (rows.length === 0) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase.from("wr_students").insert(rows).select();
    setSaving(false);
    if (data) {
      setStudents((prev) => [...prev, ...(data as WrStudent[])]);
      setBulkText("");
      setShowBulk(false);
    }
  }

  async function updateField<K extends keyof WrStudent>(id: string, field: K, rawValue: string) {
    const value = (rawValue.trim() || null) as WrStudent[K];
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    const supabase = createClient();
    await supabase.from("wr_students").update({ [field]: value }).eq("id", id);
  }

  async function updateCustomField(id: string, fieldKey: string, rawValue: string) {
    const student = students.find((s) => s.id === id);
    if (!student) return;
    const nextCustom = { ...(student.custom_fields ?? {}) };
    if (rawValue.trim()) nextCustom[fieldKey] = rawValue.trim();
    else delete nextCustom[fieldKey];
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, custom_fields: nextCustom } : s)));
    const supabase = createClient();
    await supabase.from("wr_students").update({ custom_fields: nextCustom }).eq("id", id);
  }

  async function archiveStudent(id: string) {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status: "inactive" } : s)));
    const supabase = createClient();
    await supabase.from("wr_students").update({ status: "inactive" }).eq("id", id);
  }

  async function removeStudent(id: string) {
    if (!(await confirmAction("이 학생을 완전히 삭제할까요? 관련 리포트도 함께 삭제됩니다.", { danger: true }))) return;
    setStudents((prev) => prev.filter((s) => s.id !== id));
    const supabase = createClient();
    await supabase.from("wr_students").delete().eq("id", id);
  }

  async function addFieldDef(e: React.FormEvent) {
    e.preventDefault();
    if (!newFieldLabel.trim()) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("wr_student_field_defs")
      .insert({
        field_key: randomFieldKey(),
        label: newFieldLabel.trim(),
        field_type: newFieldType,
        sort_order: fieldDefs.length,
        created_by: currentUserEmail,
      })
      .select()
      .single();
    if (data) {
      setFieldDefs((prev) => [...prev, data as WrStudentFieldDef]);
      setNewFieldLabel("");
      setNewFieldType("text");
    }
  }

  async function removeFieldDef(def: WrStudentFieldDef) {
    if (
      !(await confirmAction(
        `"${def.label}" 칼럼을 표에서 지울까요? 이미 입력된 값은 학생 기록에 남아있지만 화면에는 더 이상 보이지 않습니다.`,
        { danger: true }
      ))
    )
      return;
    setFieldDefs((prev) => prev.filter((f) => f.id !== def.id));
    const supabase = createClient();
    await supabase.from("wr_student_field_defs").delete().eq("id", def.id);
  }

  const active = students.filter((s) => s.status === "active");

  // 필터에 쓸 학년/반 선택지는 실제 등록된 학생 데이터에서 뽑습니다(가나다/숫자 순 정렬).
  const gradeOptions = useMemo(
    () => [...new Set(active.map((s) => s.grade).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
    [active]
  );
  const classOptions = useMemo(() => {
    const pool = gradeFilter ? active.filter((s) => s.grade === gradeFilter) : active;
    return [...new Set(pool.map((s) => s.class_name).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  }, [active, gradeFilter]);

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return active.filter(
      (s) =>
        (!gradeFilter || s.grade === gradeFilter) &&
        (!classFilter || s.class_name === classFilter) &&
        (!q || s.name.toLowerCase().includes(q) || (s.name_en ?? "").toLowerCase().includes(q))
    );
  }, [active, gradeFilter, classFilter, nameQuery]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (!sortKey) {
      // 기본 정렬: 학년 → 반 → 이름(가나다) 순 (요청: "1학년부터 5학년까지 정렬하고,
      // 학년다음에 반, 그리고 이름 가나다로")
      list.sort((a, b) => {
        const g = (a.grade ?? "").localeCompare(b.grade ?? "", "ko", { numeric: true });
        if (g !== 0) return g;
        const c = (a.class_name ?? "").localeCompare(b.class_name ?? "", "ko", { numeric: true });
        if (c !== 0) return c;
        return a.name.localeCompare(b.name, "ko");
      });
      return list;
    }
    list.sort((a, b) => {
      const cmp = sortValue(a, sortKey).localeCompare(sortValue(b, sortKey), "ko", { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  function SortTh({ label, sortKeyFor, className = "" }: { label: string; sortKeyFor: SortKey; className?: string }) {
    const isActive = sortKeyEq(sortKey, sortKeyFor);
    return (
      <th
        onClick={() => toggleSort(sortKeyFor)}
        title="클릭하면 이 칼럼 기준으로 정렬합니다(구글시트처럼)"
        className={"cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:bg-slate-100 " + className}
      >
        {label} {isActive ? (sortDir === "asc" ? "▲" : "▼") : ""}
      </th>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2"
        >
          + 학생 추가
        </button>
        <button
          type="button"
          onClick={() => setShowBulk((v) => !v)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          대량 등록
        </button>
        <button
          type="button"
          onClick={() => setShowFieldForm((v) => !v)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          + 칼럼 추가
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <select
          value={gradeFilter}
          onChange={(e) => {
            setGradeFilter(e.target.value);
            setClassFilter("");
          }}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-600"
        >
          <option value="">전체 학년</option>
          {gradeOptions.map((g) => (
            <option key={g} value={g}>{g}학년</option>
          ))}
        </select>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-600"
        >
          <option value="">전체 반</option>
          {classOptions.map((c) => (
            <option key={c} value={c}>{c}반</option>
          ))}
        </select>
        <span className="text-[11px] text-slate-400">칼럼 제목을 클릭하면 그 칼럼 기준으로 정렬돼요. 전체 명단이 아래에서 스크롤됩니다.</span>
      </div>

      <input
        value={nameQuery}
        onChange={(e) => setNameQuery(e.target.value)}
        placeholder="이름 또는 영어 이름으로 검색"
        className="mb-3 w-full shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-xs"
      />

      {showAddForm && (
        <form onSubmit={addStudent} className="mb-3 grid shrink-0 grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">이름 Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">영어 이름 Name (EN)</label>
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">학년</label>
            <input value={grade} onChange={(e) => setGrade(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">반</label>
            <input value={className} onChange={(e) => setClassName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">성별</label>
            <select value={gender} onChange={(e) => setGender(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">-</option>
              <option value="남">남</option>
              <option value="여">여</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">생일</label>
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">보호자 연락처</label>
            <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">보호자 이메일</label>
            <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-[11px] text-slate-400">주소</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-[11px] text-slate-400">알러지</label>
            <input
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="예: 없음 / 땅콩, 우유"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
            <button disabled={saving} className="rounded-lg bg-wr-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50">
              등록
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
              취소
            </button>
          </div>
        </form>
      )}

      {showBulk && (
        <div className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-1.5 text-[11px] text-slate-400">
            한 줄에 하나씩, &quot;이름,영어이름,학년,반,보호자연락처&quot; 형식으로 붙여넣으세요. 영어이름은 비워둬도 됩니다.
            그 외 항목은 등록 후 표에서 바로 입력할 수 있습니다.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={"홍길동,Hong Gildong,3,1반,010-1234-5678\n김철수,,3,2반,"}
            className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button onClick={bulkAdd} disabled={saving} className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50">
            일괄 등록
          </button>
        </div>
      )}

      {showFieldForm && (
        <div className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-white p-3">
          <form onSubmit={addFieldDef} className="mb-2 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">새 칼럼 이름</label>
              <input
                value={newFieldLabel}
                onChange={(e) => setNewFieldLabel(e.target.value)}
                placeholder="예: 형제자매, 통학버스 노선"
                className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">입력 형식</label>
              <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as "text" | "number" | "date")} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="text">텍스트</option>
                <option value="number">숫자</option>
                <option value="date">날짜</option>
              </select>
            </div>
            <button className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2">칼럼 추가</button>
          </form>
          {fieldDefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {fieldDefs.map((f) => (
                <span key={f.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">
                  {f.label}
                  <button onClick={() => removeFieldDef(f)} className="text-slate-400 hover:text-red-500" title="이 칼럼 지우기">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-400 shadow-sm">
            <tr>
              <SortTh label="학년" sortKeyFor="grade" />
              <SortTh label="반" sortKeyFor="class_name" />
              <SortTh label="이름" sortKeyFor="name" />
              <SortTh label="영어 이름" sortKeyFor="name_en" />
              <SortTh label="성별" sortKeyFor="gender" />
              <SortTh label="생일" sortKeyFor="birth_date" />
              <SortTh label="보호자 연락처" sortKeyFor="parent_phone" />
              <SortTh label="보호자 이메일" sortKeyFor="parent_email" />
              <SortTh label="주소" sortKeyFor="address" />
              <SortTh label="알러지" sortKeyFor="allergies" />
              {fieldDefs.map((f) => (
                <SortTh key={f.id} label={f.label} sortKeyFor={{ custom: f.field_key }} />
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-500">
                  <EditableCell value={s.grade ?? ""} onSave={(v) => updateField(s.id, "grade", v)} width="w-12" />
                </td>
                <td className="px-3 py-1.5 text-slate-500">
                  <EditableCell value={s.class_name ?? ""} onSave={(v) => updateField(s.id, "class_name", v)} width="w-16" />
                </td>
                <td className="px-3 py-1.5 font-medium">
                  <EditableCell value={s.name} onSave={(v) => v.trim() && updateField(s.id, "name", v)} width="w-24" />
                </td>
                <td className="px-3 py-1.5">
                  <EditableCell value={s.name_en ?? ""} onSave={(v) => updateField(s.id, "name_en", v)} width="w-28" />
                </td>
                <td className="px-3 py-1.5">
                  <select
                    defaultValue={s.gender ?? ""}
                    onChange={(e) => updateField(s.id, "gender", e.target.value)}
                    className="rounded-lg border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300"
                  >
                    <option value="">-</option>
                    <option value="남">남</option>
                    <option value="여">여</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="date"
                    defaultValue={s.birth_date ?? ""}
                    onBlur={(e) => e.target.value !== (s.birth_date ?? "") && updateField(s.id, "birth_date", e.target.value)}
                    className="w-32 rounded-lg border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300"
                  />
                </td>
                <td className="px-3 py-1.5 text-slate-400">
                  <EditableCell value={s.parent_phone ?? ""} onSave={(v) => updateField(s.id, "parent_phone", v)} width="w-32" />
                </td>
                <td className="px-3 py-1.5 text-slate-400">
                  <EditableCell value={s.parent_email ?? ""} onSave={(v) => updateField(s.id, "parent_email", v)} width="w-40" />
                </td>
                <td className="px-3 py-1.5 text-slate-400">
                  <EditableCell value={s.address ?? ""} onSave={(v) => updateField(s.id, "address", v)} width="w-40" />
                </td>
                <td className="px-3 py-1.5 text-slate-400">
                  <EditableCell value={s.allergies ?? ""} onSave={(v) => updateField(s.id, "allergies", v)} width="w-28" />
                </td>
                {fieldDefs.map((f) => (
                  <td key={f.id} className="px-3 py-1.5 text-slate-400">
                    <EditableCell
                      value={s.custom_fields?.[f.field_key] ?? ""}
                      inputType={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                      onSave={(v) => updateCustomField(s.id, f.field_key, v)}
                      width="w-28"
                    />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => archiveStudent(s.id)} className="mr-2 text-xs text-amber-500 hover:text-amber-600">
                    보관
                  </button>
                  <button onClick={() => removeStudent(s.id)} className="text-xs text-red-400 hover:text-red-600">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11 + fieldDefs.length} className="px-3 py-6 text-center text-slate-400">
                  {active.length === 0 ? "등록된 학생이 없습니다." : "이 조건에 맞는 학생이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 클릭하면 입력창으로 바뀌고, 포커스를 잃으면(onBlur) 저장하는 셀 - 기존 영어이름 인라인
// 편집 패턴을 모든 칼럼에 공통으로 쓰도록 뽑아냈습니다.
function EditableCell({
  value,
  onSave,
  width = "w-24",
  inputType = "text",
}: {
  value: string;
  onSave: (value: string) => void;
  width?: string;
  inputType?: "text" | "number" | "date";
}) {
  return (
    <input
      type={inputType}
      defaultValue={value}
      onBlur={(e) => e.target.value.trim() !== value && onSave(e.target.value)}
      placeholder="-"
      className={width + " rounded-lg border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300"}
    />
  );
}
