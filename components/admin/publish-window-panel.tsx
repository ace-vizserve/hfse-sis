'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Clock,
  Loader2,
  Share2,
  X,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';

type Term = { id: string; term_number: number; label: string };

type Publication = {
  id: string;
  section_id: string;
  term_id: string;
  publish_from: string;
  publish_until: string;
  published_by: string;
};

type Status = 'active' | 'scheduled' | 'expired' | 'none';

function statusOf(p: Publication | undefined): Status {
  if (!p) return 'none';
  const now = new Date();
  const from = new Date(p.publish_from);
  const until = new Date(p.publish_until);
  if (now < from) return 'scheduled';
  if (now > until) return 'expired';
  return 'active';
}

function StatusBadge({ status }: { status: Status }) {
  switch (status) {
    case 'active':
      return (
        <Badge variant="default">
          <CheckCircle2 className="h-3 w-3" />
          Published
        </Badge>
      );
    case 'scheduled':
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3" />
          Scheduled
        </Badge>
      );
    case 'expired':
      return <Badge variant="secondary">Expired</Badge>;
    default:
      return (
        <Badge
          variant="outline"
          className="border-dashed text-muted-foreground"
        >
          Not published
        </Badge>
      );
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PublishWindowPanel({
  sectionId,
  sectionName,
  terms,
}: {
  sectionId: string;
  sectionName: string;
  terms: Term[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await fetch(
        `/api/report-card-publications?section_id=${sectionId}`,
      );
      const body = await res.json();
      if (!cancelled) {
        setPublications((body.publications ?? []) as Publication[]);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sectionId]);

  async function save(termId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/report-card-publications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          section_id: sectionId,
          term_id: termId,
          publish_from: from,
          publish_until: until,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'publish failed');
      const reload = await fetch(
        `/api/report-card-publications?section_id=${sectionId}`,
      );
      const reloadBody = await reload.json();
      setPublications((reloadBody.publications ?? []) as Publication[]);
      setEditingTermId(null);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(publicationId: string) {
    if (!confirm('Revoke this publication? Parents will lose access immediately.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/report-card-publications/${publicationId}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'revoke failed');
      setPublications((prev) => prev.filter((p) => p.id !== publicationId));
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(termId: string, existing?: Publication) {
    setEditingTermId(termId);
    setError(null);
    if (existing) {
      setFrom(existing.publish_from);
      setUntil(existing.publish_until);
    } else {
      const now = new Date();
      const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      setFrom(now.toISOString());
      setUntil(twoWeeks.toISOString());
    }
  }

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Parent access
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Publish windows
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Share2 className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 px-0 pt-0">
        <p className="px-6 pt-4 text-sm text-muted-foreground">
          Publish each term to parents within a time window. Parents sign in to the parent
          portal and can only view terms with an active window.
        </p>

        {loading && (
          <div className="flex items-center gap-2 px-6 pb-4 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading publications…
          </div>
        )}

        {error && (
          <div className="px-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        {!loading && (
          <ul className="divide-y divide-border border-t border-border">
            {terms.map((term) => {
              const existing = publications.find((p) => p.term_id === term.id);
              const status = statusOf(existing);
              const isEditing = editingTermId === term.id;

              return (
                <li key={term.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-serif text-base font-semibold tracking-tight text-foreground">
                          {term.label}
                        </span>
                        <StatusBadge status={status} />
                      </div>
                      {existing && (
                        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {fmt(existing.publish_from)}{' '}
                          <span className="text-hairline-strong">→</span>{' '}
                          {fmt(existing.publish_until)}
                        </div>
                      )}
                    </div>
                    {!isEditing && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={existing ? 'outline' : 'default'}
                          onClick={() => startEdit(term.id, existing)}
                          disabled={busy}
                        >
                          {existing ? 'Edit window' : 'Publish'}
                        </Button>
                        {existing && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => revoke(existing.id)}
                            disabled={busy}
                          >
                            <X className="h-3.5 w-3.5" />
                            Revoke
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                      <FieldGroup>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor={`from-${term.id}`}>Publish from</FieldLabel>
                            <DateTimePicker
                              id={`from-${term.id}`}
                              value={from}
                              onChange={setFrom}
                              placeholder="Start date & time"
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`until-${term.id}`}>Publish until</FieldLabel>
                            <DateTimePicker
                              id={`until-${term.id}`}
                              value={until}
                              onChange={setUntil}
                              placeholder="End date & time"
                            />
                          </Field>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingTermId(null)}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => save(term.id)}
                            disabled={busy || !from || !until}
                          >
                            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {existing ? 'Update window' : 'Publish'}
                          </Button>
                        </div>
                      </FieldGroup>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
