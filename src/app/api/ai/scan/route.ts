import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaudeJson, CLAUDE_MODEL_FAST } from "@/lib/ai/claude";
import {
  buildIncidentClassifySystemPrompt,
  buildIncidentEntryBlock,
  buildMeetingClassifySystemPrompt,
  buildMeetingEntryBlock,
} from "@/lib/ai/prompts";
import { findLegalFullText } from "@/lib/ai/lawReference";
import type { IncidentClassifyResult, MeetingClassifyResult } from "@/lib/ai/types";
import { genCaseId } from "@/lib/caseId";
import { logApiError } from "@/lib/logging";
import { loadPolicyCategoryNames } from "@/lib/policyCategories";

const BATCH_SIZE = 5;

type ScanType = "incidents" | "events" | "meetings";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const type = body.type as ScanType;
  const id = typeof body.id === "string" ? body.id : undefined;
  if (!["incidents", "events", "meetings"].includes(type)) {
    return NextResponse.json({ error: "type은 incidents/events/meetings 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    if (type === "meetings") {
      const created = await scanMeetings(supabase, id);
      return NextResponse.json({ success: true, created });
    }
    const created = await scanIncidentOrEvent(supabase, type, id);
    return NextResponse.json({ success: true, created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, `scan:${type}`, err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanIncidentOrEvent(supabase: any, type: "incidents" | "events", id?: string) {
  let query = supabase.from(type).select("*");
  if (id) {
    query = query.eq("id", id).is("scanned_at", null);
  } else {
    query = query.is("scanned_at", null).order("date", { ascending: true }).limit(BATCH_SIZE);
  }
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  if (!rows || !rows.length) return 0;

  const label = type === "incidents" ? "사건" : "행사";
  const existingCategories = await loadPolicyCategoryNames(supabase);
  let created = 0;

  for (const row of rows) {
    // 여러 사람이 거의 동시에 "새 기록 분석"을 눌러도 같은 기록을 두 번 처리(=AI 이중 호출 +
    // 제안 중복 생성)하지 않도록, AI를 부르기 전에 먼저 이 행을 원자적으로 "찜"합니다. 두 요청이
    // 동시에 같은 행을 읽어왔더라도 이 UPDATE(WHERE scanned_at IS NULL)는 Postgres가 하나만
    // 통과시키므로, 뒤에 도착한 요청은 claimed가 비어 있어 이 행을 조용히 건너뜁니다.
    const { data: claimed, error: claimErr } = await supabase
      .from(type)
      .update({ scanned_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("scanned_at", null)
      .select()
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) continue; // 다른 요청이 먼저 이 기록을 가져가 처리 중(또는 이미 처리 완료)

    try {
      const entry = {
        type: label,
        title: row.title || row.name || "",
        detail: row.detail || "",
        good: row.good || "",
        lack: row.lack || "",
        suggest: row.suggest || "",
        owner: row.owner || "",
        suggestedCat: row.manual_cat || "",
      };
      const systemPrompt = buildIncidentClassifySystemPrompt();
      const userPrompt = buildIncidentEntryBlock(entry, "신규 기록", existingCategories);
      const result = (await callClaudeJson(systemPrompt, userPrompt, {
        route: `scan:${type}`,
      })) as IncidentClassifyResult;

      const legalSummary = findLegalFullText(result.legalBasis);
      // targetDoc이 "둘다"면 학부모용/실무자용 각각 별도 제안으로 만듭니다(문자열 "둘다"를 그대로
      // target_doc에 저장하면 매뉴얼 화면의 학부모용/실무자용 탭 어디에도 매칭되지 않는 값이 됩니다).
      const targetDocs =
        result.targetDoc === "둘다" ? (["학부모용", "실무자용"] as const) : ([result.targetDoc || "실무자용"] as const);

      for (const targetDoc of targetDocs) {
        const { error: insertErr } = await supabase.from("proposals").insert({
          case_id: genCaseId("PRP"),
          source: type,
          source_id: row.case_id,
          date: row.date,
          target_doc: targetDoc,
          category: result.category || "미분류",
          domain: result.domain || null,
          // 예전에는 옵션들을 "\n\n[--- 다음 옵션 ---]\n\n"로 이어붙인 하나의 문자열로 저장해서,
          // 화면에 그 구분자 글자가 그대로 반복 노출되고 옵션 경계도 파싱하기 어려웠습니다(요청 7번:
          // "다음옵션이라는 글자가 계속 반복"). 이제 JSON 배열 문자열로 저장하고, 화면(parseOptions)에서
          // 파싱해 카드 형태로 렌더링합니다 - 컬럼 타입은 그대로 text라 마이그레이션이 필요 없습니다.
          remediation: JSON.stringify(result.remediationOptions || []),
          parent_msg: JSON.stringify(result.parentCommunicationOptions || []),
          student_edu: JSON.stringify(result.studentEducationOptions || []),
          final_text: result.suggestedFinal || (result.remediationOptions || [])[0] || "",
          legal_basis: result.legalBasis || "",
          applicability: result.legalApplicability || "",
          legal_summary: legalSummary,
          benchmark: result.benchmarkNote || "",
        });
        // 위 원자적 찜(claim) 로직이 정상 동작한다면 여기서 중복이 발생할 일은 없지만, 혹시
        // 모를 틈에 대비해 DB의 유니크 제약(source+source_id+target_doc)을 마지막 방어선으로
        // 둡니다. 23505(유니크 위반)는 "이미 생성됨"이라는 뜻이라 오류로 취급하지 않고 조용히
        // 건너뜁니다(반복 업무·학사일정 자동 생성과 동일한 패턴).
        if (insertErr && insertErr.code !== "23505") throw new Error(insertErr.message);
      }

      // 사건 자체에도 항목 태그를 남깁니다(요청: "그 항목을 기준으로 사건,회의,운영계획안을
      // 항목화") - 작성자가 이미 직접 골라둔 값이 있으면(수기 태그 우선) 덮어쓰지 않습니다.
      // events는 이 컬럼이 없어 사건(incidents)에만 적용합니다.
      if (type === "incidents" && result.category) {
        const patch: Record<string, string> = {};
        if (!row.manual_cat && targetDocs.includes("실무자용")) patch.manual_cat = result.category;
        if (!row.op_plan_cat && targetDocs.includes("학부모용")) patch.op_plan_cat = result.category;
        if (Object.keys(patch).length > 0) {
          await supabase.from("incidents").update(patch).eq("id", row.id);
        }
      }

      created += 1;
    } catch (err) {
      // 처리 도중 실패하면(AI 오류 등) 이 기록이 "분석 완료"로 잘못 남아 다음 배치 스캔에서
      // 영영 누락되지 않도록, 찜을 되돌려 다시 시도할 수 있게 합니다.
      await supabase.from(type).update({ scanned_at: null }).eq("id", row.id);
      throw err;
    }
  }

  return created;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanMeetings(supabase: any, id?: string) {
  let query = supabase.from("meetings").select("*");
  if (id) {
    query = query.eq("id", id).is("scanned_at", null);
  } else {
    query = query.is("scanned_at", null).order("date", { ascending: true }).limit(BATCH_SIZE);
  }
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  if (!rows || !rows.length) return 0;

  const existingCategories = await loadPolicyCategoryNames(supabase);
  let created = 0;

  for (const row of rows) {
    // 사건/행사 스캔과 동일하게, AI를 부르기 전에 이 회의를 원자적으로 먼저 찜해서 두 사람이
    // 동시에 "새 기록 분석"을 눌러도 같은 회의를 중복 처리하지 않게 합니다.
    const { data: claimed, error: claimErr } = await supabase
      .from("meetings")
      .update({ scanned_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("scanned_at", null)
      .select()
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) continue; // 다른 요청이 먼저 이 회의를 가져가 처리 중(또는 이미 처리 완료)

    try {
      const systemPrompt = buildMeetingClassifySystemPrompt();
      const userPrompt = buildMeetingEntryBlock(
        { date: row.date, attendees: row.attendees || "", content: row.content },
        "회의 정보",
        existingCategories
      );
      // 이미 결정된 회의 내용을 문서별로 분류/정리하는 작업이라 저렴한 모델(Haiku)로 처리합니다.
      const result = (await callClaudeJson(systemPrompt, userPrompt, {
        model: CLAUDE_MODEL_FAST,
        route: "scan:meetings",
      })) as MeetingClassifyResult;

      const proposals = result.proposals || [];
      const futurePlanItems: string[] = [];
      // 회의 하나에 안건이 여러 개면 항목도 여러 개일 수 있지만, 회의 행 자체엔 항목 컬럼이
      // 하나씩뿐이라 각 문서별 첫 번째 분류 결과만 대표로 남겨둡니다(요청: "그 항목을 기준으로
      // 사건,회의,운영계획안을 항목화"). 작성자가 이미 직접 골라둔 값이 있으면 덮어쓰지 않습니다.
      let firstManualCat = row.manual_cat as string | null;
      let firstOpPlanCat = row.op_plan_cat as string | null;

      for (const p of proposals) {
        if (p.targetDoc === "향후계획") {
          futurePlanItems.push(`[향후계획] ${p.finalText}`);
          continue;
        }
        if (p.targetDoc === "행사학기참고") {
          // 매뉴얼(규정)이 아니라 특정 행사/학기에 대한 회고이므로, 이름이 비슷한 행사 기록이나
          // 진행 중인 학기 기록을 찾아 "개선 제안"란에 자동으로 붙여둡니다(다음번 같은 행사/학기 때
          // AI 비교 리포트에 바로 반영됨). 매칭되는 기록이 없으면 회의록 자체의 확정 기록에 메모로 남깁니다.
          let matched = false;
          const guess = (p.eventNameGuess || "").trim();
          const note = `[회의록 참고, ${row.date}] ${p.finalText}`;

          if (guess && p.referenceKind === "학기") {
            // 진행 중인 같은 학기/캠프를 우선 찾고, 없으면 가장 최근 회차에 붙입니다.
            const { data: matchedTerms } = await supabase
              .from("terms")
              .select("id, suggest, status")
              .ilike("term_type", guess)
              .order("year", { ascending: false });
            const target =
              (matchedTerms || []).find((t: { status: string }) => t.status === "진행중") ??
              (matchedTerms || [])[0];
            if (target) {
              const merged = [target.suggest, note].filter(Boolean).join("\n\n");
              await supabase.from("terms").update({ suggest: merged }).eq("id", target.id);
              matched = true;
            }
          } else if (guess) {
            const { data: matchedEvents } = await supabase
              .from("events")
              .select("id, suggest")
              .ilike("name", `%${guess}%`)
              .order("date", { ascending: false })
              .limit(1);
            const target = matchedEvents?.[0];
            if (target) {
              const merged = [target.suggest, note].filter(Boolean).join("\n\n");
              await supabase.from("events").update({ suggest: merged }).eq("id", target.id);
              matched = true;
            }
          }

          if (!matched) {
            futurePlanItems.push(`[행사/학기 메모]${guess ? ` (${guess})` : ""} ${p.finalText}`);
          }
          continue;
        }
        const { error: insertErr } = await supabase.from("proposals").insert({
          case_id: genCaseId("PRP"),
          source: "meetings",
          source_id: row.case_id,
          date: row.date,
          target_doc: p.targetDoc,
          category: p.category || "미분류",
          domain: p.domain || null,
          final_text: p.finalText,
        });
        if (insertErr) throw new Error(insertErr.message);
        created += 1;

        if (p.targetDoc === "실무자용" && !firstManualCat && p.category) firstManualCat = p.category;
        if (p.targetDoc === "학부모용" && !firstOpPlanCat && p.category) firstOpPlanCat = p.category;
      }

      const nextAgendaText = (result.nextAgendaItems || []).join("\n");
      const futurePlanText = futurePlanItems.join("\n");

      await supabase
        .from("meetings")
        .update({
          scanned_at: new Date().toISOString(),
          next_agenda: [row.next_agenda, nextAgendaText].filter(Boolean).join("\n") || null,
          final_record: [row.final_record, futurePlanText].filter(Boolean).join("\n") || null,
          manual_cat: firstManualCat,
          op_plan_cat: firstOpPlanCat,
        })
        .eq("id", row.id);
    } catch (err) {
      // 처리 도중 실패하면 다음 배치 스캔에서 다시 시도할 수 있도록 찜을 되돌립니다.
      await supabase.from("meetings").update({ scanned_at: null }).eq("id", row.id);
      throw err;
    }
  }

  return created;
}
