import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import ExhibitSheet from "@/components/accreditation/ExhibitSheet";
import { loadVisitSchedule } from "@/lib/accreditation";

export const dynamic = "force-dynamic";

const DAY_EN = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

/**
 * **방문단 수업 참관 일정표** — 그날 몇 교시에 어느 반이 어느 교실에서 누구와 무엇을 하는지, 영문 한 장(가로).
 *
 * 시간표 자료를 그대로 읽습니다. 참관 직전에 시간표가 바뀌면 다시 뽑기만 하면 됩니다 - 손으로 옮긴 표는 바뀐 것을
 * 모릅니다. 방문 첫날(11월 6일)이 금요일이라 기본은 금요일입니다. 둘째 날(토)은 정규 시간표가 없어 고르는 칸에 없습니다.
 */
export default async function VisitSchedulePage({ searchParams }: { searchParams: Promise<{ day?: string; date?: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");
  const sp = await searchParams;
  const weekday = Math.min(5, Math.max(1, Number(sp.day) || 5));
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : "2026-11-06";

  const supabase = await createClient();
  const depts = await loadVisitSchedule(supabase, weekday);

  return (
    <ExhibitSheet
      landscape
      title="Classroom Visit Schedule"
      subtitle={`Accreditation visit · ${DAY_EN[weekday]}, ${date} · regular timetable by period, class, teacher and room`}
      period={`${DAY_EN[weekday]} timetable`}
      generated={todayKst()}
      source="School timetable"
    >
      <div className="no-print" style={{ margin: "10px 0", fontSize: 12 }}>
        요일:{" "}
        {[1, 2, 3, 4, 5].map((d) => (
          <a key={d} href={`?day=${d}&date=${date}`} style={{ marginRight: 8, fontWeight: d === weekday ? 800 : 400, textDecoration: d === weekday ? "underline" : "none" }}>
            {DAY_EN[d]}
          </a>
        ))}
      </div>
      {depts.length === 0 && <p className="note">No timetable entries for this day.</p>}
      {depts.map((d) => (
        <div key={d.dept} style={{ breakInside: "avoid" }}>
          <h2>{d.dept}</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: 92 }}>Period</th>
                {d.classes.map((c) => (
                  <th key={c.id}>
                    {c.label}
                    {c.room ? <div style={{ fontWeight: 400, fontSize: 9, opacity: 0.85 }}>Room {c.room}</div> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.periods.map((p) => (
                <tr key={p.no}>
                  <td>
                    <b>{p.label}</b>
                    <div style={{ fontSize: 9, color: "#64748b" }}>{p.time}</div>
                  </td>
                  {p.cells.map((cell, i) => (
                    <td key={i}>
                      {cell ? (
                        <>
                          <b>{cell.subject}</b>
                          {cell.teacher && <div style={{ fontSize: 9.5 }}>{cell.teacher}</div>}
                          {cell.room && cell.room !== d.classes[i].room && <div style={{ fontSize: 9, color: "#64748b" }}>Room {cell.room}</div>}
                        </>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </ExhibitSheet>
  );
}
