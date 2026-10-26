'use client';

import {
  BookText,
  ChevronDown,
  Download,
  Info,
  Send,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  EditModuleSheet,
  MODULE_FIELDS,
} from '@/components/sow/edit-module-sheet';
import { EditWeekSheet } from '@/components/sow/edit-week-sheet';
import { formatMoment, formatTermRange } from '@/components/sow/format';
import { SowStatusBadge } from '@/components/sow/sow-status-badge';
import { WeekList } from '@/components/sow/week-list';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { HoverHint } from '@/components/ui/hover-hint';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { SowView } from '@/lib/sow/read';

// The SOW page (board 3 and the SowPage component). One component for every
// state; this task builds draft and returned, Task 10 adds the review states.
//
// What the caller may do comes from `view.capability` alone: 'edit' shows the
// edit controls, 'read' shows the same page without them.

export function SowPage({ view }: { view: SowView }) {
  const run = useWriteAction();
  const [editing, setEditing] = useState<number | null>(null);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const d = view.display;
  const canEdit = view.capability === 'edit';
  const name = `${d.levelLabel} ${d.subjectName}`;
  const termName = `Term ${d.termNumber}`;
  const sowTitle = `${name} · ${termName}`;
  const termDates = formatTermRange(d.termStart, d.termEnd);
  const meta = [
    view.key.track,
    termDates ? `${termName}, ${termDates}` : termName,
    view.classes.map((c) => c.name).join(', '),
  ].filter(Boolean);
  const returned = view.state === 'returned';
  const returnNote = returned ? d.returnNote : null;
  const editingWeek =
    editing === null
      ? null
      : (view.weeks.find((w) => w.weekNumber === editing) ?? null);

  async function send() {
    setSending(true);
    await run(
      () =>
        apiFetch<{ stalled: boolean; stalledStep?: string }>(
          `/api/sow/${view.id}/submit`,
          jsonInit('POST', {})
        ),
      {
        pending: 'Sending for review…',
        success: (r) =>
          r.stalled
            ? {
                title: 'Sent for review',
                description: `Waiting — nobody is set for ${r.stalledStep ?? 'the first step'} yet.`,
              }
            : 'Sent for review',
      }
    );
    setSending(false);
  }

  async function deleteWeek(weekNumber: number) {
    setDeleting(weekNumber);
    await run(
      () =>
        apiFetch(`/api/sow/${view.id}/weeks/${weekNumber}`, jsonInit('DELETE')),
      {
        pending: `Deleting Week ${weekNumber}…`,
        success: `Week ${weekNumber} deleted`,
      }
    );
    setDeleting(null);
  }

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/classroom">Classroom</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/classroom/sow?term=${d.termNumber}`}>
                My schemes of work
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{sowTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <BookText className="size-5" />
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Scheme of work · {d.ayCode}
            </p>
            <h1 className="font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[38px]">
              {name}
            </h1>
            <p className="text-sm text-ink-3">{meta.join(' · ')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          <SowStatusBadge state={view.state} />
          {canEdit && (
            <Button variant="outline" onClick={() => setModuleOpen(true)}>
              Edit module details
            </Button>
          )}
          {/* Task 12 builds the export; shown now so the page's actions don't
              move when it arrives. */}
          <HoverHint wrap hint="Available soon">
            <Button variant="outline" disabled>
              <Download className="size-4" />
              Download Excel
            </Button>
          </HoverHint>
          {canEdit && (
            // `canEdit` already means draft or returned, so the button is
            // never offered on a scheme that cannot be sent. A refusal (an
            // empty topic, no steps set up) comes back as the server's
            // sentence in the toast.
            <Button onClick={send} disabled={sending}>
              {returned ? (
                <Undo2 className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              {returned ? 'Send for review again' : 'Send for review'}
            </Button>
          )}
        </div>
      </header>

      {returned && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-white shadow-brand-tile">
            <Undo2 className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Returned with a note
            </p>
            {returnNote && (
              <p className="text-sm text-foreground">
                &ldquo;{returnNote.note}&rdquo;
              </p>
            )}
            {returnNote?.by && (
              <p className="text-sm text-ink-3">
                Returned by {returnNote.by}
                {returnNote.at ? ` on ${formatMoment(returnNote.at)}` : ''}.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {canEdit
                ? 'Make the changes, then send it again. It starts over from the subject head.'
                : 'The teacher makes the changes and sends it again. It starts over from the subject head.'}
            </p>
          </div>
        </div>
      )}

      {view.state === 'draft' && d.reopened && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-indigo-soft/50 bg-accent px-4 py-3 text-sm text-brand-indigo-deep">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Reopened by {d.reopened.by} on {formatMoment(d.reopened.at)}
            {d.reopened.note ? `: ${d.reopened.note}` : '.'}
          </p>
        </div>
      )}

      {!returned && view.state === 'draft' && d.copiedFrom && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-indigo-soft/50 bg-accent px-4 py-3 text-sm text-brand-indigo-deep">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Copied from <span className="font-semibold">{d.copiedFrom}</span>.
            Week dates and school events are from the {d.ayCode} calendar.
            {canEdit &&
              ' Edit any week with the pencil, then send it for review.'}
          </p>
        </div>
      )}

      <ModuleDetails module={view.module} />

      <WeekList
        weeks={view.weeks}
        breaks={view.breaks}
        canEdit={canEdit}
        returnWeekNumber={returnNote?.weekNumber ?? null}
        onEdit={setEditing}
        onDelete={deleteWeek}
        deleting={deleting}
      />

      {canEdit && (
        <>
          <EditWeekSheet
            sowId={view.id}
            week={editingWeek}
            title={sowTitle}
            returnNote={
              returnNote && returnNote.weekNumber === editing
                ? returnNote.note
                : null
            }
            onOpenChange={(open) => !open && setEditing(null)}
          />
          <EditModuleSheet
            open={moduleOpen}
            onOpenChange={setModuleOpen}
            sowId={view.id}
            module={view.module}
            updatedAt={view.updatedAt}
            title={sowTitle}
          />
        </>
      )}
    </>
  );
}

function ModuleDetails({ module }: { module: Record<string, unknown> }) {
  const value = (k: string) =>
    typeof module[k] === 'string' && (module[k] as string).trim() !== ''
      ? (module[k] as string)
      : null;
  const hours = value('hoursPerWeek');
  const summary = [
    hours ? `${hours} hrs/week` : null,
    value('textbook'),
  ].filter(Boolean);
  const filled = MODULE_FIELDS.filter((f) => value(f.key));

  return (
    <Card className="gap-0 py-0">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-5 py-4 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="font-semibold text-foreground">Module details</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {summary.length > 0
              ? `· ${summary.join(' · ')}`
              : '· Not filled in yet'}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {filled.length === 0 ? (
            <p className="px-5 pb-4 text-[13px] text-muted-foreground">
              Nothing written here yet.
            </p>
          ) : (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 border-t border-border px-5 py-4 text-[13px] sm:grid-cols-2">
              {filled.map((f) => (
                <div key={f.key}>
                  <dt className="font-semibold text-foreground">{f.label}</dt>
                  <dd className="whitespace-pre-line text-ink-2">
                    {value(f.key)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
