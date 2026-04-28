import { AlertTriangle, FileWarning, MailQuestion } from 'lucide-react';

import { LifecycleDrillSheet } from '@/components/sis/drills/lifecycle-drill-sheet';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getDocumentChaseQueueCounts } from '@/lib/sis/document-chase-queue';
import type { LifecycleDrillTarget } from '@/lib/sis/drill';

// ──────────────────────────────────────────────────────────────────────────
// DocumentChaseQueueStrip — top-of-fold "documents needing action" surface
// for the 3 dashboards that own document chase work: /p-files, /admissions,
// /records. Three cards in a flex row, each click-to-drill into the matching
// LifecycleDrillSheet target (KD #56).
//
// Spec: docs/superpowers/specs/2026-04-28-to-follow-document-flag-design.md
//       § 4 (Top-of-fold dashboard chase queue).
// ──────────────────────────────────────────────────────────────────────────

export type DocumentChaseQueueStripProps = {
  ayCode: string;
};

type ChaseTile = {
  target: LifecycleDrillTarget;
  label: string;
  description: string;
  icon: typeof AlertTriangle;
  severity: 'bad' | 'warn';
};

const TILES: ChaseTile[] = [
  {
    target: 'awaiting-document-revalidation',
    label: 'Awaiting revalidation',
    description: 'Rejected or expired — parent must re-upload',
    icon: AlertTriangle,
    severity: 'bad',
  },
  {
    target: 'awaiting-document-validation',
    label: 'Awaiting validation',
    description: 'Parent uploaded — registrar to validate',
    icon: FileWarning,
    severity: 'warn',
  },
  {
    target: 'awaiting-promised-documents',
    label: 'Awaiting promised',
    description: 'Parent committed — file not sent yet',
    icon: MailQuestion,
    severity: 'warn',
  },
];

const TILE_CRAFT: Record<ChaseTile['severity'], string> = {
  // Mirrors §7.4 craft + §10 chip palette in 09a-design-patterns.md.
  bad: 'bg-gradient-to-br from-destructive/15 via-destructive/8 to-transparent ring-1 ring-inset ring-destructive/30',
  warn: 'bg-gradient-to-br from-brand-amber/20 via-brand-amber/8 to-transparent ring-1 ring-inset ring-brand-amber/30',
};

const ICON_TILE_CRAFT: Record<ChaseTile['severity'], string> = {
  bad: 'shadow-brand-tile-destructive bg-gradient-to-br from-destructive to-destructive/70 text-destructive-foreground',
  warn: 'shadow-brand-tile-amber bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink',
};

export async function DocumentChaseQueueStrip({
  ayCode,
}: DocumentChaseQueueStripProps) {
  const counts = await getDocumentChaseQueueCounts(ayCode);
  const total = counts.promised + counts.validation + counts.revalidation;

  if (total === 0) return null;

  const valueByTarget: Record<LifecycleDrillTarget, number | undefined> = {
    'awaiting-fee-payment': undefined,
    'awaiting-document-revalidation': counts.revalidation,
    'awaiting-document-validation': counts.validation,
    'awaiting-promised-documents': counts.promised,
    'awaiting-assessment-schedule': undefined,
    'awaiting-contract-signature': undefined,
    'missing-class-assignment': undefined,
    'ungated-to-enroll': undefined,
    'new-applications': undefined,
  };

  return (
    <section className="grid gap-4 md:grid-cols-3" aria-label="Documents needing action">
      {TILES.map((tile) => {
        const value = valueByTarget[tile.target] ?? 0;
        const Icon = tile.icon;
        return (
          <Card key={tile.target} className={TILE_CRAFT[tile.severity]}>
            <CardHeader>
              <CardAction>
                <div className={`flex size-12 items-center justify-center rounded-xl ${ICON_TILE_CRAFT[tile.severity]}`}>
                  <Icon className="size-6" aria-hidden />
                </div>
              </CardAction>
              <CardTitle className="font-serif text-3xl tabular-nums">
                {value}
              </CardTitle>
              <CardDescription className="font-mono text-[11px] uppercase tracking-[0.12em]">
                {tile.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-2">{tile.description}</p>
            </CardContent>
            <CardFooter>
              <LifecycleDrillSheet target={tile.target} ayCode={ayCode} />
            </CardFooter>
          </Card>
        );
      })}
    </section>
  );
}
