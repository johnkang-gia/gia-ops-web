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

// ── 지난 줄 되짚어 채우기 ────────────────────────────────────────────────────

/** `pickup_requests` 한 줄 중 되짚기에 필요한 것만. */
export type BackfillRow = {
  id: string;
  channel_label: string | null;
  student_id: string | null;
  matched_name: string | null;
  ai_student_name: string | null;
};

/** 사람이 확인한 방 하나. 확인 안 된 방은 넘기지 않습니다. */
export type BackfillChannel = {
  label: string;
  students: OwnerCandidate[];
};

export type BackfillPlan = {
  /** 바로 채울 수 있는 줄. 방에 아이가 한 명뿐입니다. */
  fill: { id: string; studentId: string; studentName: string; channel: string }[];
  /** 형제방이라 사람이 골라야 하는 줄. */
  ask: { id: string; channel: string; candidates: OwnerCandidate[] }[];
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
export function planBackfill(rows: BackfillRow[], channels: BackfillChannel[]): BackfillPlan {
  const byLabel = new Map<string, BackfillChannel>();
  for (const c of channels) {
    const k = labelKey(c.label);
    if (k) byLabel.set(k, c);
  }

  const plan: BackfillPlan = { fill: [], ask: [], skip: [] };
  for (const r of rows) {
    // 이미 정해진 줄은 건드리지 않습니다. 사람이 고른 것을 되짚기가 덮으면 안 됩니다.
    if (r.student_id) continue;

    const key = labelKey(r.channel_label);
    const ch = key ? byLabel.get(key) : undefined;
    if (!ch) {
      plan.skip.push({
        id: r.id,
        channel: r.channel_label,
        why: key ? "사람이 확인한 방 목록에 이 방이 없습니다." : "방 이름이 비어 있습니다.",
      });
      continue;
    }
    if (ch.students.length === 1) {
      plan.fill.push({ id: r.id, studentId: ch.students[0].id, studentName: ch.students[0].name, channel: ch.label });
    } else if (ch.students.length > 1) {
      plan.ask.push({ id: r.id, channel: ch.label, candidates: ch.students });
    } else {
      plan.skip.push({ id: r.id, channel: ch.label, why: "이 방에 이어진 학생이 없습니다." });
    }
  }
  return plan;
}
