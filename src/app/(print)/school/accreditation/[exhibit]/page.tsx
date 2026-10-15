import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import ExhibitSheet, { Kpi, monthEn, pct, ratio } from "@/components/accreditation/ExhibitSheet";
import {
  EXHIBITS,
  loadAttendance,
  loadEnrollment,
  loadFaculty,
  loadGovernance,
  loadParents,
  loadProgress,
  loadSafety,
  loadTermRange,
  type ExhibitKey,
} from "@/lib/accreditation";

export const dynamic = "force-dynamic";

/**
 * 인증 증거 한 장(영문). 주소의 `std` 가 있으면 머리말에 «Standard N» 을 적습니다 - 기준 번호는 담당자가 목록 화면에서
 * 고르고, 이 화면은 받은 번호를 그대로 찍기만 합니다(Ai 기준표와 맞추는 일은 사람이 합니다).
 */
export default async function ExhibitPage({
  params,
  searchParams,
}: {
  params: Promise<{ exhibit: string }>;
  searchParams: Promise<{ std?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");
  const { exhibit } = await params;
  const meta = EXHIBITS.find((e) => e.key === exhibit);
  if (!meta) notFound();
  const std = Number((await searchParams).std);
  const exhibitNo = std >= 1 && std <= 12 ? `STANDARD ${std}` : undefined;

  const supabase = await createClient();
  const term = await loadTermRange(supabase);
  const generated = todayKst();
  const common = { exhibitNo, title: meta.title, generated };

  switch (exhibit as ExhibitKey) {
    case "enrollment": {
      const d = await loadEnrollment(supabase);
      return (
        <ExhibitSheet {...common} period={`As of ${generated}`} source="Student roster (active enrollment)">
          <div className="kpis">
            <Kpi value={d.total} label="Students currently enrolled" />
            {d.byDept.map(([k, n]) => (
              <Kpi key={k} value={n} label={k} />
            ))}
            <Kpi value={d.avgClassSize ?? "—"} label="Average class size" />
          </div>
          <h2>Enrollment by grade</h2>
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th>Grade</th>
                <th className="num">Students</th>
              </tr>
            </thead>
            <tbody>
              {d.gradeRows.map((r) => (
                <tr key={r.dept + r.grade}>
                  <td>{r.dept}</td>
                  <td>{r.grade}</td>
                  <td className="num">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Class composition</h2>
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th>Grade</th>
                <th>Class</th>
                <th className="num">Students</th>
              </tr>
            </thead>
            <tbody>
              {d.classRows.map((r) => (
                <tr key={r.dept + r.grade + r.cls}>
                  <td>{r.dept}</td>
                  <td>{r.grade}</td>
                  <td>{r.cls}</td>
                  <td className="num">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">Largest class: {d.maxClassSize ?? "—"} students. Grade 6 is administered within the Middle &amp; High School division.</p>
        </ExhibitSheet>
      );
    }
    case "faculty": {
      const d = await loadFaculty(supabase);
      return (
        <ExhibitSheet {...common} period={`As of ${generated}`} source="Class organization and subject assignment records">
          <div className="kpis">
            <Kpi value={d.classes.length} label="Homeroom classes" />
            <Kpi value={d.teacherCount} label="Teachers with assignments" />
            <Kpi value={d.subjects.length} label="Subject sections" />
            <Kpi value={d.classes.length ? Math.round((d.studentTotal / d.classes.length) * 10) / 10 : "—"} label="Students per homeroom" />
          </div>
          <h2>Homeroom classes</h2>
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th>Grade</th>
                <th>Class</th>
                <th>Homeroom teacher</th>
                <th>Co-teacher</th>
                <th>Room</th>
                <th className="num">Students</th>
              </tr>
            </thead>
            <tbody>
              {d.classes.map((c) => (
                <tr key={c.id}>
                  <td>{c.dept}</td>
                  <td>{c.grade}</td>
                  <td>{c.cls}</td>
                  <td>{c.homeroom}</td>
                  <td>{c.assistant}</td>
                  <td>{c.room}</td>
                  <td className="num">{c.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.subjects.length > 0 && (
            <>
              <h2>Subject teaching assignments</h2>
              <table>
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Subject</th>
                    <th>Class</th>
                  </tr>
                </thead>
                <tbody>
                  {d.subjects.map((s, i) => (
                    <tr key={i}>
                      <td>{s.teacher}</td>
                      <td>{s.name}</td>
                      <td>{s.cls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </ExhibitSheet>
      );
    }
    case "attendance": {
      const d = await loadAttendance(supabase, term);
      return (
        <ExhibitSheet {...common} period={`${term.label} · ${d.coverageStart && d.coverageStart > term.from ? d.coverageStart : term.from} – ${term.to}`} source="Daily attendance register">
          <div className="kpis">
            <Kpi value={pct(d.school.rate)} label="School-wide attendance rate" />
            <Kpi value={d.schoolDays} label="Instructional days recorded" />
            <Kpi value={d.school.students} label="Students" />
            <Kpi value={d.school.absent} label="Student-days absent" />
          </div>
          <h2>By division</h2>
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th className="num">Students</th>
                <th className="num">Attendance rate</th>
                <th className="num">Absences</th>
                <th className="num">Late arrivals</th>
                <th className="num">Early leaves</th>
              </tr>
            </thead>
            <tbody>
              {d.byDept.map(({ key, g }) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td className="num">{g.students}</td>
                  <td className="num">{pct(g.rate)}</td>
                  <td className="num">{g.absent}</td>
                  <td className="num">{g.late}</td>
                  <td className="num">{g.earlyLeave}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>By month</h2>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Instructional days</th>
                <th className="num">Attendance rate</th>
                <th className="num">Absences</th>
              </tr>
            </thead>
            <tbody>
              {d.byMonth.map(({ month, g }) => (
                <tr key={month}>
                  <td>{monthEn(month)}</td>
                  <td className="num">{g.schoolDays}</td>
                  <td className="num">{pct(g.rate)}</td>
                  <td className="num">{g.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>By class</h2>
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th>Grade</th>
                <th>Class</th>
                <th className="num">Students</th>
                <th className="num">Attendance rate</th>
                <th className="num">Absences</th>
              </tr>
            </thead>
            <tbody>
              {d.byClass.map((r) => (
                <tr key={r.dept + r.grade + r.cls}>
                  <td>{r.dept}</td>
                  <td>{r.grade}</td>
                  <td>{r.cls}</td>
                  <td className="num">{r.g.students}</td>
                  <td className="num">{pct(r.g.rate)}</td>
                  <td className="num">{r.g.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            Attendance rate = (instructional days − absences) ÷ instructional days. Late arrivals and early leaves are recorded separately and do not
            reduce the attendance rate. Holidays and non-instructional days are excluded using the school calendar. Absence reasons are recorded as
            illness, excused, other or unexcused.
            {d.truncated ? " (Note: record volume exceeded the export ceiling; figures may be incomplete.)" : ""}
          </p>
        </ExhibitSheet>
      );
    }
    case "progress": {
      const d = await loadProgress(supabase, term);
      return (
        <ExhibitSheet {...common} subtitle="Bi-weekly teacher observation reports on academics, behavior and overall development" period={`${term.label} · ${term.from} – ${term.to}`} source="Weekly/bi-weekly student observation reports">
          <div className="kpis">
            <Kpi value={d.total} label="Observation reports written" />
            <Kpi value={pct(ratio(d.covered, d.students))} label="Students with at least one report" />
            <Kpi value={pct(ratio(d.published, d.total))} label="Reports finalized and shared" />
            <Kpi value={d.students ? Math.round((d.total / d.students) * 10) / 10 : "—"} label="Reports per student" />
          </div>
          <h2>Coverage by class</h2>
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th>Grade</th>
                <th>Class</th>
                <th className="num">Students</th>
                <th className="num">Students covered</th>
                <th className="num">Reports</th>
                <th>Latest report</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.dept + r.grade + r.cls}>
                  <td>{r.dept}</td>
                  <td>{r.grade}</td>
                  <td>{r.cls}</td>
                  <td className="num">{r.students}</td>
                  <td className="num">
                    {r.covered} ({pct(ratio(r.covered, r.students))})
                  </td>
                  <td className="num">{r.reports}</td>
                  <td>{r.last || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.subjects.length > 0 && (
            <>
              <h2>Reports by subject area</h2>
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th className="num">Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {d.subjects.map(([s, n]) => (
                    <tr key={s}>
                      <td>{s}</td>
                      <td className="num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="note">
            Each report records the teacher&apos;s observations on academic progress, participation, behavior and social development, together with
            next steps. Reports are reviewed before being shared with families.
          </p>
        </ExhibitSheet>
      );
    }
    case "safety": {
      const d = await loadSafety(supabase);
      return (
        <ExhibitSheet {...common} period={`Last 30 days (${d.since} – ${generated}) · routes as of ${generated}`} source="Shuttle routes, GPS stop arrivals, dismissal checklist log and driving safety events">
          <div className="kpis">
            <Kpi value={d.routes} label="Active shuttle routes" />
            <Kpi value={d.assignedStudents} label="Students assigned to a route" />
            <Kpi value={d.trackedRoutes} label="Routes with live GPS tracking" />
            <Kpi value={d.stops} label="Registered stops" />
          </div>
          <h2>Routes by service</h2>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th className="num">Routes</th>
              </tr>
            </thead>
            <tbody>
              {d.byDirection.map(([k, n]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Daily safety procedures (last 30 days)</h2>
          <table>
            <thead>
              <tr>
                <th>Procedure</th>
                <th className="num">Records</th>
                <th className="num">Days with records</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Dismissal checklist — every student&apos;s boarding / pick-up / absence confirmed by staff</td>
                <td className="num">{d.checklistEntries}</td>
                <td className="num">{d.checklistDays}</td>
              </tr>
              <tr>
                <td>GPS-confirmed bus arrivals at stops</td>
                <td className="num">{d.gpsArrivals}</td>
                <td className="num">{d.gpsDays}</td>
              </tr>
              <tr>
                <td>Driving safety alerts (harsh braking / acceleration) reviewed</td>
                <td className="num">{d.hardBrake + d.hardAccel}</td>
                <td className="num">—</td>
              </tr>
            </tbody>
          </table>
          <p className="note">
            Each afternoon, staff confirm every student on the dismissal checklist (boarded, picked up by a guardian, or absent) before buses depart;
            changes requested by parents are logged with the time and the staff member. Buses report their position by GPS so the office can confirm
            arrivals at each stop. Students not using the shuttle are released only to their registered guardian.
            {d.readErrors.length ? ` (Some records could not be read: ${d.readErrors.join("; ")})` : ""}
          </p>
        </ExhibitSheet>
      );
    }
    case "governance": {
      const d = await loadGovernance(supabase, term);
      return (
        <ExhibitSheet {...common} period={`${term.label} · ${term.from} – ${term.to}`} source="Meeting minutes, incident records and school event reviews">
          <div className="kpis">
            <Kpi value={d.meetings.total} label="Staff meetings documented" />
            <Kpi value={d.incidents.total} label="Incidents recorded" />
            <Kpi value={pct(ratio(d.incidents.withAction, d.incidents.total))} label="Incidents with documented action" />
            <Kpi value={d.events.total} label="School events held" />
          </div>
          <h2>Activity by month</h2>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Meetings</th>
                <th className="num">Incidents</th>
                <th className="num">Events</th>
              </tr>
            </thead>
            <tbody>
              {d.byMonth.map((r) => (
                <tr key={r.month}>
                  <td>{monthEn(r.month)}</td>
                  <td className="num">{r.meetings}</td>
                  <td className="num">{r.incidents}</td>
                  <td className="num">{r.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.incidents.byCategory.length > 0 && (
            <>
              <h2>Incidents by policy area</h2>
              <table>
                <thead>
                  <tr>
                    <th>Policy area (staff manual category)</th>
                    <th className="num">Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {d.incidents.byCategory.map(([k, n]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="note">
            Meetings are minuted with attendees, decisions and next agenda ({d.meetings.withFollowUp} of {d.meetings.total} meetings carried a
            follow-up agenda). Each incident is recorded with what went well, what was lacking, the improvement suggested and the action taken, and is
            linked to the relevant section of the staff manual so that procedures are updated. {d.events.reviewed} of {d.events.total} events were
            reviewed after the event in the same format.
          </p>
        </ExhibitSheet>
      );
    }
    case "parents": {
      const d = await loadParents(supabase, term);
      return (
        <ExhibitSheet {...common} period={`${term.label} · ${term.from} – ${term.to}`} source="Parent messages (Toddle / Google Chat), inquiry log and parent conference records">
          <div className="kpis">
            <Kpi value={d.messages} label="Parent messages handled" />
            <Kpi value={d.inquiries} label="Parent inquiries" />
            <Kpi value={pct(ratio(d.answered, d.inquiries))} label="Inquiries answered" />
            <Kpi value={d.medianHours == null ? "—" : `${d.medianHours} h`} label="Median response time" />
          </div>
          <h2>Messages by type</h2>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">Messages</th>
              </tr>
            </thead>
            <tbody>
              {d.byKind.map(([k, n]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.byType.length > 0 && (
            <>
              <h2>Inquiries by topic</h2>
              <table>
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th className="num">Inquiries</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byType.map(([k, n]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {d.conferences.length > 0 && (
            <>
              <h2>Parent–teacher conferences</h2>
              <table>
                <thead>
                  <tr>
                    <th>Conference</th>
                    <th>Date</th>
                    <th className="num">Families booked</th>
                    <th className="num">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {d.conferences.map((c) => (
                    <tr key={c.name + c.date}>
                      <td>{c.name}</td>
                      <td>{c.end && c.end !== c.date ? `${c.date} – ${c.end}` : c.date}</td>
                      <td className="num">{c.booked}</td>
                      <td className="num">{c.done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="note">
            Every parent message is collected into one office inbox, classified (attendance, pick-up, inquiry) and assigned to the homeroom teacher or
            office. Inquiries are tracked until answered.
            {d.readErrors.length ? ` (Some records could not be read: ${d.readErrors.join("; ")})` : ""}
          </p>
        </ExhibitSheet>
      );
    }
    case "data": {
      return (
        <ExhibitSheet {...common} period={`As of ${generated}`} source="GIA Ops system configuration">
          <h2>How student information is protected</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: "28%" }}>Control</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Role-based access", "Staff sign in with individual school accounts and roles. Guardian contact details and finance records are limited to authorized office and finance staff; teacher accounts cannot read them."],
                ["Database-level locks", "Every table holding student or financial data is protected by row-level security in the database itself, so access rules apply even outside the app screens."],
                ["Data minimization on public screens", "Lobby displays and parent links receive only the fields they show; names are masked where screens are public."],
                ["Daily automatic backup", "All operational data is exported every day to storage separate from the main database, in addition to the hosting provider's own backups."],
                ["Safe restore", "Restores show a preview of every change and save a copy of the current state first; nothing is deleted by default."],
                ["Activity log", "Key actions (attendance changes, dismissal changes, finance approvals) record who made them and when."],
                ["Data quality checks", "Automated checks flag duplicate students, missing class assignments and mismatched totals for staff to resolve."],
              ].map(([a, b]) => (
                <tr key={a}>
                  <td>
                    <b>{a}</b>
                  </td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ExhibitSheet>
      );
    }
  }
}
