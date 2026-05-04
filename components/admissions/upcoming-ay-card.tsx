import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// /admissions dashboard signal card (KD #77). Renders top-of-fold when an
// upcoming AY has `accepting_applications=true AND is_current=false`,
// surfacing application volume so registrars notice early-bird activity
// without manually flipping the AY switcher.
//
// When no upcoming AY is open this component returns null — the card is
// always-or-nothing. The dedicated /admissions/upcoming/applications route
// is the deeper destination; this card is the dashboard-level signal.

export type UpcomingAyCardProps = {
  ayCode: string;
  ayLabel: string;
  applicationCount: number;
  byStage: { submitted: number; ongoingVerification: number; processing: number };
};

export function UpcomingAyCard({
  ayCode,
  ayLabel,
  applicationCount,
  byStage,
}: UpcomingAyCardProps) {
  return (
    <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Early-bird · {ayCode}
        </CardDescription>
        <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          {applicationCount.toLocaleString("en-SG")} applications for {ayLabel}
        </CardTitle>
        <CardAction>
          <Badge variant="success" className="h-7 gap-1 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            <Sparkles className="size-3" />
            Open
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 text-center">
          <StageCell label="Submitted" value={byStage.submitted} />
          <StageCell label="Ongoing Verification" value={byStage.ongoingVerification} />
          <StageCell label="Processing" value={byStage.processing} />
        </div>
      </CardContent>
      <CardFooter>
        <Link
          href="/admissions/upcoming/applications"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open the upcoming AY pipeline
          <ArrowRight className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

function StageCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="font-serif text-2xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString("en-SG")}
      </div>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
