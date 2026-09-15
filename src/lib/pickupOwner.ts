/**
 * **이 연락은 누구 이야기인가** — 한 곳에서 정합니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 토들 방은 그 집 방입니다. 사람이 [학교 → 학생 → 토들 채널]에서 방↔학생을 한 번 이어
 * 두면, 그 방에서 온 연락이 누구 것인지는 **이미 정해져 있습니다.**
 *
 * 그런데 받는 쪽은 그 연결을 읽어놓고 **이름만 꺼내어 명부에서 다시 찾았습니다.**
 *
 *     if (linked.students.length === 1) candidateName = linked.students[0].name;
 *     …
 *     const matched = resolveStudent(candidateName, roster, …).student;
 *
 * 학생 번호를 손에 들고 있으면서 이름으로 되돌아간 것입니다. 그 되돌이에서
 * **이름이 겹치면(김재이가 셋) `resolveStudent` 는 「못 좁혔다」로 null 을 돌려주고**,
 * 표기가 조금만 달라도 못 찾습니다. 그래서 학생 번호가 비었습니다.
 *
 * 실측(2026-09-14): 학생이 안 정해진 토들 연락 211건 중 **134건**이 「사람이 확인했고 그
 * 방에 아이가 한 명뿐인」 방에서 왔습니다. 알 수 있었는데 안 붙은 것입니다.
 *
 * 화면에는 오류가 아니라 그냥 「누구인지 모르는 연락」으로 보이고, 그 줄은 출결에도 대조에도
 * 못 들어갑니다.
 *
 * ── 순서가 곧 규칙입니다 ────────────────────────────────────────────────────
 *
 * 1. **형제방에서 본문이 갈랐으면 그 아이.** 그 방 안의 아이 중 하나라 안전합니다.
 * 2. **방에 아이가 한 명이면 그 아이.** 이름을 다시 대조하지 않습니다 - 방이 곧 답입니다.
 * 3. **방 연결이 없을 때만 본문 이름을 풉니다.**
 *
 * 3번을 2번보다 앞에 두면 안 됩니다. 서우 어머님 방에 「하라도 픽업할게요」가 오면 본문
 * 해석은 하라를 가리키는데, 그 연락의 주인은 서우입니다. 하라는 별도로
 * `othersMentioned` 가 확인 필요로 따로 세웁니다 - 학부모에게 남의 아이 하원을 정할
 * 권한이 없기 때문입니다.
 */

export type OwnerCandidate = {
  id: string;
  name: string;
};

export type OwnerSource = "형제 구분" | "방 연결" | "본문 이름" | null;

export type OwnerDecision = {
  student: OwnerCandidate | null;
  source: OwnerSource;
  /** 사람에게 그대로 보여줄 한 줄. 왜 이 아이로 정했는지(또는 왜 못 정했는지). */
  why: string;
  /** 방은 이어져 있는데 형제라 본문이 안 갈린 경우. 사람이 골라야 합니다. */
  needsPick: OwnerCandidate[];
};

export function decideOwner(input: {
  /** 사람이 확인한 방에 이어진 아이들. 확인 안 된 방은 아예 넘기지 않습니다. */
  linkedStudents: OwnerCandidate[] | null;
  /** 형제방에서 본문이 고른 아이. `readSiblings` 의 결과를 학생으로 바꾼 것. */
  siblingPick: OwnerCandidate | null;
  /** 본문 이름을 명부에서 푼 결과. */
  fromText: OwnerCandidate | null;
  /** 본문을 못 푼 이유(있으면). 화면에 그대로 붙습니다. */
  textWhy?: string | null;
}): OwnerDecision {
  const linked = input.linkedStudents ?? [];

  // ① 형제방에서 본문이 갈랐습니다. 방 안의 아이라 안전합니다.
  if (input.siblingPick && linked.some((s) => s.id === input.siblingPick!.id)) {
    return {
      student: input.siblingPick,
      source: "형제 구분",
      why: `형제방에서 본문이 ${input.siblingPick.name} 을(를) 가리킵니다.`,
      needsPick: [],
    };
  }

  // ② 방에 아이가 한 명. **이름을 다시 찾지 않습니다.**
  if (linked.length === 1) {
    return {
      student: linked[0],
      source: "방 연결",
      why: `사람이 이어 둔 방입니다 — 이 방의 아이는 ${linked[0].name} 한 명입니다.`,
      needsPick: [],
    };
  }

  // ③ 형제방인데 본문이 안 갈렸습니다. **고르지 않고 사람에게 묻습니다.**
  //    둘 중 하나를 기계가 찍으면 오는 아이가 셔틀에서 빠지거나, 안 오는 아이가 남습니다.
  if (linked.length > 1) {
    return {
      student: null,
      source: null,
      why: `형제방입니다(${linked.map((s) => s.name).join("·")}). 본문에서 누구인지 갈리지 않아 사람이 골라야 합니다.`,
      needsPick: linked,
    };
  }

  // ④ 방 연결이 없습니다. 이때만 본문 이름을 씁니다.
  if (input.fromText) {
    return {
      student: input.fromText,
      source: "본문 이름",
      why: `방 연결이 없어 본문에서 ${input.fromText.name} 을(를) 읽었습니다.`,
      needsPick: [],
    };
  }

  return {
    student: null,
    source: null,
    why: input.textWhy || "방 연결도 없고 본문에서도 학생을 읽지 못했습니다.",
    needsPick: [],
  };
}


// ── 학생 한 명이 꼭 필요한 글인가 ───────────────────────────────────────────

/**
 * **모든 연락에 아이를 한 명 정할 필요는 없습니다.**
 *
 * 남은 형제방 52건의 본문을 실제로 읽어 보고 알게 된 것입니다.
 *
 *     「언제까지 노트북 준비 하면 될까요?」
 *     「아이들 화목 방과후 다음주부터 부탁드립니다」
 *     「감사 인사」
 *
 * 이런 글에 아이를 한 명 찍으면 **오히려 틀립니다** - 「아이들 화목 방과후」를 형 한 명 것으로
 * 적으면 동생 기록에서 그 연락이 사라집니다.
 *
 * 아이가 한 명으로 정해져야 하는 것은 **출결·하원에 반영되는 글**뿐입니다. 그 글은 누구를
 * 셔틀에서 빼고 누구를 출석부에 적을지를 정하므로, 한 명이 아니면 아무것도 할 수 없습니다.
 *
 * 그 밖의 글은 **집만 확정되면 충분합니다**(`channel_id`). 그 집 아이들 모두의 이력에
 * 함께 뜨는 것이 사실에 더 가깝습니다.
 *
 * 실측(2026-09-15): 형제방 52건 중 학생 한 명이 필요한 글은 **4건**이었습니다.
 */
const NEEDS_ONE_STUDENT_INQUIRY = ["출결", "차량·하원"];

export function needsOneStudent(kind: string | null | undefined, inquiryType: string | null | undefined): boolean {
  // 픽업은 그 아이를 오늘 셔틀에서 빼는 일입니다. 누구인지 모르면 할 수 없습니다.
  if ((kind ?? "") === "픽업") return true;
  return NEEDS_ONE_STUDENT_INQUIRY.includes(inquiryType ?? "");
}

// ── 지난 줄 되짚어 채우기 ────────────────────────────────────────────────────

/** `pickup_requests` 한 줄 중 되짚기에 필요한 것만. */
export type BackfillRow = {
  id: string;
  channel_label: string | null;
  student_id: string | null;
  matched_name: string | null;
  ai_student_name: string | null;
  /** 형제방을 가르는 유일한 재료. 방이 하나뿐이라 본문 말고는 가릴 것이 없습니다. */
  raw_text: string | null;
  summary?: string | null;
  /** 아이를 한 명으로 정해야 하는 글인지 가릅니다(`needsOneStudent`). */
  kind?: string | null;
  inquiry_type?: string | null;
  /** 이미 집이 붙어 있는가. 붙어 있으면 다시 안 붙입니다. */
  channel_id?: string | null;
  /**
   * 「확정」이면 **사람이 이미 본 줄**입니다. 다시 물어보지 않습니다.
   *
   * 형제방 글의 절반은 「선우 다현이 셔틀버스 부탁」·「아이들 여행 일정」처럼 **둘 다**를
   * 가리킵니다. 한 명을 고르면 틀리므로, 사람이 「둘 다」라고 표시한 줄은 아이가 비어
   * 있는 채로 확정됩니다. 그 줄을 계속 물어보면 매일 같은 것을 다시 보게 됩니다.
   */
  status?: string | null;
};

/**
 * **형제방은 본문으로 가릅니다.**
 *
 * 토들은 한 집에 방이 하나입니다. 형제가 둘이어도 방은 하나라, 방을 학생별로 나눌 방법이
 * 없습니다. 그러니 「이 연락은 형·동생 중 누구 이야기인가」는 **본문을 읽어서** 정하는 수밖에
 * 없습니다.
 *
 * 규칙은 하나입니다 — **본문에 표기가 나오는 형제가 정확히 한 명일 때만 고릅니다.**
 *
 *   「선우 오늘 결석합니다」        → 선우 (다현은 안 나옴)
 *   「선우랑 다현이 둘 다 픽업」    → 못 고름 (둘 다 나옴)
 *   「오늘 아이 결석합니다」        → 못 고름 (아무도 안 나옴)
 *
 * 둘 다 나오거나 아무도 안 나오면 **고르지 않고 사람에게 남깁니다.** 둘 중 하나를 기계가
 * 찍으면 오는 아이가 셔틀에서 빠지거나 안 오는 아이가 남습니다.
 *
 * 표기(`surfaces`)는 부르는 쪽이 만들어 넘깁니다 - 「선우」·「임선우」·영문명까지 한 아이의
 * 표기를 모으는 일은 `nameSurfaces` 가 이미 하고 있고, 여기서 다시 만들면 두 곳이 어긋납니다.
 */
export type SiblingWithSurfaces = OwnerCandidate & { surfaces: readonly string[] };

export function pickSiblingFromText(
  text: string,
  siblings: readonly SiblingWithSurfaces[],
): { student: OwnerCandidate; why: string } | null {
  const body = (text ?? "").toLowerCase();
  if (!body.trim()) return null;

  const hit = siblings.filter((s) => s.surfaces.some((w) => w && body.includes(w.toLowerCase())));
  if (hit.length === 1) {
    return { student: { id: hit[0].id, name: hit[0].name }, why: `형제방인데 본문에 ${hit[0].name} 만 나옵니다.` };
  }
  return null;
}

/**
 * 형제방 한 줄을 읽어 누구인지 고릅니다. 없으면 사람에게 남깁니다.
 *
 * 부르는 쪽이 넘깁니다 - 본문을 읽는 규칙(의도 읽기·표기 만들기)은 무거운 쪽에 있고,
 * 계획을 세우는 이 파일은 순수하게 두어야 시험할 수 있습니다.
 */
export type SiblingReader = (
  text: string,
  candidates: readonly OwnerCandidate[],
) => { student: OwnerCandidate; why: string } | null;

/** 사람이 확인한 방 하나. 확인 안 된 방은 넘기지 않습니다. */
export type BackfillChannel = {
  id: string;
  label: string;
  students: OwnerCandidate[];
};

export type BackfillPlan = {
  /** 바로 채울 수 있는 줄. 방에 아이가 한 명이거나, 형제방이지만 본문이 갈라 준 경우입니다. */
  fill: { id: string; studentId: string; studentName: string; channel: string; why: string }[];
  /**
   * **집만 붙이고 넘어가는 줄.** 형제방인데 본문이 안 갈렸지만, 아이를 한 명 정할 필요가
   * 없는 글입니다(문의·기타). 그 집 아이들 모두의 이력에 뜹니다.
   */
  house: { id: string; channelId: string; channel: string; candidates: OwnerCandidate[] }[];
  /**
   * 형제방인데 본문으로도 못 갈랐고, **아이가 한 명 정해져야 하는 글**입니다.
   * 이때만 사람이 봅니다 - 출결·하원은 누구인지 모르면 아무것도 할 수 없습니다.
   */
  ask: { id: string; channelId: string; channel: string; candidates: OwnerCandidate[]; text: string | null }[];
  /** 방을 못 찾았거나 아직 확인 안 된 방. */
  skip: { id: string; channel: string | null; why: string }[];
};

/** 방 이름을 열쇠로 씁니다. 대소문자·공백 차이로 못 찾는 일이 없도록 납작하게. */
export function labelKey(label: string | null | undefined): string {
  return String(label ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * **이미 있는 줄에 학생 번호를 되짚어 채울 계획을 세웁니다.**
 *
 * 계획만 세우고 아무것도 고치지 않습니다. 화면이 먼저 보여주고 사람이 누른 뒤에 나갑니다 -
 * 211줄을 한 번에 말없이 고치면, 틀렸을 때 무엇이 바뀌었는지 되짚을 수가 없습니다.
 */
export function planBackfill(
  rows: BackfillRow[],
  channels: BackfillChannel[],
  /**
   * 형제방을 본문으로 가르는 사람. 안 넘기면 형제방은 전부 사람에게 남습니다.
   *
   * **토들은 한 집에 방이 하나입니다.** 형제가 둘이어도 방을 나눌 수 없으니, 본문 말고는
   * 가릴 것이 없습니다. 그래서 「형제방이면 무조건 사람이 고른다」로 두면 70줄이 그대로
   * 쌓입니다 - 옮겨가야 하는 일은 대개 안 합니다.
   */
  readSibling?: SiblingReader,
): BackfillPlan {
  const byLabel = new Map<string, BackfillChannel>();
  for (const c of channels) {
    const k = labelKey(c.label);
    if (k) byLabel.set(k, c);
  }

  const plan: BackfillPlan = { fill: [], house: [], ask: [], skip: [] };
  for (const r of rows) {
    const key = labelKey(r.channel_label);
    const ch = key ? byLabel.get(key) : undefined;
    if (!ch) {
      // 학생도 집도 못 붙입니다. 이미 학생이 정해진 줄이면 굳이 적지 않습니다.
      if (!r.student_id) {
        plan.skip.push({
          id: r.id,
          channel: r.channel_label,
          why: key ? "사람이 확인한 방 목록에 이 방이 없습니다." : "방 이름이 비어 있습니다.",
        });
      }
      continue;
    }

    // ── ① 집 붙이기 ─────────────────────────────────────────────────────
    //
    // **학생이 정해졌든 아니든 집은 붙입니다.** 방이 확정되면 집은 언제나 확정이고,
    // 그 확정을 버릴 이유가 없습니다.
    if (!r.channel_id) {
      plan.house.push({ id: r.id, channelId: ch.id, channel: ch.label, candidates: ch.students });
    }

    // ── ② 학생 정하기 ───────────────────────────────────────────────────
    //
    // 이미 정해진 줄은 건드리지 않습니다. 사람이 고른 것을 되짚기가 덮으면 안 됩니다.
    if (r.student_id) continue;

    if (ch.students.length === 0) {
      plan.skip.push({ id: r.id, channel: ch.label, why: "이 방에 이어진 학생이 없습니다." });
      continue;
    }
    if (ch.students.length === 1) {
      plan.fill.push({
        id: r.id,
        studentId: ch.students[0].id,
        studentName: ch.students[0].name,
        channel: ch.label,
        why: "이 방의 아이는 한 명입니다.",
      });
      continue;
    }

    // 형제방. 방으로는 못 가르니 **본문을 읽습니다.**
    const text = (r.raw_text ?? r.summary ?? "").trim();
    const read = text && readSibling ? readSibling(text, ch.students) : null;
    if (read) {
      plan.fill.push({
        id: r.id,
        studentId: read.student.id,
        studentName: read.student.name,
        channel: ch.label,
        why: read.why,
      });
    } else if (needsOneStudent(r.kind, r.inquiry_type) && r.status !== "확정") {
      // 출결·하원에 반영되는 글입니다. 한 명이 아니면 아무것도 할 수 없으므로 사람이 봅니다.
      // **사람이 이미 본 줄(확정)은 빼고** 묻습니다 - 「둘 다」로 표시한 것을 매일 다시
      // 물어보면 그 목록을 아무도 안 보게 됩니다.
      plan.ask.push({ id: r.id, channelId: ch.id, channel: ch.label, candidates: ch.students, text: text || null });
    }
    // 그 밖의 글은 위에서 집을 붙였습니다. **사람에게 넘기지 않습니다** - 「아이들 화목
    // 방과후」에 아이를 한 명 찍으면 다른 아이 기록에서 그 연락이 사라집니다.
  }

  return plan;
}
