import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { ArrowRight, ArrowUpRight, Clock, Eye, EyeOff, Share2, XCircle } from "lucide-react";
import Link from "next/link";

type Term = { id: string; term_number: number; label: string };

type Publication = {
  id: string;
  term_id: string;
  publish_from: string;
  publish_until: string;
};

type Status = "active" | "scheduled" | "expired" | "none";

// Read-only publication indicator shown on the staff-side report card detail
// page. Unlike `PublishWindowPanel` (which is the full editor on the list
// page), this is a per-term scan view. Click-through to the list page for
// editing.
export async function PublicationStatus({ sectionId, terms }: { sectionId: string; terms: Term[] }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_card_publications")
    .select("id, term_id, publish_from, publish_until")
    .eq("section_id", sectionId);
  const pubs = (data ?? []) as Publication[];

  // Server component runs per-request; current time is required to bucket
  // publications into active/scheduled/expired. Purity rule doesn't apply
  // here since there is no client-side re-render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const rows = terms.map((t) => {
    const p = pubs.find((x) => x.term_id === t.id);
    if (!p) return { term: t, pub: null, status: "none" as Status };
    const from = new Date(p.publish_from).getTime();
    const until = new Date(p.publish_until).getTime();
    if (now < from) return { term: t, pub: p, status: "scheduled" as Status };
    if (now > until) return { term: t, pub: p, status: "expired" as Status };
    return { term: t, pub: p, status: "active" as Status };
  });

  const activeCount = rows.filter((r) => r.status === "active").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 font-serif text-base font-semibold tracking-tight text-foreground">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Share2 className="size-4" />
          </span>
          Parent access
        </CardTitle>
        <CardDescription>
          {activeCount === 0
            ? "No terms are currently visible to parents."
            : activeCount === terms.length
              ? "All terms are currently visible to parents."
              : `${activeCount} of ${terms.length} terms are currently visible to parents.`}
        </CardDescription>
        <CardAction>
          <Link
            href="/report-cards"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-indigo-deep underline-offset-4 hover:underline">
            Manage
            <ArrowUpRight className="size-3.5" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="border-t border-border pt-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {rows.map(({ term, pub, status }) => (
            <TermRow key={term.id} term={term} pub={pub} status={status} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TermRow({ term, pub, status }: { term: Term; pub: Publication | null; status: Status }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="space-y-1.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {term.label}
        </p>
        {pub ? (
          <p className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-foreground">
            {fmtShort(pub.publish_from)}
            <ArrowRight className="size-3 text-muted-foreground" />
            {fmtShort(pub.publish_until)}
          </p>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">No window scheduled</p>
        )}
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  switch (status) {
    case "active":
      return (
        <Badge
          variant="outline"
          className="h-6 shrink-0 border-brand-mint bg-brand-mint/30 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
          <Eye className="h-3 w-3" />
          Visible
        </Badge>
      );
    case "scheduled":
      return (
        <Badge
          variant="outline"
          className="h-6 shrink-0 border-brand-indigo-soft/60 bg-accent px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep">
          <Clock className="h-3 w-3" />
          Scheduled
        </Badge>
      );
    case "expired":
      return (
        <Badge
          variant="outline"
          className="h-6 shrink-0 border-destructive/40 bg-destructive/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive">
          <XCircle className="h-3 w-3" />
          Expired
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="h-6 shrink-0 border-dashed border-border bg-muted px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <EyeOff className="h-3 w-3" />
          Not published
        </Badge>
      );
  }
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
