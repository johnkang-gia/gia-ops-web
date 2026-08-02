"use client";

import { createClient } from "@/lib/supabase/client";

// 비공개 버킷들 - RLS 정책상 giamicro.com 로그인 사용자만 업로드·조회·삭제할 수 있습니다
// (아동 사진/회의 음성 등 민감할 수 있는 파일이라 공개 버킷을 쓰지 않습니다).
const EVENT_PHOTOS_BUCKET = "event-photos";
const MEETING_AUDIO_BUCKET = "meeting-audio";
// 프로필 사진은 민감 정보가 아니라 공개 버킷을 씁니다 - 사이드바를 그릴 때마다 signed URL을
// 새로 발급받지 않아도 되도록(그럼 매 페이지 로드마다 스토리지 API를 한 번씩 더 불러야 함).
const AVATARS_BUCKET = "avatars";

async function uploadFile(bucket: string, file: File, folder: string): Promise<string> {
  const supabase = createClient();
  const ext = file.name.split(".").pop() || "bin";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

async function getFileSignedUrl(bucket: string, path: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60); // 1시간 동안 유효
  if (error) return null;
  return data?.signedUrl ?? null;
}

async function deleteFile(bucket: string, path: string): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from(bucket).remove([path]);
}

export async function uploadEventPhoto(file: File, folder: string): Promise<string> {
  return uploadFile(EVENT_PHOTOS_BUCKET, file, folder);
}

export async function getEventPhotoUrl(path: string): Promise<string | null> {
  return getFileSignedUrl(EVENT_PHOTOS_BUCKET, path);
}

export async function deleteEventPhoto(path: string): Promise<void> {
  return deleteFile(EVENT_PHOTOS_BUCKET, path);
}

export async function uploadMeetingAudio(file: File, folder: string): Promise<string> {
  return uploadFile(MEETING_AUDIO_BUCKET, file, folder);
}

export async function getMeetingAudioUrl(path: string): Promise<string | null> {
  return getFileSignedUrl(MEETING_AUDIO_BUCKET, path);
}

export async function deleteMeetingAudio(path: string): Promise<void> {
  return deleteFile(MEETING_AUDIO_BUCKET, path);
}

// 계정마다 파일명을 고정(avatar.확장자)해서 upsert하면 사진을 바꿀 때마다 예전 파일이 버킷에
// 계속 쌓이는 걸 막을 수 있습니다. 반환값은 바로 <img src>에 쓸 수 있는 공개 URL입니다.
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  const supabase = createClient();
  const ext = file.name.split(".").pop() || "png";
  const path = `${userId}/avatar.${ext}`;
  const { error } = await supabase.storage.from(AVATARS_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  // 캐시 무효화를 위해 매번 다른 쿼리스트링을 붙입니다(파일명이 고정이라 브라우저/CDN이
  // 이전 사진을 계속 캐싱해서 보여줄 수 있음).
  return `${data.publicUrl}?v=${Date.now()}`;
}
