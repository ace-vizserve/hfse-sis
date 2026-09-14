'use client';

import * as React from 'react';

import {
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import { SisAdminDrillSheet } from '@/components/sis/drills/sis-admin-drill-sheet';
import { AUDIT_MODULES } from '@/lib/audit/modules';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';

/**
 * AuditByModuleDrillCard — wraps the audit-by-module bar chart on /sis with a
 * drill trigger. Clicking a bar opens the audit-events drill scoped to that
 * module.
 *
 * ⚠ THE CHART SPEAKS LABELS, THE DRILL SPEAKS KEYS. `ComparisonBarPoint` uses
 * `category` for both the axis text and the click payload, so a click hands
 * back a display string ("Markbook"). The drill needs the module's stable key
 * ("markbook"). Translating here — against the same `AUDIT_MODULES` list the
 * chart was built from — is what stops the two drifting.
 *
 * They HAD drifted: the label was passed straight through as the segment, the
 * route looked it up in a slug-keyed map, missed, and fell back to using the
 * label itself as a SQL LIKE pattern. `action LIKE 'Markbook — sheet%'` matches
 * nothing, so every bar on this chart opened an empty sheet.
 */
export function AuditByModuleDrillCard({
  data,
  rangeFrom,
  rangeTo,
}: {
  data: ComparisonBarPoint[];
  rangeFrom?: string;
  rangeTo?: string;
}) {
  const [moduleKey, setModuleKey] = React.useState<string | null>(null);

  // Label → key. An unrecognised label sets nothing rather than opening a
  // wrongly-scoped sheet: silence beats a list that looks authoritative and is
  // not (the failure this component just had).
  const selectByLabel = React.useCallback((label: string) => {
    const match = AUDIT_MODULES.find((m) => m.label === label);
    if (match) setModuleKey(match.key);
  }, []);

  return (
    <Sheet open={!!moduleKey} onOpenChange={(o) => !o && setModuleKey(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Audit activity by module
          </CardDescription>
          <CardTitle className="font-serif text-xl">
            Where the system is most active
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ComparisonBarChart
            data={data}
            orientation="horizontal"
            height={300}
            onSegmentClick={selectByLabel}
          />
        </CardContent>
      </Card>
      {moduleKey && (
        <SisAdminDrillSheet
          target="audit-events"
          segment={moduleKey}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
        />
      )}
    </Sheet>
  );
}
