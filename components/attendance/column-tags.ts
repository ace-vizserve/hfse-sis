import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';
import type { ColumnTagCode } from '@/lib/attendance/sheet-columns';

// Single source for the column-tag → ChartLegendChip color mapping (§10.2).
// Shared by the attendance term-sheet grid (date-column header chips) and the
// sheet-context card (term-calendar list keys), so both surfaces document the
// same PH / SH / SE / EX / HBL / NC tags with identical paint and can't drift.
// PH/SH/HBL/NC keep their day-type colours; EX (examination) reuses the notable
// 'primary' wash; SE (school event) reuses 'fresh'. The letter label is always
// present, so colour is never the only signal.
export const COLUMN_TAG_COLOR: Record<ColumnTagCode, ChartLegendChipColor> = {
  PH: 'very-stale',
  SH: 'stale',
  HBL: 'primary',
  NC: 'neutral',
  EX: 'primary',
  SE: 'fresh',
};
