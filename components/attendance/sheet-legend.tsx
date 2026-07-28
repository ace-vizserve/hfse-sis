import { COLUMN_TAG_COLOR } from '@/components/attendance/column-tags';
import { STATUS_CELL_WASH } from '@/components/attendance/status-wash';
import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import type { AttendanceStatus, DayType } from '@/lib/schemas/attendance';

// The Term sheet's key, mounted inside the register card (SheetContextCard) so
// the colours are readable while marking — it previously sat below the whole
// two-month grid, out of reach of the person actually reading a cell.
//
// Two groups, split by the card's own hairline idiom: what a cell's colour
// means, and what the tag above a date column means.

// Day-type → ChartLegendChip color. Mirrors the calendar admin's
// DAY_TYPE_LEGEND_COLOR exactly so the wide-grid header chip and the
// calendar's day-type chip read as the same affordance across surfaces.
// 'school_day' uses 'fresh' to match the calendar.
const DAY_TYPE_CHIP_COLOR: Record<DayType, ChartLegendChipColor> = {
  school_day: 'fresh',
  public_holiday: 'very-stale',
  school_holiday: 'stale',
  hbl: 'primary',
  no_class: 'neutral',
};

export function SheetLegend({ canWriteNc }: { canWriteNc: boolean }) {
  return (
    // gap-px over bg-border draws the hairline between the two groups — the
    // same rule-drawing idiom the term-calendar DateList grid uses below.
    <div className="grid grid-cols-1 gap-px border-b border-border bg-border sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="bg-card px-6 py-3">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Cell marks
        </p>
        {/* Each swatch reads the SAME STATUS_CELL_WASH map used inside the
            cell when populated, so legend ↔ cell pixel-match per
            docs/context/09a-design-patterns.md §10.2 (bespoke swatch for grid
            cell tints). EX is a single chip — the cell collapses every EX
            subtype (MC / vacation / compassionate) to "EX";
            the subtype is still selectable in the marking palette + stored
            (KD #94), and shown in the cell tooltip. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground">
          <StatusLegendChip status="P" letter="P" description="Present" />
          <StatusLegendChip status="L" letter="L" description="Late" />
          <StatusLegendChip status="EX" letter="EX" description="Excused" />
          <StatusLegendChip status="A" letter="A" description="Absent" />
          {canWriteNc && (
            <StatusLegendChip status="NC" letter="NC" description="No class" />
          )}
        </div>
      </div>

      <div className="bg-card px-6 py-3">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Date columns
        </p>
        {/* Day-type chips are the SAME ChartLegendChip rendered in column
            headers, so the column-header chip and the legend chip read as
            the same affordance per §10. School day is the default — no chip
            on its column headers, so the legend chip just signals "this is
            what a teaching day looks like elsewhere in the SIS". */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground">
          <DayTypeLegendChip
            dayType="school_day"
            letter="·"
            description="School day"
          />
          <DayTypeLegendChip
            dayType="public_holiday"
            letter="PH"
            description="Public holiday"
          />
          <DayTypeLegendChip
            dayType="school_holiday"
            letter="SH"
            description="School holiday"
          />
          <DayTypeLegendChip
            dayType="hbl"
            letter="HBL"
            description="Home-based, marked"
          />
          <DayTypeLegendChip
            dayType="no_class"
            letter="NC"
            description="No class"
          />
          {/* SE and EX have no day-type of their own — they come from
              calendar_events, so they read COLUMN_TAG_COLOR directly. */}
          <span className="inline-flex items-center gap-2">
            <ChartLegendChip color={COLUMN_TAG_COLOR.SE} label="SE" />
            <span className="text-[12px] font-medium text-foreground">
              School event
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            <ChartLegendChip color={COLUMN_TAG_COLOR.EX} label="EX" />
            <span className="text-[12px] font-medium text-foreground">
              Examination
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

// Legend row pairing a marking-cell swatch with a description label. The
// swatch reads the SAME STATUS_CELL_WASH map applied to the cells when status
// is set, so legend + cell are pixel-identical paint per the "true visual
// key" rule in docs/context/09a-design-patterns.md §10.2 (bespoke swatch for
// grid cell tints). The letter sits ON the swatch so the key shows both the
// colour AND the letter exactly as the grid does.
function StatusLegendChip({
  status,
  letter,
  description,
}: {
  status: AttendanceStatus;
  letter: string;
  description: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={
          'inline-flex min-w-7 items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] shadow-input ' +
          STATUS_CELL_WASH[status]
        }
      >
        {letter}
      </span>
      <span className="text-[12px] font-medium text-foreground">
        {description}
      </span>
    </span>
  );
}

// Sibling to StatusLegendChip — pulls its color from the same
// DAY_TYPE_CHIP_COLOR map the column header chips use, so legend + header
// stay pixel-identical. Single source of truth, per §10.
function DayTypeLegendChip({
  dayType,
  letter,
  description,
}: {
  dayType: DayType;
  letter: string;
  description: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <ChartLegendChip color={DAY_TYPE_CHIP_COLOR[dayType]} label={letter} />
      <span className="text-[12px] font-medium text-foreground">
        {description}
      </span>
    </span>
  );
}
