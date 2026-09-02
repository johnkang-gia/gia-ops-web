"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errorMessage";
import { TERM_TYPES } from "@/lib/termTypes";

// ===== 공용 파싱 유틸 =====
// 구글시트에서 셀 범위를 복사해서 붙여넣으면 탭(\t)으로 구분되고, CSV 파일을 업로드하면
// 쉼표(,)로 구분됩니다 - 첫 줄을 보고 자동으로 구분자를 판단합니다.
function parseRows(text: string, skipHeader: boolean): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const rows = lines.map((l) => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, "")));
  return skipHeader ? rows.slice(1) : rows;
}

function readFileToText(file: File, onDone: (text: string) => void) {
  const reader = new FileReader();
  reader.onload = () => onDone(String(reader.result ?? ""));
  reader.readAsText(file, "utf-8");
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 16).replace("T", " ");
}

const inputCls = "min-h-[140px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs";
const btnPrimary =
  "rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50";

// ===== 1. 교직원 명단 =====
type StaffRow = {
  email: string;
  name: string;
  department: string | null;
  position: string;
  ok: boolean;
  error?: string;
};

function parseStaffRow(cells: string[]): StaffRow {
  const [emailRaw, nameRaw, deptRaw, posRaw] = cells;
  const email = (emailRaw ?? "").trim().toLowerCase();
  const name = (nameRaw ?? "").trim();
  const position = (posRaw ?? "").trim();
  const deptCandidate = (deptRaw ?? "").trim();
  const department = ["유치부", "초등부", "중고등부"].includes(deptCandidate) ? deptCandidate : null;

  const errors: string[] = [];
  if (!email || !email.endsWith("@giamicro.com")) errors.push("이메일이 @giamicro.com 형식이 아님");
  if (!name) errors.push("이름 없음");
  if (!["교사", "행정직원", "관리자"].includes(position)) errors.push("직위는 교사/행정직원/관리자 중 하나여야 함");

  return { email, name, department, position, ok: errors.length === 0, error: errors.join(", ") };
}

function StaffImportSection({ adminEmail }: { adminEmail: string }) {
  const [text, setText] = useState("");
  const [skipHeader, setSkipHeader] = useState(true);
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const validCount = rows?.filter((r) => r.ok).length ?? 0;

  function preview() {
    const parsed = parseRows(text, skipHeader).map(parseStaffRow);
    setRows(parsed);
    setResult(null);
  }

  async function doImport() {
    if (!rows) return;
    const valid = rows.filter((r) => r.ok);
    if (valid.length === 0) return;
    setImporting(true);
    const supabase = createClient();
    const payload = valid.map((r) => ({
      email: r.email,
      name: r.name,
      department: r.department,
      position: r.position,
      status: "approved",
      decided_by: adminEmail,
      decided_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("app_users").upsert(payload, { onConflict: "email" });
    setImporting(false);
    setResult(error ? friendlyError("반영하지 못했습니다.", error) : `${valid.length}명 반영 완료. 이후 본인 계정으로 로그인하면 승인 과정 없이 바로 사용할 수 있습니다.`);
  }

  return (
    <div className="g-panel-solid p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-slate-800">🧑‍🏫 교직원 명단</h2>
      <p className="mb-2 text-[11px] text-slate-500">
        열 순서: <code className="rounded bg-slate-100 px-1">이메일, 이름, 소속, 직위</code> (소속은
        유치부/초등부/중고등부, 직위는 교사/행정직원/관리자). 이메일은 반드시 @giamicro.com 이어야
        하고, 이미 등록된 이메일은 정보가 덮어쓰기 됩니다. 여기서 미리 등록해두면 해당 선생님이
        나중에 구글 계정으로 처음 로그인할 때 승인 대기 없이 바로 시스템을 쓸 수 있습니다.
      </p>
      <pre className="mb-2 overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
{`이메일,이름,소속,직위
aimie@giamicro.com,Aimie,유치부,교사
johndoe@giamicro.com,John Doe,행정직원,행정직원`}
      </pre>
      <textarea value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="여기에 구글시트 표를 붙여넣으세요 (또는 아래에서 CSV 파일 선택)" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFileToText(f, setText);
          }}
          className="text-xs"
        />
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" checked={skipHeader} onChange={(e) => setSkipHeader(e.target.checked)} />
          첫 줄은 제목행(건너뛰기)
        </label>
        <button type="button" onClick={preview} disabled={!text.trim()} className={btnGhost}>
          미리보기
        </button>
        <button type="button" onClick={doImport} disabled={importing || validCount === 0} className={btnPrimary}>
          {importing ? "반영 중..." : `${validCount}명 가져오기`}
        </button>
      </div>

      {rows && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="px-2 py-1">이메일</th>
                <th className="px-2 py-1">이름</th>
                <th className="px-2 py-1">소속</th>
                <th className="px-2 py-1">직위</th>
                <th className="px-2 py-1">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={"border-t border-slate-100 " + (r.ok ? "" : "bg-red-50")}>
                  <td className="px-2 py-1">{r.email || "-"}</td>
                  <td className="px-2 py-1">{r.name || "-"}</td>
                  <td className="px-2 py-1">{r.department || "-"}</td>
                  <td className="px-2 py-1">{r.position || "-"}</td>
                  <td className="px-2 py-1">
                    {r.ok ? <span className="text-emerald-600">✓ 정상</span> : <span className="text-red-500">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <p className="mt-2 text-xs font-semibold text-slate-600">{result}</p>}
    </div>
  );
}

// ===== 2. 반 구성 (담임/부담임) =====
type ClassRow = {
  grade: string;
  class_name: string;
  teacher_email: string | null;
  sub_teacher_email: string | null;
  ok: boolean;
  error?: string;
};

function parseClassRow(cells: string[]): ClassRow {
  const [gradeRaw, classRaw, teacherRaw, subRaw] = cells;
  const grade = (gradeRaw ?? "").trim();
  const class_name = (classRaw ?? "").trim();
  const teacher_email = (teacherRaw ?? "").trim().toLowerCase() || null;
  const sub_teacher_email = (subRaw ?? "").trim().toLowerCase() || null;

  const errors: string[] = [];
  if (!grade) errors.push("학년 없음");
  if (!class_name) errors.push("반 이름 없음");
  if (teacher_email && !teacher_email.includes("@")) errors.push("담임 이메일 형식 오류");
  if (sub_teacher_email && !sub_teacher_email.includes("@")) errors.push("부담임 이메일 형식 오류");

  return { grade, class_name, teacher_email, sub_teacher_email, ok: errors.length === 0, error: errors.join(", ") };
}

function ClassImportSection() {
  const [text, setText] = useState("");
  const [skipHeader, setSkipHeader] = useState(true);
  const [rows, setRows] = useState<ClassRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const validCount = rows?.filter((r) => r.ok).length ?? 0;

  function preview() {
    const parsed = parseRows(text, skipHeader).map(parseClassRow);
    setRows(parsed);
    setResult(null);
  }

  async function doImport() {
    if (!rows) return;
    const valid = rows.filter((r) => r.ok);
    if (valid.length === 0) return;
    setImporting(true);
    const supabase = createClient();
    const { data: existing } = await supabase.from("wr_classes").select("id, grade, class_name").eq("is_demo", false);
    let created = 0;
    let updated = 0;
    let failed = 0;
    for (const r of valid) {
      const match = (existing ?? []).find((c) => (c.grade ?? "") === r.grade && (c.class_name ?? "") === r.class_name);
      const payload = { grade: r.grade, class_name: r.class_name, teacher_email: r.teacher_email, sub_teacher_email: r.sub_teacher_email };
      if (match) {
        const { error } = await supabase.from("wr_classes").update(payload).eq("id", match.id);
        if (error) failed++;
        else updated++;
      } else {
        const { error } = await supabase.from("wr_classes").insert({ ...payload, is_demo: false });
        if (error) failed++;
        else created++;
      }
    }
    setImporting(false);
    setResult(`신규 ${created}개 · 업데이트 ${updated}개${failed ? ` · 실패 ${failed}개` : ""} 완료`);
  }

  return (
    <div className="g-panel-solid p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-slate-800">🏫 반 구성 (담임 · 부담임)</h2>
      <p className="mb-2 text-[11px] text-slate-500">
        열 순서: <code className="rounded bg-slate-100 px-1">학년, 반, 담임 이메일, 부담임 이메일</code>
        (부담임은 비워도 됩니다). 이미 있는 학년+반 조합이면 담임/부담임 정보를 갱신하고, 없으면 새로
        만듭니다. 담임/부담임 이메일은 위 교직원 명단에 먼저 등록해두시면 이름이 바로 매칭됩니다.
      </p>
      <pre className="mb-2 overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
{`학년,반,담임 이메일,부담임 이메일
1,A,aimie@giamicro.com,crystal@giamicro.com
2,Y,yunsang@giamicro.com,`}
      </pre>
      <textarea value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="여기에 구글시트 표를 붙여넣으세요 (또는 아래에서 CSV 파일 선택)" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFileToText(f, setText);
          }}
          className="text-xs"
        />
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" checked={skipHeader} onChange={(e) => setSkipHeader(e.target.checked)} />
          첫 줄은 제목행(건너뛰기)
        </label>
        <button type="button" onClick={preview} disabled={!text.trim()} className={btnGhost}>
          미리보기
        </button>
        <button type="button" onClick={doImport} disabled={importing || validCount === 0} className={btnPrimary}>
          {importing ? "반영 중..." : `${validCount}개 반 가져오기`}
        </button>
      </div>

      {rows && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="px-2 py-1">학년</th>
                <th className="px-2 py-1">반</th>
                <th className="px-2 py-1">담임</th>
                <th className="px-2 py-1">부담임</th>
                <th className="px-2 py-1">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={"border-t border-slate-100 " + (r.ok ? "" : "bg-red-50")}>
                  <td className="px-2 py-1">{r.grade || "-"}</td>
                  <td className="px-2 py-1">{r.class_name || "-"}</td>
                  <td className="px-2 py-1">{r.teacher_email || "-"}</td>
                  <td className="px-2 py-1">{r.sub_teacher_email || "-"}</td>
                  <td className="px-2 py-1">
                    {r.ok ? <span className="text-emerald-600">✓ 정상</span> : <span className="text-red-500">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <p className="mt-2 text-xs font-semibold text-slate-600">{result}</p>}
    </div>
  );
}

// ===== 3. 학생 명부 =====
type StudentRow = {
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  mother_phone: string | null;
  father_phone: string | null;
  parent_phone: string | null;
  ok: boolean;
  error?: string;
};

/**
 * 한 줄을 학생 하나로 읽습니다.
 *
 * 다섯 번째 칸은 **어머니** 번호로 봅니다. 예전 양식(이름·영어이름·학년·반·보호자연락처)을
 * 그대로 붙여넣는 분이 있는데, 그 번호는 거의 어머니 것이라 그렇게 두는 편이 붙여넣은 사람의
 * 뜻에 가깝습니다. 여섯·일곱 번째 칸(아버지·보호자)은 비워도 됩니다.
 */
function parseStudentRow(cells: string[]): StudentRow {
  const [nameRaw, nameEnRaw, gradeRaw, classRaw, motherRaw, fatherRaw, guardianRaw] = cells;
  const name = (nameRaw ?? "").trim();
  const errors: string[] = [];
  if (!name) errors.push("이름 없음");
  return {
    name,
    name_en: (nameEnRaw ?? "").trim() || null,
    grade: (gradeRaw ?? "").trim() || null,
    class_name: (classRaw ?? "").trim() || null,
    mother_phone: (motherRaw ?? "").trim() || null,
    father_phone: (fatherRaw ?? "").trim() || null,
    parent_phone: (guardianRaw ?? "").trim() || null,
    ok: errors.length === 0,
    error: errors.join(", "),
  };
}

function StudentImportSection() {
  const [text, setText] = useState("");
  const [skipHeader, setSkipHeader] = useState(true);
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const validCount = rows?.filter((r) => r.ok).length ?? 0;

  function preview() {
    const parsed = parseRows(text, skipHeader).map(parseStudentRow);
    setRows(parsed);
    setResult(null);
  }

  async function doImport() {
    if (!rows) return;
    const valid = rows.filter((r) => r.ok);
    if (valid.length === 0) return;
    setImporting(true);
    const supabase = createClient();
    const { data: classes } = await supabase.from("wr_classes").select("id, grade, class_name").eq("is_demo", false);
    const payload = valid.map((r) => {
      const match = (classes ?? []).find((c) => (c.grade ?? "") === (r.grade ?? "") && (c.class_name ?? "") === (r.class_name ?? ""));
      return {
        name: r.name,
        name_en: r.name_en,
        grade: r.grade,
        class_name: r.class_name,
        class_id: match?.id ?? null,
        mother_phone: r.mother_phone,
        father_phone: r.father_phone,
        parent_phone: r.parent_phone,
        status: "active" as const,
      };
    });
    const { error } = await supabase.from("wr_students").insert(payload.map((r) => ({ ...r, is_demo: false })));
    setImporting(false);
    setResult(error ? friendlyError("등록하지 못했습니다.", error) : `${valid.length}명 등록 완료 (새 학생으로 추가됩니다 - 이미 등록된 학생과 이름이 같아도 중복 확인 없이 추가되니, 재등록이 아닌지 확인 후 실행해주세요).`);
  }

  return (
    <div className="g-panel-solid p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-slate-800">🎓 학생 명부</h2>
      <p className="mb-2 text-[11px] text-slate-500">
        열 순서: <code className="rounded bg-slate-100 px-1">이름, 영어이름, 학년, 반, 어머니, 아버지, 보호자</code>
        (이름 말고는 다 비워도 됩니다. 다섯 번째 칸은 <b>어머니</b> 번호로 들어가고, 마지막
        &lsquo;보호자&rsquo;는 부모가 아닌 분을 위한 자리입니다). 학년+반이 위 반 구성과 일치하면 자동으로 그 반에
        연결됩니다. 새 학생으로 추가되는 방식이라 이미 등록된 학생을 다시 올리면 중복 등록되니
        주의해주세요.
      </p>
      <pre className="mb-2 overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
{`이름,영어이름,학년,반,어머니,아버지,보호자
권태이,Tay Kwon,1,A,010-1234-5678,010-2222-3333,
김사랑,Benecia Kim,1,A,,,010-9999-0000`}
      </pre>
      <textarea value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="여기에 구글시트 표를 붙여넣으세요 (또는 아래에서 CSV 파일 선택)" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFileToText(f, setText);
          }}
          className="text-xs"
        />
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" checked={skipHeader} onChange={(e) => setSkipHeader(e.target.checked)} />
          첫 줄은 제목행(건너뛰기)
        </label>
        <button type="button" onClick={preview} disabled={!text.trim()} className={btnGhost}>
          미리보기
        </button>
        <button type="button" onClick={doImport} disabled={importing || validCount === 0} className={btnPrimary}>
          {importing ? "반영 중..." : `${validCount}명 가져오기`}
        </button>
      </div>

      {rows && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="px-2 py-1">이름</th>
                <th className="px-2 py-1">영어이름</th>
                <th className="px-2 py-1">학년</th>
                <th className="px-2 py-1">반</th>
                <th className="px-2 py-1">어머니(M)</th>
                <th className="px-2 py-1">아버지(F)</th>
                <th className="px-2 py-1">보호자</th>
                <th className="px-2 py-1">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={"border-t border-slate-100 " + (r.ok ? "" : "bg-red-50")}>
                  <td className="px-2 py-1">{r.name || "-"}</td>
                  <td className="px-2 py-1">{r.name_en || "-"}</td>
                  <td className="px-2 py-1">{r.grade || "-"}</td>
                  <td className="px-2 py-1">{r.class_name || "-"}</td>
                  <td className="px-2 py-1">{r.mother_phone || "-"}</td>
                  <td className="px-2 py-1">{r.father_phone || "-"}</td>
                  <td className="px-2 py-1">{r.parent_phone || "-"}</td>
                  <td className="px-2 py-1">
                    {r.ok ? <span className="text-emerald-600">✓ 정상</span> : <span className="text-red-500">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <p className="mt-2 text-xs font-semibold text-slate-600">{result}</p>}
    </div>
  );
}

// ===== 4. 신청서(구글폼 연동) - 학기/행사 신청 가져오기 =====
// 요청("구글폼으로 보통 새로운 학기 등록 신청을 받거나, 행사 신청을 받거나 하는데... 구글폼에
// 링크된 구글시트를 연결하면, 분석해서... 구글폼 형식도 매번 비슷하니까 기억했다가 바로 다시
// 사용할 수 있도록 학기,이벤트 별로 저장할 수 있도록"). 위 세 섹션과 달리 열 순서가 고정돼
// 있지 않아서(구글폼마다 질문이 다름), 붙여넣은 표의 제목 행을 보고 표준 항목에 매칭한 뒤 그
// 매칭 규칙을 템플릿으로 저장합니다. 다음에 같은 폼(=같은 열 제목)에서 받은 시트를 붙여넣으면
// 저장된 템플릿을 자동으로 찾아서 매칭을 다시 안 해도 됩니다.
type FormKind = "term" | "event";

type FormTemplateRow = {
  id: string;
  name: string;
  kind: FormKind;
  year: string;
  term_type: string;
  purpose: string;
  headers: string[];
  column_mapping: Record<string, string>;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
};

type FormSubmissionRow = {
  id: string;
  template_id: string | null;
  kind: FormKind;
  year: string;
  term_type: string;
  purpose: string;
  term_id: string | null;
  event_id: string | null;
  mapped: Record<string, string>;
  imported_by: string;
  imported_at: string;
};

const FORM_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "(무시)" },
  { value: "name", label: "이름" },
  { value: "phone", label: "연락처" },
  { value: "email", label: "이메일" },
  { value: "grade", label: "학년" },
  { value: "class_pref", label: "반/희망사항" },
  { value: "birth_date", label: "생년월일" },
  { value: "submitted_at", label: "신청일시" },
  { value: "note", label: "메모/비고" },
  { value: "extra1", label: "기타1" },
  { value: "extra2", label: "기타2" },
  { value: "extra3", label: "기타3" },
];

// 구글폼 질문 제목에 자주 쓰이는 단어를 보고 표준 항목을 미리 추천합니다(완벽하진 않아도
// 처음 매칭할 때 대부분의 항목을 자동으로 채워줘서 확인만 하면 되게 합니다).
function suggestFormField(header: string): string {
  const h = header.trim().toLowerCase();
  const rules: [string, string[]][] = [
    ["name", ["이름", "성명", "학생명", "신청자", "성함"]],
    ["phone", ["연락처", "전화", "휴대폰", "휴대전화", "핸드폰"]],
    ["email", ["이메일", "email", "메일"]],
    ["grade", ["학년"]],
    ["class_pref", ["희망반", "반", "학급", "희망"]],
    ["birth_date", ["생년월일", "생일", "출생"]],
    ["submitted_at", ["타임스탬프", "timestamp", "제출일", "신청일시", "신청일", "작성일"]],
    ["note", ["메모", "비고", "특이사항", "문의", "기타사항"]],
  ];
  for (const [field, keywords] of rules) {
    if (keywords.some((k) => h.includes(k))) return field;
  }
  return "";
}

function normalizeHeaders(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join("|");
}

function FormApplicationImportSection({ adminEmail }: { adminEmail: string }) {
  const [kind, setKind] = useState<FormKind>("term");
  const [linkOptions, setLinkOptions] = useState<{ id: string; label: string }[]>([]);
  const [linkedId, setLinkedId] = useState("");
  const [templates, setTemplates] = useState<FormTemplateRow[]>([]);
  const [recent, setRecent] = useState<FormSubmissionRow[]>([]);

  // 붙여넣기 전에 먼저 선택하는 분류값입니다(요청: "구글시트 붙여넣기 전에 무슨학기의 어떤
  // 행사인지(예: 26년 3학기 인원모집, 26년 여름캠프2 바자회 행사) 선택해서"). year/term_type은
  // terms 관리 화면과 같은 값 체계를 씁니다 - 정적 목록 대신 "학기 관리"(terms) 화면에 실제로
  // 등록된 연도/학기를 그대로 선택지로 보여줍니다(요청: "지금 설정된 학기들이 가져오기
  // 학기선택에 반영되도록"). 아직 terms에 등록되지 않은 다음 연도/학기를 미리 준비하는
  // 경우도 있어서, "직접 입력"으로 벗어날 수 있는 길은 남겨뒀습니다.
  const [termsData, setTermsData] = useState<{ year: string; term_type: string }[]>([]);
  const [year, setYear] = useState("");
  const [termType, setTermType] = useState("");
  const [customYear, setCustomYear] = useState(false);
  const [customTermType, setCustomTermType] = useState(false);
  const [purpose, setPurpose] = useState("");
  const classifyReady = year.trim() !== "" && termType.trim() !== "" && purpose.trim() !== "";

  const yearOptions = useMemo(
    () => Array.from(new Set(termsData.map((t) => t.year))).sort((a, b) => b.localeCompare(a)),
    [termsData]
  );
  const termTypeOptionsForYear = useMemo(
    () => Array.from(new Set(termsData.filter((t) => t.year === year).map((t) => t.term_type))),
    [termsData, year]
  );
  // 선택한 연도로 등록된 학기가 하나도 없으면(아직 학기관리에서 만들지 않은 미래 연도 등)
  // 기존 표준 목록(TERM_TYPES)을 대신 보여줘서 처음 준비할 때도 고를 수 있게 합니다.
  const termTypeOptions = termTypeOptionsForYear.length > 0 ? termTypeOptionsForYear : TERM_TYPES;

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("terms")
      .select("year, term_type")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const rows = (data as { year: string; term_type: string }[] | null) ?? [];
        setTermsData(rows);
        if (rows.length > 0) {
          const years = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => b.localeCompare(a));
          setYear((prev) => prev || years[0]);
          const firstYearTypes = rows.filter((r) => r.year === years[0]).map((r) => r.term_type);
          setTermType((prev) => prev || firstYearTypes[0] || TERM_TYPES[0]);
        } else {
          setYear((prev) => prev || String(new Date().getFullYear()));
          setTermType((prev) => prev || TERM_TYPES[0]);
          setCustomYear(true);
        }
      });
  }, []);

  // 연도를 바꾸면 그 연도에 실제로 등록된 학기 목록도 바뀌므로, 지금 골라둔 학기타입이 새
  // 연도에는 없는 값이면 그 연도의 첫 옵션으로 자동으로 맞춰줍니다(직접 입력 중이면 유지).
  useEffect(() => {
    if (customTermType) return;
    if (termTypeOptionsForYear.length > 0 && !termTypeOptionsForYear.includes(termType)) {
      setTermType(termTypeOptionsForYear[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [templateName, setTemplateName] = useState("");
  const [matchedTemplateId, setMatchedTemplateId] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function loadForKind(k: FormKind) {
    const supabase = createClient();
    const { data: tpl } = await supabase
      .from("form_import_templates")
      .select("*")
      .eq("kind", k)
      .order("last_used_at", { ascending: false, nullsFirst: false });
    setTemplates((tpl as FormTemplateRow[]) ?? []);

    const { data: subs } = await supabase
      .from("form_submissions")
      .select("*")
      .eq("kind", k)
      .order("imported_at", { ascending: false })
      .limit(20);
    setRecent((subs as FormSubmissionRow[]) ?? []);

    if (k === "term") {
      const { data } = await supabase.from("terms").select("id, term_type, year").order("year", { ascending: false }).limit(30);
      setLinkOptions(((data as { id: string; term_type: string; year: string }[]) ?? []).map((t) => ({ id: t.id, label: `${t.year} ${t.term_type}` })));
    } else {
      const { data } = await supabase.from("events").select("id, name, date").order("date", { ascending: false }).limit(30);
      setLinkOptions(((data as { id: string; name: string; date: string }[]) ?? []).map((e) => ({ id: e.id, label: `${e.date} ${e.name}` })));
    }
  }

  useEffect(() => {
    setLinkedId("");
    setAnalyzed(false);
    setResult(null);
    loadForKind(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function analyze() {
    const all = parseRows(text, false);
    if (all.length < 1) return;
    const hdrs = all[0];
    const rows = all.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
    setHeaders(hdrs);
    setDataRows(rows);

    const norm = normalizeHeaders(hdrs);
    const matched = templates.find((t) => normalizeHeaders(t.headers) === norm);
    if (matched) {
      setMapping({ ...matched.column_mapping });
      setTemplateName(matched.name);
      setMatchedTemplateId(matched.id);
    } else {
      const suggested: Record<string, string> = {};
      hdrs.forEach((h) => {
        suggested[h] = suggestFormField(h);
      });
      setMapping(suggested);
      setTemplateName(`${year.trim()}년 ${termType.trim()} ${purpose.trim()}`.trim());
      setMatchedTemplateId(null);
    }
    setAnalyzed(true);
    setResult(null);
  }

  const mappedFieldCount = Object.values(mapping).filter(Boolean).length;

  async function doImport() {
    if (!classifyReady || !templateName.trim() || mappedFieldCount === 0 || dataRows.length === 0) return;
    setImporting(true);
    setResult(null);
    const supabase = createClient();

    const y = year.trim();
    const tt = termType.trim();
    const p = purpose.trim();

    let templateId = matchedTemplateId;
    if (templateId) {
      // 같은 형식(열 제목)의 폼을 재사용하는 경우입니다 - 매칭 규칙은 그대로 두고, 연도/목적은
      // "가장 최근 사용" 값으로 갱신해 템플릿 목록에서 최신 상태를 보여줍니다(개별 회차 기록은
      // 아래 form_submissions에 그대로 남아 이전 학기 기록 조회에 영향이 없습니다).
      await supabase
        .from("form_import_templates")
        .update({
          name: templateName.trim(),
          column_mapping: mapping,
          year: y,
          term_type: tt,
          purpose: p,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", templateId);
    } else {
      const { data, error } = await supabase
        .from("form_import_templates")
        .insert({
          name: templateName.trim(),
          kind,
          year: y,
          term_type: tt,
          purpose: p,
          headers,
          column_mapping: mapping,
          created_by: adminEmail,
          last_used_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error || !data) {
        setImporting(false);
        setResult(friendlyError("템플릿을 저장하지 못했습니다.", error));
        return;
      }
      templateId = (data as { id: string }).id;
    }

    const payload = dataRows.map((row) => {
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => {
        raw[h] = row[i] ?? "";
      });
      const mapped: Record<string, string> = {};
      headers.forEach((h, i) => {
        const field = mapping[h];
        if (field) mapped[field] = row[i] ?? "";
      });
      return {
        template_id: templateId,
        kind,
        // 회차별로 실제 선택한 연도/학기타입/목적을 그대로 저장합니다 - 템플릿은 재사용되며
        // "최근 사용" 값으로 갱신되지만, 이 값은 그때 그 회차의 기록으로 고정되어 학기준비
        // 화면에서 "지난 학기엔 이랬다"를 정확히 찾을 수 있습니다.
        year: y,
        term_type: tt,
        purpose: p,
        term_id: kind === "term" ? linkedId || null : null,
        event_id: kind === "event" ? linkedId || null : null,
        raw,
        mapped,
        imported_by: adminEmail,
      };
    });

    const { error: insertError } = await supabase.from("form_submissions").insert(payload);
    setImporting(false);
    if (insertError) {
      setResult(friendlyError("가져오지 못했습니다.", insertError));
      return;
    }
    setResult(
      `${payload.length}건 가져왔습니다. "${templateName.trim()}" 템플릿으로 저장했으니, 다음에 같은 형식의 시트를 붙여넣으면 자동으로 알아봅니다.`
    );
    setText("");
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setAnalyzed(false);
    setMatchedTemplateId(null);
    loadForKind(kind);
  }

  async function deleteTemplate(id: string) {
    const supabase = createClient();
    await supabase.from("form_import_templates").delete().eq("id", id);
    loadForKind(kind);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="g-panel-solid p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-slate-800">📋 신청서(구글폼) 가져오기</h2>
        <p className="mb-3 text-[11px] text-slate-500">
          새 학기 등록 신청이나 행사 참가 신청을 구글폼으로 받을 때, 폼에 연결된 응답 구글시트를 열어
          제목 행을 포함해 표 전체를 복사해서 아래에 붙여넣으세요(구글 계정 연동 없이 시트 내용을
          직접 붙여넣는 방식이라 별도 인증 없이 바로 쓸 수 있습니다). 열 제목을 분석해 이름/연락처/
          학년 같은 표준 항목에 자동으로 맞춰주고, 그 매칭을 템플릿으로 기억해뒀다가 다음에 같은
          형식의 시트를 붙여넣으면 바로 알아봅니다.
        </p>

        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-bold text-slate-600">
            ① 무슨 학기/행사의 신청서인가요? (예: 26년 3학기 인원모집, 26년 여름캠프2 바자회 행사)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 g-panel-solid p-1">
              {(["term", "event"] as FormKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={
                    "rounded-md px-3 py-1 text-xs font-semibold transition " +
                    (kind === k ? "bg-wr-primary text-white" : "text-slate-500 hover:bg-white")
                  }
                >
                  {k === "term" ? "🗓️ 학기 신청" : "🎉 행사 신청"}
                </button>
              ))}
            </div>
            {customYear || yearOptions.length === 0 ? (
              <input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="연도 (예: 2026)"
                className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
              />
            ) : (
              <select
                value={year}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomYear(true);
                    setYear("");
                  } else {
                    setYear(e.target.value);
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                title="학기 관리 화면에 등록된 연도 목록입니다"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
                <option value="__custom__">직접 입력...</option>
              </select>
            )}
            {customTermType ? (
              <input
                value={termType}
                onChange={(e) => setTermType(e.target.value)}
                placeholder="학기/캠프 직접 입력"
                className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
              />
            ) : (
              <select
                value={termType}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomTermType(true);
                    setTermType("");
                  } else {
                    setTermType(e.target.value);
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                title="선택한 연도에 학기 관리 화면에서 등록된 학기 목록입니다"
              >
                {termTypeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="__custom__">직접 입력...</option>
              </select>
            )}
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder={kind === "term" ? "목적 (예: 인원모집, 등록신청)" : "목적 (예: 바자회 행사 참가신청)"}
              className="min-w-[160px] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            />
          </div>
          {!classifyReady && (
            <p className="mt-2 text-[11px] font-semibold text-amber-600">
              연도/학기(또는 캠프)/목적을 모두 입력해야 아래에 붙여넣을 수 있습니다.
            </p>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={linkedId}
            onChange={(e) => setLinkedId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
          >
            <option value="">{kind === "term" ? "이미 등록된 학기에 연결(선택)" : "이미 등록된 행사에 연결(선택)"}</option>
            {linkOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAnalyzed(false);
          }}
          disabled={!classifyReady}
          className={inputCls + (classifyReady ? "" : " cursor-not-allowed bg-slate-50 text-slate-300")}
          placeholder={
            classifyReady
              ? "구글시트에서 제목 행을 포함해 표 전체를 복사해서 여기에 붙여넣으세요"
              : "먼저 위에서 연도/학기(또는 캠프)/목적을 선택하세요"
          }
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!classifyReady}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                readFileToText(f, (t) => {
                  setText(t);
                  setAnalyzed(false);
                });
            }}
            className="text-xs"
          />
          <button type="button" onClick={analyze} disabled={!classifyReady || !text.trim()} className={btnGhost}>
            분석하기
          </button>
        </div>

        {analyzed && (
          <div className="mt-3 rounded-lg border border-slate-100 p-3">
            {matchedTemplateId ? (
              <p className="mb-2 text-xs font-semibold text-emerald-600">
                ✓ 저장된 템플릿 &quot;{templateName}&quot;과 열 제목이 같아서 매칭을 그대로 불러왔습니다. 필요하면 아래에서 수정 후 저장하세요.
              </p>
            ) : (
              <p className="mb-2 text-xs font-semibold text-amber-600">
                처음 보는 형식이라 열 제목을 보고 최대한 자동으로 맞춰봤습니다. 확인 후 필요한 항목만 조정해주세요.
              </p>
            )}
            <label className="mb-2 block text-xs text-slate-500">
              템플릿 이름
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder={kind === "term" ? "예: 2026학년도 신학기 등록 신청" : "예: 체육대회 참가 신청"}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-400">
                  <tr>
                    <th className="px-2 py-1">구글폼 열 제목</th>
                    <th className="px-2 py-1">매칭할 항목</th>
                    <th className="px-2 py-1">예시 값</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono">{h || "(제목 없음)"}</td>
                      <td className="px-2 py-1">
                        <select
                          value={mapping[h] ?? ""}
                          onChange={(e) => setMapping((prev) => ({ ...prev, [h]: e.target.value }))}
                          className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                        >
                          {FORM_FIELD_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="max-w-[160px] truncate px-2 py-1 text-slate-400">{dataRows[0]?.[i] || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{dataRows.length}건 감지됨</p>
            <button
              type="button"
              onClick={doImport}
              disabled={importing || !classifyReady || !templateName.trim() || mappedFieldCount === 0 || dataRows.length === 0}
              className={btnPrimary + " mt-2"}
            >
              {importing ? "가져오는 중..." : `${dataRows.length}건 가져오기`}
            </button>
          </div>
        )}
        {result && <p className="mt-2 text-xs font-semibold text-slate-600">{result}</p>}
      </div>

      <div className="g-panel-solid p-4 shadow-sm">
        <h3 className="mb-2 text-xs font-bold text-slate-700">저장된 템플릿 ({templates.length})</h3>
        {templates.length === 0 ? (
          <p className="text-xs text-slate-400">아직 저장된 템플릿이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                <div>
                  <span className="font-semibold text-slate-700">{t.name}</span>
                  {(t.year || t.term_type || t.purpose) && (
                    <span className="ml-1.5 rounded bg-wr-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-wr-primary">
                      {[t.year && `${t.year}년`, t.term_type, t.purpose].filter(Boolean).join(" ")}
                    </span>
                  )}
                  <span className="ml-1.5 text-slate-400">
                    열 {t.headers.length}개 · {t.last_used_at ? `최근 사용 ${formatDate(t.last_used_at)}` : "미사용"}
                  </span>
                </div>
                <button type="button" onClick={() => deleteTemplate(t.id)} className="text-red-500 hover:underline">
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="g-panel-solid p-4 shadow-sm">
        <h3 className="mb-2 text-xs font-bold text-slate-700">최근 가져온 신청 (최대 20건)</h3>
        {recent.length === 0 ? (
          <p className="text-xs text-slate-400">아직 가져온 신청이 없습니다.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-400">
                <tr>
                  <th className="px-2 py-1">학기/목적</th>
                  <th className="px-2 py-1">이름</th>
                  <th className="px-2 py-1">연락처</th>
                  <th className="px-2 py-1">학년</th>
                  <th className="px-2 py-1">가져온 시각</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-500">
                      {[s.year && `${s.year}년`, s.term_type, s.purpose].filter(Boolean).join(" ") || "-"}
                    </td>
                    <td className="px-2 py-1">{s.mapped.name || "-"}</td>
                    <td className="px-2 py-1">{s.mapped.phone || "-"}</td>
                    <td className="px-2 py-1">{s.mapped.grade || "-"}</td>
                    <td className="px-2 py-1 text-slate-400">{formatDate(s.imported_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { key: "staff", label: "🧑‍🏫 교직원 명단" },
  { key: "class", label: "🏫 반 구성" },
  { key: "student", label: "🎓 학생 명부" },
  { key: "form", label: "📋 신청서(학기/행사)" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function SchoolImportClient({ adminEmail }: { adminEmail: string }) {
  const [tab, setTab] = useState<TabKey>("staff");

  const order = useMemo(
    () => "먼저 교직원 명단 → 반 구성 → 학생 명부 순서로 가져오시면 담임/부담임 이름과 반 연결이 한 번에 깔끔하게 맞습니다.",
    []
  );

  return (
    <div>
      <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">💡 {order}</p>
      <div className="mb-4 flex gap-1 g-panel-solid p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-md px-3 py-1.5 text-xs font-semibold transition " +
              (tab === t.key ? "bg-wr-primary text-white" : "text-slate-500 hover:bg-slate-50")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "staff" && <StaffImportSection adminEmail={adminEmail} />}
      {tab === "class" && <ClassImportSection />}
      {tab === "student" && <StudentImportSection />}
      {tab === "form" && <FormApplicationImportSection adminEmail={adminEmail} />}
    </div>
  );
}
