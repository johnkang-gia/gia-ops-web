/**
 * 아직 없을 수도 있는 칸을 섞어서 읽습니다.
 *
 * PostgREST 는 없는 칸을 **하나라도** 적으면 질의 전체를 400 으로 되돌립니다. 그래서
 * 마이그레이션이 아직 안 돌아간 DB에서는 표 한 칸이 없다는 이유로 화면이 통째로 비고,
 * 보는 사람은 자료가 없는 것인지 고장난 것인지 알 수 없습니다.
 * (보호자 연락처 칸 하나 때문에 인보이스 명단 137명이 전부 안 나온 적이 있습니다.)
 *
 * 여기서는 없는 칸만 빼고 다시 읽되, **무엇이 없었는지를 돌려줍니다.** 조용히 넘어가면
 * 안 됩니다 — 부르는 쪽에서 그 이름을 화면에 띄워야 사람이 SQL 을 돌릴 수 있습니다.
 */
type Res<T> = { data: T[] | null; error: { message: string; code?: string } | null };

/** `column wr_students.mother_phone does not exist` 에서 `mother_phone` 만 꺼냅니다. */
function missingColumnOf(message: string): string | null {
  const m = /column\s+(?:[\w."]+\.)?"?([\w]+)"?\s+does not exist/i.exec(message);
  return m ? m[1] : null;
}

export async function selectTolerant<T>(
  run: (columns: string) => PromiseLike<Res<T>>,
  required: string[],
  optional: string[],
): Promise<{ data: T[]; missing: string[]; error: string | null }> {
  let live = [...optional];
  const missing: string[] = [];

  // 없는 칸은 한 번에 하나씩만 알려주기 때문에, 빠질 수 있는 칸 수만큼 다시 시도합니다.
  for (let attempt = 0; attempt <= optional.length; attempt++) {
    const res = await run([...required, ...live].join(", "));
    if (!res.error) return { data: res.data ?? [], missing, error: null };

    const gone = missingColumnOf(res.error.message);
    if (!gone || !live.includes(gone)) {
      return { data: [], missing, error: res.error.message };
    }
    live = live.filter((c) => c !== gone);
    missing.push(gone);
  }
  return { data: [], missing, error: "읽을 수 있는 칸을 찾지 못했습니다." };
}
