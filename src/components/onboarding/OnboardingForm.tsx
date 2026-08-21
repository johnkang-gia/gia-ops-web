"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLang, useT } from "@/components/common/LanguageProvider";
import { departmentLabel, positionLabel } from "@/lib/i18nLabels";

const DEPARTMENTS = ["유치부", "초등부", "중고등부"] as const;
// "개발자" 직위는 시스템이 johnkang@giamicro.com 계정 전용으로 예약해두고 있어서, 다른
// 사람들에게는 선택지로 아예 보여주지 않습니다.
const POSITIONS = ["교사", "행정직원", "관리자"] as const;

// 소속·직위는 DB에 한글 값 그대로 저장하고, 화면에만 영어 이름을 보여줍니다(i18nLabels).
// 영어 화면에서 고른 값도 DB에는 "교사"로 들어가므로, 이후 권한 판정 로직이 언어와 무관하게
// 똑같이 동작합니다.
export default function OnboardingForm({
  initialDepartment,
  initialPosition,
}: {
  initialDepartment: string | null;
  initialPosition: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const { lang } = useLang();
  const [name, setName] = useState("");
  const [department, setDepartment] = useState<string>(initialDepartment ?? "");
  const [position, setPosition] = useState<string>(
    initialPosition && (POSITIONS as readonly string[]).includes(initialPosition) ? initialPosition : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError(t("이름을 입력해주세요.", "Please enter your name."));
      return;
    }
    if (!department) {
      setError(t("소속을 선택해주세요.", "Please choose your department."));
      return;
    }
    if (!position) {
      setError(t("직위를 선택해주세요.", "Please choose your role."));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = (user?.email || "").toLowerCase();

    const { error: updateError } = await supabase
      .from("app_users")
      .update({ name: name.trim(), department, position })
      .eq("email", email);

    setSubmitting(false);
    if (updateError) {
      setError(t("저장하지 못했습니다. 새로고침 후 다시 시도해주세요.", "Could not save. Please refresh and try again."));
      return;
    }
    // 등록 신청이 완료됐음을 관리자에게 알립니다(실패해도 온보딩 자체는 이미 저장이 끝났으니
    // 화면 이동은 그대로 진행합니다).
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
