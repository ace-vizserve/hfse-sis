'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useTrackFilter,
  type TrackFilterValue,
} from '@/lib/sis/subject-track-filter-store';

const TRACK_VIEW_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'global', label: 'Global' },
  { value: 'standard', label: 'Standard' },
] as const;

// Secondary-only Track VIEW filter (Task 1 scaffolding, wired in Task 2 of
// the "Unified Subject Setup page" plan). Deliberately writes nothing —
// `sections.class_type` is only ever written from Step ②'s bundle-flag
// buttons (Task 3). Backed by `lib/sis/subject-track-filter-store.ts`'s
// shared client store rather than local `useState` — this toggle and
// `SubjectCatalogCard`'s table (which reads + applies the filter) are
// sibling client components under one Server Component page with no
// client ancestor to lift shared state into; see that module's header
// comment for why a module-scoped store was chosen over Context or a URL
// param.
export function SubjectTrackViewToggle() {
  const [value, setValue] = useTrackFilter();

  return (
    <Tabs value={value} onValueChange={(v) => setValue(v as TrackFilterValue)}>
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
