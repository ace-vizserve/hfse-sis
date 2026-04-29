'use client';

import { Mail, ShieldCheck, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type ContactRow = {
  role: 'mother' | 'father' | 'guardian';
  name: string | null;
  email: string | null;
};

const ROLE_LABEL: Record<ContactRow['role'], string> = {
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
};

export function FamilyContactCard({
  family,
  recipients,
  stpApplicationType,
}: {
  family: { motherName: string | null; fatherName: string | null; guardianName: string | null };
  recipients: { motherEmail: string | null; fatherEmail: string | null; guardianEmail: string | null };
  stpApplicationType: string | null;
}) {
  const allRows: ContactRow[] = [
    { role: 'mother', name: family.motherName, email: recipients.motherEmail },
    { role: 'father', name: family.fatherName, email: recipients.fatherEmail },
    { role: 'guardian', name: family.guardianName, email: recipients.guardianEmail },
  ];
  const rows = allRows.filter((r) => r.name || r.email);

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Family · contact
        </CardDescription>
        <CardTitle className="font-serif text-xl">Reminder recipients</CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Users className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      {rows.length === 0 ? (
        <CardContent className="py-5">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No parent or guardian contact on file. Renewal reminders cannot be sent until at least
            one email is captured in admissions.
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.role} className="flex items-center justify-between gap-3 px-6 py-3.5">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium text-foreground">
                    {row.name ?? `Unknown ${ROLE_LABEL[row.role]}`}
                  </p>
                  <Badge
                    variant="outline"
                    className="h-5 border-border bg-muted px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {ROLE_LABEL[row.role]}
                  </Badge>
                </div>
                {row.email ? (
                  <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
                    <Mail className="size-3 shrink-0" />
                    <span className="truncate">{row.email}</span>
                  </p>
                ) : (
                  <p className="font-mono text-[11px] text-destructive">No email on file</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {stpApplicationType && (
        <div className="flex items-start gap-3 border-t border-border bg-accent/30 px-6 py-3.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ShieldCheck className="size-3.5" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep">
              STP Application
            </p>
            <p className="truncate text-[13px] text-foreground">{stpApplicationType}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
