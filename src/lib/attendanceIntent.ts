// 한 문장에 아이가 둘인데 **서로 다른 이야기**를 하는 경우를 가려냅니다.
//
// 실제로 틀렸던 문장입니다.
//
//   "오늘 여명인 괜찮은데, 이제는 여전히 열나고 아파 하루 더 쉬도록 하겠습니다.
//    여명이는 정상등원 합니다!"
//
// 쉬는 아이는 **이제**이고 여명이는 정상등원인데, 여명이가 결석으로 들어갔습니다.
// 형제 대화방이라 두 이름이 다 나오고, 문장 전체를 한 덩이로 읽으면 **먼저 나온 이름**이
// 결석을 뒤집어씁니다.
//
// **왜 문장 전체로 보면 안 되는가:** 지금까지는 메시지 하나에 상태 하나(결석/픽업/지각)를
// 정하고 그 메시지에서 찾은 학생 전원에게 똑같이 붙였습니다. 형제방에서는 이 전제가
// 깨집니다. 한 아이는 쉬고 한 아이는 갑니다.
//
// 그래서 **이름이 있는 절(節)만** 보고 그 아이의 상태를 정합니다.
//
// **왜 등원 쪽을 더 세게 보는가:** 두 실수의 무게가 다릅니다.
//   · 오는 아이를 결석으로 잘못 찍으면 → 셔틀 명단에서 빠져 **아이가 차를 못 탑니다.**
//   · 안 오는 아이를 등원으로 두면 → 기사님이 잠깐 기다리고 사람이 확인 전화를 합니다.
// 앞쪽이 훨씬 위험하므로, 한 절에 "정상등원"이 적혀 있으면 그 아이는 결석으로 보지 않습니다.

export type StudentIntent = "결석" | "픽업" | "등원" | null;

/** "괜찮" 같은 말이 부정으로 쓰인 경우("안 괜찮아서"). 이건 등원 신호가 아닙니다. */
const NEGATED_FINE = /(안\s*괜찮|괜찮지\s*않|안괜찮)/;

const ATTEND = /(정상\s*등원|정상\s*등교|등원\s*(합니다|해요|하겠|할\s*예정|예정|시킬|시킵)|등교\s*(합니다|해요|하겠|할\s*예정|예정|시킬|시킵)|괜찮|멀쩡|다\s*나았|나았|호전|회복|평소대로|as\s*usual|will\s*attend|attends?\b|is\s*fine|feeling\s*better|no\s*problem)/i;

const ABSENT = /(결석|쉬(도록|게|려|겠|기로|는|어야)|하루\s*더\s*쉬|못\s*(가|와|옵)|안\s*(가|와|옵)|등원\s*안|등교\s*안|병결|조퇴|absent|absence|not\s*coming|stay(ing)?\s*home|won'?t\s*(be\s*)?(come|coming|attend))/i;

const PICKUP = /(픽업|픽엄|데리러|직접\s*데려|pick\s*-?\s*up)/i;

/**
 * 문장을 절 단위로 자릅니다.
 *
 * 한국어는 "~한데", "~지만"으로 앞뒤 이야기가 뒤집히는 일이 잦아서, 마침표만으로 자르면
 * "여명인 괜찮은데 이제는 아파서 쉽니다"가 통째로 한 덩이가 됩니다. 뒤집는 어미와 쉼표도
 * 경계로 봅니다.
 */
export function splitClauses(text: string): string[] {
  return (text ?? "")
    .replace(/([.!?。])/g, "$1")
    .replace(/(는데|은데|지만|으나|나서|고요|구요)(?=[\s,]|$)/g, "$1")
    // 영어도 뒤집는 접속사에서 자릅니다. "Ryeomyeong will attend but Ije is absent"를
    // 한 덩이로 읽으면 둘 다 등원이 됩니다.
    .replace(/\s(but|however|while|whereas|though|although)\s/gi, "\x01 $1 ")
    .replace(/([,、])/g, "$1")
    .replace(/\n/g, "")
    .split("")
    .map((s) => s.trim())
    .filter((s) => /[가-힣A-Za-z]/.test(s));
}

/**
 * 이름 하나를 문장에서 찾을 때 쓸 표기들.
 *
 * "강여명"은 본문에 "여명인", "여명이는"으로 나옵니다. 성을 뗀 이름이 실제로 쓰이는 표기라
 * 함께 넣습니다. 영어 이름은 **성을 빼고 이름만** 씁니다 - 형제는 성이 같아서 성으로는
 * 구별이 안 됩니다.
 */
export function nameSurfaces(korean?: string | null, english?: string | null): string[] {
  const out = new Set<string>();
  const ko = (korean ?? "").trim();
  if (ko) {
    out.add(ko);
    // 한국 성은 대개 한 글자입니다. 두 글자 성(남궁·황보 등)은 드물어 여기서는 다루지 않습니다.
    if (ko.length >= 3) out.add(ko.slice(1));
  }
  const en = (english ?? "").trim();
  if (en) {
    const first = en.split(/\s+/)[0];
    if (first.length >= 2) out.add(first);
  }
  return [...out].filter((s) => s.length >= 2);
}

function clauseHasName(clause: string, surfaces: readonly string[]): boolean {
  const c = clause.toLowerCase().replace(/\s+/g, "");
  return surfaces.some((s) => c.includes(s.toLowerCase().replace(/\s+/g, "")));
}

/** 절 하나가 말하는 상태. 등원 신호가 있으면 결석보다 등원이 이깁니다(위 주석 참고). */
function clauseIntent(clause: string): StudentIntent {
  const attend = ATTEND.test(clause) && !NEGATED_FINE.test(clause);
  if (attend) return "등원";
  if (PICKUP.test(clause)) return "픽업";
  if (ABSENT.test(clause)) return "결석";
  return null;
}

/**
 * 이 학생이 **이 문장에서** 어떤 상태인지. 이름이 없으면 null(= 알 수 없음).
 *
 * 이름이 여러 절에 나오면 한 번이라도 "등원"이라고 적힌 쪽을 믿습니다.
 */
export function intentForStudent(text: string, surfaces: readonly string[]): StudentIntent {
  if (surfaces.length === 0) return null;
  const own = splitClauses(text).filter((c) => clauseHasName(c, surfaces));
  if (own.length === 0) return null;
  const intents = own.map(clauseIntent);
  if (intents.includes("등원")) return "등원";
  if (intents.includes("픽업")) return "픽업";
  if (intents.includes("결석")) return "결석";
  return null;
}

export type SiblingRead = { key: string; surfaces: string[]; intent: StudentIntent };

/**
 * 형제 여럿 중 **지금 처리해야 할 아이**를 고릅니다.
 *
 * 돌려주는 것:
 *   pick       처리 대상 한 명(결석·픽업이라고 적힌 아이). 못 고르면 null.
 *   attending  "정상등원"이라고 명시된 아이들 - 이 아이들은 절대 결석으로 찍으면 안 됩니다.
 *   conflict   서로 다른 상태가 섞여 있는지. 사람이 한 번 봐야 한다는 신호입니다.
 */
export function readSiblings(text: string, siblings: readonly { key: string; surfaces: string[] }[]) {
  const reads: SiblingRead[] = siblings.map((s) => ({ ...s, intent: intentForStudent(text, s.surfaces) }));
  const actionable = reads.filter((r) => r.intent === "결석" || r.intent === "픽업");
  const attending = reads.filter((r) => r.intent === "등원").map((r) => r.key);
  const pick = actionable.length === 1 ? actionable[0] : null;
  const kinds = new Set(reads.map((r) => r.intent).filter(Boolean));
  return { reads, pick, attending, conflict: kinds.size > 1 };
}
