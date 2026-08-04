"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errorMessage";

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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
    const { data: existing } = await supabase.from("wr_classes").select("id, grade, class_name");
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
        const { error } = await supabase.from("wr_classes").insert(payload);
        if (error) failed++;
        else created++;
      }
    }
    setImporting(false);
    setResult(`신규 ${created}개 · 업데이트 ${updated}개${failed ? ` · 실패 ${failed}개` : ""} 완료`);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
  parent_phone: string | null;
  ok: boolean;
  error?: string;
};

function parseStudentRow(cells: string[]): StudentRow {
  const [nameRaw, nameEnRaw, gradeRaw, classRaw, phoneRaw] = cells;
  const name = (nameRaw ?? "").trim();
  const errors: string[] = [];
  if (!name) errors.push("이름 없음");
  return {
    name,
    name_en: (nameEnRaw ?? "").trim() || null,
    grade: (gradeRaw ?? "").trim() || null,
    class_name: (classRaw ?? "").trim() || null,
    parent_phone: (phoneRaw ?? "").trim() || null,
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
    const { data: classes } = await supabase.from("wr_classes").select("id, grade, class_name");
    const payload = valid.map((r) => {
      const match = (classes ?? []).find((c) => (c.grade ?? "") === (r.grade ?? "") && (c.class_name ?? "") === (r.class_name ?? ""));
      return {
        name: r.name,
        name_en: r.name_en,
        grade: r.grade,
        class_name: r.class_name,
        class_id: match?.id ?? null,
        parent_phone: r.parent_phone,
        status: "active" as const,
      };
    });
    const { error } = await supabase.from("wr_students").insert(payload);
    setImporting(false);
    setResult(error ? friendlyError("등록하지 못했습니다.", error) : `${valid.length}명 등록 완료 (새 학생으로 추가됩니다 - 이미 등록된 학생과 이름이 같아도 중복 확인 없이 추가되니, 재등록이 아닌지 확인 후 실행해주세요).`);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-slate-800">🎓 학생 명부</h2>
      <p className="mb-2 text-[11px] text-slate-500">
        열 순서: <code className="rounded bg-slate-100 px-1">이름, 영어이름, 학년, 반, 보호자 연락처</code>
        (영어이름·보호자 연락처는 비워도 됩니다). 학년+반이 위 반 구성과 일치하면 자동으로 그 반에
        연결됩니다. 새 학생으로 추가되는 방식이라 이미 등록된 학생을 다시 올리면 중복 등록되니
        주의해주세요.
      </p>
      <pre className="mb-2 overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
{`이름,영어이름,학년,반,보호자 연락처
권태이,Tay Kwon,1,A,010-1234-5678
김사랑,Benecia Kim,1,A,`}
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
                <th className="px-2 py-1">보호자 연락처</th>
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

const TABS = [
  { key: "staff", label: "🧑‍🏫 교직원 명단" },
  { key: "class", label: "🏫 반 구성" },
  { key: "student", label: "🎓 학생 명부" },
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
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
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
    </div>
  );
}
