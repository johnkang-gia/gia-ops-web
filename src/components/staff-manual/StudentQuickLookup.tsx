"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Incident, WrClass, WrEnrollment, WrReport, WrStudent } from "@/lib/types";

type ProfileResponse = {
  student: WrStudent;
  currentClass: WrClass | null;
  enrollments: WrEnrollment[];
  reports: WrReport[];
  incidents: Incident[];
  termLabelMap: Record<string, string>;
  teacherNameMap: Record<string, string>;
};

function fmtDate(d: string | null) {
  return d || "-";
}

// 전화 응대 중 학부모/학생 관련 문의가 오면, 실무자매뉴얼을 검색하는 동시에 여기서 학생 이름/
// 학번을 검색해 바로 옆에서 기본 인적사항·학적사항·사건기록·리포트 이력을 볼 수 있게 한
// 위젯입니다. /students/[id] 페이지로 이동하지 않고 이 화면 안에서 바로 확인합니다.
export default function StudentQuickLookup({ students }: { students: WrStudent[] }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return students.filter((s) => s.name.includes(q) || s.student_no.includes(q)).slice(0, 20);
  }, [students, query]);

  async function openStudent(id: string) {
    setSelectedId(id);
    setProfile(null);
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/students/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "학생 정보를 불러오지 못했습니다.");
      } else {
        setProfile(data as ProfileResponse);
      }
    } catch {
      setError("학생 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function backToList() {
    setSelectedId(null);
    setProfile(null);
    setError("");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h2 className="mb-1 text-sm font-bold text-slate-700">🔎 학생 정보 조회</h2>
      <p className="mb-3 text-xs text-slate-500">
        전화 응대 중인 학생의 이름이나 학번을 검색하면, 인적사항·학적사항·사건기록·주간 학생
        관찰기록 이력을 옆에서 바로 확인할 수 있습니다.
      </p>

      {!selectedId ? (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="학생 이름 또는 학번으로 검색"
            className="mb-3 w-full shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex-1 overflow-y-auto">
            {query.trim() && results.length === 0 && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}
            <div className="flex flex-col gap-1.5">
              {results.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openStudent(s.id)}
                  className="flex items-center justify-between gap-2 g-panel-solid px-3 py-2.5 text-left shadow-sm transition hover:border-gia-navy hover:bg-gia-gold-soft/10"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">{s.name}</span>
                    <span className="text-xs text-slate-400">
                      {s.grade}학년 {s.class_name}반
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">{s.student_no}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <button onClick={backToList} className="mb-2 shrink-0 self-start text-xs text-slate-400 hover:text-slate-600">
            ← 검색으로
          </button>
          <div className="flex-1 overflow-y-auto pr-1">
            {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
            {profile && (
              <div className="flex flex-col gap-3">
                <div className="g-panel-solid p-3.5 shadow-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-800">{profile.student.name}</h3>
                    <span className="rounded-full bg-gia-gold-soft/40 px-2 py-0.5 text-[10px] font-semibold text-gia-navy">
                      {profile.student.student_no}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {profile.student.grade}학년 {profile.student.class_name}반
                    {profile.currentClass?.teacher_email &&
                      ` · 담임: ${profile.teacherNameMap[profile.currentClass.teacher_email] ?? profile.currentClass.teacher_email}`}
                  </p>
                  <Link href={`/students/${profile.student.id}`} className="mt-1 inline-block text-[11px] font-semibold text-blue-600 underline">
                    전체 프로필 페이지 열기 →
                  </Link>
                </div>

                <div className="g-panel-solid p-3.5 shadow-sm">
                  <h4 className="mb-1.5 text-xs font-bold text-slate-700">기본 인적사항</h4>
                  <dl className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between"><dt className="text-slate-400">생년월일</dt><dd>{fmtDate(profile.student.birth_date)}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-400">학생 연락처</dt><dd>{profile.student.phone || "-"}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-400">보호자 연락처</dt><dd>{profile.student.parent_phone || "-"}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-400">주소</dt><dd className="max-w-[60%] text-right">{profile.student.address || "-"}</dd></div>
                    {profile.student.note && (
                      <div className="flex justify-between"><dt className="text-slate-400">메모</dt><dd className="max-w-[60%] text-right">{profile.student.note}</dd></div>
                    )}
                  </dl>
                </div>

                <div className="g-panel-solid p-3.5 shadow-sm">
                  <h4 className="mb-1.5 text-xs font-bold text-slate-700">학적 이력</h4>
                  {profile.enrollments.length === 0 ? (
                    <p className="text-[11px] text-slate-400">등록된 재학 이력이 없습니다.</p>
                  ) : (
                    <div className="flex flex-col gap-1 text-[11px]">
                      {profile.enrollments.map((e) => (
                        <div key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1">
                          <span className="font-medium text-slate-600">{e.term_id ? profile.termLabelMap[e.term_id] ?? "학기 미상" : "학기 미상"}</span>
                          <span className="text-slate-500">
                            {e.grade}학년{" "}
                            {e.homeroom_teacher_email ? `· 담임 ${profile.teacherNameMap[e.homeroom_teacher_email] ?? e.homeroom_teacher_email}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="g-panel-solid p-3.5 shadow-sm">
                  <h4 className="mb-1.5 text-xs font-bold text-slate-700">📋 관련 사건기록 ({profile.incidents.length}건)</h4>
                  {profile.incidents.length === 0 ? (
                    <p className="text-[11px] text-slate-400">연결된 사건기록이 없습니다.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {profile.incidents.map((it) => (
                        <Link key={it.id} href="/records" className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] hover:bg-slate-50">
                          <span className="min-w-0 flex-1 truncate">{it.title}</span>
                          <span className="shrink-0 text-slate-400">{it.date}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div className="g-panel-solid p-3.5 shadow-sm">
                  <h4 className="mb-1.5 text-xs font-bold text-slate-700">📈 주간 학생 관찰기록 이력 ({profile.reports.length}건)</h4>
                  {profile.reports.length === 0 ? (
                    <p className="text-[11px] text-slate-400">작성된 주간 학생 관찰기록이 없습니다.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {profile.reports.slice(0, 10).map((r) => (
                        <Link
                          key={r.id}
                          href={`/weekly-report/students/${profile.student.id}`}
                          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] hover:bg-slate-50"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            [{r.subject}] {r.status === "published" ? "발행됨" : "임시저장"}
                          </span>
                          <span className="shrink-0 text-slate-400">{r.report_date}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
