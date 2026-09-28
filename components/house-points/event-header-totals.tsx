import { Hand, ListOrdered } from 'lucide-react';

import { HouseStatCard } from '@/components/house-points/house-stat-card';
import { PlaceBadge } from '@/components/house-points/place-badge';
import type {
  EntrantKind,
  Place,
  PlacementMode,
  RankWithin,
} from '@/lib/house-points/compute';
import { ordinal } from '@/lib/house-points/defaults';
import { rankStandings } from '@/lib/house-points/standings';
import type { HouseRow } from '@/lib/sis/houses';

// The top of an event's page: what each house has taken from THIS event, then
// the rubric the sheet below is placed by.
//
// Rendered by the score sheet, from the same in-memory rows the table edits —
// so a score typed below moves these four figures the moment it is committed,
// with no refetch. No hooks here; it is a pure view of what it is handed.

type Props = {
  houses: HouseRow[];
  /** This event's points per house id, recomputed on every change. */
  totals: Record<string, number>;
  /** How many of this event's entrants belong to each house id. */
  entrantsByHouse: Record<string, number>;
  entrantKind: EntrantKind;
  placementMode: PlacementMode;
  rankWithin: RankWithin;
  places: Place[];
};

export function EventHeaderTotals({
  houses,
  totals,
  entrantsByHouse,
  entrantKind,
  placementMode,
  rankWithin,
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

      <RubricPanel
        entrantKind={entrantKind}
        placementMode={placementMode}
        rankWithin={rankWithin}
        places={places}
      />
    </div>
  );
}

function entrantDetail(kind: EntrantKind, count: number): string {
  if (kind === 'house') return 'Not placed yet';
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

/** "The top 3 scores in each class are placed" — worded by rank_within. */
function rubricTitle(
  entrantKind: EntrantKind,
  placementMode: PlacementMode,
  rankWithin: RankWithin,
  places: Place[]
): string {
  if (placementMode === 'pick') return 'Placements are picked by hand';
  const ranked = places.filter((p) => p.rank !== null).length;
  // Teams and houses always rank across the whole event (queries.ts).
  const scope =
    entrantKind !== 'student' || rankWithin === 'event'
      ? ''
      : rankWithin === 'section'
        ? ' in each class'
        : ' in each level';
  return ranked === 1
    ? `The top score${scope} is placed`
    : `The top ${ranked} scores${scope} are placed`;
}

function RubricPanel({
  entrantKind,
  placementMode,
  rankWithin,
  places,
}: Omit<Props, 'houses' | 'totals' | 'entrantsByHouse'>) {
  const sorted = [...places].sort((a, b) => a.sortOrder - b.sortOrder);
  const catchAll = sorted.find((p) => p.rank === null);
  const Icon = placementMode === 'pick' ? Hand : ListOrdered;

  let body: string;
  if (placementMode === 'pick') {
    body = 'Choose each place from the list on the row. Each place earns:';
  } else if (catchAll) {
    body = `Equal scores share a place. Anyone else with a score gets ${catchAll.label}. A blank score earns nothing.`;
  } else {
    body =
      'Equal scores share a place. Anyone else earns no points, and a blank score earns nothing.';
  }

  // §9.4 accent panel — informational, the reader carries on around it.
  return (
    <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft bg-accent p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1.5">
          <p className="font-serif text-base font-semibold text-foreground">
            {rubricTitle(entrantKind, placementMode, rankWithin, places)}
          </p>
          <p className="text-sm text-muted-foreground">{body}</p>
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
