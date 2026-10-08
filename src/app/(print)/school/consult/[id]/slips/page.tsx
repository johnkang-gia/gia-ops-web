import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { loadConsultState } from "@/lib/consult/server";
import { timeToMinutes } from "@/lib/consult/model";
import PrintButton from "@/components/consult/PrintButton";
import { APP_ORIGIN } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

/**
 * 학부모 안내지 — 예약마다 한 칸, QR을 찍으면 «내 순서»가 휴대폰에 뜹니다(로그인 없음).
 *
 * 안내데스크에서 도착한 학부모께 건네거나, 미리 가정통신문과 함께 보냅니다. QR 은 그 예약
 * 하나만 여는 열쇠입니다 - 다른 가정의 순서는 보이지 않습니다.
 */
export default async function ConsultSlipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/consult");

  const supabase = await createClient();
  const { state, error } = await loadConsultState(supabase, id, { phones: false });
  if (!state) return <p className="p-6 text-rose-700">안내지를 만들지 못했습니다: {error}</p>;
  if (!state.event.personal_links_enabled) {
    return <p className="p-6 text-slate-700">이 행사는 학부모 개인 확인 링크가 꺼져 있습니다. 설정에서 켠 뒤 다시 열어 주세요.</p>;
  }

  // 종이에 찍혀 학부모 손에 가는 주소입니다 - 언제나 운영 주소로 만듭니다.
  const origin = APP_ORIGIN;
  const studentById = new Map(state.students.map((s) => [s.id, s]));
  const roomName = new Map(state.rooms.map((r) => [r.id, r.name]));
  const appts = state.appts
    .filter((a) => a.status !== "취소")
    .sort((x, y) => (timeToMinutes(x.scheduled_time) ?? 9999) - (timeToMinutes(y.scheduled_time) ?? 9999));
  const slips = await Promise.all(
    appts.map(async (a) => ({
      a,
      qr: await QRCode.toDataURL(`${origin}/consult-me/${a.personal_token}`, { margin: 1, width: 220 }),
      names: a.student_ids.map((sid) => {
        const s = studentById.get(sid);
        return s ? `${s.name}${s.grade ? ` (${s.grade}${s.class_name ? ` ${s.class_name}` : ""})` : ""}` : "?";
      }),
    })),
  );

  return (
    <div className="p-6 print:p-0">
      <div className="mb-4 flex items-center gap-3 print:hidden">
        <h1 className="text-lg font-bold">{state.event.name} — 학부모 안내지 {slips.length}장</h1>
        <PrintButton />
      </div>
      <div className="grid grid-cols-3 gap-3 print:gap-2">
        {slips.map(({ a, qr, names }) => (
          <div key={a.id} className="break-inside-avoid rounded-lg border border-slate-300 p-3 text-center">
            <p className="text-[11px] text-slate-500">{state.event.name}</p>
            <p className="mt-1 text-base font-bold">{names.join(" · ")}</p>
            <p className="text-sm text-slate-700">
              {a.scheduled_time ?? "시각 미정"} · {a.room_id ? roomName.get(a.room_id) : "상담실 안내 예정"}
            </p>
            <img src={qr} alt="" className="mx-auto my-2 h-32 w-32" />
            <p className="text-[11px] leading-tight text-slate-600">휴대폰 카메라로 찍으면 내 순서와 예상 대기 시간이 보입니다.</p>
            <p className="text-[10px] text-slate-400">Scan to see your place in line.</p>
          </div>
        ))}
      </div>
    </div>
  );
}
