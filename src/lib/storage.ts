"use client";

import { createClient } from "@/lib/supabase/client";

// 행사/학기 사진을 저장하는 비공개 버킷입니다. RLS 정책상 giamicro.com 로그인 사용자만
// 업로드·조회·삭제할 수 있습니다(아동이 포함된 사진일 수 있어 공개 버킷을 쓰지 않습니다).
const EVENT_PHOTOS_BUCKET = "event-photos";

export async function uploadEventPhoto(file: File, folder: string): Promise<string> {
  const supabase = createClient();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(EVENT_PHOTOS_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function getEventPhotoUrl(path: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(EVENT_PHOTOS_BUCKET)
    .createSignedUrl(path, 60 * 60); // 1시간 동안 유효
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function deleteEventPhoto(path: string): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from(EVENT_PHOTOS_BUCKET).remove([path]);
}
