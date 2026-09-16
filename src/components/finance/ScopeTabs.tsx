"use client";

import { useEffect } from "react";
import { gradeSortKey } from "@/lib/department";
import { classesIn, fixScope, gradesIn, type Scope, type ScopeStudent } from "@/lib/gradeScope";

/**
 * **부서 → 학년 → 반**, 한 단씩 좁혀 보는 줄.
 *
 * 청구(학비)와 학비외가 **같은 덩어리**를 씁니다. 두 화면에 따로 만들면 한쪽에서 「2학년
 * 전체」가 되고 다른 쪽에서 안 되는데, 쓰는 사람은 같은 일을 하다가 화면만 옮긴 것이라
 * 그걸 고장으로 여깁니다.
 *
 * 값은 바깥이 들고 있습니다(controlled). 화면마다 그 값으로 하는 일이 다르기 때문입니다 -
 * 학비외는 고른 범위를 「이 반에 기본으로 붙이기」와 내려받는 파일 이름에도 씁니다.
 */
export default function ScopeTabs({
  dept,
  students,
  scope,
  onChange,
}: {
  /** 지금 부서 이름. 「초등부 전체」처럼 적어야 어느 전체인지 알 수 있습니다. */
  dept: string;
  /** **이미 부서로 걸러낸** 명단. 부서 판정은 화면마다 사정이 달라 바깥에 둡니다. */
  students: ScopeStudent[];
  scope: Scope;
  onChange: (next: Scope) => void;
}) {
  const grades = gradesIn(students, gradeSortKey);
  const classes = classesIn(students, scope.grade);

  // 좁혀둔 것이 없는 자리를 가리키면 풀어줍니다. 빈 표는 오류가 아니라 「학생이 없다」로
  // 읽히기 때문에, 그 상태로 두면 아무도 원인을 못 찾습니다.
  useEffect(() => {
    const fixed = fixScope(scope, grades, classes);
    if (fixed.grade !== scope.grade || fixed.klass !== scope.klass) onChange(fixed);
  });

  // 학년이 하나뿐인 부서(기타 등)에서는 줄 자체를 숨깁니다 - 고를 것이 없는 단추 줄은
  // 자리만 먹습니다.
  if (grades.length <= 1) return null;

  return (
    <div className="mb-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1 px-0.5">
        <span className="mr-0.5 w-6 shrink-0 text-[10px] font-bold text-slate-400">학년</span>
        <Chip on={!scope.grade} onClick={() => onChange({ grade: "", klass: "" })}>
          {dept} 전체
        </Chip>
        {grades.map((g) => (
          <Chip key={g} on={scope.grade === g} onClick={() => onChange({ grade: g, klass: "" })}>
            {g}
          </Chip>
        ))}
      </div>

      {/* 반 줄은 **학년을 고른 뒤에만** 뜹니다. 반을 전부 펼쳐두면 초등부만 열 개 넘게 한
          줄에 서서 정작 학년이 묻힙니다. */}
      {scope.grade && classes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-0.5">
          <span className="mr-0.5 w-6 shrink-0 text-[10px] font-bold text-slate-400">반</span>
          {/* 「학년 전체」가 먼저입니다 - 한 학년을 통째로 보는 일이 반을 고르는 것만큼
              잦고, 없으면 반을 눌러본 사람이 전체로 돌아올 길을 못 찾습니다. */}
          <Chip on={!scope.klass} onClick={() => onChange({ grade: scope.grade, klass: "" })}>
            {scope.grade} 전체
          </Chip>
          {classes.map((c) => (
            <Chip key={c} on={scope.klass === c} onClick={() => onChange({ grade: scope.grade, klass: c })}>
              {c}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-2.5 py-0.5 text-[11px] font-bold transition " +
        (on ? "bg-teal-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
      }
    >
      {children}
    </button>
  );
}
