import { AlertTriangle, CheckCircle2, Clock, Info, LogOut } from 'lucide-react';

import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';

// ──────────────────────────────────────────────────────────────────────────
// StudentStatusBadges — read-only two-badge status display.
//
// Surfaces the distinction between:
//   - Application Outcome (applicationStatus, append-only history):
//       the funnel result — Enrolled / Enrolled (Conditional) / Cancelled /
//       Withdrawn / etc.
//   - Current Status (enrollment_status from section_students):
//       the live operational state — active, withdrawn, late_enrollee.
//
// A student who enrolled then withdrew is now legible:
//   Application Outcome: Enrolled   (mint)
//   Current Status:      Withdrawn  (destructive)
//
// Design: §9.3 semantic palette — tone encodes meaning, icon accompanies
// colour so the signal is never colour-only (accessibility rule).
// Hard Rule #7: semantic tokens only, no raw hex / slate / gray.
// ──────────────────────────────────────────────────────────────────────────

/** Humanize the `enrollment_status` enum for display. */
function humanizeEnrollmentStatus(raw: string): string {
  if (raw === 'active') return 'Enrolled';
  if (raw === 'withdrawn') return 'Withdrawn';
  if (raw === 'late_enrollee') return 'Late enrollee';
  // Fallback: title-case the raw value (e.g. "some_value" → "Some value").
  return raw.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function stateTone(state: string): StatusTone {
  if (state === 'active') return 'healthy';
  if (state === 'withdrawn') return 'locked';
  if (state === 'late_enrollee') return 'warning';
  return 'muted';
}

function outcomeTone(outcome: string): StatusTone {
  if (outcome === 'Enrolled') return 'healthy';
  if (outcome === 'Enrolled (Conditional)') return 'warning';
  if (outcome === 'Cancelled' || outcome === 'Withdrawn') return 'locked';
  return 'muted';
}

const STATE_ICON = {
  active: CheckCircle2,
  withdrawn: LogOut,
  late_enrollee: Clock,
} satisfies Record<string, React.ComponentType<{ className?: string }>>;

function stateIcon(state: string) {
  return state in STATE_ICON
    ? STATE_ICON[state as keyof typeof STATE_ICON]
    : Info;
}

function outcomeIcon(outcome: string) {
  if (outcome === 'Enrolled') return CheckCircle2;
  if (outcome === 'Enrolled (Conditional)') return AlertTriangle;
  if (outcome === 'Cancelled' || outcome === 'Withdrawn') return LogOut;
  return Info;
}

// A labelled badge pair: mono eyebrow label + status badge.
function LabelledBadge({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export function StudentStatusBadges({
  outcome,
  state,
}: {
  /** Raw `applicationStatus` value (append-only funnel history). */
  outcome: string | null;
  /** Raw `enrollment_status` from `section_students` (current operational state). */
  state: string | null;
}) {
  const hasOutcome = outcome != null && outcome !== '';
  const hasState = state != null && state !== '';

  if (!hasOutcome && !hasState) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {hasOutcome && (
        <LabelledBadge label="Application outcome:">
          <StatusBadge
            tone={outcomeTone(outcome!)}
            icon={outcomeIcon(outcome!)}
          >
            {outcome}
          </StatusBadge>
        </LabelledBadge>
      )}
      {hasState && (
        <LabelledBadge label="Current status:">
          <StatusBadge tone={stateTone(state!)} icon={stateIcon(state!)}>
            {humanizeEnrollmentStatus(state!)}
          </StatusBadge>
        </LabelledBadge>
      )}
    </div>
  );
}
