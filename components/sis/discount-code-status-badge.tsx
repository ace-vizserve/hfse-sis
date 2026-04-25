import { Badge } from '@/components/ui/badge';

type Props = {
  startDate: string | null;
  endDate: string | null;
};

// Active / Expired / Upcoming / — computed from today vs. the window.
// Today is normalized to 00:00 local for a stable same-day comparison;
// a window ending today still counts as Active.
function classify(start: string | null, end: string | null): 'active' | 'expired' | 'upcoming' | 'none' {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  if (e && e < today) return 'expired';
  if (s && s > today) return 'upcoming';
  if (s && e && today >= s && today <= e) return 'active';
  return 'none';
}

export function DiscountCodeStatusBadge({ startDate, endDate }: Props) {
  const state = classify(startDate, endDate);
  if (state === 'active') {
    return (
      <Badge variant="success" className="h-6 font-mono text-[10px] uppercase tracking-wider">
        Active
      </Badge>
    );
  }
  if (state === 'expired') {
    return (
      <Badge variant="outline" className="h-6 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Expired
      </Badge>
    );
  }
  if (state === 'upcoming') {
    return (
      <Badge variant="outline" className="h-6 border-brand-indigo-soft bg-accent font-mono text-[10px] uppercase tracking-wider text-brand-indigo-deep">
        Upcoming
      </Badge>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

export function isExpired(endDate: string | null): boolean {
  return classify(null, endDate) === 'expired';
}
