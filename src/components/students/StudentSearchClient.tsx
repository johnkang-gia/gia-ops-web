"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { WrStudent } from "@/lib/types";

// 통합 학생 조회(요청 ⑤): 재학/졸업/퇴학 탭으로 나누고, 상단에 검색과 학년별 분포를 두어
// 한눈에 파악되게 합니다. 카드를 누르면 통합 프로필(/students/[id])로 이동합니다.
type Bucket = "active" | "graduated" | "withdrawn";

// 보관(inactive·보류) 학생과 유치부는 이 화면에 아예 나타나지 않습니다(요청: "재학생 명단에는
// 안뜨게... 아예 페이지에서 기록되지 않도록"). null을 돌려주면 어느 탭에도 들어가지 않습니다.
function bucketOf(status: string | null): Bucket | null {
  if (status === "졸업" || status === "graduated") return "graduated";
  if (status === "퇴학" || status === "전출" || status === "전출예정" || status === "withdrawn") return "withdrawn";
  if (status === "active" || status === "재학") return "active";
  return null; // inactive·보류 등 = 보관
}

const TAB_LABEL: Record<Bucket, string> = { active: "재학", graduated: "졸업", withdrawn: "퇴학·전출" };
const TAB_COLOR: Record<Bucket, string> = { active: "#7c3aed", graduated: "#0ea5e9", withdrawn: "#64748b" };

// 부서 탭(담당자: "이제 중고등부 명단도 넣어줬으니까 초등부·중고등부 탭을 나누고").
type Dept = "초등부" | "중고등부";

// 학년 숫자만 뽑습니다("2", "2학년", "8th Grade" → 2, 8). 못 읽으면 999(맨 뒤).
function gradeNum(grade: string | null | undefined): number {
  const m = String(grade ?? "").match(/\d{1,2}/);
  return m ? Number(m[0]) : 999;
}

// 명부의 department 칸을 먼저 믿고, 비어 있으면 학년 숫자로 정합니다.
// (예전 줄들은 department가 비어 있을 수 있어서, 그 아이들이 어느 탭에도 안 뜨면 안 됩니다.)
function deptOf(s: WrStudent): Dept {
  const d = (s.department as string | null) ?? "";
  if (d.includes("중") || d.includes("고")) return "중고등부";
  if (d.includes("초")) return "초등부";
  return gradeNum(s.grade) >= 7 ? "중고등부" : "초등부";
}

export default function StudentSearchClient({
  students,
  shuttleByStudent = {},
  photoUrlByPath = {},
}: {
  students: WrStudent[];
  /** 학생 id → 실제 배정된 노선("하원 9호"). 명부의 shuttle_mode가 아니라 실제 배정입니다. */
  shuttleByStudent?: Record<string, string>;
  /** 사진 경로 → 짧게 사는 서명 주소. 비공개 버킷이라 서버에서 묶어 받아옵니다. */
  photoUrlByPath?: Record<string, string>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Bucket>("active");
  const [dept, setDept] = useState<Dept>("초등부");
  // "전체"면 null. 담당자: "전체명단 해서 이렇게 뜨고, 전체탭 옆에 2학년 3학년 순으로."
  const [gradeTab, setGradeTab] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const byBucket = useMemo(() => {
    const m: Record<Bucket, WrStudent[]> = { active: [], graduated: [], withdrawn: [] };
    for (const s of students) {
      // 유치부·보관(inactive 등) 학생은 화면에 아예 나타나지 않습니다(요청).
      if (((s.department as string | null) ?? "").includes("유치")) continue;
      const b = bucketOf(s.status);
      if (b) m[b].push(s);
    }
    // 학년 오름차순 → 같은 학년 안에서 이름 오름차순(담당자 요청).
    for (const k of Object.keys(m) as Bucket[]) {
      m[k].sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || a.name.localeCompare(b.name, "ko"));
    }
    return m;
  }, [students]);

  // 부서까지 좁힌 목록 - 학년 탭과 인원수의 기준이 됩니다.
  const deptList = useMemo(() => byBucket[tab].filter((s) => deptOf(s) === dept), [byBucket, tab, dept]);
  const deptCount = useMemo(() => {
    const c: Record<Dept, number> = { 초등부: 0, 중고등부: 0 };
    for (const s of byBucket[tab]) c[deptOf(s)] += 1;
    return c;
  }, [byBucket, tab]);

  // 이 부서에 실제로 있는 학년만 탭으로 만듭니다(없는 학년 탭이 뜨면 눌러도 빈 화면입니다).
  const gradeTabs = useMemo(() => {
    const g = new Map<number, number>();
    for (const s of deptList) {
      const n = gradeNum(s.grade);
      g.set(n, (g.get(n) ?? 0) + 1);
    }
    return [...g.entries()].map(([n, count]) => ({ n, count })).sort((a, b) => a.n - b.n);
  }, [deptList]);

  const list = useMemo(
    () => (gradeTab == null ? deptList : deptList.filter((s) => gradeNum(s.grade) === gradeTab)),
    [deptList, gradeTab]
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return list;
    return list.filter((s) => s.name.includes(q) || (s.student_no ?? "").includes(q) || (s.name_en ?? "").toLowerCase().includes(q.toLowerCase()));
  }, [list, query]);

  return (
    <div className="flex flex-col gap-3">
      {/* 탭 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["active", "graduated", "withdrawn"] as Bucket[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                setTab(b);
                setGradeTab(null);
              }}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition " +
                (tab === b ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700")
              }
              style={tab === b ? { color: TAB_COLOR[b] } : undefined}
            >
              {TAB_LABEL[b]} <span className="tabular-nums">{byBucket[b].length}</span>
            </button>
          ))}
        </div>

        {/* 부서 탭. 초등 101명 + 중고등 36명이 한 덩어리로 쏟아지면 찾기가 어렵습니다. */}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["초등부", "중고등부"] as Dept[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDept(d);
                setGradeTab(null);
              }}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition " +
                (dept === d ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")
              }
            >
              {d} <span className="tabular-nums">{deptCount[d]}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // 결과가 한 명이면 Enter로 바로 그 학생 프로필로 갑니다. 이름을 다 치고 나서
          // 마우스로 카드를 한 번 더 누르는 동작이 매번 반복되던 자리입니다.
          onKeyDown={(e) => {
            if (e.key === "Enter" && results.length === 1) router.push(`/students/${results[0].id}`);
          }}
          placeholder="🔍 이름 · 학번 · 영문이름 (Enter로 바로 열기)"
          className="ml-auto w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-purple-400"
        />
      </div>

      {/* 학년 탭. 예전에는 학년별 막대그래프였는데, 보기만 되고 **누를 수가 없었습니다.**
          숫자를 보고 나서 그 학년만 보려면 결국 스크롤로 찾아야 했습니다. 인원수는 그대로
          보여주면서 누르면 걸러지도록 바꿨습니다 - 같은 자리에서 두 가지를 다 합니다. */}
      {gradeTabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 g-panel-solid p-2.5">
          <button
            type="button"
            onClick={() => setGradeTab(null)}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition " +
              (gradeTab == null ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            전체 <span className="tabular-nums">{deptList.length}</span>
          </button>
          {gradeTabs.map((g) => (
            <button
              key={g.n}
              type="button"
              onClick={() => setGradeTab(g.n)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition " +
                (gradeTab === g.n ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
              }
            >
              {g.n === 999 ? "학년 미지정" : `${g.n}학년`} <span className="tabular-nums">{g.count}</span>
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-400">
            {TAB_LABEL[tab]} {dept} {gradeTab == null ? "전체" : `${gradeTab}학년`} {results.length}명
          </span>
        </div>
      )}

      {/* 학생 그리드 */}
      {results.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">해당하는 학생이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((s) => (
            <Link
              key={s.id}
              href={`/students/${s.id}`}
              className="flex items-center justify-between gap-2 g-panel-solid px-3 py-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-purple-300 hover:shadow-md"
            >
              {/* 얼굴이 이름보다 빠릅니다. 전화를 받거나 아이를 인계할 때 특히 그렇습니다. */}
              <span className="h-[42px] w-[33px] shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-50">
                {s.photo_path && photoUrlByPath[s.photo_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 서명 주소라 next/image 대상이 아닙니다.
                  <img src={photoUrlByPath[s.photo_path]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[9px] text-slate-300">—</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-slate-800">{s.name}</span>
                  {s.name_en && <span className="truncate text-[11px] text-slate-400">{s.name_en}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                  <span>
                    {s.grade ? `${s.grade}학년` : ""} {s.class_name ? `${s.class_name}반` : ""}
                  </span>
                  {/* 셔틀 여부(요청 ⑨). **실제 배정**을 보여줍니다 - 명부에 적어둔 값이 아니라
                      그 아이가 실제로 어느 차에 올라 있는지. */}
                  {shuttleByStudent[s.id] ? (
                    <span className="rounded bg-amber-50 px-1 py-px text-[10px] font-bold text-amber-700">
                      🚌 {shuttleByStudent[s.id]}
                    </span>
                  ) : (
                    // 명부에는 "탄다"고 적혀 있는데 배정이 없는 경우. 이게 실제로 사고가 나는
                    // 자리입니다 - 그날 아무 차에도 안 실립니다.
                    s.shuttle_mode &&
                    s.shuttle_mode !== "없음" && (
                      <span
                        className="rounded bg-red-50 px-1 py-px text-[10px] font-bold text-red-600"
                        title={`명부에는 '${s.shuttle_mode}'으로 되어 있는데 배정된 노선이 없습니다. 셔틀 → 탑승 배정에서 확인해주세요.`}
                      >
                        🚌 배정 없음
                      </span>
                    )
                  )}
                </div>
              </div>
              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{s.student_no}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
