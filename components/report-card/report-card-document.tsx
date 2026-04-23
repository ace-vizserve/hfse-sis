import {
  computeAttendancePercentage,
  computeGeneralAverage,
  gradeDescriptor,
} from '@/lib/compute/annual';
import type {
  AttendanceRecord,
  Cell,
  CommentRecord,
  ReportCardPayload,
} from '@/lib/report-card/build-report-card';

export function ReportCardDocument({
  payload,
  viewingTermNumber,
}: {
  payload: ReportCardPayload;
  viewingTermNumber: 1 | 2 | 3 | 4;
}) {
  const { ay, terms, student, section, level, enrollment_status, subjects, attendance, comments, schoolConfig } =
    payload;

  const isFinal = viewingTermNumber === 4;

  // T1-T3: show terms 1-3; T4: show all four terms
  const visibleTerms = isFinal
    ? terms
    : terms.filter((t) => t.term_number <= 3);

  const generalAverage = isFinal
    ? computeGeneralAverage(
        subjects.filter((r) => r.subject.is_examinable).map((r) => r.annual),
      )
    : null;

  const attendancePct = isFinal ? computeAttendancePercentage(attendance) : null;

  return (
    <article className="mx-auto w-full max-w-[8.5in] overflow-hidden rounded-2xl border border-hairline bg-white text-ink shadow-sm print:rounded-none print:border-0 print:shadow-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/report-card/report-card-header.png"
        alt="HFSE International School · HFSE Global Education Group"
        className="block w-full"
      />

      <div className="space-y-8 px-4 py-6 sm:px-8 sm:py-8 lg:px-10 print:px-8 print:py-6">
        <header className="flex flex-col items-center gap-1 border-b border-hairline pb-5 text-center">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-4">
            Academic year {ay.label}
          </p>
          <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Student Progress Report
          </h1>
          {schoolConfig.peiRegistrationNumber && (
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-4">
              PEI Reg. No. {schoolConfig.peiRegistrationNumber}
            </p>
          )}
        </header>

        {/* Student info card — different fields per template */}
        <section className="rounded-xl border border-hairline bg-muted/40 p-5 print:break-inside-avoid">
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
            Student
          </p>
          <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            {isFinal ? (
              <>
                <InfoRow label="Name" value={student.full_name} />
                <InfoRow label="Grade Level" value={level.label} />
                <InfoRow label="Section" value={section.name} />
                <InfoRow label="Teacher" value={section.form_class_adviser ?? '—'} />
              </>
            ) : (
              <>
                <InfoRow label="Student Name" value={student.full_name} />
                <InfoRow label="Course" value={level.label} />
                <InfoRow label="Class" value={section.name} />
                <InfoRow label="Form Class Adviser" value={section.form_class_adviser ?? '—'} />
              </>
            )}
          </div>
        </section>

        {/* Academic grades */}
        <section className="space-y-3 print:break-inside-avoid">
          <SectionHeading>{isFinal ? 'Academic Results' : 'Academic Grades'}</SectionHeading>
          <div className="-mx-4 overflow-x-auto rounded-none border-y border-hairline sm:mx-0 sm:overflow-hidden sm:rounded-xl sm:border print:mx-0 print:overflow-hidden print:rounded-xl print:border">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                  <th className="px-4 py-2.5">{isFinal ? 'Subjects' : 'Subject'}</th>
                  {visibleTerms.map((t) => (
                    <th key={t.id} className="w-14 py-2.5 text-center">
                      Term {t.term_number}
                    </th>
                  ))}
                  {isFinal && <th className="w-20 py-2.5 text-center">Final Grade</th>}
                </tr>
              </thead>
              <tbody>
                {subjects.map((row) => (
                  <tr key={row.subject.id} className="border-t border-hairline">
                    <td className="px-4 py-2 font-medium">{row.subject.name}</td>
                    {visibleTerms.map((t) => {
                      const termKey = `t${t.term_number}` as 't1' | 't2' | 't3' | 't4';
                      return (
                        <td key={t.id} className="py-2 text-center tabular-nums">
                          {cellText(row[termKey], row.subject.is_examinable)}
                        </td>
                      );
                    })}
                    {isFinal && (
                      <td className="py-2 text-center font-serif text-base font-semibold tabular-nums text-ink">
                        {row.subject.is_examinable
                          ? row.annual ?? '—'
                          : 'Passed'}
                      </td>
                    )}
                  </tr>
                ))}
                {subjects.length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleTerms.length + 1 + (isFinal ? 1 : 0)}
                      className="py-6 text-center text-sm text-ink-4"
                    >
                      No subjects configured for {level.label}.
                    </td>
                  </tr>
                )}
              </tbody>
              {isFinal && generalAverage != null && (
                <tfoot>
                  <tr className="border-t-2 border-hairline-strong bg-muted/40">
                    <td
                      colSpan={visibleTerms.length + 1}
                      className="px-4 py-2.5 text-right font-serif text-sm font-semibold tracking-tight text-ink"
                    >
                      General Average
                    </td>
                    <td className="py-2.5 text-center font-serif text-base font-semibold tabular-nums text-ink">
                      {generalAverage}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {/* Grading legend */}
        <section className="rounded-xl border border-hairline bg-accent/50 p-4 text-xs text-ink-3 print:break-inside-avoid">
          <div className="grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Legend (Examinable Subjects)
              </p>
              <div>Outstanding · 90–100</div>
              <div>Very Satisfactory · 85–89</div>
              <div>Satisfactory · 80–84</div>
              <div>Fairly Satisfactory · 75–79</div>
              <div>Below Minimum Expectations · Below 75</div>
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Legend (Non-Examinable Subjects)
              </p>
              <div>A — Fully demonstrated the skills required (90 to 100)</div>
              <div>B — Demonstrated some skills required (85 to 89)</div>
              <div>C — Fairly demonstrated the skill required (80 to 84)</div>
              <div>IP — In Progress (79 and below)</div>
              <div>UG — Ungraded</div>
              <div>N.A. — Not Applicable</div>
            </div>
          </div>
        </section>

        {/* School Attendance */}
        <section className="space-y-3 print:break-inside-avoid">
          <SectionHeading>School Attendance</SectionHeading>
          <div className="-mx-4 overflow-x-auto rounded-none border-y border-hairline sm:mx-0 sm:overflow-hidden sm:rounded-xl sm:border print:mx-0 print:overflow-hidden print:rounded-xl print:border">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                  <th className="px-4 py-2.5"></th>
                  {visibleTerms.map((t) => (
                    <th key={t.id} className="py-2.5 text-center">
                      Term {t.term_number}
                    </th>
                  ))}
                  {isFinal && <th className="py-2.5 text-center">Percentage</th>}
                </tr>
              </thead>
              <tbody>
                {ATTENDANCE_ROWS.map(({ key, label }) => {
                  return (
                    <tr key={key} className="border-t border-hairline">
                      <td className="px-4 py-2 text-ink-3">{label}</td>
                      {visibleTerms.map((t) => {
                        const rec = attendance.find(
                          (a: AttendanceRecord) => a.term_id === t.id,
                        );
                        const val = rec?.[key] ?? null;
                        return (
                          <td key={t.id} className="py-2 text-center tabular-nums">
                            {val ?? 'N.A.'}
                          </td>
                        );
                      })}
                      {isFinal && (
                        <td className="py-2 text-center font-semibold tabular-nums">
                          {key === 'days_present' && attendancePct != null
                            ? `${attendancePct}%`
                            : key === 'days_late'
                              ? 'N.A.'
                              : ''}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Adviser comments — T1-T3 only (T4 reference doesn't show comments) */}
        {!isFinal && (
          <section className="space-y-3">
            <SectionHeading>
              Form Class Adviser&apos;s Comments
              {(() => {
                // KD #49: parenthetical carries the viewing term's virtue
                // theme. Falls back to an unparenthesised heading when the
                // theme is null (historical terms pre-migration 018).
                const viewingTerm = terms.find((t) => t.term_number === viewingTermNumber);
                const virtue = viewingTerm?.virtue_theme?.trim() || null;
                return virtue ? (
                  <span className="font-sans text-[11px] font-normal tracking-normal text-ink-4">
                    {' '}
                    (HFSE Virtues: {virtue})
                  </span>
                ) : null;
              })()}
            </SectionHeading>
            <div className="space-y-2.5">
              {visibleTerms.map((t) => {
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
        )}

        {/* Signatures */}
        <section className="pt-2 text-xs text-ink-3 print:break-inside-avoid">
          {isFinal ? (
            <div className="grid grid-cols-3 gap-6 sm:gap-8">
              <div>
                <div className="h-12 border-b border-ink-5"></div>
                <p className="mt-2 font-medium text-ink">
                  {section.form_class_adviser ?? 'Form Teacher'}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-ink-4">Form Teacher</p>
              </div>
              <div>
                <div className="h-12 border-b border-ink-5"></div>
                <p className="mt-2 font-medium text-ink">
                  {schoolConfig.principalName || ' '}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-ink-4">School Principal</p>
              </div>
              <div>
                <div className="h-12 border-b border-ink-5"></div>
                <p className="mt-2 font-medium text-ink">
                  {schoolConfig.ceoName || ' '}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-ink-4">Founder &amp; CEO</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-xs">
              <div className="h-12 border-b border-ink-5"></div>
              <p className="mt-2 text-center font-medium text-ink">&nbsp;</p>
              <p className="text-center text-[10px] uppercase tracking-wider text-ink-4">
                Parent&apos;s Signature
              </p>
            </div>
          )}
        </section>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/report-card/report-card-footer.jpg"
        alt="HFSE Global Education Group affiliates"
        className="block w-full"
      />
    </article>
  );
}

const ATTENDANCE_ROWS: { key: 'school_days' | 'days_present' | 'days_late'; label: string }[] = [
  { key: 'school_days', label: 'Number of School Days' },
  { key: 'days_present', label: 'Number of Days Present' },
  { key: 'days_late', label: 'Number of Days Late' },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-[15px] font-semibold tracking-tight text-ink">{children}</h2>
  );
}

function cellText(cell: Cell, examinable: boolean): string {
  if (cell.is_na) return 'N.A.';
  if (!examinable) return cell.letter ?? '—';
  return cell.quarterly != null ? String(cell.quarterly) : '—';
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="w-28 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 sm:w-36">
        {label}
      </div>
      <div className="flex-1 font-medium text-ink">{value}</div>
    </div>
  );
}
