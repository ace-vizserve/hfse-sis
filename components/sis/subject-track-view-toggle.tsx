'use client';

import * as React from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TRACK_VIEW_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'global', label: 'Global' },
  { value: 'standard', label: 'Standard' },
] as const;
type TrackView = (typeof TRACK_VIEW_OPTIONS)[number]['value'];

// Secondary-only Track VIEW filter (Task 1 of the "Unified Subject Setup
// page" plan). Deliberately writes nothing — `sections.class_type` is
// only ever written from Step ②'s bundle-flag buttons (Task 3). This is
// pure local client state today: no consumer reads it yet, so it renders
// as inert scaffolding per the brief ("can be left as inert/non-functional
// UI scaffolding in this task if wiring it to an actual filter is
// premature — Task 2 will complete it"). Task 2 wires `value` into the
// catalog table's Track column filter — that's the one line this
// component needs to grow when that lands (either lift this state up via
// a callback prop, or have Task 2 replace it with its own filtered view).
export function SubjectTrackViewToggle() {
  const [value, setValue] = React.useState<TrackView>('all');

  return (
    <Tabs value={value} onValueChange={(v) => setValue(v as TrackView)}>
      <TabsList variant="segmented" aria-label="Filter by track">
        {TRACK_VIEW_OPTIONS.map((opt) => (
          <TabsTrigger key={opt.value} value={opt.value}>
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
