"use client";

import { createClient } from "@/lib/supabase/client";

// 비공개 버킷들 - RLS 정책상 giamicro.com 로그인 사용자만 업로드·조회·삭제할 수 있습니다
// (아동 사진/회의 음성 등 민감할 수 있는 파일이라 공개 버킷을 쓰지 않습니다).
const EVENT_PHOTOS_BUCKET = "event-photos";
const MEETING_AUDIO_BUCKET = "meeting-audio";

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
