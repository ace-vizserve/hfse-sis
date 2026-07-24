import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { RoleChip, staffInitials } from '@/components/sis/staff-visuals';
import type { Role } from '@/lib/auth/roles';
import type { TeacherSectionRow } from '@/lib/account/sections';

/**
 * The account page's left-rail "About" card — avatar, name, role chip, the
 * old "Signed-in identity" card folded in, and (teacher only) a "Your
 * sections" sub-section. Pure presentation: no data fetching here. Spec:
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md §1.
 */
export function AboutCard({
  name,
  email,
  role,
  sections,
}: {
  name: string;
  email: string;
  role: Role | null;
  /** Only populated for teacher — see the design spec's Section 1. */
  sections?: TeacherSectionRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-indigo/10 font-serif text-lg font-bold text-brand-indigo">
          {staffInitials(name)}
        </div>
        <div>
          <p className="font-serif text-base font-semibold text-foreground">
            {name}
          </p>
          <RoleChip role={role} className="mt-1" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 border-t border-border pt-4">
        <div>
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Identity
          </p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate font-medium text-foreground">{email}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="font-mono font-bold uppercase text-brand-indigo">
                {role ?? 'no role'}
              </dd>
            </div>
          </dl>
        </div>
        {sections && sections.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Your sections
            </p>
            <ul className="space-y-1.5 text-sm">
              {sections.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {s.sectionName}
                  </span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {s.roleTag}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
