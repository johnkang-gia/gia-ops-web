"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/storage";
import type { ShellTheme } from "@/lib/currentUser";
import { useT } from "@/components/common/LanguageProvider";

// 요청("테마구현 : 라이트(지금), 다크, 리퀴드글라스, GIA")에 따른 4가지 선택지입니다.
// swatch는 실제 globals.css의 [data-theme] 변수값과 맞춘 미리보기용 그라디언트입니다 -
// 고르기 전에도 대략 어떤 느낌인지 보이도록 했습니다.
const THEME_OPTIONS: { value: ShellTheme; label: string; labelEn: string; swatch: string }[] = [
  { value: "light", label: "라이트", labelEn: "Light", swatch: "linear-gradient(135deg, #ffffff 50%, #eef1f6 50%)" },
  { value: "dark", label: "다크", labelEn: "Dark", swatch: "linear-gradient(135deg, #1e293b 50%, #0b1120 50%)" },
  {
    value: "liquid-glass",
    label: "리퀴드 글라스",
    labelEn: "Liquid glass",
    swatch: "linear-gradient(135deg, rgba(255,255,255,0.95) 40%, rgba(125,211,252,0.55) 100%)",
  },
  { value: "gia-brand", label: "GIA", labelEn: "GIA", swatch: "linear-gradient(135deg, #0f1b33 45%, #c6a15b 100%)" },
];

export default function AccountSettingsForm({
  userId,
  email,
  initialName,
  initialAvatarUrl,
  positionLabel,
  initialTheme,
}: {
  userId: string;
  email: string;
  initialName: string;
  initialAvatarUrl: string | null;
  positionLabel: string | null;
  initialTheme: ShellTheme;
}) {
  const router = useRouter();
  const t = useT();
  const [name, setName] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [theme, setTheme] = useState<ShellTheme>(initialTheme);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  async function handlePhotoChange(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t("이미지 파일만 올릴 수 있어요.", "You can only upload image files."));
      return;
    }
    setUploadingPhoto(true);
    setError("");
    try {
      const url = await uploadAvatar(file, userId);
      setAvatarUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("사진을 올리지 못했습니다.", "Could not upload the photo."));
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSavedMsg("");
    if (!name.trim()) {
      setError(t("이름을 입력해주세요.", "Please enter your name."));
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("app_users")
      .update({
        name: name.trim(),
        avatar_url: avatarUrl,
        theme,
      })
      .eq("email", email);
    setSaving(false);
    if (updateError) {
      setError(t("저장하지 못했습니다. 새로고침 후 다시 시도해주세요.", "Could not save. Please refresh and try again."));
      return;
    }
    setSavedMsg(t("저장했습니다. 사이드바에 바로 반영됩니다.", "Saved. The sidebar is already updated."));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={name || email} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl font-bold text-slate-300">
              {(name || email)[0]?.toUpperCase()}
            </div>
          )}
        </div>
        <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          {uploadingPhoto ? t("업로드 중...", "Uploading...") : t("📷 사진 바꾸기", "📷 Change photo")}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handlePhotoChange(e.target.files)}
            disabled={uploadingPhoto}
            className="hidden"
          />
        </label>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("로그인 계정", "Sign-in account")}</label>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-400">{email}</div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("이름", "Name")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("예: 홍길동", "e.g. Jane Smith")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("직위", "Role")}</label>
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
          {positionLabel ? (
            <span className="rounded bg-gia-navy px-2 py-0.5 text-xs font-bold text-white">
              {positionLabel}
            </span>
          ) : (
            <span className="text-sm text-slate-400">{t("미지정", "Not set")}</span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          {t(
            "사이드바 이름 옆 뱃지에 그대로 표시되는, 우리 시스템의 실제 권한 값입니다(교사/행정직원/관리자에 따라 볼 수 있는 메뉴가 달라짐). 여기서 직접 바꿀 수는 없고, 관리자만 [학교관리 > 사용자 관리]에서 변경할 수 있습니다.",
            "This is your actual role in the system, shown on the badge next to your name in the sidebar. It decides which menus you can open. You cannot change it here \u2014 only an administrator can, under [School > User management]."
          )}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("테마", "Theme")}</label>
        <div className="grid grid-cols-4 gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center transition ${
                theme === opt.value ? "border-gia-navy" : "border-transparent hover:border-slate-200"
              }`}
              title={t(opt.label, opt.labelEn)}
            >
              <span
                className="h-9 w-full rounded-md border border-slate-200"
                style={{ background: opt.swatch }}
              />
              <span className={`text-[10px] font-semibold ${theme === opt.value ? "text-gia-navy" : "text-slate-500"}`}>
                {t(opt.label, opt.labelEn)}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          {t(
            "사이드바·헤더 등 공통 화면 틀에 적용됩니다. 저장하면 바로 반영됩니다.",
            "Applies to the shared frame such as the sidebar and header. It takes effect as soon as you save."
          )}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {savedMsg && <p className="text-sm text-emerald-600">{savedMsg}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-gia-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
      >
        {saving ? t("저장 중...", "Saving...") : t("저장", "Save")}
      </button>
    </form>
  );
}
