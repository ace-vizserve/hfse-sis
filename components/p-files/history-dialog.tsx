'use client';

import * as React from 'react';
import { Clock, Download, ExternalLink, History, Loader2, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DocumentRevision } from '@/lib/p-files/queries';

type HistoryDialogProps = {
  enroleeNumber: string;
  slotKey: string;
  label: string;
  trigger?: React.ReactNode;
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatExpiry(date: string | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function HistoryDialog({ enroleeNumber, slotKey, label, trigger }: HistoryDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [revisions, setRevisions] = React.useState<DocumentRevision[] | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setRevisions(null);

    fetch(`/api/p-files/${enroleeNumber}/revisions?slotKey=${encodeURIComponent(slotKey)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Failed to load revisions');
        if (!cancelled) setRevisions(body.revisions as DocumentRevision[]);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Failed to load revisions');
          setRevisions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, enroleeNumber, slotKey]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <History className="size-3" />
            History
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <DialogTitle className="font-serif tracking-tight">History — {label}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            Previous uploads for this slot, newest first. The current document on the card is the active version.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading revisions…
            </div>
          )}

          {!loading && revisions && revisions.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No prior versions — this slot has not been replaced yet.
            </div>
          )}

          {!loading && revisions && revisions.length > 0 && (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60 bg-background">
              {revisions.map((rev, i) => {
                const expiry = formatExpiry(rev.expirySnapshot);
                const isParentPortal = rev.source === 'parent-portal';
                // The archived file is only accessible when the SIS officer
                // flow moved the prior file (archivedUrl set). Parent-portal
                // re-uploads only capture metadata + previousUrl — the file
                // bytes may have been overwritten in storage if the parent
                // portal writes to the canonical path.
                const fileLink = rev.archivedUrl ?? rev.previousUrl;
                const fileLinkLabel = rev.archivedUrl ? 'Open' : 'Try previous URL';
                return (
                  <li key={rev.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-mono text-[11px] tabular-nums text-foreground">
                            {formatTimestamp(rev.replacedAt)}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            Version {revisions.length - i}
                          </span>
                          {isParentPortal && (
                            <Badge variant="warning" className="gap-1">
                              <UserCircle2 className="size-3" />
                              Parent re-uploaded
                            </Badge>
                          )}
                        </div>
                        {rev.replacedByEmail && (
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {isParentPortal ? 'By parent' : 'Replaced by'} {rev.replacedByEmail}
                          </p>
                        )}
                      </div>
                      {fileLink && (
                        <Button asChild variant="outline" size="sm" className="h-7 shrink-0 gap-1.5 text-xs">
                          <a href={fileLink} target="_blank" rel="noopener noreferrer">
                            {rev.archivedUrl ? (
                              <Download className="size-3" />
                            ) : (
                              <ExternalLink className="size-3" />
                            )}
                            {fileLinkLabel}
                          </a>
                        </Button>
                      )}
                    </div>

                    {isParentPortal && (
                      <p className="rounded-md border border-brand-amber/30 bg-brand-amber-light/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                        Parent re-uploaded directly via the enrolment portal — the prior file may
                        have been overwritten in storage. Metadata (status, expiry, who, when) is
                        preserved here.
                      </p>
                    )}

                    {(rev.passportNumberSnapshot || rev.passTypeSnapshot || expiry) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                        {rev.passportNumberSnapshot && (
                          <span>
                            <span className="uppercase tracking-wider">Passport</span>{' '}
                            <span className="text-foreground">{rev.passportNumberSnapshot}</span>
                          </span>
                        )}
                        {rev.passTypeSnapshot && (
                          <span>
                            <span className="uppercase tracking-wider">Pass type</span>{' '}
                            <span className="text-foreground">{rev.passTypeSnapshot}</span>
                          </span>
                        )}
                        {expiry && (
                          <span>
                            <span className="uppercase tracking-wider">Expiry</span>{' '}
                            <span className="text-foreground">{expiry}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {rev.note && (
                      <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-foreground">
                        {rev.note}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
