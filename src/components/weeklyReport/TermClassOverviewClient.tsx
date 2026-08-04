"use client";

import { useMemo, useState } from "react";
import type { Term, WrClass, WrStudent } from "@/lib/types";
import StudentReportBoard from "./StudentReportBoard";
import StudentsListClient from "./StudentsListClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🎓 반별 작성 현황이란?",
    lines: [
      "현재 학기를 상단에 표시하고, 그 아래 반별 위젯에서 학생별 이번 주 리포트 작성 뱃지(✅ 발행됨/📝 임시저장/미작성)를 한눈에 확인합니다.",
      "\"전체 목록\" 탭을 누르면 예전처럼 전교생을 표 형태(이름/학년/반/보호자 연락처 검색)로 볼 수 있습니다.",
    ],
  },
];

type ClassGroup = { cls: WrClass; teacherName: string; students: WrStudent[] };

// 관리자/행정직원이 [주간 학생 관찰기록 > 반별 작성 현황]에 들어왔을 때 첫 화면입니다. 예전에는
// 전교생을 한 표로만 보여줘서 "이번 주 어느 반이 아직 안 썼는지"를 알려면 반마다 필터를 걸어야
// 했는데, 지금은 현재 학기를 맨 위에 크게 보여주고 그 아래 반별로 위젯을 나눠, 위젯 안에서
// 학생별 작성 뱃지(✅ 발행됨/📝 임시저장/미작성)를 바로 볼 수 있습니다. 예전 "전체 목록"
// 화면(표 형태, 이름/학년/반/보호자 연락처 검색)도 탭으로 그대로 남겨뒀습니다.
export default function TermClassOverviewClient({
  term,
  classGroups,
  unassigned,
  allStudents,
  userEmail,
}: {
  term: Term | null;
  classGroups: ClassGroup[];
  unassigned: WrStudent[];
  allStudents: WrStudent[];
  userEmail: string;
}) {
  const [view, setView] = useState<"widget" | "list">("widget");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!q) return classGroups;
    return classGroups
      .map((g) => ({ ...g, students: g.students.filter((s) => s.name.toLowerCase().includes(q) || (s.name_en ?? "").toLowerCase().includes(q)) }))
      .filter((g) => g.students.length > 0);
  }, [classGroups, q]);

  const filteredUnassigned = useMemo(() => {
    if (!q) return unassigned;
    return unassigned.filter((s) => s.name.toLowerCase().includes(q) || (s.name_en ?? "").toLowerCase().includes(q));
  }, [unassigned, q]);

  const isEmpty = classGroups.length === 0 && unassigned.length === 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 text-center">
        {term ? (
          <div className="text-xl font-extrabold tracking-tight text-slate-800 sm:text-2xl">
            📅 {term.year} {term.term_type}
          </div>
        ) : (
          <div className="text-sm text-slate-400">
            진행중인 학기가 없습니다. 학교관리 &gt; 학기 관리에서 학기를 먼저 시작해주세요.
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">반별로 이번 주 담임 리포트 작성 현황을 확인하세요.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button
            onClick={() => setView("widget")}
            className={
              "rounded-md px-3 py-1.5 text-xs font-semibold transition " +
              (view === "widget" ? "bg-wr-primary text-white" : "text-slate-500 hover:bg-slate-50")
            }
          >
            🎓 반별 작성 현황
          </button>
          <button
            onClick={() => setView("list")}
            className={
              "rounded-md px-3 py-1.5 text-xs font-semibold transition " +
              (view === "list" ? "bg-wr-primary text-white" : "text-slate-500 hover:bg-slate-50")
            }
          >
            📋 전체 목록
          </button>
        </div>
        <div className="flex items-center gap-2">
          {view === "widget" && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="학생 이름으로 검색..."
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          )}
          <GuideButton title="반별 작성 현황 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      {view === "list" ? (
        <StudentsListClient students={allStudents} />
      ) : isEmpty ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          등록된 반이나 학생이 없습니다. 학교관리 &gt; 반 관리/학생 관리에서 먼저 등록해주세요.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredGroups.map((g) => (
              <StudentReportBoard
                key={g.cls.id}
                students={g.students}
                term={term}
                userEmail={userEmail}
                mode="admin"
                subjectName="담임"
                title={`${g.cls.grade ?? "-"}학년 ${g.cls.class_name ?? "-"} (${g.students.length}명)`}
                meta={g.teacherName ? `담임 ${g.teacherName}` : undefined}
                emptyMessage="이 반에 배정된 학생이 없습니다."
              />
            ))}
          </div>

          {filteredUnassigned.length > 0 && (
            <StudentReportBoard
              students={filteredUnassigned}
              term={term}
              userEmail={userEmail}
              mode="admin"
              subjectName="담임"
              title={`반 미배정 학생 (${filteredUnassigned.length}명)`}
              meta="학교관리 > 반 관리에서 반을 배정해주세요."
            />
          )}
        </div>
      )}
    </div>
  );
}
