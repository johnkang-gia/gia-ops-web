"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { genCaseId } from "@/lib/caseId";
import { useCollapsedPanel } from "@/lib/useCollapsedPanel";
import type { Incident, GiaSystem, Term, WrStudent } from "@/lib/types";
import AiSourcePanel from "@/components/ai/AiSourcePanel";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";
import CollapsedStrip from "@/components/common/CollapsedStrip";
import AutoGrowTextarea from "@/components/common/AutoGrowTextarea";

// 사건이 쌓일수록 목록이 끝없이 길어지지 않도록, 게시판처럼 페이지 단위로 잘라 보여줍니다.
const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "📋 사건기록이란?",
    lines: [
      "학생 관련 사건을 기록·검색합니다. 왼쪽에서 사건을 고르면 가운데에 상세 내용과 AI 제안(대응 방안/학부모 안내 등)이 나타납니다.",
      "\"+ 새 사건\"으로 새 기록을 작성하고, 관련 학생을 태그해두면 학생 통합 프로필에서도 확인할 수 있습니다.",
    ],
  },
];

type FormState = {
  date: string;
  title: string;
  detail: string;
  good: string;
  lack: string;
  suggest: string;
  owner: string;
  students: string;
  manual_cat: string;
  op_plan_cat: string;
  status: string;
  resolution_note: string;
};

function emptyForm(ownerDefault: string): FormState {
  return {
    date: new Date().toISOString().slice(0, 10),
    title: "",
    detail: "",
    good: "",
    lack: "",
    suggest: "",
    owner: ownerDefault,
    students: "",
    manual_cat: "",
    op_plan_cat: "",
    status: "",
    resolution_note: "",
  };
}

// 자주 쓰는 사건 유형별 시작 틀입니다(요청: "다른 업무툴 대비 기능제안"에서 나온 "자주 쓰는
// 사건/문서 양식 템플릿" 제안 반영). 매번 빈 칸에서 시작하는 대신, 눌러서 제목/상세 내용에
// 기본 틀을 채워 넣고 그 위에 실제 내용만 채우면 됩니다 - 이미 있는 "AI로 채우기"(자유 메모를
// AI가 정리)와는 반대 방향의 보완재입니다(빈 칸을 어떻게 채워야 할지부터 막막할 때 씀).
const INCIDENT_TEMPLATES: { label: string; title: string; detail: string }[] = [
  {
    label: "🩹 안전사고(경미)",
    title: "안전사고 - ",
    detail: "언제/어디서:\n다친 학생:\n경위:\n응급처치 내용:\n보호자 연락 여부:\n",
  },
  {
    label: "🧑‍🤝‍🧑 교우관계/다툼",
    title: "교우관계 다툼 - ",
    detail: "관련 학생:\n장소/시간:\n경위(양측 진술):\n현재 관계 상태:\n",
  },
  {
    label: "📵 규칙 위반",
    title: "규칙 위반 - ",
    detail: "위반 내용:\n적발 경위:\n학생 반응:\n기존 지도 이력:\n",
  },
  {
    label: "📞 학부모 민원",
    title: "학부모 민원 - ",
    detail: "민원 접수 경로:\n민원 요지:\n1차 안내 내용:\n후속 조치 필요 여부:\n",
  },
];

function oneLine(text: string, maxLen = 40) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

// 왼쪽(목록) · 가운데(입력폼, 항상 표시) · 오른쪽(AI 제안) 3단 레이아웃입니다. 사건기록 →
// 제안함 → 채택예정을 오가지 않고, 새 사건을 적으면 바로 옆에서 AI 제안이 나타나 승인/발행까지
// 한 화면에서 끝낼 수 있습니다.
export default function IncidentsClient({
  initialItems,
  currentTerm,
  currentUserEmail,
  currentUserName,
  giaSystems,
}: {
  initialItems: Incident[];
  currentTerm: Term | null;
  currentUserEmail: string;
  currentUserName: string;
  // 매뉴얼(실무자용)/운영계획안(학부모용) 고정 항목 목록 - 요청("사건기록의 매뉴얼항목·
  // 운영계획안항목을 GIA시스템에 나온 항목으로 분류"에 대한 확인 답변 "GIA시스템 목록으로
  // 완전 대체")에 따라 policy_categories 대신 gia_systems(대분류>중분류>세부항목)에서
  // 골라서 태그합니다. GIA시스템에는 학부모용/실무자용 구분이 없어 두 드롭다운이 같은
  // 목록을 공유합니다(예: "비상연락망 및 위기대응체계"는 두 문서 어느 쪽에도 해당될 수 있음).
  giaSystems: GiaSystem[];
}) {
  // 요청: "항목들은 기본적으로 가나다순으로 정렬" - 대분류 순서 안에서는 중분류>세부항목 가나다순.
  const GIA_MAJOR_ORDER = ["재정", "인사·교직원", "학사", "운영", "시설·안전", "입학·홍보", "행정·문서", "정보보안·법무"];
  const giaSystemOptions = [...giaSystems].sort((a, b) => {
    const ia = GIA_MAJOR_ORDER.indexOf(a.major);
    const ib = GIA_MAJOR_ORDER.indexOf(b.major);
    if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    if (a.category !== b.category) return a.category.localeCompare(b.category, "ko");
    return a.name.localeCompare(b.name, "ko");
  });
  const giaSystemsByMajor = new Map<string, GiaSystem[]>();
  for (const g of giaSystemOptions) {
    const list = giaSystemsByMajor.get(g.major) ?? [];
    list.push(g);
    giaSystemsByMajor.set(g.major, list);
  }
  const [items, setItems] = useRealtimeTable<Incident>("incidents", initialItems);
  // 담당자 기본값은 로그인 이메일이 아니라 [내 계정 설정]에서 정한 표시 이름을 씁니다(이름이
  // 아직 없으면 이메일로 대체). 물론 자유 텍스트라 필요하면 그대로 고쳐 쓸 수 있습니다.
  const [form, setForm] = useState<FormState>(emptyForm(currentUserName || currentUserEmail));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSavedMsg, setJustSavedMsg] = useState("");
  const [filling, setFilling] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  // 요청: "좁게 사용하는 사람들이 있기 때문에... 사건목록이나 AI제안들의 탭을 접고 펼 수
  // 있도록 해주고, 개인별로 접은 부분 기억해서 다시 그 페이지로 돌아가도 계속 접혀있도록".
  // 왼쪽(목록)/오른쪽(AI 제안) 컬럼만 접을 수 있게 하고, 가운데 입력폼은 항상 보이게 둡니다.
  const [leftCollapsed, setLeftCollapsed] = useCollapsedPanel("incidents", "list", currentUserEmail);
  const [rightCollapsed, setRightCollapsed] = useCollapsedPanel("incidents", "ai", currentUserEmail);
  const gridColsClass =
    leftCollapsed && rightCollapsed
      ? "lg:grid-cols-[40px_1fr_40px]"
      : leftCollapsed
        ? "lg:grid-cols-[40px_1fr_340px]"
        : rightCollapsed
          ? "lg:grid-cols-[300px_1fr_40px]"
          : "lg:grid-cols-[300px_1fr_340px]";

  // 동명이인이 있어도 정확히 어느 학생인지 고유번호(student_no) 기준으로 연결하기 위한 상태입니다
  // (incidents.students 자유 텍스트는 그대로 두고, incident_students 조인 테이블에 실제 학생
  // 레코드를 별도로 연결합니다 - [학생 정보 조회] 화면에서 이 연결을 기준으로 모아봅니다).
  const [allStudents, setAllStudents] = useState<WrStudent[]>([]);
  const [linkedStudentIds, setLinkedStudentIds] = useState<string[]>([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [showStudentMenu, setShowStudentMenu] = useState(false);

  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page]
  );
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // 목록이 갱신되어(새 사건 저장 등) 전체 건수가 바뀌면 현재 보던 페이지가 더 이상 유효하지
  // 않을 수 있어 1페이지로 되돌립니다.
  useEffect(() => {
    setPage(1);
  }, [items.length]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("wr_students")
      .select("*").eq("is_demo", false)
      .eq("status", "active")
      .order("name", { ascending: true })
      .then(({ data }) => setAllStudents((data as WrStudent[] | null) ?? []));
  }, []);

  const studentMatches = useMemo(() => {
    const q = studentQuery.trim();
    if (!q) return [];
    return allStudents.filter((s) => s.name.includes(q) && !linkedStudentIds.includes(s.id)).slice(0, 8);
  }, [allStudents, studentQuery, linkedStudentIds]);

  function addLinkedStudent(s: WrStudent) {
    setLinkedStudentIds((prev) => [...prev, s.id]);
    setStudentQuery("");
    setShowStudentMenu(false);
  }

  function removeLinkedStudent(id: string) {
    setLinkedStudentIds((prev) => prev.filter((sid) => sid !== id));
  }

  async function syncIncidentStudents(incidentId: string) {
    const supabase = createClient();
    await supabase.from("incident_students").delete().eq("incident_id", incidentId);
    if (linkedStudentIds.length > 0) {
      await supabase
        .from("incident_students")
        .insert(linkedStudentIds.map((student_id) => ({ incident_id: incidentId, student_id })));
    }
  }

  function startNew() {
    setEditingId(null);
    setForm(emptyForm(currentUserName || currentUserEmail));
    setLinkedStudentIds([]);
    setStudentQuery("");
    setError("");
    setJustSavedMsg("");
  }

  async function fillFromDetail() {
    if (!form.detail.trim()) {
      setError("먼저 상세 내용(경위)을 입력해주세요.");
      return;
    }
    setFilling(true);
    setError("");
    const res = await fetch("/api/ai/fill-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ detail: form.detail, currentTitle: form.title }),
    });
    const data = await res.json();
    setFilling(false);
    if (!res.ok) {
      setError(data.error || "자동 채우기에 실패했습니다.");
      return;
    }
    const result = data.result as { date: string; title: string; good: string; lack: string; suggest: string };
    setForm((f) => ({
      ...f,
      date: result.date || f.date,
      title: result.title || f.title,
      good: result.good || f.good,
      lack: result.lack || f.lack,
      suggest: result.suggest || f.suggest,
    }));
  }

  // 요청: "한번 사건분석요청한 사건들은... 다시 분석하기를 눌러야만 재분석하도록" - 자동/일괄
  // 스캔은 고유번호(scanned_at) 기준으로 이미 분석된 건을 건너뛰지만, 사용자가 명시적으로
  // 이 버튼을 누르면 force:true로 재분석을 강제합니다(제안함에 이미 들어온 이전 제안은 새
  // 제안으로 대체됩니다).
  async function rescanIncident() {
    if (!editingId) return;
    setRescanning(true);
    setError("");
    setJustSavedMsg("");
    try {
      const res = await fetch("/api/ai/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "incidents", id: editingId, force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "다시 분석하지 못했습니다.");
      } else {
        setJustSavedMsg("다시 분석을 요청했습니다. 오른쪽 AI 제안이 곧 갱신됩니다.");
      }
    } catch {
      setError("다시 분석하지 못했습니다.");
    }
    setRescanning(false);
  }

  function startEdit(it: Incident) {
    setEditingId(it.id);
    setForm({
      date: it.date,
      title: it.title,
      detail: it.detail ?? "",
      good: it.good ?? "",
      lack: it.lack ?? "",
      suggest: it.suggest ?? "",
      owner: it.owner ?? "",
      students: it.students ?? "",
      manual_cat: it.manual_cat ?? "",
      op_plan_cat: it.op_plan_cat ?? "",
      status: it.status ?? "",
      resolution_note: it.resolution_note ?? "",
    });
    setStudentQuery("");
    setLinkedStudentIds([]);
    const supabase = createClient();
    supabase
      .from("incident_students")
      .select("student_id")
      .eq("incident_id", it.id)
      .then(({ data }) => setLinkedStudentIds(((data as { student_id: string }[] | null) ?? []).map((r) => r.student_id)));
    setError("");
    setJustSavedMsg("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    setJustSavedMsg("");
    const supabase = createClient();

    // 요청: "학생이름이나 학생의 정보들은 학생기록으로 무조건 통합관리 되도록" - 자유 텍스트로
    // 직접 타이핑하는 칸은 없애고, 위 검색 선택(고유번호로 정확히 연결)에서 고른 학생만
    // incidents.students(목록 표시용 요약 텍스트)에도 그대로 반영합니다. 즉 표시되는 이름은
    // 항상 실제 학생 레코드에서 나온 이름입니다.
    const studentsText = linkedStudentIds
      .map((id) => allStudents.find((s) => s.id === id)?.name)
      .filter((n): n is string => !!n)
      .join(", ");

    if (editingId) {
      const { data, error: err } = await supabase
        .from("incidents")
        .update({ ...form, students: studentsText })
        .eq("id", editingId)
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        setItems((prev) => prev.map((it) => (it.id === editingId ? (data as Incident) : it)));
        await syncIncidentStudents(editingId);
        setJustSavedMsg("수정되었습니다.");
      }
    } else {
      const { data, error: err } = await supabase
        .from("incidents")
        .insert({ ...form, students: studentsText, case_id: genCaseId("INC"), term_id: currentTerm?.id ?? null })
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        const saved = data as Incident;
        setItems((prev) => [saved, ...prev]);
        await syncIncidentStudents(saved.id);
        startNew();
        setJustSavedMsg("저장되었습니다. 오른쪽에 AI 제안이 곧 나타납니다.");
        // 저장 직후 바로 이 건에 대해서만 AI 분석을 실행해, 5건 단위 일괄 분석을 기다리지 않고
        // 오른쪽 패널에 즉시 제안이 뜨도록 합니다.
        fetch("/api/ai/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "incidents", id: saved.id }),
        }).catch(() => {});
      }
    }
    setSaving(false);
  }

  return (
    <div className={`grid h-full grid-cols-1 gap-4 overflow-y-auto ${gridColsClass} lg:overflow-hidden`}>
      {/* 왼쪽: 목록 - 계속 늘어지는 스크롤 대신 게시판처럼 페이지 번호로 넘겨봅니다 */}
      <div className="order-2 lg:order-1 lg:h-full lg:min-h-0">
        {leftCollapsed ? (
          <CollapsedStrip label={`사건 목록 (${items.length})`} onExpand={() => setLeftCollapsed(false)} />
        ) : (
          <div className="flex h-full flex-col gap-2 lg:min-h-0 lg:overflow-hidden">
            <div className="flex items-center justify-between">
              <h1 className="text-sm font-bold text-slate-700">사건 ({items.length}건)</h1>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={startNew}
                  className="rounded-lg bg-gia-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-gia-navy-2"
                >
                  + 새 사건
                </button>
                <GuideButton title="사건기록 사용 가이드" sections={GUIDE_SECTIONS} />
                <button
                  onClick={() => setLeftCollapsed(true)}
                  title="목록 접기"
                  className="rounded-lg border border-slate-300 px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
                >
                  ‹
                </button>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto lg:min-h-0">
              {items.length === 0 && (
                <div className="rounded-lg bg-white p-3 text-xs text-slate-400 shadow-sm">등록된 사건이 없습니다.</div>
              )}
              {pageItems.map((it) => (
                <button
                  key={it.id}
                  onClick={() => startEdit(it)}
                  className={
                    "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left shadow-sm transition " +
                    (editingId === it.id
                      ? "border-gia-navy bg-gia-gold-soft/20"
                      : "border-slate-200 bg-white hover:border-slate-300")
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{oneLine(it.title)}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">{it.date}</span>
                  </div>
                  {it.status && (
                    <span className="w-fit rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {it.status}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="shrink-0">
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          </div>
        )}
      </div>

      {/* 가운데: 입력폼 (항상 표시) - 요청: "새사건입력할때 밑으로 내려가면 아래로 화면을
          못내려" - 양옆 목록/AI제안 칸(lg:h-full lg:min-h-0)과 달리 이 칸에는 높이 제한이
          없어서, 데스크톱(lg:overflow-hidden인 바깥 grid)에서 폼이 화면보다 길어지면 아래
          내용(저장 버튼 포함)이 그냥 잘려나가고 스크롤도 안 됐습니다. 다른 두 칸과 같은
          패턴으로 이 칸 자체를 스크롤 가능하게 만들어 해결합니다. */}
      <div className="order-1 lg:order-2 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 g-panel-solid p-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">{editingId ? "사건 수정" : "새 사건 입력"}</h2>
            {editingId && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={rescanIncident}
                  disabled={rescanning}
                  title="이미 제안함에 들어온 제안이 있어도 새로 분석해 대체합니다."
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {rescanning ? "분석 중..." : "🔄 다시 분석"}
                </button>
                <button
                  type="button"
                  onClick={startNew}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  새로 작성하기
                </button>
              </div>
            )}
          </div>
          {!editingId && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">빠른 시작:</span>
              {INCIDENT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      title: f.title.trim() ? f.title : tpl.title,
                      detail: f.detail.trim() ? f.detail + "\n\n" + tpl.detail : tpl.detail,
                    }))
                  }
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              날짜
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              담당자
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            제목
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="예: 현장학습 중 학생 경미한 부상"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            <div className="flex items-center justify-between">
              <span>상세 내용(경위) - 두서없이 메모하듯 써도 됩니다</span>
              <button
                type="button"
                onClick={fillFromDetail}
                disabled={filling || !form.detail.trim()}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {filling ? "채우는 중..." : "🧹 AI로 채우기"}
              </button>
            </div>
            <AutoGrowTextarea
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              minRows={3}
              maxRows={10}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <p className="-mt-2 text-[11px] text-slate-400">
            위에 상황을 적고 &quot;AI로 채우기&quot;를 누르면 날짜·제목·잘된 점·부족했던 점·보완점을
            AI가 최대한 자동으로 채워줍니다(원문에 없는 내용은 비워둠 - 확인 후 수정하세요).
          </p>
          {[
            ["good", "잘된 점"],
            ["lack", "부족했던 점"],
            ["suggest", "보완점/제안"],
          ].map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-slate-500">
              {label}
              <AutoGrowTextarea
                value={form[key as keyof FormState]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                minRows={2}
                maxRows={10}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          ))}
          {/* 요청: "사건기록 새사건 입력할때 처리상태는 없애줘" - 새로 입력할 때는 처리상태
              칸을 보여주지 않습니다. 이미 처리상태가 적혀 있는 기존 기록을 수정할 때만(과거
              데이터가 남아있으므로) 계속 편집할 수 있게 둡니다. */}
          {editingId && (
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              처리상태
              <input
                type="text"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                placeholder="예: 처리중, 완료"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          )}

          {/* 요청: "사건이 어떻게 완료되었는지 적을 수 있는 조치사항 공간을 만들어줘 - 어떤
              조치를 취했는지 적을 수 있도록". good/lack/suggest(회고·제안)와 달리, 실제로
              무엇을 했는지를 남기는 칸입니다(업무탭 resolution_note와 같은 패턴). */}
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            조치사항 (어떤 조치를 취했는지)
            <AutoGrowTextarea
              value={form.resolution_note}
              onChange={(e) => setForm({ ...form, resolution_note: e.target.value })}
              minRows={3}
              maxRows={10}
              placeholder="예: 보건실에서 1차 처치 후 학부모에게 전화 안내, 병원 진료 동행, 재발 방지를 위해 담당 교사 안전교육 실시 등"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              매뉴얼 항목(실무자용)
              <select
                value={form.manual_cat}
                onChange={(e) => setForm({ ...form, manual_cat: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">(선택 안 함 - AI가 나중에 분류)</option>
                {[...giaSystemsByMajor.entries()].map(([major, items]) => (
                  <optgroup key={major} label={major}>
                    {items.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.category} · {g.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              운영계획안 항목(학부모용)
              <select
                value={form.op_plan_cat}
                onChange={(e) => setForm({ ...form, op_plan_cat: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">(선택 안 함 - AI가 나중에 분류)</option>
                {[...giaSystemsByMajor.entries()].map(([major, items]) => (
                  <optgroup key={major} label={major}>
                    {items.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.category} · {g.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          <div className="relative flex flex-col gap-1 text-xs text-slate-500">
            <span>관련 학생</span>
            {linkedStudentIds.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1.5">
                {linkedStudentIds.map((id) => {
                  const s = allStudents.find((st) => st.id === id);
                  return (
                    <span
                      key={id}
                      className="flex items-center gap-1 rounded-full bg-gia-gold-soft/40 px-2 py-0.5 text-[11px] font-medium text-gia-navy"
                    >
                      {s ? `${s.name} · ${s.grade}학년 ${s.class_name}반` : "(로딩중...)"}
                      <button
                        type="button"
                        onClick={() => removeLinkedStudent(id)}
                        className="text-slate-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              value={studentQuery}
              onChange={(e) => {
                setStudentQuery(e.target.value);
                setShowStudentMenu(true);
              }}
              onFocus={() => setShowStudentMenu(true)}
              placeholder="학생 이름을 입력하면 명부에서 찾아드립니다 (예: 백서아)"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            {showStudentMenu && studentMatches.length > 0 && (
              <div className="absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto g-panel-solid shadow-lg">
                {studentMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addLinkedStudent(s)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-[11px] text-slate-400">
                      {s.grade}학년 {s.class_name}반 · {s.student_no}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              직접 타이핑하지 않고 항상 이 목록에서 골라야, 같은 이름의 학생이 있어도 학년·반·학번까지
              정확히 구분되어 [학생 정보 조회]에서 그 학생 기록으로 자동으로 모입니다.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {justSavedMsg && <p className="text-sm text-emerald-600">{justSavedMsg}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
            >
              {saving ? "저장 중..." : editingId ? "수정 저장" : "저장"}
            </button>
          </div>
        </form>
      </div>

      {/* 오른쪽: AI 제안 */}
      <div className="order-3 lg:h-full lg:min-h-0">
        {rightCollapsed ? (
          <CollapsedStrip label="AI 제안" onExpand={() => setRightCollapsed(false)} />
        ) : (
          <div className="flex h-full flex-col gap-2 lg:min-h-0 lg:overflow-hidden">
            <div className="flex items-center justify-end">
              <button
                onClick={() => setRightCollapsed(true)}
                title="AI 제안 접기"
                className="rounded-lg border border-slate-300 px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
              >
                ›
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AiSourcePanel source="incidents" scanType="incidents" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
