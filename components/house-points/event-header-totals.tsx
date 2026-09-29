import { Hand } from 'lucide-react';

import { HouseStatCard } from '@/components/house-points/house-stat-card';
import { PlaceBadge } from '@/components/house-points/place-badge';
import type { EntrantKind, Place } from '@/lib/house-points/compute';
import { ordinal } from '@/lib/house-points/defaults';
import { rankStandings } from '@/lib/house-points/standings';
import type { HouseRow } from '@/lib/sis/houses';

// The top of an event's page: what each house has taken from THIS event, then
// the rubric of awards the sheet below picks from.
//
// Rendered by the score sheet, from the same in-memory rows the table edits —
// so an award picked below moves these four figures the moment it is saved,
// with no refetch. No hooks here; it is a pure view of what it is handed.

type Props = {
  houses: HouseRow[];
  /** This event's points per house id, recomputed on every change. */
  totals: Record<string, number>;
  /** How many of this event's entrants belong to each house id. */
  entrantsByHouse: Record<string, number>;
  entrantKind: EntrantKind;
  places: Place[];
};

export function EventHeaderTotals({
  houses,
  totals,
  entrantsByHouse,
  entrantKind,
  places,
}: Props) {
  const standings = rankStandings(houses, totals);
  const anyPoints = standings.some((s) => s.total !== 0);

  return (
    <div className="space-y-4">
      {standings.length > 0 && (
        <div className="@container/main">
          <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
            {standings.map((s) => (
              <HouseStatCard
                key={s.house.id}
                name={s.house.name}
                colourToken={s.house.colourToken}
                total={s.total}
                footerTitle={
                  anyPoints
                    ? `${ordinal(s.place)} in this event`
                    : 'No points yet'
                }
                footerDetail={
                  anyPoints
                    ? s.gapLabel
                    : entrantDetail(
                        entrantKind,
                        entrantsByHouse[s.house.id] ?? 0
                      )
                }
              />
            ))}
          </div>
        </div>
      )}

      <RubricPanel places={places} />
    </div>
  );
}

function entrantDetail(kind: EntrantKind, count: number): string {
  if (kind === 'house') return 'No award yet';
  const noun =
    kind === 'team'
      ? count === 1
        ? 'team'
        : 'teams'
      : count === 1
        ? 'student'
        : 'students';
  return count === 0 ? `No ${noun} entered` : `${count} ${noun} entered`;
}

function RubricPanel({ places }: { places: Place[] }) {
  const sorted = [...places].sort((a, b) => a.sortOrder - b.sortOrder);

  // §9.4 accent panel — informational, the reader carries on around it.
  return (
    <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft bg-accent p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Hand className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1.5">
          <p className="font-serif text-base font-semibold text-foreground">
            Awards are picked by hand
          </p>
          <p className="text-sm text-muted-foreground">
            Choose each award from the list on the row. Each award earns:
          </p>
        </div>
        {sorted.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Rubric">
            {sorted.map((place) => (
              <li key={place.id}>
                <PlaceBadge place={place} withPoints />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
