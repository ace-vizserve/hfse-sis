'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MySowListRow } from '@/components/sow/my-sows-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// New SOW (board 2). Starts a draft for one subject x level x track this term,
// blank or copied from last year's approved scheme, and opens it.
//
// Opened from a row ("Start SOW"), the subject, level, track and term are that
// row's and are shown, not picked. Opened from "New SOW", one select offers
// the rows not started yet — the only combinations the teacher can create.
// (The Excel import option is Task 11.)

const CHOICE_CLASS =
  'flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-indigo/40 has-[[data-state=checked]]:bg-brand-indigo/5';

const keyOf = (r: MySowListRow) => `${r.subjectId}|${r.levelId}|${r.track}`;

export function NewSowSheet({
  open,
  onOpenChange,
  rows,
  fixedKey,
  termLabel,
  ayCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rows with no scheme yet. */
  rows: MySowListRow[];
  /** The row it was opened from, or null to let the teacher pick. */
  fixedKey: string | null;
  termLabel: string;
  ayCode?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {/* Mounted per opening, so each one starts from the row's defaults. */}
        {open && (
          <NewSowForm
            key={fixedKey ?? 'pick'}
            rows={rows}
            fixedKey={fixedKey}
            termLabel={termLabel}
            ayCode={ayCode}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A row's defaults: the teacher's own classes, and last year's copy if any. */
const ticksFor = (r: MySowListRow | null) =>
  new Set(r ? r.classes.map((c) => c.sectionId) : []);
const startFor = (r: MySowListRow | null): 'copy' | 'blank' =>
  r?.lastYear ? 'copy' : 'blank';

function NewSowForm({
  rows,
  fixedKey,
  termLabel,
  ayCode,
}: {
  rows: MySowListRow[];
  fixedKey: string | null;
  termLabel: string;
  ayCode?: string;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const findRow = (k: string | null) =>
    rows.find((r) => keyOf(r) === k) ?? null;
  const [key, setKey] = useState<string | null>(
    fixedKey ?? (rows[0] ? keyOf(rows[0]) : null)
  );
  const row = findRow(key);
  const [ticked, setTicked] = useState<Set<string>>(() => ticksFor(row));
  const [start, setStart] = useState<'copy' | 'blank'>(() => startFor(row));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function pick(k: string) {
    const next = findRow(k);
    setKey(k);
    setTicked(ticksFor(next));
    setStart(startFor(next));
    setError(null);
  }

  const sections = row
    ? row.groupSections.length > 0
      ? row.groupSections
      : row.classes
    : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    if (ticked.size === 0) {
      setError('Tick at least one class.');
      return;
    }
    setError(null);
    setSaving(true);
    const result = await run(
      () =>
        apiFetch<{ ok: true; sowId: string }>(
          '/api/sow',
          jsonInit('POST', {
            key: {
              termId: row.termId,
              subjectId: row.subjectId,
              levelId: row.levelId,
              track: row.track,
            },
            sectionIds: [...ticked],
            start,
          })
        ),
      {
        pending: 'Creating the draft…',
        success: 'Draft created',
        // The new SOW page arriving is the change on screen; nothing behind
        // the drawer needs re-rendering first.
        refresh: false,
        onResolved: (d) => router.push(`/classroom/sow/${d.sowId}`),
      }
    );
    if (!result) setSaving(false);
  }

  return (
    <>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            New SOW
          </SheetTitle>
          <SheetDescription>
            You&rsquo;ll write and edit it here. It stays a draft until you send
            it for review.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {!row ? (
            <p className="text-sm text-muted-foreground">
              Every subject you teach already has a scheme of work for{' '}
              {termLabel}.
            </p>
          ) : (
            <>
              {fixedKey ? (
                <dl className="grid grid-cols-2 gap-4">
                  <Fact label="Subject" value={row.subjectName} />
                  <Fact label="Level" value={row.levelLabel} />
                  <Fact label="Track" value={row.track} />
                  <Fact label="Term" value={termLabel} />
                </dl>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Field>
                    <FieldLabel htmlFor="new-sow-which">
                      Subject, level and track
                    </FieldLabel>
                    <Select value={key ?? undefined} onValueChange={pick}>
                      <SelectTrigger id="new-sow-which" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rows.map((r) => (
                          <SelectItem key={keyOf(r)} value={keyOf(r)}>
                            {r.subjectName} · {r.levelLabel} · {r.track}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <dl>
                    <Fact label="Term" value={termLabel} />
                  </dl>
                </div>
              )}

              <FieldSet>
                <FieldLegend variant="label">
                  Classes that follow it
                </FieldLegend>
                <div className="space-y-2.5">
                  {sections.map((s) => {
                    const id = `new-sow-class-${s.sectionId}`;
                    return (
                      <label
                        key={s.sectionId}
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
                      >
                        <Checkbox
                          id={id}
                          checked={ticked.has(s.sectionId)}
                          onCheckedChange={(on) =>
                            setTicked((prev) => {
                              const next = new Set(prev);
                              if (on) next.add(s.sectionId);
                              else next.delete(s.sectionId);
                              return next;
                            })
                          }
                        />
                        {row.levelLabel} {s.name}
                      </label>
                    );
                  })}
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">
                  How do you want to start?
                </FieldLegend>
                <RadioGroup
                  value={start}
                  onValueChange={(v) => setStart(v as 'copy' | 'blank')}
                  className="gap-2.5"
                >
                  {row.lastYear && (
                    <label htmlFor="new-sow-copy" className={CHOICE_CLASS}>
                      <RadioGroupItem
                        value="copy"
                        id="new-sow-copy"
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium text-foreground">
                          Copy from last year
                        </span>
                        <span className="block text-[13px] text-muted-foreground">
                          Start from your approved SOW for the same subject,
                          level and term, then change what&rsquo;s different.
                        </span>
                      </span>
                    </label>
                  )}
                  <label htmlFor="new-sow-blank" className={CHOICE_CLASS}>
                    <RadioGroupItem
                      value="blank"
                      id="new-sow-blank"
                      className="mt-0.5"
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium text-foreground">
                        Start blank
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        Empty weeks for this term, dated from the school
                        calendar.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              </FieldSet>

              {start === 'copy' && row.lastYear && (
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3.5 text-[13px] text-ink-2">
                  <p className="font-medium text-foreground">
                    Copy from {row.lastYear.label} · {row.levelLabel}{' '}
                    {row.subjectName} ({row.track}), approved
                  </p>
                  <FieldDescription>
                    Brings across the module details and every week. Week dates
                    and school events are set from the{' '}
                    {ayCode ? `${ayCode} ` : ''}calendar. Last year&rsquo;s
                    weekly checks and notes are not copied.
                  </FieldDescription>
                </div>
              )}
            </>
          )}
        </div>

        <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-6 py-4">
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </SheetClose>
          <Button
            type="submit"
            disabled={!row}
            loading={saving}
            loadingText="Creating…"
          >
            Create draft
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-[13px] font-medium text-foreground">{label}</dt>
      <dd className="text-sm text-ink-3">{value}</dd>
    </div>
  );
}
