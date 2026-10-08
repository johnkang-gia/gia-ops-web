import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { loadConsultState } from "@/lib/consult/server";
import PrintButton from "@/components/consult/PrintButton";
import { APP_ORIGIN } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

/**
 * 상담실 문에 붙이는 QR — 한 장에 한 방씩(A4 반 장 크기).
 *
 * 태블릿을 방마다 둘 수 없을 때 씁니다. 그 방에 들어간 선생님이 아무 휴대폰으로나 찍으면 그 방의
 * 호출·시작·종료 화면이 열립니다. 학부모가 찍어도 그 방의 단추만 보이므로, 문 **안쪽**이나 책상
 * 위에 붙이는 편이 좋습니다.
 */
export default async function ConsultRoomQrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/consult");

  const supabase = await createClient();
  const { state, error } = await loadConsultState(supabase, id, { phones: false });
  if (!state) return <p className="p-6 text-rose-700">QR을 만들지 못했습니다: {error}</p>;

  // 종이에 찍히는 주소라 언제나 운영 주소로 만듭니다 - 미리보기 주소가 찍히면 배포 뒤 열리지 않습니다.
  const cards = await Promise.all(
    state.rooms.map(async (r) => {
      const url = `${APP_ORIGIN}/cr/${r.room_short_code}`;
      return { r, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 360 }) };
    }),
  );

  return (
    <div className="p-6 print:p-0">
      <div className="mb-4 flex items-center gap-3 print:hidden">
        <h1 className="text-lg font-bold">{state.event.name} — 상담실 QR {cards.length}장</h1>
        <PrintButton />
        {!state.event.room_links_enabled && <span className="text-sm text-amber-700">지금은 설정에서 상담실 링크가 꺼져 있습니다.</span>}
      </div>
      <div className="grid grid-cols-2 gap-4 print:gap-3">
        {cards.map(({ r, url, qr }) => (
          <div key={r.id} className="break-inside-avoid rounded-xl border-2 border-slate-400 p-5 text-center">
            <p className="text-xs text-slate-500">{state.event.name}</p>
            <p className="mt-1 text-3xl font-extrabold">{r.name}</p>
            {r.teacher_name && <p className="text-base text-slate-600">{r.teacher_name}</p>}
            <img src={qr} alt="" className="mx-auto my-3 h-48 w-48" />
            <p className="text-sm font-semibold text-slate-800">찍으면 이 방의 호출 · 시작 · 종료 화면이 열립니다</p>
            <p className="text-xs text-slate-500">Scan to call · start · finish conferences in this room</p>
            <p className="mt-2 font-mono text-xs text-slate-500">{url}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
