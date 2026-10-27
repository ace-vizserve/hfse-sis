import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { GRADE_BAND_FILL } from '@/components/markbook/grade-band-colors';
import {
  BAND_DISPLAY_ORDER,
  bandTotal,
  type BandCounts,
} from '@/lib/markbook/academic-overview-compute';

// The school's spread across the five mastery bands, drawn with the app's
// shared recharts `DonutChart`. The legend keeps ladder order
// (`legendOrder="given"`) — these bands are a ladder, and a key that lists
// them biggest-first stops reading as one.
//
// Colours come from GRADE_BAND_FILL, the same map the spread bars in both
// tables use, so this ring and every bar above it share one key (09a §10.2).

export function BandDonut({ bands }: { bands: BandCounts }) {
  return (
    <DonutChart
      data={BAND_DISPLAY_ORDER.map((band) => ({
        name: `${band.label} (${band.range})`,
        value: bands[band.key],
      }))}
      colors={BAND_DISPLAY_ORDER.map((band) => GRADE_BAND_FILL[band.key])}
      height={180}
      centerValue={bandTotal(bands)}
      centerLabel="students"
      legendOrder="given"
    />
  );
}
