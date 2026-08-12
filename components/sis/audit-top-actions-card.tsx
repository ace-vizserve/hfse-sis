import { ListOrdered } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { TopAuditAction } from '@/lib/sis/dashboard';

const ACTION_LABELS: Record<string, string> = {
  'entry.update': 'Grade entry updated',
  'totals.update': 'Assessment totals updated',
  'attendance.daily.update': 'Attendance marked',
  'attendance.import.bulk': 'Attendance bulk import',
  'attendance.calendar.upsert': 'School calendar updated',
  'attendance.event.create': 'Calendar event created',
  'evaluation.writeup.save': 'Writeup saved',
  'evaluation.writeup.submit': 'Writeup submitted',
  'evaluation.checklist_response.save': 'Checklist response saved',
  'evaluation.checklist_item.create': 'Checklist topic added',
  'evaluation.subject_comment.save': 'Subject comment saved',
  'sis.profile.update': 'Student profile edited',
  'sis.family.update': 'Family info edited',
  'sis.stage.update': 'Enrolment stage updated',
  'sis.document.approve': 'Document approved',
  'sis.document.reject': 'Document rejected',
  'sis.discount_code.create': 'Discount code created',
  'pfile.upload': 'P-File document uploaded',
  'pfile.reminder.sent': 'P-File reminder sent',
  'pfile.reminder.bulk': 'P-File bulk reminder sent',
  'sheet.lock': 'Grading sheet locked',
  'sheet.unlock': 'Grading sheet unlocked',
  'sheet.create': 'Grading sheet created',
  'sheet.bulk_create': 'Grading sheets bulk-created',
  'sheet.lock_overdue_batch': 'Sheets auto-locked (overdue)',
  'publication.create': 'Report card published',
  'publication.delete': 'Publication removed',
  grade_change_requested: 'Grade change requested',
  grade_change_approved: 'Grade change approved',
  grade_change_rejected: 'Grade change rejected',
  grade_change_applied: 'Grade change applied',
  grade_change_undo_rejection: 'Rejection undone',
  'grade_entry.annual_letter.update': 'Annual letter grade set',
  'user.login': 'Staff sign-in',
  'parent.session.issued': 'Parent session started',
  'parent.session.cleared': 'Parent session ended',
  'school_config.update': 'School config updated',
  'template.apply': 'Class template applied',
  'environment.switch': 'Environment switched',
  'user.create': 'User account created',
  'user.role.update': 'User role changed',
  'approver.assign': 'Approver assigned',
  'approver.revoke': 'Approver revoked',
  'section.create': 'Section created',
  'section.realphabetize': 'Roster re-alphabetised',
  'assignment.create': 'Teacher assigned',
  'assignment.delete': 'Teacher unassigned',
  'assignment.relief.start': 'Relief teacher arranged',
  'assignment.relief.end': 'Relief teacher finished',
  'student.section.transfer': 'Student transferred',
  'enrolment.metadata.update': 'Enrolment record updated',
  'ay.create': 'Academic year created',
  'ay.switch_current': 'Active AY switched',
  'ay.term_dates.update': 'Term dates updated',
  'ay.term_virtue.update': 'Virtue theme updated',
  'admissions.reminder.sent': 'Admissions reminder sent',
  'admissions.mark.promised': 'Documents marked promised',
};

function labelFor(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function AuditTopActionsCard({
  actions,
}: {
  actions: TopAuditAction[];
}) {
  const max = actions[0]?.count ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Activity breakdown
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Most frequent actions
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListOrdered className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {actions.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No actions logged in this range.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {actions.map(({ action, count }, i) => (
              <li key={action} className="flex items-center gap-3 px-5 py-3">
                <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground/60">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-[13px] font-medium leading-snug text-foreground">
                    {labelFor(action)}
                  </p>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-navy"
                      style={{ width: `${Math.round((count / max) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                  {count.toLocaleString('en-SG')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
