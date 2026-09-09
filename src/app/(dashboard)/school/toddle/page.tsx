import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { ROSTER_SELECT, toRosterEntries } from "@/lib/pickupParse";
import ToddleChannelsClient, { type ChannelRow, type StudentOption } from "@/components/school/ToddleChannelsClient";

export const dynamic = "force-dynamic";

/**
 * **토들 채팅방 ↔ 학생 연결** — 학기에 한 번 하는 일.
 *
 * 토들 방 이름은 학교가 정한 규칙이라('G2_Reina Park_Office') 누구 이야기인지가 방 이름에
 * 이미 적혀 있습니다. 그런데 지금까지는 글이 들어올 때마다 그 이름을 글자로 다시 풀었습니다 -
 * 매번 같은 계산을 하고, 매번 같은 곳에서 틀렸습니다.
 *
 * 학기 초에 한 번 이어두면 그 뒤로는 풀 일이 없습니다. **사람이 확인한 연결은 글자 해석보다
 * 언제나 믿을 만합니다.**
 */
export default async function ToddleChannelsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const canEdit = isAdminUser(me);

  const supabase = await createClient();

  // 이미 만들어진 방 + 연결된 학생.
  const [{ data: channels, error: chErr }, { data: links }, { data: students }, { data: seen }] = await Promise.all([
    supabase.from("toddle_channels").select("id, label, grades, confirmed_at, confirmed_by, ignored, last_seen_at").order("label"),
    supabase.from("toddle_channel_students").select("channel_id, student_id, seq").order("seq"),
    supabase.from("wr_students").select(ROSTER_SELECT).eq("is_demo", false).eq("status", "active").order("name"),
    // 아직 표에 없는 방. 수집된 글의 채널 이름에서 찾아옵니다 - 토들에서 방 목록을 따로
    // 받아올 길이 없으니, **실제로 글이 들어온 방**이 우리가 아는 전부입니다.
    supabase
      .from("pickup_requests")
      .select("channel_label, received_at")
      .not("channel_label", "is", null)
      .order("received_at", { ascending: false })
      .limit(2000),
  ]);

  // 못 읽으면 조용히 빈 화면을 보여주지 않습니다. 「연결할 방이 없다」와 「못 읽었다」가
  // 똑같아 보이면, 사람은 다 끝난 줄 알고 넘어갑니다.
  const loadError = chErr ? `채널 목록을 읽지 못했습니다: ${chErr.message}` : null;

  const roster = toRosterEntries(students);
  const studentOptions: StudentOption[] = roster.map((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.name_en,
    grade: s.grade,
    className: s.class_name ?? null,
  }));

  const linkByChannel = new Map<string, string[]>();
  for (const l of (links as { channel_id: string; student_id: string }[] | null) ?? []) {
    (linkByChannel.get(l.channel_id) ?? linkByChannel.set(l.channel_id, []).get(l.channel_id)!).push(l.student_id);
  }

  const rows: ChannelRow[] = ((channels as
    | { id: string; label: string; grades: string | null; confirmed_at: string | null; confirmed_by: string | null; ignored: boolean; last_seen_at: string | null }[]
    | null) ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    confirmedAt: c.confirmed_at,
    confirmedBy: c.confirmed_by,
    ignored: c.ignored,
    lastSeenAt: c.last_seen_at,
    studentIds: linkByChannel.get(c.id) ?? [],
  }));

  // 글은 들어왔는데 아직 표에 없는 방을 덧붙입니다. 이렇게 하면 수집기를 고치지 않아도
  // **오늘 연락이 온 방**은 전부 이 목록에 뜹니다.
  const known = new Set(rows.map((r) => r.label));
  const lastByLabel = new Map<string, string>();
  for (const r of (seen as { channel_label: string; received_at: string }[] | null) ?? []) {
    const label = (r.channel_label ?? "").trim();
    if (!label || known.has(label)) continue;
    if (!lastByLabel.has(label)) lastByLabel.set(label, r.received_at);
  }
  for (const [label, at] of lastByLabel) {
    rows.push({ id: null, label, confirmedAt: null, confirmedBy: null, ignored: false, lastSeenAt: at, studentIds: [] });
  }

  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-5">
      <ToddleChannelsClient rows={rows} students={studentOptions} canEdit={canEdit} loadError={loadError} />
    </div>
  );
}
