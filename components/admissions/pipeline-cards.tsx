import {
  Asterisk,
  ClipboardList,
  Cog,
  FileText,
  GraduationCap,
  UserMinus,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { PipelineCounts, PipelineStatus } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type CardSpec = {
  status: PipelineStatus;
  eyebrow: string;
  icon: LucideIcon;
  footerTitle: string;
  footerDetail: string;
};

const CARDS: CardSpec[] = [
  {
    status: 'Submitted',
    eyebrow: 'Submitted',
    icon: FileText,
    footerTitle: 'Received',
    footerDetail: 'Awaiting initial review',
  },
  {
    status: 'Ongoing Verification',
    eyebrow: 'Verification',
    icon: ClipboardList,
    footerTitle: 'Under review',
    footerDetail: 'Documents being checked',
  },
  {
    status: 'Processing',
    eyebrow: 'Processing',
    icon: Cog,
    footerTitle: 'In flight',
    footerDetail: 'Active processing queue',
  },
  {
    status: 'Enrolled',
    eyebrow: 'Enrolled',
    icon: GraduationCap,
    footerTitle: 'Successfully enrolled',
    footerDetail: 'Full enrolment complete',
  },
  {
    status: 'Enrolled (Conditional)',
    eyebrow: 'Conditional',
    icon: Asterisk,
    footerTitle: 'Conditionally enrolled',
    footerDetail: 'Pending final documents',
  },
  {
    status: 'Withdrawn',
    eyebrow: 'Withdrawn',
    icon: UserMinus,
    footerTitle: 'Pulled out',
    footerDetail: 'Parent-initiated withdrawal',
  },
  {
    status: 'Cancelled',
    eyebrow: 'Cancelled',
    icon: XCircle,
    footerTitle: 'Closed out',
    footerDetail: 'Application cancelled',
  },
];

export function PipelineCards({ counts }: { counts: PipelineCounts }) {
  return (
    <div className="@container/main">
      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @4xl/main:grid-cols-3 @6xl/main:grid-cols-4">
        {CARDS.map((c) => (
          <PipelineCard key={c.status} spec={c} value={counts[c.status]} />
        ))}
      </div>
      {counts.Other > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {counts.Other} application{counts.Other === 1 ? '' : 's'} have an
          unrecognized status value and are not shown in the cards above.
        </p>
      )}
    </div>
  );
}

function PipelineCard({ spec, value }: { spec: CardSpec; value: number }) {
  const { icon: Icon, eyebrow, footerTitle, footerDetail } = spec;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
