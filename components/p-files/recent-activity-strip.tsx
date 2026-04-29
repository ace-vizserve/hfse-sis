'use client';

import { Activity, CalendarClock, Mail } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

const SLOT_SHORT_LABEL: Record<string, string> = {
  idPicture: 'ID Picture',
  birthCert: 'Birth Cert',
  educCert: 'Educ Cert',
  medical: 'Medical',
  form12: 'Form 12',
  passport: 'Passport',
  pass: 'Student Pass',
  motherPassport: 'Mother PP',
  motherPass: 'Mother Pass',
  fatherPassport: 'Father PP',
  fatherPass: 'Father Pass',
  guardianPassport: 'Guardian PP',
  guardianPass: 'Guardian Pass',
  icaPhoto: 'ICA Photo',
  financialSupportDocs: 'Financial',
  vaccinationInformation: 'Vaccination',
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}

export type ActivityEvent = {
  kind: 'reminder' | 'promise';
  slotKey: string;
  createdAt: string;
  promisedUntil: string | null;
  recipientEmail: string | null;
  note: string | null;
};

export function RecentActivityStrip({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-muted-foreground" />
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Recent renewal activity
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-5 border-border bg-muted px-2 font-mono text-[10px] tabular-nums text-muted-foreground"
        >
          {events.length} event{events.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <ul className="flex min-w-min items-stretch gap-2 px-5 py-3">
          {events.map((event, i) => {
            const Icon = event.kind === 'reminder' ? Mail : CalendarClock;
            const slotLabel = SLOT_SHORT_LABEL[event.slotKey] ?? event.slotKey;
            const tone =
              event.kind === 'reminder'
                ? 'border-brand-amber/40 bg-brand-amber/10'
                : 'border-brand-indigo-soft bg-accent/40';
            const iconTone =
              event.kind === 'reminder' ? 'text-brand-amber' : 'text-brand-indigo-deep';
            return (
              <li
                key={`${event.kind}-${event.createdAt}-${i}`}
                className={`flex shrink-0 flex-col gap-1 rounded-lg border ${tone} px-3 py-2 min-w-[160px]`}
                title={event.note ?? undefined}
              >
                <div className="flex items-center gap-1.5">
                  <Icon className={`size-3 ${iconTone}`} />
                  <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.10em] text-foreground">
                    {event.kind === 'reminder' ? 'Reminder sent' : 'Promised by parent'}
                  </span>
                </div>
                <p className="truncate text-[12px] text-foreground">{slotLabel}</p>
                <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {relativeTime(event.createdAt)}
                  {event.promisedUntil ? ` → ${formatDate(event.promisedUntil)}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
