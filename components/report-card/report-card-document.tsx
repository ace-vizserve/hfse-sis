import { ReportCardLetterhead } from '@/components/report-card/report-card-letterhead';
import { ReportCardSignatureBlock } from '@/components/report-card/report-card-signature-block';
import {
  computeAttendancePercentage,
  computeGeneralAverage,
} from '@/lib/compute/annual';
import type {
  AttendanceRecord,
  Cell,
  CommentRecord,
  ReportCardPayload,
} from '@/lib/report-card/build-report-card';
import { AnnualLetterInput } from '@/components/grading/annual-letter-input';

export function ReportCardDocument({
  payload,
  viewingTermNumber,
  canManage = false,
  showDrafts = false,
}: {
  payload: ReportCardPayload;
  viewingTermNumber: 1 | 2 | 3 | 4;
  canManage?: boolean;
  /**
   * Show an unsubmitted form-adviser comment, flagged as a draft.
   *
   * On for the staff preview only. Without it a draft is simply absent, and an
   * empty comment section can't tell a coordinator whether the adviser hasn't
   * written anything or has written it and not pressed Submit. Off (the
   * default) for anything that produces a deliverable — the parent API and the
   * section batch print — where a draft must never appear.
   */
  showDrafts?: boolean;
}) {
  const {
    ay,
    terms,
    student,
    section,
    level,
    enrollment_status,
    subjects,
    attendance,
    comments,
    schoolConfig,
  } = payload;

  const isFinal = viewingTermNumber === 4;

  // T1-T3: show terms 1-3; T4: show all four terms
  const visibleTerms = isFinal
    ? terms
    : terms.filter((t) => t.term_number <= 3);

  const generalAverage = isFinal
    ? computeGeneralAverage(
        subjects.filter((r) => r.subject.is_examinable).map((r) => r.annual)
      )
    : null;

  const attendancePct = isFinal
    ? computeAttendancePercentage(attendance)
    : null;

  return (
    <article className="mx-auto w-full max-w-[8.5in] overflow-hidden rounded-2xl border border-hairline bg-white text-ink shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <ReportCardLetterhead config={schoolConfig} />

      <div className="space-y-8 px-4 py-6 sm:px-8 sm:py-8 lg:px-10 print:px-8 print:py-6">
        <header className="flex flex-col items-center gap-1 border-b border-hairline pb-5 text-center">
          {/* Just the label — it already reads "Academic Year 2026" (KD #13),
              so prefixing the words produced "Academic year Academic Year
              2026" on every card and printout. */}
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-4">
            {ay.label}
          </p>
          <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Student Progress Report
          </h1>
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
                <InfoRow
                  label="Teacher"
                  value={section.form_class_adviser ?? '—'}
                />
              </>
            ) : (
              <>
                <InfoRow label="Student Name" value={student.full_name} />
                <InfoRow label="Course" value={level.label} />
                <InfoRow label="Class" value={section.name} />
                <InfoRow
                  label="Form Class Adviser"
                  value={section.form_class_adviser ?? '—'}
                />
              </>
            )}
          </div>
        </section>

        {/* Academic grades */}
        <section className="space-y-3 print:break-inside-avoid">
          <SectionHeading>
            {isFinal ? 'Academic Results' : 'Academic Grades'}
          </SectionHeading>
          <div className="-mx-4 overflow-x-auto rounded-none border-y border-hairline sm:mx-0 sm:overflow-hidden sm:rounded-xl sm:border print:mx-0 print:overflow-hidden print:rounded-xl print:border">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                  <th className="px-4 py-2.5">
                    {isFinal ? 'Subjects' : 'Subject'}
                  </th>
                  {visibleTerms.map((t) => (
                    <th key={t.id} className="w-14 py-2.5 text-center">
                      Term {t.term_number}
                    </th>
                  ))}
                  {isFinal && (
                    <th className="w-20 py-2.5 text-center">Final Grade</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {subjects.map((row) => (
                  <tr key={row.subject.id} className="border-t border-hairline">
                    <td className="px-4 py-2 font-medium">
                      {row.subject.report_label ?? row.subject.name}
                    </td>
                    {visibleTerms.map((t) => {
                      const termKey = `t${t.term_number}` as
                        | 't1'
                        | 't2'
                        | 't3'
                        | 't4';
                      return (
                        <td
                          key={t.id}
                          className="py-2 text-center tabular-nums"
                        >
                          {cellText(row[termKey], row.subject.is_examinable)}
                        </td>
                      );
                    })}
                    {isFinal && (
                      <td className="py-2 text-center font-serif text-base font-semibold tabular-nums text-ink">
                        {row.subject.is_examinable ? (
                          (row.annual ?? '—')
                        ) : canManage && row.t4_entry_id && row.t4_sheet_id ? (
                          <>
                            <span className="hidden print:inline">
                              {row.annual_letter ?? '—'}
                            </span>
                            <span className="print:hidden">
                              <AnnualLetterInput
                                sheetId={row.t4_sheet_id}
                                entryId={row.t4_entry_id}
                                initialValue={row.annual_letter_override}
                              />
                            </span>
                          </>
                        ) : (
                          (row.annual_letter ?? '—')
                        )}
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
                      {generalAverage.toFixed(1)}
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
                  {isFinal && (
                    <th className="py-2.5 text-center">Percentage</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {ATTENDANCE_ROWS.map(({ key, label }) => {
                  return (
                    <tr key={key} className="border-t border-hairline">
                      <td className="px-4 py-2 text-ink-3">{label}</td>
                      {visibleTerms.map((t) => {
                        const rec = attendance.find(
                          (a: AttendanceRecord) => a.term_id === t.id
                        );
                        const val = rec?.[key] ?? null;
                        return (
                          <td
                            key={t.id}
                            className="py-2 text-center tabular-nums"
                          >
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

        {/* Form Class Adviser's Comments — CUMULATIVE per KD #49. A published
            interim card for term N shows one headed box per term 1..N (capped
            at 3; T4 has no FCA block). Each box carries that term's own virtue
            theme in its heading. A term with no comment is omitted (the publish
            hard-gate guarantees published cards have them; this guards the
            in-progress staff preview against a broken empty box). */}
        {(() => {
          if (isFinal) return null;
          const cap = Math.min(viewingTermNumber, 3);
          // Each box shows that term's comment + its own virtue theme. An
          // unsubmitted draft counts as absent unless `showDrafts` is on, in
          // which case it renders with a flag — see the prop's own note.
          const commentTerms = terms
            .filter((t) => t.term_number >= 1 && t.term_number <= cap)
            .map((t) => {
              const record = comments.find(
                (c: CommentRecord) => c.term_id === t.id
              );
              return {
                term: t,
                comment: record?.comment?.trim() || null,
                isDraft: record != null && !record.submitted,
              };
            })
            .filter(
              (entry) => entry.comment != null && (showDrafts || !entry.isDraft)
            );

          if (commentTerms.length === 0) return null;

          return (
            <section className="space-y-3">
              <SectionHeading>
                Form Class Adviser&apos;s Comments
              </SectionHeading>
              <div className="space-y-2.5">
                {commentTerms.map(({ term: t, comment, isDraft }) => {
                  const virtue = t.virtue_theme?.trim() || null;
                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border border-hairline p-4 print:break-inside-avoid"
                    >
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                        {t.label}
                        {virtue ? (
                          <span className="font-sans normal-case tracking-normal text-ink-4">
                            {' '}
                            (HFSE Virtues: {virtue})
                          </span>
                        ) : null}
                        {/* Reaches here only under `showDrafts` (staff
                            preview). Deliberately NOT print-hidden: if someone
                            prints a preview holding a draft, the paper should
                            say so rather than pass as final. */}
                        {isDraft ? (
                          <span className="ml-2 rounded border border-brand-amber/40 bg-brand-amber/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-brand-amber">
                            Draft — not submitted
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                        {comment}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        <ReportCardSignatureBlock
          isFinal={isFinal}
          formClassAdviser={section.form_class_adviser}
          principalName={schoolConfig.principalName}
          ceoName={schoolConfig.ceoName}
        />
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="px-6">
        <img
          src="/report-card/reference/report-card-footer-bg.png"
          alt="HFSE Global Education Group affiliates"
          className="block w-full"
        />
      </div>
    </article>
  );
}

const ATTENDANCE_ROWS: {
  key: 'school_days' | 'days_present' | 'days_late';
  label: string;
}[] = [
  { key: 'school_days', label: 'Number of School Days' },
  { key: 'days_present', label: 'Number of Days Present' },
  { key: 'days_late', label: 'Number of Days Late' },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-[15px] font-semibold tracking-tight text-ink">
      {children}
    </h2>
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
