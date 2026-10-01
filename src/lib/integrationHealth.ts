import type { SupabaseClient } from "@supabase/supabase-js";
import { INTEGRATIONS, type IntegrationSpec } from "@/lib/heartbeat";

/**
 * **연동 상태 판정 · 고치는 길 · 경보** — 한 곳.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 연동 상태 화면은 빨간불을 켜 주기만 했습니다. 켜진 다음에 무엇을 해야 하는지는 화면에
 * 없었고, 구글챗 출결 방이 9월 15일부터 꺼져 있었는데 2주 동안 아무도 몰랐습니다 - 크론은
 * 다른 방을 돌고 있어서 초록이었고, 업무보드의 빨간 점은 작아서 지나쳤습니다. 그 사이 「권수호
 * 4시 픽업」 같은 연락이 그냥 사라졌습니다. 오류가 아니라 «새 연락이 없는 날»로 보였습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 *   judge           화면과 경보가 **같은 기준**으로 판정합니다. 둘이 다르면 화면은 초록인데 경보가
 *                   울리거나 그 반대가 됩니다.
 *   FIX_GUIDE       빨간불마다 「어디를 보라」. 화면이 그대로 띄우고 복사 글에도 들어갑니다.
 *   buildReport     사람이 개발자에게 붙여넣을 글. 비밀값은 안 들어갑니다.
 *   checkAlerts     끊기면 안 되는 것(셔틀·구글챗·토들·출결 방)이 끊기면 **전체공지**를 올리고,
 *                   돌아오면 내립니다. 크론 둘(구글챗 1분·픽업 예약 5분)과 토들 신호가 부릅니다 -
 *                   하나가 죽어도 다른 하나가 알립니다.
 */
export type Beat = { key: string; last_seen_at: string | null; status: string | null; detail: string | null };
export type Verdict = { dot: "🟢" | "🟡" | "🔴" | "⚪"; text: string };

/** 평일 07~19시(한국)인가. 이 시간대에만 도는 크론은 밤중에 조용해도 정상입니다. */
export function inOfficeHours(now = new Date()): boolean {
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const day = kst.getDay();
  const h = kst.getHours();
  return day >= 1 && day <= 5 && h >= 7 && h < 19;
}

/** 정해진 주기의 3배가 지나면 끊김. 네트워크가 한두 번 튄 것까지 빨간불을 켜면 아무도 안 믿습니다. */
export function judge(spec: IntegrationSpec, beat: Beat | null | undefined, now = new Date()): Verdict {
  if (spec.officeHoursOnly && !inOfficeHours(now)) return { dot: "⚪", text: "지금은 쉬는 시간대" };
  if (!beat?.last_seen_at) return { dot: "🔴", text: "한 번도 안 돌았습니다" };
  const late = now.getTime() - new Date(beat.last_seen_at).getTime() > spec.everyMinutes * 60 * 1000 * 3;
  if (late) return { dot: "🔴", text: "끊김" };
  if (beat.status && beat.status !== "ok") return { dot: "🟡", text: beat.status };
  return { dot: "🟢", text: "정상" };
}

/** 끊기면 운영이 바로 틀어지는 것들. 이것만 경보를 울립니다 - 전부 울리면 아무도 안 봅니다. */
export const CRITICAL_KEYS = ["cron:shuttle-auto", "google-chat-poll", "toddle-collector", "cron:pickup-schedules"] as const;

/** 빨간불이 켜졌을 때 사람이 볼 곳. 비밀값은 적지 않습니다 - 복사 글에 그대로 들어갑니다. */
export const FIX_GUIDE: Record<string, string[]> = {
  "cron:shuttle-auto": [
    "cron-job.org 에서 「shuttle-auto」 작업이 켜져 있는지(실패가 쌓이면 자동으로 꺼집니다).",
    "주소가 /api/cron/shuttle-auto 이고 Authorization 헤더가 Bearer + CRON_SECRET 인지.",
    "Vercel 배포 뒤 CRON_SECRET 환경변수가 바뀌지 않았는지.",
  ],
  "google-chat-poll": [
    "cron-job.org 에서 「poll-chat-messages」 작업이 켜져 있는지.",
    "아래 「구글챗 방」에서 출결알림 방이 켜져 있는지 - 방이 꺼져 있으면 크론은 돌아도 그 방 글은 안 옵니다.",
    "오류에 401·invalid_grant 가 있으면 구글 토큰이 만료된 것 - 관리 > 구글챗 연결에서 다시 로그인.",
  ],
  "toddle-collector": [
    "사무실 PC 크롬이 켜져 있고 토들 수집기 확장이 켜져 있는지.",
    "오류에 login_required 가 있으면 그 PC 에서 토들에 다시 로그인하면 됩니다.",
    "확장 아이콘을 눌러 「마지막 전송」 시각을 확인.",
  ],
  "cron:pickup-schedules": [
    "cron-job.org 에서 「pickup-schedules」 작업이 켜져 있는지(5분마다).",
    "주소가 /api/cron/pickup-schedules 이고 Authorization 헤더가 맞는지.",
  ],
};

export const DEFAULT_GUIDE = ["cron-job.org 에 등록되어 있는지, 주소와 Authorization 헤더가 맞는지 확인."];

export type SpaceLite = { google_space_id: string; display_name: string | null; source_key: string | null; enabled: boolean; last_polled_at: string | null; last_error: string | null };

/** 출결알림 방이 꺼져 있으면 크론이 초록이어도 출결 연락은 안 옵니다. 신호와 별개로 봅니다. */
export function attendanceSpaceProblem(spaces: readonly SpaceLite[]): string | null {
  const att = spaces.find((s) => s.source_key === "attendance");
  if (!att) return "출결알림 방(source_key=attendance)이 등록되어 있지 않습니다.";
  if (!att.enabled) return `출결알림 방 「${att.display_name ?? att.google_space_id}」이 꺼져 있습니다. 구글챗 출결·픽업 연락이 안 들어옵니다.`;
  if (att.last_error) return `출결알림 방 마지막 오류: ${att.last_error}`;
  return null;
}

/** 개발자에게 붙여넣을 글. 화면의 「상태 복사」가 만듭니다. */
export function buildReport(beats: readonly Beat[], spaces: readonly SpaceLite[], now = new Date()): string {
  const byKey = new Map(beats.map((b) => [b.key, b]));
  const lines: string[] = [`[연동 상태] ${now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`];
  for (const spec of INTEGRATIONS) {
    const b = byKey.get(spec.key) ?? null;
    const v = judge(spec, b, now);
    const seen = b?.last_seen_at ? new Date(b.last_seen_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "없음";
    lines.push(`${v.dot} ${spec.key} (${spec.label}) · ${spec.everyMinutes}분 · 마지막 ${seen} · ${b?.status ?? "-"}${b?.detail ? ` · ${b.detail}` : ""}`);
  }
  lines.push("[구글챗 방]");
  for (const s of spaces) {
    lines.push(`${s.enabled ? "켜짐" : "꺼짐"} ${s.display_name ?? "(이름 없음)"} ${s.source_key ? `[${s.source_key}]` : ""} · 마지막 ${s.last_polled_at ?? "없음"}${s.last_error ? ` · 오류 ${s.last_error}` : ""}`);
  }
  const att = attendanceSpaceProblem(spaces);
  if (att) lines.push(`⚠️ ${att}`);
  return lines.join("\n");
}

const ALERT_PREFIX = "⚠️ 연동 끊김:";
const ALERT_AUTHOR = "system@gia-ops";

/**
 * 끊기면 안 되는 것이 끊겼으면 전체공지를 올리고, 돌아오면 내립니다.
 *
 * 공지 하나에 끊긴 것 전부를 적습니다(제목이 바뀌면 고쳐 씁니다). 이미 올라가 있으면 또 올리지
 * 않습니다 - 1분마다 같은 공지가 쌓이면 사람은 접어 버리고, 접힌 공지는 없는 것과 같습니다.
 */
export async function checkAlerts(supabase: SupabaseClient, spaces?: readonly SpaceLite[]): Promise<{ broken: string[] }> {
  const now = new Date();
  const { data: beatRows } = await supabase.from("integration_heartbeats").select("key, last_seen_at, status, detail");
  const byKey = new Map(((beatRows as Beat[] | null) ?? []).map((b) => [b.key, b]));
  const broken: string[] = [];
  for (const key of CRITICAL_KEYS) {
    const spec = INTEGRATIONS.find((s) => s.key === key);
    if (!spec) continue;
    const v = judge(spec, byKey.get(key), now);
    if (v.dot === "🔴") broken.push(spec.label);
  }
  let spaceList = spaces;
  if (!spaceList) {
    const { data } = await supabase.from("google_chat_spaces").select("google_space_id, display_name, source_key, enabled, last_polled_at, last_error");
    spaceList = (data as SpaceLite[] | null) ?? [];
  }
  const att = attendanceSpaceProblem(spaceList);
  if (att) broken.push("구글챗 출결알림 방");

  const { data: open } = await supabase
    .from("work_notices")
    .select("id, title")
    .eq("author_email", ALERT_AUTHOR)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const openRows = (open as { id: string; title: string }[] | null) ?? [];

  if (broken.length === 0) {
    if (openRows.length > 0) {
      await supabase.from("work_notices").update({ archived_at: now.toISOString() }).in("id", openRows.map((r) => r.id));
    }
    return { broken };
  }

  const title = `${ALERT_PREFIX} ${broken.join(" · ")}`;
  const body = [
    "끊기면 운영에 바로 영향이 가는 연동입니다. 관리 > 연동 상태에서 빨간 줄의 「고치는 길」을 보고, 안 되면 「상태 복사」로 복사해 개발자에게 보내주세요.",
    att ? `· ${att}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  if (openRows.length > 0) {
    if (openRows[0].title !== title) await supabase.from("work_notices").update({ title, body }).eq("id", openRows[0].id);
    return { broken };
  }
  await supabase.from("work_notices").insert({ scope: "전체", title, body, author_email: ALERT_AUTHOR });
  return { broken };
}
