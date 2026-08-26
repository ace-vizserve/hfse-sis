import { PageTabNav } from '@/components/sis/page-tab-nav';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getStaffCount, getTeacherList } from '@/lib/auth/staff-list';
import type { Role } from '@/lib/auth/roles';

// The "Staff." header and the two-cut switcher, shared by the two LIST pages.
//
// This used to live in `app/(sis)/sis/admin/staff/layout.tsx`. It moved out
// when the teacher detail page was added: a layout wraps every child, so the
// detail page inherited a header above its own and a switcher showing two tabs
// with neither selected — its URL is neither of them. Chrome that belongs to
// two specific pages belongs in those pages.
//
// ─── Which year ──────────────────────────────────────────────────────────────
//
// Teaching assignments are per academic year and always have been: an
// assignment row points at a section, and a section belongs to exactly one
// year. What was missing was any way to LOOK at another one — every staffing
// page selected `is_current` and offered no alternative, so AY2025's staffing
// existed and nothing displayed it.
//
// The `?ay=` param and this switcher are the same pattern ~29 other pages use
// (Admissions, Records, the four Insights pages). Nothing below it changed:
// `loadStaffAssignments` and `getTeacherDetail` already took a year.
export async function StaffDirectoryChrome({
  role,
  ayCode,
  children,
}: {
  role: Role;
  /**
   * The year being viewed — not necessarily the current one.
   *
   * The picker itself lives in each table's toolbar, beside the data it
   * scopes. The header still has to NAME the year, though: a header describing
   * one year above a table showing another is the exact confusion this whole
   * change exists to remove.
   */
  ayCode: string;
  children: React.ReactNode;
}) {
  const capabilities = await getCapabilitiesForRole(role);
  const canSeeAccounts = can(capabilities, 'staff.view_accounts');
  const currentAy = await getCurrentAcademicYear();

  // Both are free: they share the single 5-minute-cached listUsers() call
  // underlying every helper in lib/auth/staff-list.ts.
  const [staffCount, teacherList] = await Promise.all([
    getStaffCount(),
    getTeacherList(),
  ]);
  const teachingCount = teacherList.length;

  // Plain words, not a date comparison the reader has to do themselves. String
  // comparison on `ay_code` is safe and is what the rest of the codebase uses.
  const currentCode = currentAy?.ay_code ?? ayCode;
  const whichYear =
    ayCode === currentCode
      ? 'This year'
      : ayCode < currentCode
        ? 'Earlier year'
        : 'A year ahead';

  // Omitted on the current year so the everyday URL stays clean and
  // bookmarkable as `/sis/admin/staff`.
  const ayQuery = ayCode === currentCode ? '' : `?ay=${ayCode}`;

  return (
    <>
      <SisPageHeader
        group={`${whichYear} · ${ayCode}`}
        title="Staff."
        description="Everyone who works in the school — their accounts, roles, and what they teach."
        chips={
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            {staffCount} people · {teachingCount} teaching
          </Badge>
        }
      />

      {/* Switcher and the content it controls are one region (space-y-4,
          tighter than PageShell's space-y-8) so the tabs read as bound to what
          is directly below them. */}
      <div className="space-y-4">
        {canSeeAccounts && (
          <PageTabNav
            tabs={[
              {
                // Carry the year across the switch, or changing tab silently
                // drops you back into the current one. PageTabNav matches on
                // the path alone, so the query string does not affect which
                // tab reads as selected.
                href: `/sis/admin/staff${ayQuery}`,
                label: 'Teaching assignments',
                count: teachingCount,
              },
              {
                href: `/sis/admin/staff/accounts${ayQuery}`,
                label: 'Accounts',
                // staffCount, not the loaded account list. It excludes disabled
                // accounts, so it can read one or two lower than the Accounts
                // table — but it is the same number on both tabs, where the old
                // page showed a different one depending on which tab you were
                // standing on.
                count: staffCount,
              },
            ]}
          />
        )}
        {children}
      </div>
    </>
  );
}
