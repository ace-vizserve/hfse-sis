import { gradeDescriptor } from '@/lib/compute/annual';
import type {
  AttendanceRecord,
  Cell,
  CommentRecord,
  ReportCardPayload,
} from '@/lib/report-card/build-report-card';

// Pure render component for a single report card. Staff preview + parent
// view both render this same component. Print CSS lives here; consumers
// must NOT wrap this in another card/surface or the print layout will
// regress.
export function ReportCardDocument({ payload }: { payload: ReportCardPayload }) {
  const { ay, terms, student, section, level, enrollment_status, subjects, attendance, comments } =
    payload;

  return (
    <article className="mx-auto w-full max-w-[8.5in] overflow-hidden rounded-2xl border border-hairline bg-white text-ink shadow-sm print:rounded-none print:border-0 print:shadow-none">
      {/* Letterhead — the full PNG carries logo, address, contact, registration */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/report-card/report-card-header.png"
        alt="HFSE International School · HFSE Global Education Group"
        className="block w-full"
      />

      <div className="space-y-8 px-10 py-8 print:px-8 print:py-6">
        {/* Document title band */}
        <header className="flex flex-col items-center gap-1 border-b border-hairline pb-5 text-center">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-4">
            Academic year {ay.label}
          </p>
          <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Student Progress Report
          </h1>
        </header>

        {/* Student info card */}
        <section className="rounded-xl border border-hairline bg-muted/40 p-5 print:break-inside-avoid">
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
            Student
          </p>
          <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            <InfoRow label="Name" value={student.full_name} />
            <InfoRow label="Student no." value={student.student_number} />
            <InfoRow label="Course" value={level.label} />
            <InfoRow label="Class" value={section.name} />
            <InfoRow label="Form Class Adviser" value={section.form_class_adviser ?? '—'} />
            <InfoRow label="Status" value={enrollment_status} />
          </div>
        </section>

        {/* Academic grades */}
        <section className="space-y-3 print:break-inside-avoid">
          <SectionHeading>Academic grades</SectionHeading>
          <div className="overflow-hidden rounded-xl border border-hairline">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                  <th className="px-4 py-2.5">Subject</th>
                  {terms.map((t) => (
                    <th key={t.id} className="w-14 py-2.5 text-center">
                      T{t.term_number}
                    </th>
                  ))}
                  <th className="w-16 py-2.5 text-center">Final</th>
                  <th className="px-4 py-2.5">Remark</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((row) => (
                  <tr key={row.subject.id} className="border-t border-hairline">
                    <td className="px-4 py-2 font-medium">{row.subject.name}</td>
                    <td className="py-2 text-center tabular-nums">
                      {cellText(row.t1, row.subject.is_examinable)}
                    </td>
                    <td className="py-2 text-center tabular-nums">
                      {cellText(row.t2, row.subject.is_examinable)}
                    </td>
                    <td className="py-2 text-center tabular-nums">
                      {cellText(row.t3, row.subject.is_examinable)}
                    </td>
                    <td className="py-2 text-center tabular-nums">
                      {cellText(row.t4, row.subject.is_examinable)}
                    </td>
                    <td className="py-2 text-center font-serif text-base font-semibold tabular-nums text-ink">
                      {row.subject.is_examinable ? row.annual ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-4">
                      {row.subject.is_examinable ? gradeDescriptor(row.annual) : 'Letter'}
                    </td>
                  </tr>
                ))}
                {subjects.length === 0 && (
                  <tr>
                    <td
                      colSpan={terms.length + 3}
                      className="py-6 text-center text-sm text-ink-4"
                    >
                      No subjects configured for {level.label}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Grading legend */}
        <section className="rounded-xl border border-hairline bg-accent/50 p-4 text-xs text-ink-3 print:break-inside-avoid">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
            Grading legend
          </p>
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            <div>90–100 · Outstanding</div>
            <div>A — Outstanding (90–100)</div>
            <div>85–89 · Very Satisfactory</div>
            <div>B — Very Satisfactory (85–89)</div>
            <div>80–84 · Satisfactory</div>
            <div>C — Satisfactory (80–84)</div>
            <div>75–79 · Fairly Satisfactory</div>
            <div>IP — In Progress (&lt; 80)</div>
            <div>&lt; 75 · Below Minimum</div>
            <div>NA / UG / INC / CO / E — special codes</div>
          </div>
        </section>

        {/* Attendance */}
        <section className="space-y-3 print:break-inside-avoid">
          <SectionHeading>Attendance</SectionHeading>
          <div className="overflow-hidden rounded-xl border border-hairline">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                  <th className="px-4 py-2.5"></th>
                  {terms.map((t) => (
                    <th key={t.id} className="py-2.5 text-center">
                      T{t.term_number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['school_days', 'days_present', 'days_late'] as const).map((field) => (
                  <tr key={field} className="border-t border-hairline">
                    <td className="px-4 py-2 capitalize text-ink-3">{field.replace('_', ' ')}</td>
                    {terms.map((t) => {
                      const rec = attendance.find((a: AttendanceRecord) => a.term_id === t.id);
                      const val = rec?.[field] ?? null;
                      return (
                        <td key={t.id} className="py-2 text-center tabular-nums">
                          {val ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Adviser comments */}
        <section className="space-y-3">
          <SectionHeading>Form Class Adviser&apos;s comments</SectionHeading>
          <div className="space-y-2.5">
            {terms.map((t) => {
              const comment =
                comments.find((c: CommentRecord) => c.term_id === t.id)?.comment ?? null;
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-hairline p-4 print:break-inside-avoid"
                >
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                    {t.label}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {comment ?? <span className="italic text-ink-4">No comment yet.</span>}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Signatures */}
        <section className="grid grid-cols-2 gap-10 pt-2 text-xs text-ink-3 print:break-inside-avoid">
          <div>
            <div className="h-12 border-b border-ink-5"></div>
            <p className="mt-2 font-medium text-ink">
              {section.form_class_adviser ?? 'Form Class Adviser'}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-ink-4">Form Class Adviser</p>
          </div>
          <div>
            <div className="h-12 border-b border-ink-5"></div>
            <p className="mt-2 font-medium text-ink">&nbsp;</p>
            <p className="text-[10px] uppercase tracking-wider text-ink-4">
              Parent / Guardian Signature
            </p>
          </div>
        </section>
      </div>

      {/* Footer — affiliated brands strip */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/report-card/report-card-footer.jpg"
        alt="HFSE Global Education Group affiliates"
        className="block w-full"
      />
    </article>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-[15px] font-semibold tracking-tight text-ink">{children}</h2>
  );
}

function cellText(cell: Cell, examinable: boolean): string {
  if (cell.is_na) return 'N/A';
  if (!examinable) return cell.letter ?? '—';
  return cell.quarterly != null ? String(cell.quarterly) : '—';
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="w-36 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
        {label}
      </div>
      <div className="flex-1 font-medium text-ink">{value}</div>
    </div>
  );
}
