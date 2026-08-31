import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import { kstParts } from "@/lib/shuttleTracking";
import { hasConflictingIntent, similarity } from "@/lib/textSimilarity";
import {
  matchStudent,
  normalizeTime,
  parseChannelLabel,
  pickSiblingFromText,
  type RosterEntry,
} from "@/lib/pickupParse";
import { extractTargetRange } from "@/lib/attendanceDigest";
import { extractRecurringWeekdays, hasRecurringPhrase, weekdayLabel } from "@/lib/parentRecurrence";
import { genCaseId } from "@/lib/caseId";

// 어느 경로로 들어온 연락이든 이 함수 하나를 거쳐 픽업으로 바뀝니다.
// 토들 수집기, 전화 통화 텍스트, 교사 전달, 직접 입력이 모두 같은 판단을 받도록 하기 위해서입니다.

export type IngestInput = {
  source: "토들" | "전화" | "교사" | "구글챗" | "직접입력" | "학부모링크";
  sourceRef?: string | null;
  channelLabel?: string | null;
  senderName?: string | null;
  text: string;
  receivedAt?: string | null;
  /** 토들 채팅방 번호 - 이걸로 원문으로 돌아가는 링크를 만듭니다. */
  chatId?: string | null;
  /** 원문으로 바로 가는 주소(수집기가 만들어 보냅니다). */
  sourceUrl?: string | null;
};

export type IngestResult = {
  skipped?: "duplicate" | "empty";
  id?: string;
  kind?: "픽업" | "문의" | "기타";
  isPickup: boolean;
  status?: "확인대기" | "확정" | "무시";
  studentName?: string | null;
  pickupTime?: string | null;
  /** 이 연락으로 예약된 날짜들(오늘 것 포함). */
  scheduledDates?: string[];
  scheduledCount?: number;
};

// 판단은 기계적인 편이고 사람이 인박스에서 한 번 더 보므로 저렴한 모델(Haiku)을 씁니다.
const SYSTEM = `당신은 국제학교 행정실의 보조입니다. 학부모가 보낸 연락 한 건을 읽고 분류합니다.

반드시 아래 JSON만 출력하세요. 설명·인사말·코드펜스를 붙이지 마세요.
{
  "kind": "픽업" | "문의" | "기타",
  "student_name": "본문에 언급된 학생 이름(없으면 null)",
  "pickup_time": "HH:MM 24시간 형식(픽업이고 시각 언급이 있을 때만, 없으면 null)",
  "pickup_dates": [
    { "date": "YYYY-MM-DD", "time": "HH:MM 또는 null", "certain": true 또는 false, "why": "이 날짜로 본 근거를 짧게" }
  ],
  "recurring_weekdays": ["월"|"화"|"수"|"목"|"금" 중 반복되는 요일들. 한 번뿐이면 빈 배열],
  "inquiry_type": "출결 | 수업·학습 | 생활·교우 | 건강·안전 | 차량·하원 | 행사·일정 | 납부·행정 | 기타",
  "summary": "한국어 한 줄 요약(25자 안팎). 학부모 문장을 그대로 옮기지 말고 무엇을 원하는지 적으세요.",
  "urgency": "높음 | 보통 | 낮음",
  "confidence": 0.0~1.0,
  "note": "판단 근거를 한국어 한 문장으로"
}

kind 판단 기준
- "픽업": 보호자가 오늘(또는 특정 날짜) 아이를 학교로 직접 데리러 가겠다는 통보.
  예) "오늘 제가 데리러 갈게요", "3시에 픽업하겠습니다", "차량 안 타고 제가 데려갑니다",
  "I'll pick him up today", "조퇴시켜서 데려가겠습니다"
- "문의": 학교가 확인하거나 답해야 하는 내용. 결석·지각 통보, 수업·숙제·성적 질문, 상담 요청,
  준비물·행사 문의, 건강 이상 알림, 차량 노선 변경 요청, 납부 문의 등.
- "기타": 답이 필요 없는 인사, 감사 표현, 학교 안내에 대한 단순 확인("네 알겠습니다"),
  이미 지난 일에 대한 잡담.

**픽업이 아닌 것 (가장 중요)**

픽업의 뜻은 딱 하나입니다: **아이를 학교에서 데려간다.**
아이를 데려간다는 말이 없으면, 시각이 적혀 있어도 픽업이 아닙니다.
실제로 틀렸던 예입니다.

- "선생님 55분 도착입니다^^"
  → **픽업 아님.** 아이가 학교에 몇 시에 도착하는지(지각 알림)일 수도 있고, 보호자가 몇 시에
    학교 근처에 도착한다는 말일 수도 있습니다. **아이를 데려간다는 말이 없습니다.**
    시각만 보고 픽업으로 단정하지 마세요. 이런 건 "문의"이고 confidence는 0.3 이하입니다.
- "첼로 가지러 오피스로 갈게요"
  → **픽업 아님.** 가지러 가는 대상이 **물건**입니다. 아이가 아닙니다. "문의"입니다.
  → 같은 이유로 "서류 받으러", "약 가져다 주러", "물건 두고 가서" 도 전부 픽업이 아닙니다.
- "오늘 몇 시에 하원하나요?" → 물어보는 것이지 데려가겠다는 통보가 아닙니다. "문의".
- "차량 노선 바꿔주세요" → 셔틀을 계속 탑니다. "문의".

판단이 헷갈리면 스스로 물어보세요: **"이 문장에 '아이를' + '데려간다'가 둘 다 있는가?"**
둘 중 하나라도 없으면 픽업이 아닙니다. 애매하면 "문의"로 두세요 - 픽업으로 잘못 넣으면
아이가 차를 못 타지만, 문의로 잘못 두면 사람이 한 번 더 읽을 뿐입니다.

urgency 기준
- "높음": 오늘 안에 대응하지 않으면 곤란한 것. 아이가 아프다, 지금 학교에 와 있다,
  오늘 하원 방법이 바뀐다, 안전 관련.
- "보통": 며칠 안에 답하면 되는 일반 문의.
- "낮음": 급하지 않은 확인·감사.

주의
- 픽업이면서 문의이기도 한 경우(예: "오늘 데리러 갈게요, 그리고 숙제가 뭔가요?")는 "픽업"으로
  분류하고 summary에 문의 내용도 함께 적으세요.
- 애매하면 confidence를 0.5 미만으로 주세요. 낮은 값은 사람이 확인하라는 뜻이지 틀렸다는
  뜻이 아닙니다. 확실하지 않은데 높은 값을 주는 것이 가장 나쁩니다.

recurring_weekdays 규칙 (가장 자주 놓치는 부분)
- "매주 금요일", "금요일마다", "앞으로 화·목은", "every Friday"처럼 **계속 반복되는** 약속이면
  그 요일들을 적으세요. 예) "규민이는 매주 금요일 16시에 직접 픽업하겠습니다" → ["금"]
- 이건 그날 하루가 아니라 **셔틀 배정 자체를 바꿔야 하는 일**입니다. 한 번짜리로 처리하면
  다음 주 금요일에 아이가 차에 타버립니다.
- "이번주 금요일", "내일", "오늘"처럼 한 번뿐이면 빈 배열로 두세요.

pickup_dates 규칙 (픽업일 때만 채우고, 아니면 빈 배열)
- 학부모가 말한 날을 **하나도 빠뜨리지 말고** 모두 적으세요. 연락 한 건이 여러 날을 가리키는
  경우가 많습니다. 예)
  - "이번주 목금 픽업입니다" → 이번 주 목요일과 금요일, 두 줄
  - "내일부터 금요일까지 제가 데려갑니다" → 내일부터 그 주 금요일까지 평일 전부
  - "오늘 3시에 데리러 갈게요" → 오늘 한 줄, time은 "15:00"
  - "8/26, 8/27 픽업" → 그 두 날짜
- 반드시 아래에 주어진 [오늘] 정보를 기준으로 실제 달력 날짜를 계산해 YYYY-MM-DD로 쓰세요.
- 토요일·일요일은 넣지 마세요(하원 차량이 없습니다).
- 지난 날짜는 넣지 마세요. 이미 지난 요일을 말한 것 같으면 다음 주로 보지 말고 빼세요.
- certain: 날짜를 분명히 짚을 수 있으면 true. "이번주 목금"처럼 어느 주인지 해석이 필요하거나
  "며칠간", "당분간"처럼 범위가 흐릿하면 false로 주세요. false여도 날짜는 최선으로 채워
  넣으세요 - 비워두면 그냥 잊힙니다.
- 시각이 날짜마다 다르면 각 줄의 time에 따로 적으세요.`;

type AiOut = {
  kind?: unknown;
  student_name?: unknown;
  pickup_time?: unknown;
  pickup_dates?: unknown;
  date_hint?: unknown;
  recurring_weekdays?: unknown;
  inquiry_type?: unknown;
  summary?: unknown;
  urgency?: unknown;
  confidence?: unknown;
  note?: unknown;
};

const INQUIRY_TYPES = ["출결", "수업·학습", "생활·교우", "건강·안전", "차량·하원", "행사·일정", "납부·행정", "기타"];
const URGENCIES = ["높음", "보통", "낮음"];
const pick = (v: unknown, allowed: string[]): string | null =>
  typeof v === "string" && allowed.includes(v) ? v : null;

// 이 값 이상이면 사람 확인 없이 바로 픽업으로 확정합니다. 픽업은 "아이를 누구에게 보내느냐"의
// 문제라 기준을 넉넉히 잡았습니다 - 틀린 자동 확정보다 한 번 더 눌러 확인하는 편이 낫습니다.
const AUTO_CONFIRM_MIN = 0.85;

/** 예약을 잡아둘 수 있는 최대 앞날. 이보다 먼 날짜는 잘못 읽은 것으로 봅니다. */
const MAX_SCHEDULE_DAYS = 45;

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 그 주의 월요일. AI가 "이번주 목금"을 실제 날짜로 옮길 때 기준으로 씁니다. */
function mondayOfWeek(iso: string, weekday: number): string {
  // weekday: 0=일 … 6=토. 일요일은 그 주가 이미 끝났으므로 다음 날 월요일을 기준으로 봅니다.
  const back = weekday === 0 ? -1 : weekday - 1;
  return addDays(iso, -back);
}

export type ParsedPickupDate = { date: string; time: string | null; certain: boolean; why: string | null };

/**
 * AI가 준 날짜 목록을 다듬습니다.
 *
 * AI는 날짜 계산을 틀릴 수 있습니다. 틀린 날짜로 예약을 걸면 엉뚱한 날 아이가 차를 못 타거나
 * 반대로 태워 보내게 되므로, 여기서 걸러냅니다 - 지난 날, 너무 먼 날, 주말, 중복.
 */
export function normalizePickupDates(raw: unknown, todayKst: string): ParsedPickupDate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ParsedPickupDate[] = [];
  const limit = addDays(todayKst, MAX_SCHEDULE_DAYS);

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < todayKst || date > limit) continue;
    // 주말은 하원 차량이 없습니다.
    const wd = new Date(date + "T00:00:00Z").getUTCDay();
    if (wd === 0 || wd === 6) continue;
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({
      date,
      time: normalizeTime(o.time),
      certain: o.certain === true,
      why: typeof o.why === "string" ? o.why.slice(0, 120) : null,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── 같은 연락이 두 경로로 들어오는 경우 ──────────────────────────────────────
//
// 요청: "토들과 지금 구글챗 긁어오는것 중복되지않게 분석해서 하나만 뜰 수 있도록 해줘,
// 문장이 완전히 똑같지 않을거라서 잘 분석해줘"
//
// 학부모가 토들로 보낸 것과, 담임 선생님이 구글챗 출결방에 옮겨 적은 것이 같은 일인 경우가
// 많습니다. 쓴 사람이 다르니 문장은 전혀 다릅니다.
//
//   토들:   "선생님 안녕하세요. 유겸이가 어제부터 장염이라 오늘 결석하겠습니다."
//   구글챗: "@노유겸 결석 - 장염"
//
// 판단은 세 단계로 좁힙니다. 넓게 잡아 엉뚱한 것끼리 묶으면 한쪽 내용이 통째로 사라지므로,
// 확실하지 않으면 따로 두는 쪽을 택했습니다.
//
//   1) 같은 학생·같은 날짜·같은 종류(픽업/문의)인 것만 후보로 봅니다.
//      학생을 특정하지 못한 건은 아예 묶지 않습니다 - 잘못 묶는 것이 두 줄 뜨는 것보다 나쁩니다.
//   2) 픽업은 후보가 있으면 같은 건으로 봅니다. 같은 아이를 같은 날 두 번 데려갈 일은 없습니다.
//   3) 문의는 글자가 얼마나 겹치는지 보고, 애매하면 AI에게 한 번 더 묻습니다.

const DUP_SURE = 0.6; // 이 이상 겹치면 물어볼 것도 없이 같은 건
const DUP_MAYBE = 0.2; // 이 아래면 물어볼 것도 없이 다른 건

const DUP_SYSTEM = `두 개의 학교 연락이 **같은 사안**을 말하는지 판단합니다.

하나는 학부모가 직접 보낸 글이고, 다른 하나는 선생님이 그 내용을 옮겨 적은 메모일 수 있습니다.
그래서 말투와 길이가 많이 다를 수 있습니다.

반드시 아래 JSON만 출력하세요.
{ "same": true 또는 false, "why": "한 문장 근거" }

같다고 볼 때
- 같은 아이의 같은 날 일에 대해 같은 것을 알리고 있을 때.
  예) "유겸이가 장염이라 오늘 결석합니다" 와 "@노유겸 결석 - 장염"
  예) "오늘 제가 3시에 데리러 갈게요" 와 "@이라엘 3시 픽업"

다르다고 볼 때
- 알리는 내용이 다를 때(결석 vs 지각, 결석 vs 픽업).
- 한쪽에만 있는 별개의 요청이 핵심일 때(예: 한쪽은 결석 통보, 다른 쪽은 방과후 등록 문의).
- 같은 아이 얘기지만 서로 다른 날의 일일 때.

애매하면 false를 주세요. 잘못 묶으면 한쪽 내용이 통째로 사라집니다. 두 줄로 남는 것이 낫습니다.`;

type DupCandidate = { id: string; raw_text: string | null; source: string; merged_sources: string[] | null };

async function findDuplicate(
  supabase: SupabaseClient,
  opts: { studentId: string; serviceDate: string; kind: "픽업" | "문의"; text: string; source: string }
): Promise<DupCandidate | null> {
  const { data } = await supabase
    .from("pickup_requests")
    // merged_sources 는 나중에 추가된 칸입니다. 콕 집어 달라고 하면 마이그레이션이 아직
    // 안 걸린 동안 조회가 실패하고, 그러면 들어온 연락이 통째로 버려집니다.
    .select("*")
    .eq("student_id", opts.studentId)
    .eq("service_date", opts.serviceDate)
    .eq("kind", opts.kind)
    .neq("status", "무시")
    .order("received_at", { ascending: false })
    .limit(5);

  const rows = (data ?? []) as DupCandidate[];
  if (rows.length === 0) return null;

  for (const row of rows) {
    // 같은 경로로 또 들어온 것은 원래 source_ref 로 걸러집니다. 여기서 볼 것은 다른 경로입니다.
    if (row.source === opts.source) continue;
    const other = row.raw_text ?? "";
    if (!other.trim()) continue;

    // 픽업은 같은 아이·같은 날이면 같은 건입니다. 시각이 다르면 그건 정정이지 별건이 아닙니다.
    if (opts.kind === "픽업") return row;

    if (hasConflictingIntent(opts.text, other)) continue;

    const score = similarity(opts.text, other);
    if (score >= DUP_SURE) return row;
    if (score < DUP_MAYBE) continue;

    // 애매한 구간만 AI에게 묻습니다. 후보가 있을 때만이라 호출이 잦지 않습니다.
    try {
      const raw = await callClaudeJson(
        DUP_SYSTEM,
        `연락 A:\n"""\n${other.slice(0, 800)}\n"""\n\n연락 B:\n"""\n${opts.text.slice(0, 800)}\n"""`,
        { model: CLAUDE_MODEL_FAST, maxTokens: 200, route: "pickup-dedupe" }
      );
      if ((raw as { same?: unknown } | null)?.same === true) return row;
    } catch {
      // 물어보지 못했으면 묶지 않습니다. 확실하지 않을 때는 따로 두는 쪽이 안전합니다.
    }
  }
  return null;
}

// 기간으로 온 연락인지 봅니다.
//
// "~까지"라는 말이 있고 그 끝날이 오늘보다 뒤면 기간입니다. 하루짜리는 여기서 걸리지
// 않습니다("오늘 3시 픽업"에는 끝날이 없습니다).
//
// 기간을 읽는 일은 출결 인박스가 이미 하고 있으므로(extractTargetRange) 그 도구를 그대로
// 씁니다 - 같은 문장을 두 곳이 다르게 읽으면 언젠가 답이 갈립니다.
function detectPeriod(
  text: string,
  base: Date
): { kind: "pickup" | "absent"; from: string; to: string; why: string } | null {
  if (!text) return null;
  // "까지"가 없으면 기간으로 보지 않습니다. 원칙은 "그날 하루"입니다(담당자).
  if (!/(까지|until|through)/i.test(text)) return null;

  const range = extractTargetRange(text, base);
  if (!range || range.from === range.to) return null;

  // 결석인지 픽업인지. 결석 쪽 표현이 있으면 결석으로 봅니다 - 결석이 더 센 상태라,
  // 두 말이 섞여 있으면 결석으로 두는 편이 안전합니다(안 오는 아이를 태우러 가지 않도록).
  const isAbsent = /(결석|안\s*가|못\s*가|등원\s*안|병결|absent|not\s+com)/i.test(text);
  const isPickupWord = /(픽업|데리러|하원\s*안|차\s*안\s*타|pick\s*up)/i.test(text);
  if (!isAbsent && !isPickupWord) return null;

  return {
    kind: isAbsent ? "absent" : "pickup",
    from: range.from,
    to: range.to,
    why: text.slice(0, 60),
  };
}

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
  const { iso: todayKst, weekday: todayWeekday } = kstParts(receivedAt);

  const channel = parseChannelLabel(input.channelLabel);
  const channelHint = channel
    ? `\n\n[채널 정보] 이 연락은 "${channel.names.join(", ")}" 학생(${channel.grades.join(", ")}) 가정의 대화방에서 왔습니다.`
    : "";

  let ai: AiOut = {};
  try {
    // AI가 "이번주 목요일"을 실제 날짜로 옮기려면 오늘이 며칠 무슨 요일인지 알아야 합니다.
    const wd = ["일", "월", "화", "수", "목", "금", "토"][todayWeekday] ?? "?";
    const todayHint = `\n\n[오늘] ${todayKst} (${wd}요일). 이번 주 월요일은 ${mondayOfWeek(todayKst, todayWeekday)}입니다.`;
    const raw = await callClaudeJson(SYSTEM, `연락 내용:\n"""\n${text}\n"""${channelHint}${todayHint}`, {
      model: CLAUDE_MODEL_FAST,
      maxTokens: 500,
      route: "pickup-ingest",
    });
    ai = (raw ?? {}) as AiOut;
  } catch {
    // AI 호출이 실패해도 연락 자체를 버리면 안 됩니다. 문의로 남겨 사람이 보게 합니다.
    ai = { kind: "문의", confidence: 0, note: "AI 판단에 실패해 사람 확인이 필요합니다." };
  }

  const kind = (pick(ai.kind, ["픽업", "문의", "기타"]) ?? "문의") as "픽업" | "문의" | "기타";
  let confidence = typeof ai.confidence === "number" ? Math.max(0, Math.min(1, ai.confidence)) : 0;

  // 발신자별 학습(요청 ⑩): 이 발신자를 과거에 어떻게 정정했는지로 신뢰도를 조정합니다.
  // 분류(kind)는 바꾸지 않고, 자동확정 여부만 조정해 오분류를 만들지 않습니다.
  // - 대개 픽업이었던 발신자의 픽업 → 신뢰도↑(더 빨리 자동확정)
  // - 대개 픽업이 아니었던 발신자의 픽업 → 신뢰도↓(사람이 한 번 더 확인)
  if (kind === "픽업") {
    const senderKey = ((input.senderName ?? "") || (input.channelLabel ?? "")).trim();
    if (senderKey) {
      const { data: fb } = await supabase
        .from("pickup_sender_feedback")
        .select("pickup_count, not_pickup_count")
        .eq("sender_key", senderKey)
        .maybeSingle();
      if (fb) {
        const p = (fb.pickup_count as number) ?? 0;
        const np = (fb.not_pickup_count as number) ?? 0;
        if (np >= 2 && np > p) confidence = Math.min(confidence, 0.4);
        else if (p >= 3 && p > np * 2) confidence = Math.max(confidence, 0.9);
      }
    }
  }

  // ── 학생 연결 ─────────────────────────────────────────────────────────────
  // 채널 이름을 먼저 믿습니다. 학교가 정한 규칙이라 자유 문장보다 훨씬 정확합니다.
  let candidateName: string | null = null;
  let grade: string | null = null;
  if (channel) {
    grade = channel.grades[0] ?? null;
    if (!channel.isSibling) candidateName = channel.names[0];
    // 형제 방 - 본문에서 누구인지 가려냅니다. 못 가리면 사람에게 넘깁니다.
    else candidateName = pickSiblingFromText(text, channel.names);
  }
  // 채널 정보가 없으면(전화·교사 전달 등) AI가 읽어낸 이름을 씁니다.
  if (!candidateName && typeof ai.student_name === "string") candidateName = ai.student_name;

  const matched = candidateName ? matchStudent(candidateName, roster, grade) : null;
  // 담임을 함께 적어둡니다 - 문의를 담임별로 묶어 보거나, 업무로 넘길 때 담당자를 미리
  // 채우는 데 씁니다.
  const homeroomEmail = matched ? await findHomeroomEmail(supabase, matched.id) : null;

  // ── 기타(답이 필요 없는 인사·확인)는 남기지 않습니다 ──────────────────────
  // 학부모 대화를 쌓아두는 시스템이 되면 안 됩니다. 다만 같은 메시지를 매번 다시 AI에 보내지
  // 않으려면 "이건 이미 봤다"는 표시는 남겨야 해서, 출처 식별자만 남기고 본문은 비웁니다.
  if (kind === "기타") {
    if (input.sourceRef) {
      await supabase.from("pickup_requests").insert({
        service_date: todayKst,
        kind: "기타",
        source: input.source,
        source_ref: input.sourceRef,
        channel_label: input.channelLabel ?? null,
        received_at: receivedAt.toISOString(),
        // 본문은 남기지 않습니다(학부모 대화를 쌓아두지 않겠다는 원칙 그대로).
        raw_text: null,
        // 다만 **한 줄 요약과 판단 근거는 남깁니다.**
        //
        // 담당자: "토들 긁어오는데 업무보드, 업무 대시보드에 반영이 안 돼."
        // 실측해보니 24시간에 들어온 31건 중 9건이 '기타'로 조용히 버려지고 있었고,
        // 본문도 요약도 없어서 **무엇을 왜 버렸는지 확인할 방법이 아예 없었습니다.**
        // 진짜 인사말이었는지 잘못 버린 것인지 사람이 검증할 수 없다는 뜻입니다.
        //
        // 요약 한 줄은 원문이 아니라 "무엇에 관한 글이었나"라서 쌓아두는 부담이 훨씬 작고,
        // 대신 잘못 버린 것을 찾아낼 수 있게 됩니다. 안 남기는 것보다 이쪽이 낫습니다.
        summary: typeof ai.summary === "string" ? ai.summary.slice(0, 120) : null,
        ai_note: typeof ai.note === "string" ? ai.note.slice(0, 200) : null,
        ai_is_pickup: false,
        ai_confidence: confidence,
        status: "무시",
        resolved_at: new Date().toISOString(),
        resolved_by: "AI",
      });
    }
    return { kind: "기타", isPickup: false, status: "무시" };
  }

  // 앞으로의 날짜들. "이번주 목금"처럼 한 연락이 여러 날을 가리키는 경우가 많습니다.
  const dates = kind === "픽업" ? normalizePickupDates(ai.pickup_dates, todayKst) : [];

  // 대표 날짜는 그중 가장 이른 날로 잡습니다. 목록이 비었으면 예전처럼 오늘/내일로 봅니다.
  let serviceDate = dates[0]?.date ?? todayKst;
  if (dates.length === 0 && ai.date_hint === "tomorrow") {
    serviceDate = kstParts(new Date(receivedAt.getTime() + 24 * 60 * 60 * 1000)).iso;
  }

  // ── 이미 다른 경로로 들어온 건인지 ────────────────────────────────────────
  // 같은 일이면 새 줄을 만들지 않고 먼저 들어온 줄에 붙입니다. 두 줄이 뜨면 같은 일을 두 번
  // 처리하게 되고, 한쪽만 처리하면 다른 쪽이 미처리로 남아 계속 눈에 걸립니다.
  if (matched) {
    const dup = await findDuplicate(supabase, {
      studentId: matched.id,
      serviceDate: dates[0]?.date ?? todayKst,
      kind,
      text,
      source: input.source,
    });
    if (dup) {
      const already = dup.merged_sources ?? [];
      await supabase
        .from("pickup_requests")
        .update({
          merged_sources: already.includes(input.source) ? already : [...already, input.source],
          merged_count: (already.length || 0) + 1,
          merged_at: new Date().toISOString(),
        })
        .eq("id", dup.id);
      return { skipped: "duplicate", id: dup.id, kind, isPickup: kind === "픽업" };
    }
  }

  // ── 매주 반복되는 픽업 ────────────────────────────────────────────────────
  //
  // 담당자: "픽업 건도 매주 금요일이면 오늘이 금요일이라 오늘 건이야. 게다가 매주니까
  //          오늘을 포함한 매주 금요일 셔틀을 안 타도록 수정해야 하는 거야."
  //
  // 정확합니다. "매주 금요일 픽업"은 그날 하루짜리 연락이 아니라 **셔틀 배정 자체를 바꾸는
  // 일**입니다. 한 번짜리로 처리하면 다음 주 금요일에 아이가 그냥 차에 타버립니다.
  //
  // 그래서 지속 특이사항(shuttle_persistent_notes)으로 올립니다. 이 표는 매일 아침 크론이
  // 읽어 그날 해당 요일이면 픽업으로 찍어줍니다 - 사람이 매주 다시 입력하지 않아도 됩니다.
  const WD_NUM: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
  const aiRecurDays = Array.isArray(ai.recurring_weekdays)
    ? (ai.recurring_weekdays as unknown[]).map((d) => WD_NUM[String(d).trim()]).filter((n): n is number => !!n)
    : [];

  // AI 답과 **규칙**을 합칩니다.
  //
  // 담당자: "Theo is pick up everyfriday 3:10! 이걸 킴태오 픽업으로 만들었더라고.
  //          everyfriday 매주 금요일인데 이 부분을 무시하고 그냥 태오 픽업으로 넣어버렸어."
  //
  // 프롬프트에는 'every Friday'를 반복으로 보라는 규칙이 이미 있었는데도 놓쳤습니다. 붙여
  // 쓴 'everyfriday', 앞에 길게 붙은 멘션, 영어·한국어가 섞인 문장 - 모델이 흔들릴 이유는
  // 많고, 놓쳤을 때 **아무 표시도 남지 않습니다.** 오늘 픽업으로 잘 들어간 것처럼 보이고
  // 다음 주 금요일에 아이가 그냥 차를 탑니다.
  //
  // 그래서 규칙(@/lib/recurrence)으로 한 번 더 봅니다. 둘 중 하나라도 반복이라고 하면
  // 반복으로 봅니다 - 한 번짜리를 반복으로 잘못 보면 사람이 특이사항에서 지우면 되지만,
  // 반복을 한 번짜리로 잘못 보면 아무도 모른 채 지나갑니다.
  const ruleRecurDays = extractRecurringWeekdays(text);
  const recurDays = [...new Set([...aiRecurDays, ...ruleRecurDays])].sort((a, b) => a - b);

  if (kind === "픽업" && recurDays.length > 0 && matched) {
    // 이미 같은 학생·같은 요일로 올려둔 것이 있으면 또 만들지 않습니다.
    const { data: dup } = await supabase
      .from("shuttle_persistent_notes")
      .select("id")
      .eq("student_id", matched.id)
      .eq("effect_kind", "pickup")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (!dup) {
      await supabase
        .from("shuttle_persistent_notes")
        .insert({
          term: "정규학기",
          student_id: matched.id,
          student_name: matched.name,
          content: `매주 ${weekdayLabel(recurDays)}요일 픽업 (학부모 연락으로 자동 등록)`,
          effect_kind: "pickup",
          effect_days: recurDays,
          effect_from: todayKst,
          created_by: "AI(반복 픽업)",
        })
        .then(undefined, () => undefined); // 표가 아직 없어도 수집 자체는 멈추지 않습니다.

      // 특이사항은 **임시 방편**입니다. 매일 아침 픽업으로 덮어써 주지만, 명단 자체는
      // 그대로라 표에는 계속 그 아이가 타는 것으로 보입니다.
      //
      // 담당자: "매주 금요일 건은 특정 날짜가 아니라 계속 셔틀이 바뀌는 거라서,
      //          셔틀 메뉴의 하원 셔틀 명단에서 아예 금요일 체크를 풀어서 바꿀게."
      //
      // 그게 맞습니다. 근본은 배정입니다. 그래서 사람이 손볼 일을 업무로 남깁니다 -
      // 이걸 안 남기면 "특이사항으로 처리됐으니 됐지" 하고 명단은 영영 안 고쳐집니다.
      const wdLabel = weekdayLabel(recurDays);
      await supabase
        .from("tasks")
        .insert({
          case_id: genCaseId("TSK"),
          title: `[셔틀 명단 수정] ${matched.name} - 매주 ${wdLabel}요일 픽업`,
          status: "예정",
          priority: "높음",
          position: Date.now(),
          due_date: todayKst,
          description: [
            `${matched.name} 학생이 매주 ${wdLabel}요일에는 보호자가 직접 데려갑니다.`,
            "",
            "셔틀 > 탑승배정에서 이 학생의 하원 배정에서 " + wdLabel + "요일 체크를 풀어주세요.",
            "그 전까지는 매일 아침 자동으로 픽업 표시만 해둡니다(명단에는 그대로 남아 있습니다).",
            "",
            `학부모 원문: ${input.text.slice(0, 200)}`,
          ].join("\n"),
        })
        .then(undefined, () => undefined);
    }
  }

  const isPickup = kind === "픽업";
  // 반복인 것 같은데 **요일을 못 집어낸** 경우.
  //
  // "앞으로 계속 제가 데리러 갈게요"처럼 요일이 없는 반복도 있습니다. 이런 글을 하루짜리로
  // 자동 확정해버리면 아무 표시도 안 남고, 다음부터는 아이가 그냥 차를 탑니다.
  // 요일을 모르면 기계가 정할 수 없으니, **사람이 반드시 한 번 보게** 확정을 막습니다.
  const looksRecurringButUnclear = recurDays.length === 0 && hasRecurringPhrase(text);

  // 픽업 자동 확정 조건: AI가 충분히 확신하고, 학생이 명부에서 하나로 특정되었을 때만.
  // 문의는 자동으로 처리할 것이 없으므로 항상 사람이 봅니다.
  const autoConfirm = isPickup && confidence >= AUTO_CONFIRM_MIN && !!matched && !looksRecurringButUnclear;

  const { data, error } = await supabase
    .from("pickup_requests")
    .insert({
      service_date: serviceDate,
      kind,
      source: input.source,
      source_ref: input.sourceRef ?? null,
      source_chat_id: input.chatId ?? null,
      source_url: input.sourceUrl ?? null,
      channel_label: input.channelLabel ?? null,
      sender_name: input.senderName ?? null,
      received_at: receivedAt.toISOString(),
      raw_text: text,
      ai_is_pickup: isPickup,
      ai_student_name: candidateName,
      ai_pickup_time: isPickup ? normalizeTime(ai.pickup_time) : null,
      ai_confidence: confidence,
      // 반복으로 읽었으면 그 사실을 근거에 남깁니다. 인박스에서 "왜 확정이 안 됐지"를
      // 그 자리에서 알 수 있어야 합니다.
      ai_note: [
        typeof ai.note === "string" ? ai.note : null,
        recurDays.length > 0 ? `반복 감지: 매주 ${weekdayLabel(recurDays)}요일 (지속 특이사항으로 등록)` : null,
        looksRecurringButUnclear ? "반복되는 약속으로 보이는데 요일을 읽지 못했습니다. 사람이 확인해주세요." : null,
      ]
        .filter(Boolean)
        .join(" / ")
        .slice(0, 300) || null,
      inquiry_type: isPickup ? null : pick(ai.inquiry_type, INQUIRY_TYPES),
      summary: typeof ai.summary === "string" ? ai.summary.slice(0, 200) : null,
      urgency: pick(ai.urgency, URGENCIES),
      student_id: matched?.id ?? null,
      matched_name: matched?.name ?? null,
      homeroom_email: homeroomEmail,
      status: autoConfirm ? "확정" : "확인대기",
      resolved_by: autoConfirm ? "AI" : null,
      resolved_at: autoConfirm ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw error;

  const requestId = data?.id as string | undefined;

  // ── 하루짜리인가, 기간인가 ────────────────────────────────────────────────
  //
  // 담당자: "우선 원칙은 그날만 일시적인 픽업인 거야. 근데 '~까지 픽업', 또는 '언제까지
  //          결석'이라는 문구가 나오면 그건 특이사항에 올려서 그 기간 동안 반영되게."
  //
  // 두 가지는 성격이 다릅니다.
  //   "오늘 3시에 픽업이요"        → 그날 하루. 예약 한 줄이면 됩니다.
  //   "금요일까지 픽업이요"        → 한 상태가 며칠 이어지는 것.
  //
  // 뒤쪽을 날짜마다 예약으로 흩뿌리면 **중간에 하나가 빠져도 아무도 모릅니다.** 그리고
  // 하원체크표를 보는 사람은 "이 아이가 언제까지 이런 상태인지"를 알 수 없습니다 - 오늘
  // 한 줄만 보이니까요. 그래서 특이사항 한 줄로 두고 매일 그날 해당하는지 봅니다.
  const period = detectPeriod(text, receivedAt);
  let persistentNoteId: string | null = null;

  if (period && requestId && matched) {
    const { data: noteRow } = await supabase
      .from("shuttle_persistent_notes")
      .insert({
        term: "정규학기",
        student_name: matched.name,
        student_id: matched.id,
        content: `${period.kind === "pickup" ? "픽업" : "결석"} · ${period.from} ~ ${period.to} (${period.why})`,
        effect_kind: period.kind,
        effect_from: period.from,
        effect_to: period.to,
        request_id: requestId,
        created_by: "AI(수집기)",
      })
      .select("id")
      .single();
    persistentNoteId = (noteRow?.id as string | undefined) ?? null;
  }

  // ── 앞으로의 날짜를 예약해둡니다 ──────────────────────────────────────────
  // 오늘 것은 바로 반영하고, 나머지는 그날 아침 크론이 꺼내갑니다. 사람이 기억하고 있다가
  // 그날 손으로 거는 방식은 반드시 언젠가 빠집니다.
  //
  // 기간으로 잡힌 건은 특이사항이 맡으므로 예약을 따로 만들지 않습니다 - 두 곳이 같은 날을
  // 각각 반영하면 화면에 두 번 뜨고, 하나를 취소해도 다른 하나가 남습니다.
  let scheduled = 0;
  if (isPickup && requestId && dates.length > 0 && !persistentNoteId) {
    const rows = dates.map((d) => ({
      request_id: requestId,
      student_id: matched?.id ?? null,
      student_name: matched?.name ?? candidateName,
      service_date: d.date,
      pickup_time: d.time ?? normalizeTime(ai.pickup_time),
      // 오늘 것은 아래에서 바로 반영하므로 곧장 적용됨으로 적습니다.
      status: d.date === todayKst && autoConfirm && matched ? "적용됨" : "예정",
      // 확실치 않은 표현이거나 학생을 특정하지 못했으면 사람이 한 번 봐야 합니다.
      needs_confirm: !d.certain || !matched,
      source_note: d.why,
      homeroom_email: homeroomEmail,
      applied_at: d.date === todayKst && autoConfirm && matched ? new Date().toISOString() : null,
    }));
    const { error: schedErr } = await supabase.from("pickup_schedules").upsert(rows, {
      onConflict: "request_id,service_date",
    });
    if (!schedErr) scheduled = rows.length;
  }

  if (autoConfirm && matched) await applyPickup(supabase, matched.id, serviceDate);

  return {
    id: requestId,
    kind,
    isPickup,
    status: autoConfirm ? "확정" : "확인대기",
    studentName: matched?.name ?? candidateName,
    pickupTime: isPickup ? normalizeTime(ai.pickup_time) : null,
    scheduledDates: dates.map((d) => d.date),
    scheduledCount: scheduled,
  };
}

/** 학생의 반 담임 이메일을 찾습니다. 반이 없거나 담임이 아직 가입 전이면 null입니다. */
async function findHomeroomEmail(supabase: SupabaseClient, studentId: string): Promise<string | null> {
  const { data: student } = await supabase.from("wr_students").select("class_id").eq("id", studentId).maybeSingle();
  if (!student?.class_id) return null;
  const { data: cls } = await supabase.from("wr_classes").select("teacher_email").eq("id", student.class_id).maybeSingle();
  return (cls?.teacher_email as string | null) ?? null;
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
    .select("id, name, name_en, grade, birth_date, class_name")
    .eq("is_demo", false)
    .in("status", ["active", "보류"]);
  return (data ?? []) as RosterEntry[];
}
