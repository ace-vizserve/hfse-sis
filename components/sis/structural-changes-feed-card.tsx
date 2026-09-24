import { ShieldAlert } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { StructuralChangeRow } from '@/lib/sis/dashboard';

const STRUCTURAL_ACTION_LABELS: Record<string, string> = {
  'school_config.update': 'School config updated',
  'template.apply': 'Class template applied',
  'environment.switch': 'Environment switched',
  'environment.seed': 'Test data seeded',
  'environment.topup': 'Test data topped up',
  'user.role.update': 'User role changed',
  'user.create': 'User account created',
  'ay.create': 'Academic year created',
  'ay.switch_current': 'Active AY switched',
  'ay.delete': 'Academic year deleted',
  'ay.accepting_applications.toggle': 'Early-bird applications toggled',
  'ay.vizschool_applications.toggle': 'VizSchool applications toggled',
  'approver.assign': 'Approver assigned',
  'approver.revoke': 'Approver revoked',
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-SG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function StructuralChangesFeedCard({
  rows,
}: {
  rows: StructuralChangeRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Governance · All time
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Recent structural changes
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/70 text-white shadow-brand-tile">
            <ShieldAlert className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No structural changes on record.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3.5 px-5 py-3.5">
                <div className="mt-[7px] flex size-2 shrink-0 rounded-full bg-brand-amber/60" />
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-[14px] font-semibold leading-snug text-foreground">
                    {STRUCTURAL_ACTION_LABELS[row.action] ?? row.action}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                    {row.actorEmail}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground/70">
                  {formatTimestamp(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
