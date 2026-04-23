import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Status badges read severity at a glance through one of five semantic
// recipes. Per docs/context/09a-design-patterns.md §9.1 + §9.3 — no
// per-status bespoke colors, no raw Tailwind utilities. Anything the
// admissions team sends that isn't mapped falls through to MUTED so it
// surfaces rather than vanishes.

const MINT     = 'bg-brand-mint/30 text-ink border-brand-mint';                 // healthy / active / verified
const ACCENT   = 'bg-accent text-brand-indigo-deep border-brand-indigo-soft';   // informational / in-progress
const AMBER    = 'bg-brand-amber-light/40 text-ink border-brand-amber-light';   // conditional / warning
const DESTRUCT = 'bg-destructive/10 text-destructive border-destructive/30';    // cancelled / rejected / failed
const MUTED    = 'bg-muted text-muted-foreground border-border';                // withdrawn / archived / unknown

// applicationStatus — mirrors components/admissions/* tints so the SIS list
// reads the same as the admissions pipeline dashboard.
const TONE: Record<string, string> = {
  'Submitted':              ACCENT,
  'Ongoing Verification':   ACCENT,
  'Processing':             ACCENT,
  'Enrolled':               MINT,
  'Enrolled (Conditional)': AMBER,
  'Withdrawn':              MUTED,
  'Cancelled':              DESTRUCT,
};

export function ApplicationStatusBadge({ status }: { status: string | null | undefined }) {
  const v = (status ?? '').trim();
  if (!v) {
    return (
      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Unknown
      </Badge>
    );
  }
  const tone = TONE[v] ?? MUTED;
  return (
    <Badge variant="outline" className={cn('font-mono text-[10px] uppercase tracking-wider', tone)}>
      {v}
    </Badge>
  );
}

// Per-stage status (Registration / Documents / Fees / etc.).
const STAGE_TONE: Record<string, string> = {
  Pending:    AMBER,
  Incomplete: AMBER,
  Rejected:   DESTRUCT,
  Finished:   MINT,
  Signed:     MINT,
  Valid:      MINT,
  Invoiced:   ACCENT,
  Uploaded:   ACCENT,
};

export function StageStatusBadge({ status }: { status: string | null | undefined }) {
  const v = (status ?? '').trim();
  if (!v) {
    return <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">—</span>;
  }
  const tone = STAGE_TONE[v] ?? MUTED;
  return (
    <Badge variant="outline" className={cn('font-mono text-[10px] uppercase tracking-wider', tone)}>
      {v}
    </Badge>
  );
}
