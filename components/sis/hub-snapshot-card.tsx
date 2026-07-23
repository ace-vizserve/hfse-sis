// components/sis/hub-snapshot-card.tsx
//
// "The school, at a glance" — pure presentational summary of the current
// AY's level distribution, staff headcount by role, active-section roster
// stats, and the current-term window. Consumes lib/sis/hub-snapshot.ts's
// HubSnapshot; no data fetching here.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HubSnapshot } from '@/lib/sis/hub-snapshot';
import type { Role } from '@/lib/auth/roles';

// No ROLE_LABELS map exists in lib/auth/roles.ts (verified) — defined
// locally per the plan's fallback instruction.
const ROLE_LABELS: Record<Role, string> = {
  teacher: 'Teachers',
  academic_coordinator: 'Academic Coordinator',
  school_admin: 'School admin',
  superadmin: 'Superadmin',
  p_file_officer: 'P-File Officer',
  admissions: 'Admissions',
};

function isSecondaryLevel(label: string): boolean {
  return label.startsWith('Secondary');
}

export function HubSnapshotCard({ snapshot }: { snapshot: HubSnapshot }) {
  const maxCount = Math.max(1, ...snapshot.levelCounts.map((l) => l.count));

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b border-border py-4">
        <CardTitle className="font-serif text-lg font-semibold text-foreground">
          The school, at a glance
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-0 p-0 md:grid-cols-4">
        <div className="border-b border-border p-4 md:border-r md:border-b-0">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Enrolled by level
          </p>
          <div className="space-y-1.5">
            {snapshot.levelCounts.map((l) => (
              <div
                key={l.level}
                className="flex items-center gap-2 text-[11.5px]"
              >
                <span className="w-16 shrink-0 truncate text-muted-foreground">
                  {l.level}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(l.count / maxCount) * 100}%`,
                      background: isSecondaryLevel(l.level)
                        ? 'linear-gradient(90deg, var(--color-brand-sky), var(--color-brand-indigo-soft))'
                        : 'linear-gradient(90deg, var(--color-brand-indigo), var(--color-brand-indigo-soft))',
                    }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right font-mono tabular-nums text-foreground">
                  {l.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-border p-4 md:border-r md:border-b-0">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Staff
          </p>
          <p className="font-serif text-2xl font-semibold text-foreground">
            {snapshot.totalStaff}
          </p>
          <p className="text-[11px] text-muted-foreground">Active accounts</p>
          <div className="mt-3 space-y-1">
            {(Object.entries(snapshot.staffByRole) as [Role, number][])
              .filter(([, count]) => count > 0)
              .map(([role, count]) => (
                <div key={role} className="flex justify-between text-[12px]">
                  <span className="text-muted-foreground">
                    {ROLE_LABELS[role]}
                  </span>
                  <span className="font-mono font-semibold text-foreground">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div className="border-b border-border p-4 md:border-r md:border-b-0">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Sections
          </p>
          <p className="font-serif text-2xl font-semibold text-foreground">
            {snapshot.activeSections}
          </p>
          <p className="text-[11px] text-muted-foreground">Active this year</p>
          {snapshot.avgRosterSize != null && (
            <>
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                Avg. {snapshot.avgRosterSize} students / section
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (snapshot.avgRosterSize / 50) * 100)}%`,
                    background:
                      'linear-gradient(90deg, var(--color-brand-mint), var(--color-brand-sky))',
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="p-4">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Current term
          </p>
          <p className="font-serif text-xl font-semibold text-foreground">
            {snapshot.currentTermLabel ?? '—'}
          </p>
          {snapshot.daysLeftInTerm != null && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold text-brand-indigo-deep">
              {snapshot.daysLeftInTerm} days left
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
