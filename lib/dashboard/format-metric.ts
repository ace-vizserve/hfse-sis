/**
 * How a dashboard metric renders as text.
 *
 * Lives in `lib/` rather than beside `MetricCard` because BOTH sides of the
 * RSC boundary need it: `MetricCard` is a server component, its sparkline is a
 * client one, and the sparkline's hover readout has to print in the same units
 * as the headline number above it.
 *
 * The obvious way to do that — have the card pass `format={(n) => …}` down —
 * does not work: a function cannot be serialised to a client component, and
 * Next fails the render with "Functions cannot be passed directly to Client
 * Components". So the card passes the format NAME, which is a plain string,
 * and the client rebuilds the formatter on its own side.
 */

export type MetricFormat =
  | 'number'
  | 'percent'
  | 'days'
  | 'hours'
  | 'currency'
  | 'raw';

export function formatMetricValue(
  value: string | number,
  format: MetricFormat | undefined,
  currencySuffix?: string
): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  switch (format) {
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'days':
      return `${value.toFixed(1)}d`;
    case 'hours':
      return value < 1
        ? `${Math.round(value * 60)}m`
        : value >= 48
          ? `${(value / 24).toFixed(1)}d`
          : `${value.toFixed(1)}h`;
    case 'currency':
      return `${value.toLocaleString('en-SG')}${currencySuffix ? ` ${currencySuffix}` : ''}`;
    case 'raw':
      return String(value);
    case 'number':
    default:
      return value.toLocaleString('en-SG');
  }
}
