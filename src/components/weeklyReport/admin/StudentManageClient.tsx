"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WR_INSTRUMENTS, type ShuttleRoute, type ShuttleStop, type WrStudent, type WrStudentFieldDef } from "@/lib/types";
import { assignClass, findClass, type ClassRow } from "@/lib/classAssign";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";
import ShuttleRecommendModal from "@/components/shuttle/ShuttleRecommendModal";

const SHUTTLE_MODES = ["없음", "등원", "하원", "등하원"] as const;

type SortKey =
  | "grade"
  | "class_name"
  | "name"
  | "name_en"
  | "gender"
  | "birth_date"
  | "mother_phone"
  | "father_phone"
  | "parent_phone"
  | "parent_email"
  | "address"
  | "allergies"
  | "instrument"
  | "enrolled_on"
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
    case "mother_phone":
      return s.mother_phone ?? "";
    case "father_phone":
      return s.father_phone ?? "";
    case "parent_phone":
      return s.parent_phone ?? "";
    case "parent_email":
      return s.parent_email ?? "";
    case "address":
      return s.address ?? "";
    case "allergies":
      return s.allergies ?? "";
    case "instrument":
      return s.instrument ?? "";
    case "enrolled_on":
      return s.enrolled_on ?? "";
  }
}

// 새 커스텀 칼럼의 field_key는 화면에서 무작위로 만들어 절대 겹치지 않게 합니다(한글 라벨을
// 그대로 컬럼키로 쓰면 충돌·인코딩 문제가 생길 수 있어서, 키와 라벨을 분리했습니다).
function randomFieldKey() {
  return "custom_" + Math.random().toString(36).slice(2, 10);
}

/** 칸 모양은 한 벌만 둡니다. 자리마다 다른 것은 **길이**뿐입니다. */
const FIELD = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm";

export default function StudentManageClient({
  initialStudents,
  initialFieldDefs,
  currentUserEmail,
  canEdit,
  shuttleRoutes = [],
  shuttleStops = [],
  currentTermId = null,
  classes = [],
}: {
  initialStudents: WrStudent[];
  initialFieldDefs: WrStudentFieldDef[];
  currentUserEmail: string;
  /** 지금 학기. 유니폼 사이즈는 학기별로 남깁니다 - 아이는 자랍니다. */
  currentTermId?: string | null;
  /**
   * 지금 있는 반. **반 이름을 연결(class_id)까지 붙이는 데** 씁니다.
   *
   * 이게 없던 때는 반을 적어도 이름만 저장되고 연결은 비어 있었습니다. 화면에는 반 이름이
   * 잘 보이니 다 된 줄 알았는데, 반 배정 화면에서는 그 아이가 「미배정」이었습니다.
   */
  classes?: ClassRow[];
  /**
   * 고칠 수 있는가. 행정직원 이상만 참입니다.
   *
   * 명부는 **교직원 모두가 봅니다** - 담임은 자기 반 아이의 학년·생일·알레르기·셔틀을 늘
   * 봐야 합니다. 다만 고치는 것은 행정실이 합니다.
   */
  canEdit: boolean;
  shuttleRoutes?: ShuttleRoute[];
  shuttleStops?: ShuttleStop[];
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [students, setStudents] = useState<WrStudent[]>(initialStudents);
  const [fieldDefs, setFieldDefs] = useState<WrStudentFieldDef[]>(initialFieldDefs);
  const [recommendFor, setRecommendFor] = useState<WrStudent | null>(null);

  // ── 새 학생 등록 폼 ──────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [motherPhone, setMotherPhone] = useState("");
  const [fatherPhone, setFatherPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [address, setAddress] = useState("");
  const [allergies, setAllergies] = useState("");
  // 시트 명부에는 있는데 이 화면에는 담을 칸이 없던 셋. 없으면 학생을 손으로 추가할 때마다
  // 「이 아이 악기가 뭐였지」를 다시 물어봐야 하고, 그 물음이 결국 엑셀로 돌아가게 만듭니다.
  const [instrument, setInstrument] = useState("");
  const [enrolledOn, setEnrolledOn] = useState("");
  const [uniformSize, setUniformSize] = useState("");
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
  const [showOnHold, setShowOnHold] = useState(false);
  // 재학/졸업/퇴학/보류 탭(요청 ⑥). 기본은 재학.
  const [statusTab, setStatusTab] = useState<"active" | "졸업" | "퇴학" | "보류" | "기타">("active");

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
    setMotherPhone("");
    setFatherPhone("");
    setParentPhone("");
    setParentEmail("");
    setAddress("");
    setAllergies("");
    setInstrument("");
    setEnrolledOn("");
    setUniformSize("");
  }

  /**
   * 지금 적은 반이 명부의 어느 반인가. **적는 동안** 알려줍니다.
   *
   * 저장한 뒤에 알려주면 이미 잘못 들어간 뒤이고, 그때는 명부를 다시 열어 고쳐야 합니다.
   * 반 이름만 남고 배정이 비어 있는 줄은 화면에 멀쩡해 보여서 아무도 안 찾습니다.
   */
  const matchedClass = useMemo(() => findClass(className, classes, grade), [className, classes, grade]);

  /**
   * 학생 추가 폼의 학년·반 선택지. **학생 명부가 아니라 반 명부(`wr_classes`)에서** 뽑습니다.
   *
   * 학생 쪽에서 뽑으면 예전에 잘못 들어간 「2학년」·「G2」·「2」가 그대로 선택지가 되고,
   * 그걸 고른 다음 학생이 또 같은 표기로 저장되어 잘못된 표기가 스스로 번식합니다.
   * 반 명부는 사람이 만든 한 벌뿐이라, 여기서 고르면 표기가 갈릴 수 없습니다.
   */
  const formGrades = useMemo(
    () =>
      [...new Set(classes.map((c) => String(c.grade ?? "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ko", { numeric: true }),
      ),
    [classes],
  );

  /** 학년을 고르면 그 학년의 반만 남습니다. 안 골랐으면 전부 보여줍니다 - 학년 없는 반도 있습니다. */
  const formClasses = useMemo(
    () =>
      classes
        .filter((c) => !grade.trim() || String(c.grade ?? "").trim() === grade.trim())
        .filter((c) => !!c.class_name)
        .sort((a, b) => String(a.class_name).localeCompare(String(b.class_name), "ko", { numeric: true })),
    [classes, grade],
  );

  /**
   * 학년을 바꾸면 **그 학년에 없는 반은 비웁니다.**
   *
   * 안 비우면 선택 칸에는 아까 고른 반 이름이 남아 있는데 목록에는 없는 상태가 됩니다.
   * 사람 눈에는 골라진 것으로 보이고, 저장하면 학년과 반이 어긋난 학생이 생깁니다.
   */
  function pickGrade(next: string) {
    setGrade(next);
    if (!className.trim()) return;
    const stillThere = classes.some(
      (c) => c.class_name === className && (!next.trim() || String(c.grade ?? "").trim() === next.trim()),
    );
    if (!stillThere) setClassName("");
  }

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("wr_students")
      .insert({
        name: name.trim(),
        name_en: nameEn.trim() || null,
        grade: grade.trim() || null,
        // 반은 **이름과 연결을 함께** 넣습니다. 한 곳(assignClass)에서만 정합니다.
        ...assignClass(className, classes, grade),
        gender: gender || null,
        birth_date: birthDate || null,
        mother_phone: motherPhone.trim() || null,
        father_phone: fatherPhone.trim() || null,
        parent_phone: parentPhone.trim() || null,
        parent_email: parentEmail.trim() || null,
        address: address.trim() || null,
        allergies: allergies.trim() || null,
        instrument: instrument || null,
        enrolled_on: enrolledOn || null,
        // 이 화면에서 만드는 학생은 언제나 실제 학생입니다. 기본값에 기대지 않고 못박습니다.
        is_demo: false,
      })
      .select()
      .single();
    if (error || !data) {
      // 저장이 안 됐는데 창이 닫히면 사람은 등록된 줄 압니다. 그리고 며칠 뒤 「그 아이가
      // 명부에 없다」로 발견됩니다.
      setSaving(false);
      notify(`학생을 저장하지 못했습니다: ${error?.message ?? "알 수 없는 이유"}`, "error");
      return;
    }

    // 유니폼 사이즈는 **의류 대장**에 넣습니다. 학생 칸에 하나만 두면 아이가 자랐을 때
    // 지난 사이즈가 사라지고, 의류 화면·제작 건과도 이어지지 않습니다.
    if (uniformSize.trim()) {
      const { error: sizeErr } = await supabase.from("student_apparel_sizes").insert({
        student_id: (data as WrStudent).id,
        kind: "유니폼",
        size: uniformSize.trim(),
        term_id: currentTermId,
        updated_by: currentUserEmail,
      });
      if (sizeErr) notify(`학생은 등록했지만 유니폼 사이즈를 저장하지 못했습니다: ${sizeErr.message}`, "error");
    }

    setSaving(false);
    setStudents((prev) => [...prev, data as WrStudent]);
    // 반 이름은 들어갔는데 배정이 비었으면 **그렇다고 말합니다.** 화면에는 반이 잘 보이니,
    // 안 알리면 반 배정 화면에 가서야 「이 아이가 미배정에 있네」를 발견합니다.
    if (className.trim() && !matchedClass) {
      notify(
        `${name.trim()} 학생을 등록했지만, 「${className.trim()}」이라는 반이 명부에 없어 반 배정은 비워뒀습니다. 반/담임 배정에서 반을 먼저 만들어주세요.`,
        "error",
      );
    }
    resetForm();
    setShowAddForm(false);
    notify(`${(data as WrStudent).name} 등록했습니다.`, "success");
  }

  async function bulkAdd() {
    // 한 줄에 "이름,영어이름,학년,반,어머니,아버지,보호자" 형식.
    //
    // 뒤의 세 칸은 비워도 됩니다. 예전 형식(다섯 칸)으로 붙여넣으면 다섯 번째 값이 **어머니**
    // 번호로 들어갑니다 - 청구서가 어머니 앞으로 가는 집이 가장 많아서, 그렇게 두는 편이
    // 붙여넣은 사람의 뜻에 가깝습니다.
    const rows = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [n, ne, g, c, m, f, p] = line.split(",").map((v) => v?.trim() ?? "");
        return {
          name: n,
          name_en: ne || null,
          grade: g || null,
          class_name: c || null,
          mother_phone: m || null,
          father_phone: f || null,
          parent_phone: p || null,
          is_demo: false,
        };
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

  /**
   * 반 칸을 고치면 **연결까지** 함께 바꿉니다.
   *
   * 이름만 바꾸면 그 아이는 화면상 새 반인데 실제로는 옛 반에 매달린 채로 남습니다.
   * 없는 반을 적으면 연결을 비우고 그 사실을 알려줍니다 - 조용히 두면 「적었는데 왜 안
   * 되지」가 됩니다.
   */
  async function updateClass(id: string, rawValue: string) {
    if (!canEdit) {
      notify("명부를 고치는 것은 행정직원 이상만 할 수 있습니다.", "error");
      return;
    }
    const before = students.find((s) => s.id === id);
    const cls = assignClass(rawValue, classes, before?.grade ?? null);
    const { error } = await createClient().from("wr_students").update(cls).eq("id", id);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      return;
    }
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...cls } as WrStudent : s)));
    if (rawValue.trim() && !cls.class_id) {
      notify(`「${rawValue.trim()}」이라는 반이 명부에 없어 배정은 비워뒀습니다. 반/담임 배정에서 반을 먼저 만들어주세요.`, "error");
    }
  }

  async function updateField<K extends keyof WrStudent>(id: string, field: K, rawValue: string) {
    // 고칠 수 없는 사람은 여기서 멈춥니다. 화면에서도 못 누르게 막지만, 이 한 줄이 마지막
    // 문지기입니다 - DB 의 RLS 도 막지만 그때는 조용히 실패해서 사람이 모릅니다.
    if (!canEdit) {
      notify("명부를 고치는 것은 행정직원 이상만 할 수 있습니다.", "error");
      return;
    }
    const before = students.find((s) => s.id === id);
    const value = (rawValue.trim() || null) as WrStudent[K];
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    const { error } = await createClient().from("wr_students").update({ [field]: value }).eq("id", id);
    if (error) {
      // 조용히 넘기면 화면에는 바뀐 것처럼 보이는데 다음에 열면 그대로입니다.
      notify("저장하지 못했습니다: " + error.message, "error");
      if (before) setStudents((prev) => prev.map((s) => (s.id === id ? before : s)));
    }
  }

  async function updateCustomField(id: string, fieldKey: string, rawValue: string) {
    if (!canEdit) {
      notify("명부를 고치는 것은 행정직원 이상만 할 수 있습니다.", "error");
      return;
    }
    const student = students.find((s) => s.id === id);
    if (!student) return;
    const nextCustom = { ...(student.custom_fields ?? {}) };
    if (rawValue.trim()) nextCustom[fieldKey] = rawValue.trim();
    else delete nextCustom[fieldKey];
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, custom_fields: nextCustom } : s)));
    const { error } = await createClient().from("wr_students").update({ custom_fields: nextCustom }).eq("id", id);
    if (error) {
      notify("저장하지 못했습니다: " + error.message, "error");
      setStudents((prev) => prev.map((s) => (s.id === id ? student : s)));
    }
  }

  // 학적 상태를 바꿉니다(요청 ⑥: 재학/졸업/퇴학/보류로 관리). status 값을 그대로 저장합니다.
  async function setStudentStatus(id: string, status: WrStudent["status"]) {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    const supabase = createClient();
    await supabase.from("wr_students").update({ status }).eq("id", id);
  }

  // 보류 → 재학으로 되돌리기. 확정 명부에서 누락됐을 뿐 실제로는 우리 학생인 경우에 씁니다.
  async function restoreStudent(id: string) {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status: "active" } : s)));
    const supabase = createClient();
    await supabase.from("wr_students").update({ status: "active" }).eq("id", id);
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
  const graduated = students.filter((s) => s.status === "졸업");
  const withdrawn = students.filter((s) => s.status === "퇴학" || s.status === "전출");
  // 확정 명부에 없어 보류로 넘어간 학생들. 평소에는 접혀 있고, 필요할 때만 펼쳐서 되돌립니다.
  const onHold = students.filter((s) => s.status === "보류");
  const others = students.filter((s) => !["active", "졸업", "퇴학", "전출", "보류"].includes(s.status ?? ""));
  // 지금 탭에서 보여줄 학생들.
  const pool =
    statusTab === "active" ? active : statusTab === "졸업" ? graduated : statusTab === "퇴학" ? withdrawn : statusTab === "보류" ? onHold : others;

  // 필터에 쓸 학년/반 선택지는 실제 등록된 학생 데이터에서 뽑습니다(가나다/숫자 순 정렬).
  const gradeOptions = useMemo(
    () => [...new Set(pool.map((s) => s.grade).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
    [pool]
  );
  const classOptions = useMemo(() => {
    const base = gradeFilter ? pool.filter((s) => s.grade === gradeFilter) : pool;
    return [...new Set(base.map((s) => s.class_name).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  }, [pool, gradeFilter]);

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return pool.filter(
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

      {/* 확정 명부에 없어 보류로 넘어간 학생들.
          요청: "일단 지금 명단에 없으면 전부 보류하고, 나중에 중등부 명단을 주면 다시 비교해서...
          중고등학생 명단에도 없으면 퇴소처리 해줘"
          퇴소로 단정하지 않고 여기 모아둡니다. 초등부 학생인데 명부에서 누락된 경우라면
          [재학으로] 한 번으로 되돌립니다. 평소에는 접혀 있어 표를 가리지 않습니다. */}
      {onHold.length > 0 && (
        <div className="mb-3 shrink-0 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <button
            type="button"
            onClick={() => setShowOnHold((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="text-sm font-bold text-amber-900">⏸️ 보류 {onHold.length}명</span>
            <span className="text-[11px] text-amber-700">
              3학기 확정 명부에 없어 화면에서 빠진 학생입니다. 중고등부 명단을 받으면 대조 후 정리합니다.
            </span>
            <span className="ml-auto text-xs font-bold text-amber-700">{showOnHold ? "접기 ‹" : "펼치기 ›"}</span>
          </button>
          {showOnHold && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {onHold.map((s) => (
                <span
                  key={s.id}
                  className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-2 py-1 text-xs"
                >
                  <span className="font-semibold text-slate-700">{s.name}</span>
                  {s.grade && <span className="text-[10px] text-slate-400">{s.grade}</span>}
                  <button
                    type="button"
                    onClick={() => restoreStudent(s.id)}
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-200"
                  >
                    재학으로
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {showAddForm && (
        /* ── 칸 길이는 **들어가는 값의 길이**에 맞춥니다 ──────────────────────────
           네 칸짜리 격자에 전부 같은 너비로 늘려 놓으니, 학년 한 글자를 적는 칸이 주소
           칸과 같은 길이가 됐습니다. 긴 칸은 「여기 뭔가 더 적어야 하나」로 읽히고,
           눈은 매번 칸 끝까지 갔다가 돌아옵니다. 묶음(기본·연락처·그 외)으로 줄을
           나누고, 칸마다 제 길이를 줍니다. */
        <form onSubmit={addStudent} className="mb-3 shrink-0 space-y-2.5 g-panel-solid p-3">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-wide text-slate-400">기본</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-28">
                <label className="mb-1 block text-[11px] text-slate-400">이름 Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
              </div>
              <div className="w-40">
                <label className="mb-1 block text-[11px] text-slate-400">영어 이름 Name (EN)</label>
                <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={FIELD} />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-[11px] text-slate-400">학년</label>
                <select value={grade} onChange={(e) => pickGrade(e.target.value)} className={FIELD}>
                  <option value="">-</option>
                  {formGrades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-32">
                {/* **반은 명부에 있는 것 중에서만 고릅니다.** 자유입력이던 때는 「G2 C」·「g2c」·
                    「2반」이 섞여 들어왔고, 명부와 안 맞는 이름은 반 이름만 저장되고 반 배정은
                    빈 채로 남았습니다. 화면에는 반이 잘 보이니 오류로 보이지 않고, 반 배정
                    화면에 가서야 미배정으로 발견됩니다. 고를 수 없으면 그런 값이 안 생깁니다. */}
                <label className="mb-1 block text-[11px] text-slate-400">반</label>
                <select
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  disabled={formClasses.length === 0}
                  className={FIELD}
                >
                  <option value="">-</option>
                  {formClasses.map((c) => (
                    <option key={c.id} value={c.class_name ?? ""}>
                      {c.class_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-16">
                <label className="mb-1 block text-[11px] text-slate-400">성별</label>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className={FIELD}>
                  <option value="">-</option>
                  <option value="남">남</option>
                  <option value="여">여</option>
                </select>
              </div>
              <div className="w-36">
                <label className="mb-1 block text-[11px] text-slate-400">생일</label>
                <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={FIELD} />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-bold tracking-wide text-slate-400">연락처</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-36">
                <label className="mb-1 block text-[11px] text-slate-400">어머니 (M)</label>
                <input value={motherPhone} onChange={(e) => setMotherPhone(e.target.value)} placeholder="010-" className={FIELD} />
              </div>
              <div className="w-36">
                <label className="mb-1 block text-[11px] text-slate-400">아버지 (F)</label>
                <input value={fatherPhone} onChange={(e) => setFatherPhone(e.target.value)} placeholder="010-" className={FIELD} />
              </div>
              <div className="w-36">
                <label className="mb-1 block text-[11px] text-slate-400" title="부모가 아닌 분(조부모·친척 등)">
                  보호자
                </label>
                <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="010-" className={FIELD} />
              </div>
              <div className="w-56">
                <label className="mb-1 block text-[11px] text-slate-400">보호자 이메일</label>
                <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} className={FIELD} />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-bold tracking-wide text-slate-400">그 외</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-36">
                <label className="mb-1 block text-[11px] text-slate-400">입학일 (첫 등교일)</label>
                <input type="date" value={enrolledOn} onChange={(e) => setEnrolledOn(e.target.value)} className={FIELD} />
              </div>
              <div className="w-28">
                {/* 목록에서 고릅니다. 악기는 학교가 가르치는 것만 있고, 자유 글자로 두면
                    「바이올린」·「violin」·「바이올린(개인)」이 섞여 반을 셀 수 없게 됩니다. */}
                <label className="mb-1 block text-[11px] text-slate-400">악기</label>
                <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className={FIELD}>
                  <option value="">-</option>
                  {WR_INSTRUMENTS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-20">
                {/* 사이즈는 **적힌 그대로** 받습니다. 목록에서 고르게 하면 그 목록에 없는 값이
                    필요한 순간 사람은 화면 밖(엑셀·쪽지)으로 나갑니다. */}
                <label className="mb-1 block text-[11px] text-slate-400" title="의류 대장에 이번 학기 사이즈로 남습니다">
                  유니폼
                </label>
                <input value={uniformSize} onChange={(e) => setUniformSize(e.target.value)} placeholder="16호" className={FIELD} />
              </div>
              <div className="w-48">
                <label className="mb-1 block text-[11px] text-slate-400">알러지</label>
                <input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="없음 / 땅콩, 우유" className={FIELD} />
              </div>
              {/* 주소만 남은 자리를 다 씁니다 - 도로명 주소는 실제로 길고, 짧게 자르면
                  적는 사람이 자기가 뭘 적었는지 못 봅니다. */}
              <div className="min-w-64 flex-1">
                <label className="mb-1 block text-[11px] text-slate-400">주소</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} className={FIELD} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 pt-2.5">
            <button disabled={saving} className="rounded-lg bg-wr-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50">
              등록
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
              취소
            </button>
            {/* 고를 반이 하나도 없으면 **왜 못 고르는지** 말해줍니다. 비활성 칸만 남겨두면
                사람은 화면이 고장 난 줄 압니다. */}
            {formClasses.length === 0 && (
              <span className="text-[11px] font-semibold text-orange-600">
                {grade.trim() ? `${grade.trim()}에 등록된 반이 없습니다.` : "명부에 반이 없습니다."} 반/담임 배정에서 반을 먼저 만들어주세요.
              </span>
            )}
          </div>
        </form>
      )}

      {showBulk && (
        <div className="mb-3 shrink-0 g-panel-solid p-3">
          <p className="mb-1.5 text-[11px] text-slate-400">
            한 줄에 하나씩, &quot;이름,영어이름,학년,반,어머니,아버지,보호자&quot; 형식으로 붙여넣으세요. 이름 말고는 다 비워둬도 되고, 예전처럼 다섯 칸만 붙여넣으면 다섯 번째가 어머니 번호로 들어갑니다.
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
        <div className="mb-3 shrink-0 g-panel-solid p-3">
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

      {/* 학적 상태 탭(요청 ⑥) */}
      <div className="mb-2 flex shrink-0 flex-wrap gap-1">
        {([
          ["active", "재학", active.length],
          ["졸업", "졸업", graduated.length],
          ["퇴학", "퇴학·전출", withdrawn.length],
          ["보류", "보류", onHold.length],
          ["기타", "기타", others.length],
        ] as [typeof statusTab, string, number][])
          .filter(([key, , n]) => key === "active" || n > 0)
          .map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusTab(key)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition " +
                (statusTab === key ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-500 hover:text-slate-700")
              }
            >
              {label} {n}
            </button>
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto g-panel-solid">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-400 shadow-sm">
            <tr>
              <th className="whitespace-nowrap px-3 py-2" title="학생 고유코드(편집 불가) - 이 코드로 관련 자료를 찾습니다">학번(코드)</th>
              <SortTh label="학년" sortKeyFor="grade" />
              <SortTh label="반" sortKeyFor="class_name" />
              <SortTh label="이름" sortKeyFor="name" />
              <SortTh label="영어 이름" sortKeyFor="name_en" />
              <SortTh label="성별" sortKeyFor="gender" />
              <SortTh label="생일" sortKeyFor="birth_date" />
              {/*
                연락처를 세 칸으로 나눕니다. 집마다 청구서를 받는 분이 달라서 한 칸으로는
                누구 번호인지 알 수 없었습니다. 청구는 어머니 → 아버지 → 보호자 순으로
                있는 번호를 씁니다.
              */}
              {/* 보호자 연락처는 **행정실만** 봅니다.
                  교사에게는 공용 뷰로 자료가 오는데 그 뷰에 이 칸이 아예 없습니다 - 화면에서
                  가리는 것이 아니라 처음부터 오지 않습니다. 열까지 없애야 빈 칸 넷이 표를
                  가로로 늘리지 않습니다. */}
              {canEdit && (
                <>
                  <SortTh label="어머니(M)" sortKeyFor="mother_phone" />
                  <SortTh label="아버지(F)" sortKeyFor="father_phone" />
                  <SortTh label="보호자" sortKeyFor="parent_phone" />
                  <SortTh label="보호자 이메일" sortKeyFor="parent_email" />
                </>
              )}
              <SortTh label="주소" sortKeyFor="address" />
              <th className="whitespace-nowrap px-3 py-2">🚌 차량탑승</th>
              <SortTh label="악기" sortKeyFor="instrument" />
              <SortTh label="입학일" sortKeyFor="enrolled_on" />
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
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500" title="고유코드(편집 불가)">
                    {s.student_no || "-"}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-500">
                  <EditableCell value={s.grade ?? ""} onSave={(v) => updateField(s.id, "grade", v)} width="w-12" />
                </td>
                <td className="px-3 py-1.5 text-slate-500">
                  <EditableCell value={s.class_name ?? ""} onSave={(v) => updateClass(s.id, v)} width="w-16" />
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
                {canEdit && (
                  <>
                    <td className="px-3 py-1.5 text-slate-400">
                      <EditableCell value={s.mother_phone ?? ""} onSave={(v) => updateField(s.id, "mother_phone", v)} width="w-32" />
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">
                      <EditableCell value={s.father_phone ?? ""} onSave={(v) => updateField(s.id, "father_phone", v)} width="w-32" />
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">
                      <EditableCell value={s.parent_phone ?? ""} onSave={(v) => updateField(s.id, "parent_phone", v)} width="w-32" />
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">
                      <EditableCell value={s.parent_email ?? ""} onSave={(v) => updateField(s.id, "parent_email", v)} width="w-40" />
                    </td>
                  </>
                )}
                <td className="px-3 py-1.5 text-slate-400">
                  <EditableCell value={s.address ?? ""} onSave={(v) => updateField(s.id, "address", v)} width="w-40" />
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <select
                      defaultValue={s.shuttle_mode}
                      onChange={(e) => updateField(s.id, "shuttle_mode", e.target.value)}
                      className="rounded-lg border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300"
                    >
                      {SHUTTLE_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {s.shuttle_mode !== "없음" && (
                      <button
                        onClick={() => setRecommendFor(s)}
                        disabled={!s.address}
                        title={s.address ? "가까운 노선 추천받기" : "주소를 먼저 입력해주세요"}
                        className="shrink-0 rounded-lg border border-slate-300 px-1.5 py-1 text-[10px] text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                      >
                        추천
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-slate-500">
                  {/* 악기는 **고르게** 합니다. 자유 글자로 두면 「바이올린」·「violin」이 섞여
                      악기반 인원을 셀 수 없고, DB 의 허용 목록에도 걸려 저장이 실패합니다. */}
                  <select
                    value={s.instrument ?? ""}
                    onChange={(e) => void updateField(s.id, "instrument", e.target.value)}
                    disabled={!canEdit}
                    className="rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] hover:border-slate-300 disabled:cursor-default"
                  >
                    <option value="">-</option>
                    {WR_INSTRUMENTS.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-slate-400">
                  <EditableCell value={s.enrolled_on ?? ""} onSave={(v) => updateField(s.id, "enrolled_on", v)} width="w-24" />
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
                  {/* 학적 상태 변경(요청 ⑥: 재학/졸업/퇴학/보류). */}
                  <select
                    value={s.status ?? "active"}
                    onChange={(e) => setStudentStatus(s.id, e.target.value as WrStudent["status"])}
                    title="학적 상태"
                    className="mr-2 rounded-lg border border-slate-200 px-1.5 py-1 text-xs text-slate-600 hover:border-slate-300"
                  >
                    <option value="active">재학</option>
                    <option value="졸업">졸업</option>
                    <option value="퇴학">퇴학</option>
                    <option value="전출">전출</option>
                    <option value="보류">보류</option>
                    <option value="inactive">보관</option>
                  </select>
                  <button onClick={() => removeStudent(s.id)} className="text-xs text-red-400 hover:text-red-600">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={12 + fieldDefs.length} className="px-3 py-6 text-center text-slate-400">
                  {active.length === 0 ? "등록된 학생이 없습니다." : "이 조건에 맞는 학생이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {recommendFor && (
        <ShuttleRecommendModal
          student={recommendFor}
          routes={shuttleRoutes}
          stops={shuttleStops}
          onClose={() => setRecommendFor(null)}
          onStudentUpdated={(patch) => {
            setStudents((prev) => prev.map((s) => (s.id === recommendFor.id ? { ...s, ...patch } : s)));
            setRecommendFor((prev) => (prev ? { ...prev, ...patch } : prev));
          }}
        />
      )}
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
