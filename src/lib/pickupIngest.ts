import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { kstParts } from "@/lib/shuttleTracking";
import {
  matchStudent,
  normalizeTime,
  parseChannelLabel,
  pickSiblingFromText,
  type RosterEntry,
} from "@/lib/pickupParse";

// 어느 경로로 들어온 연락이든 이 함수 하나를 거쳐 픽업으로 바뀝니다.
// 토들 수집기, 전화 통화 텍스트, 교사 전달, 직접 입력이 모두 같은 판단을 받도록 하기 위해서입니다.

export type IngestInput = {
  source: "토들" | "전화" | "교사" | "구글챗" | "직접입력" | "학부모링크";
  sourceRef?: string | null;
  channelLabel?: string | null;
  senderName?: string | null;
  text: string;
  receivedAt?: string | null;
};

export type IngestResult = {
  skipped?: "duplicate" | "empty";
  id?: string;
  isPickup: boolean;
  status?: "확인대기" | "확정" | "무시";
  studentName?: string | null;
  pickupTime?: string | null;
};

// 판단은 기계적인 편이고 사람이 인박스에서 한 번 더 보므로 저렴한 모델(Haiku)을 씁니다.
const SYSTEM = `당신은 국제학교 행정실의 보조입니다. 학부모가 보낸 연락 한 건을 읽고, 그것이
"오늘(또는 특정 날짜) 아이를 학교로 직접 데리러 가겠다"는 픽업 통보인지 판단합니다.

반드시 아래 JSON만 출력하세요. 설명·인사말·코드펜스를 붙이지 마세요.
{
  "is_pickup": true 또는 false,
  "student_name": "본문에 언급된 학생 이름(없으면 null)",
  "pickup_time": "HH:MM 24시간 형식(시각 언급이 없으면 null)",
  "date_hint": "today | tomorrow | null",
  "confidence": 0.0~1.0,
  "note": "판단 근거를 한국어 한 문장으로"
}

판단 기준
- 픽업이다: "오늘 제가 데리러 갈게요", "3시에 픽업하겠습니다", "차량 안 타고 제가 데려갑니다",
  "I'll pick him up today", "조퇴시켜서 데려가겠습니다" 등 보호자가 직접 데려간다는 뜻.
- 픽업이 아니다: 결석·지각 통보, 숙제·수업·성적 문의, 인사, 감사 표현, 상담 요청,
  준비물 문의, 이미 지난 날짜의 이야기, 학교가 보낸 안내에 대한 단순 확인 답변.
- 날짜가 미래(다음 주 등)로 특정되면 is_pickup은 true로 두되 confidence를 낮추세요.
- 애매하면 confidence를 0.5 미만으로 주세요. 낮은 값은 사람이 확인하라는 뜻이지 틀렸다는
  뜻이 아닙니다. 확실하지 않은데 높은 값을 주는 것이 가장 나쁩니다.`;

type AiOut = {
  is_pickup?: unknown;
  student_name?: unknown;
  pickup_time?: unknown;
  date_hint?: unknown;
  confidence?: unknown;
  note?: unknown;
};

// 이 값 이상이면 사람 확인 없이 바로 픽업으로 확정합니다. 픽업은 "아이를 누구에게 보내느냐"의
// 문제라 기준을 넉넉히 잡았습니다 - 틀린 자동 확정보다 한 번 더 눌러 확인하는 편이 낫습니다.
const AUTO_CONFIRM_MIN = 0.85;

export async function ingestPickup(
  supabase: SupabaseClient,
  input: IngestInput,
  roster: RosterEntry[]
): Promise<IngestResult> {
  const text = (input.text ?? "").trim();
  if (!text) return { skipped: "empty", isPickup: false };

  // 이미 처리한 메시지면 AI를 다시 부르지 않습니다(비용·중복 방지).
  if (input.sourceRef) {
    const { data: existing } = await supabase
      .from("pickup_requests")
      .select("id")
      .eq("source", input.source)
      .eq("source_ref", input.sourceRef)
      .maybeSingle();
    if (existing) return { skipped: "duplicate", isPickup: false };
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const { iso: todayKst } = kstParts(receivedAt);

  const channel = parseChannelLabel(input.channelLabel);
  const channelHint = channel
    ? `\n\n[채널 정보] 이 연락은 "${channel.names.join(", ")}" 학생(${channel.grades.join(", ")}) 가정의 대화방에서 왔습니다.`
    : "";

  let ai: AiOut = {};
  try {
    const raw = await callClaudeJson(SYSTEM, `연락 내용:\n"""\n${text}\n"""${channelHint}`, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 400,
      route: "pickup-ingest",
    });
    ai = (raw ?? {}) as AiOut;
  } catch {
    // AI 호출이 실패해도 연락 자체를 버리면 안 됩니다. 확인 대기로 남겨 사람이 보게 합니다.
    ai = { is_pickup: true, confidence: 0, note: "AI 판단에 실패해 사람 확인이 필요합니다." };
  }

  const isPickup = ai.is_pickup === true;
  const confidence = typeof ai.confidence === "number" ? Math.max(0, Math.min(1, ai.confidence)) : 0;

  // ── 픽업이 아니면 원문을 저장하지 않습니다 ────────────────────────────────
  // 학부모 대화를 쌓아두는 시스템이 되면 안 됩니다. 다만 같은 메시지를 매번 다시 AI에 보내지
  // 않으려면 "이건 이미 봤다"는 표시는 남겨야 해서, 출처 식별자만 남기고 본문은 비웁니다.
  if (!isPickup) {
    if (input.sourceRef) {
      await supabase.from("pickup_requests").insert({
        service_date: todayKst,
        source: input.source,
        source_ref: input.sourceRef,
        channel_label: input.channelLabel ?? null,
        received_at: receivedAt.toISOString(),
        raw_text: null,
        ai_is_pickup: false,
        ai_confidence: confidence,
        status: "무시",
        resolved_at: new Date().toISOString(),
        resolved_by: "AI",
      });
    }
    return { isPickup: false, status: "무시" };
  }

  // ── 학생 연결 ─────────────────────────────────────────────────────────────
  // 채널 이름을 먼저 믿습니다. 학교가 정한 규칙이라 자유 문장보다 훨씬 정확합니다.
  let candidateName: string | null = null;
  let grade: string | null = null;
  if (channel) {
    grade = channel.grades[0] ?? null;
    if (!channel.isSibling) {
      candidateName = channel.names[0];
    } else {
      // 형제 방 - 본문에서 누구인지 가려냅니다. 못 가리면 사람에게 넘깁니다.
      candidateName = pickSiblingFromText(text, channel.names);
    }
  }
  // 채널 정보가 없으면(전화·교사 전달 등) AI가 읽어낸 이름을 씁니다.
  if (!candidateName && typeof ai.student_name === "string") candidateName = ai.student_name;

  const matched = candidateName ? matchStudent(candidateName, roster, grade) : null;

  // 날짜: "내일"이라고 하면 하루 뒤로 잡습니다.
  let serviceDate = todayKst;
  if (ai.date_hint === "tomorrow") {
    serviceDate = kstParts(new Date(receivedAt.getTime() + 24 * 60 * 60 * 1000)).iso;
  }

  // 자동 확정 조건: AI가 충분히 확신하고, 학생이 명부에서 하나로 특정되었을 때만.
  // 둘 중 하나라도 아니면 확인 대기입니다.
  const autoConfirm = confidence >= AUTO_CONFIRM_MIN && !!matched;

  const { data, error } = await supabase
    .from("pickup_requests")
    .insert({
      service_date: serviceDate,
      source: input.source,
      source_ref: input.sourceRef ?? null,
      channel_label: input.channelLabel ?? null,
      sender_name: input.senderName ?? null,
      received_at: receivedAt.toISOString(),
      raw_text: text,
      ai_is_pickup: true,
      ai_student_name: candidateName,
      ai_pickup_time: normalizeTime(ai.pickup_time),
      ai_confidence: confidence,
      ai_note: typeof ai.note === "string" ? ai.note.slice(0, 300) : null,
      student_id: matched?.id ?? null,
      matched_name: matched?.name ?? null,
      status: autoConfirm ? "확정" : "확인대기",
      resolved_by: autoConfirm ? "AI" : null,
      resolved_at: autoConfirm ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw error;

  if (autoConfirm && matched) await applyPickup(supabase, matched.id, serviceDate);

  return {
    id: data?.id as string | undefined,
    isPickup: true,
    status: autoConfirm ? "확정" : "확인대기",
    studentName: matched?.name ?? candidateName,
    pickupTime: normalizeTime(ai.pickup_time),
  };
}

/**
 * 실제 하원 체크표에 픽업으로 표시합니다. 셔틀 배정이 있는 학생만 해당하며(차량을 안 타는
 * 학생은 애초에 하원 차량 명단에 없습니다), 그날 배정된 모든 좌석에 픽업을 겁니다.
 */
export async function applyPickup(supabase: SupabaseClient, studentId: string, serviceDate: string): Promise<number> {
  const { data: assignments } = await supabase
    .from("shuttle_assignments")
    .select("id")
    .eq("student_id", studentId);

  const ids = (assignments ?? []).map((a) => a.id as string);
  if (ids.length === 0) return 0;

  // 그날 탑승 기록이 이미 있으면 상태만 바꾸고, 없으면 새로 만듭니다.
  for (const assignmentId of ids) {
    const { data: existing } = await supabase
      .from("shuttle_boardings")
      .select("id")
      .eq("service_date", serviceDate)
      .eq("assignment_id", assignmentId)
      .maybeSingle();

    if (existing) {
      await supabase.from("shuttle_boardings").update({ status: "픽업" }).eq("id", existing.id);
    } else {
      await supabase
        .from("shuttle_boardings")
        .insert({ service_date: serviceDate, assignment_id: assignmentId, status: "픽업" });
    }
  }
  return ids.length;
}

/** 명부를 한 번만 읽어 여러 건에 재사용합니다(수집기가 한 번에 여러 건을 보냅니다). */
export async function loadRoster(supabase: SupabaseClient): Promise<RosterEntry[]> {
  const { data } = await supabase
    .from("wr_students")
    .select("id, name, name_en, grade")
    .eq("is_demo", false)
    .in("status", ["active", "보류"]);
  return (data ?? []) as RosterEntry[];
}
