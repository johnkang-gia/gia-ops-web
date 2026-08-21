"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang, useT } from "@/components/common/LanguageProvider";
import { departmentLabel, positionLabel } from "@/lib/i18nLabels";

const DEPARTMENTS = ["유치부", "초등부", "중고등부"] as const;
// "개발자" 직위는 시스템이 johnkang@giamicro.com 계정 전용으로 예약해두고 있어서, 다른
// 사람들에게는 선택지로 아예 보여주지 않습니다.
const POSITIONS = ["교사", "행정직원", "관리자"] as const;

export type OpenClass = { id: string; grade: string | null; className: string | null; teacherName: string | null };
export type OpenSubject = { id: string; name: string; teacherName: string | null };

// 가입 화면입니다. 소속·직위는 DB에 한글 값 그대로 저장하고 화면에만 영어 이름을 보여주므로,
// 영어로 가입해도 이후 권한 판정은 언어와 무관하게 똑같이 동작합니다.
//
// 요청: "교사와 교직원, 관리자를 선택했을 때 각각 다르게 아래에 나오도록" - 직위를 고르면 그
// 직위에만 필요한 항목이 아래에 이어서 나타납니다. 세 직위의 질문을 한꺼번에 늘어놓으면
// 대부분 자기와 상관없는 칸이라 무엇을 채워야 하는지 헷갈립니다.
export default function OnboardingForm({
  initialDepartment,
  initialPosition,
  openClasses,
  openSubjects,
}: {
  initialDepartment: string | null;
  initialPosition: string | null;
  // 아직 담임이 정해지지 않은 반 / 담당 교사가 없는 과목입니다. 이미 다른 선생님이 맡은 곳은
  // 애초에 목록에 없어서, 실수로 남의 반을 고를 수 없습니다.
  openClasses: OpenClass[];
  openSubjects: OpenSubject[];
}) {
  const router = useRouter();
  const t = useT();
  const { lang } = useLang();
  const [name, setName] = useState("");
  const [department, setDepartment] = useState<string>(initialDepartment ?? "");
  const [position, setPosition] = useState<string>(
    initialPosition && (POSITIONS as readonly string[]).includes(initialPosition) ? initialPosition : ""
  );
  const [duty, setDuty] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 입력한 이름과 명부에 적힌 담임 이름이 겹치는 반을 위로 올려줍니다. 명부에는 "Ms. Jaime"처럼
  // 영어 호칭으로 적혀 있어서, 이름 일부만 같아도 후보로 봅니다(호칭·성/이름 순서가 달라도 걸리도록).
  const suggestedClassId = useMemo(() => {
    const n = name.trim().toLowerCase().replace(/\s+/g, "");
    if (n.length < 2) return null;
    const hit = openClasses.find((c) => {
      const tn = (c.teacherName ?? "").toLowerCase().replace(/^(ms\.?|mr\.?|mrs\.?)\s*/, "").replace(/\s+/g, "");
      return !!tn && (tn.includes(n) || n.includes(tn));
    });
    return hit?.id ?? null;
  }, [name, openClasses]);

  function toggleSubject(id: string) {
    setSubjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError(t("이름을 입력해주세요.", "Please enter your name."));
    if (!department) return setError(t("소속을 선택해주세요.", "Please choose your department."));
    if (!position) return setError(t("직위를 선택해주세요.", "Please choose your role."));

    setSubmitting(true);
    const res = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        department,
        position,
        duty,
        classId: position === "교사" ? classId || null : null,
        subjectIds: position === "교사" ? subjectIds : [],
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? t("저장하지 못했습니다. 새로고침 후 다시 시도해주세요.", "Could not save. Please refresh and try again."));
      return;
    }
    // 등록 신청이 완료됐음을 관리자에게 알립니다(실패해도 저장은 이미 끝났으니 화면은 넘어갑니다).
    fetch("/api/notify/registration", { method: "POST" }).catch(() => {});
    router.push("/pending");
    router.refresh();
  }

  const chip = (selected: boolean) =>
    "rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
    (selected
      ? "border-gia-navy bg-gia-navy text-white"
      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300");

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("이름", "Name")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder={t("예: 홍길동", "e.g. Jane Smith")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          {t(
            "학생·학부모께 안내될 때 쓰이는 이름입니다.",
            "This is the name shown to colleagues, and used when communicating with students and families."
          )}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("소속", "Department")}</label>
        <div className="flex flex-wrap gap-1.5">
          {DEPARTMENTS.map((d) => (
            <button key={d} type="button" onClick={() => setDepartment(d)} className={chip(department === d)}>
              {departmentLabel(d, lang)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("직위", "Role")}</label>
        <div className="flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => (
            <button key={p} type="button" onClick={() => setPosition(p)} className={chip(position === p)}>
              {positionLabel(p, lang)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          {t(
            "직위에 따라 볼 수 있는 화면이 달라지니 정확히 선택해주세요. 관리자 승인 시 함께 확인됩니다.",
            "Your role decides which screens you can open, so please choose carefully. An administrator checks this when approving your account."
          )}
        </p>
      </div>

      {/* ── 교사: 담임반 + 담당과목 ─────────────────────────────────────── */}
      {position === "교사" && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              {t("담임반", "Homeroom class")}
            </label>
            {openClasses.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                {t(
                  "지금은 담임이 비어 있는 반이 없습니다. 담임이시라면 행정실에 배정을 요청해주세요.",
                  "There are no classes without a homeroom teacher right now. If you are a homeroom teacher, please ask the office to assign you."
                )}
              </p>
            ) : (
              <>
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                >
                  <option value="">{t("담임 아님 (과목만 담당)", "Not a homeroom teacher")}</option>
                  {openClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {[c.grade ? `${c.grade}${t("학년", "")}` : "", c.className, c.teacherName ? `· ${c.teacherName}` : ""]
                        .filter(Boolean)
                        .join(" ")}
                    </option>
                  ))}
                </select>
                {suggestedClassId && classId !== suggestedClassId && (
                  <button
                    type="button"
                    onClick={() => setClassId(suggestedClassId)}
                    className="mt-1.5 rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
                  >
                    {t("명부에서 찾은 반으로 선택", "Use the class matched from the roster")} —{" "}
                    {(() => {
                      const c = openClasses.find((x) => x.id === suggestedClassId);
                      return c ? `${c.className ?? ""} ${c.teacherName ?? ""}`.trim() : "";
                    })()}
                  </button>
                )}
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {t(
                    "학교 명부에 적힌 담임 이름이 함께 표시됩니다. 본인 반을 고르시면 됩니다. 잘못 고르셔도 관리자가 바로 고칠 수 있습니다.",
                    "The teacher name from the school roster is shown next to each class. Pick your own class — an administrator can correct it if needed."
                  )}
                </p>
              </>
            )}
          </div>

          {openSubjects.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                {t("담당 과목 (여러 개 선택 가능)", "Subjects you teach (choose any)")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {openSubjects.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSubject(s.id)}
                    className={chip(subjectIds.includes(s.id))}
                    title={s.teacherName ?? undefined}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {t(
                  "담임 선생님은 비워두셔도 됩니다. 전담 과목이 있으신 경우에만 고르세요.",
                  "Homeroom teachers can leave this empty. Only pick a subject if you teach it as a specialist."
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 행정직원 · 관리자: 맡은 업무 ────────────────────────────────── */}
      {(position === "행정직원" || position === "관리자") && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="mb-1 block text-xs font-semibold text-slate-500">
            {position === "관리자" ? t("담당 영역", "Area of responsibility") : t("담당 업무", "Main duties")}
          </label>
          <input
            value={duty}
            onChange={(e) => setDuty(e.target.value)}
            placeholder={
              position === "관리자"
                ? t("예: 학사 전반 / 시설·안전", "e.g. Academics / Facilities & safety")
                : t("예: 학부모 상담, 셔틀 운영", "e.g. Parent counselling, shuttle operations")
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {t(
              "업무 배정과 문의 연결에 쓰입니다. 나중에 [내 계정 설정]에서 바꿀 수 있습니다.",
              "Used for assigning work and routing questions. You can change it later in Account settings."
            )}
          </p>
        </div>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full rounded-lg bg-gia-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
      >
        {submitting ? t("저장 중...", "Saving...") : t("저장하고 계속하기", "Save and continue")}
      </button>
    </form>
  );
}
