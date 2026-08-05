"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DEPARTMENTS = ["유치부", "초등부", "중고등부"] as const;
// "개발자" 직위는 시스템이 johnkang@giamicro.com 계정 전용으로 예약해두고 있어서, 다른
// 사람들에게는 선택지로 아예 보여주지 않습니다.
const POSITIONS = ["교사", "행정직원", "관리자"] as const;

export default function OnboardingForm({
  initialDepartment,
  initialPosition,
}: {
  initialDepartment: string | null;
  initialPosition: string | null;
}) {
  const router = useRouter();
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
      setError("이름을 입력해주세요.");
      return;
    }
    if (!department) {
      setError("소속을 선택해주세요.");
      return;
    }
    if (!position) {
      setError("직위를 선택해주세요.");
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
      setError("저장하지 못했습니다. 새로고침 후 다시 시도해주세요.");
      return;
    }
    // 등록 신청이 완료됐음을 관리자에게 Slack으로 알립니다(실패해도 온보딩 자체는
    // 이미 저장이 끝났으니 화면 이동은 그대로 진행합니다).
    fetch("/api/notify/registration", { method: "POST" }).catch(() => {});
    router.push("/pending");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">이름</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="예: 홍길동"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">소속</label>
        <div className="flex flex-wrap gap-1.5">
          {DEPARTMENTS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepartment(d)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
                (department === d
                  ? "border-gia-navy bg-gia-navy text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")
              }
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">직위</label>
        <div className="flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPosition(p)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
                (position === p
                  ? "border-gia-navy bg-gia-navy text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")
              }
            >
              {p}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          교사/행정직원과 관리자의 권한이 다르게 적용되니 정확히 선택해주세요. 관리자 승인 시 함께
          확인됩니다.
        </p>
      </div>

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full rounded-lg bg-gia-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
      >
        {submitting ? "저장 중..." : "저장하고 계속하기"}
      </button>
    </form>
  );
}
