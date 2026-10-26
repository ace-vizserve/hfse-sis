'use client';

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
} from 'lucide-react';
import { useState } from 'react';

import { formatRange, formatWeekdayDay } from '@/components/sow/format';
import { ReliefNoteLine } from '@/components/sow/relief-note-line';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RichText } from '@/components/ui/rich-text';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { isEmptyRichText, toPlainText } from '@/lib/rich-text';
import {
  type CellMark,
  CHECK_LABELS,
  CHECK_NOTE_MAX,
  CHECK_NOTE_PLACEHOLDERS,
  CHECK_NOTE_PROMPTS,
  CHECK_OPTIONS,
  type CheckOption,
} from '@/lib/sow/check-options';
import type {
  SowCheckClass,
  SowCheckWeek,
  SowChecking,
} from '@/lib/sow/checks';
import { cn } from '@/lib/utils';

// The weekly check on an approved scheme of work (board 7): "This week" shows
// one week with its "How did Week N go?" form; "Whole term" lists every week
// with each class's mark, the chosen week opened in place. The plan shown is
// the APPROVED snapshot (lib/sow/checks.ts), so a scheme being revised still
// shows — and is checked against — the plan in force.
//
// A custom row list, like WeekList: each week is a multi-line block, and the
// open week carries a form.

type Draft = { option: CheckOption; note: string };

// §9.3 tones. The selected option chip and the read-only mark share them:
// as planned / ok → mint, anything with a note → amber, missed → destructive.
const MINT = 'border-brand-mint bg-brand-mint/30 text-ink';
const AMBER = 'border-brand-amber/40 bg-brand-amber/10 text-ink';
const MISSED = 'border-destructive/40 bg-destructive/10 text-destructive';

const ROW =
  'grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[64px_120px_minmax(0,1fr)]';

function markLabel(c: SowCheckClass): string {
  switch (c.mark) {
    case 'ok':
      return 'As planned';
    case 'note': {
      const opts = [...new Set(c.notes.map((n) => CHECK_LABELS[n.option]))];
      return opts.length > 0 ? opts.join(', ') : 'Not as planned';
    }
    case 'missed':
      return 'Not checked';
    case 'todo':
      return 'Not yet';
  }
}

const MARK_TONE: Record<CellMark, string> = {
  ok: MINT,
  note: AMBER,
  missed: MISSED,
  todo: 'border-border bg-muted text-muted-foreground',
};

function MarkPill({ c }: { c: SowCheckClass }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold',
        MARK_TONE[c.mark]
      )}
    >
      {c.name} · {markLabel(c)}
    </span>
  );
}

export function WeekChecks({
  sowId,
  checking,
  revising = false,
}: {
  sowId: string;
  checking: SowChecking;
  /** A reopened scheme: the checks follow the last approved plan. */
  revising?: boolean;
}) {
  const run = useWriteAction();
  const { weeks } = checking;
  const lastStarted = [...weeks].reverse().find((w) => w.started);
  const [view, setView] = useState<'week' | 'term'>('week');
  const [selected, setSelected] = useState<number | null>(
    checking.thisWeekNumber ??
      lastStarted?.weekNumber ??
      weeks[0]?.weekNumber ??
      null
  );
  // Only what the teacher has changed; everything else reads from the server.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);

  if (weeks.length === 0) {
    return (
      <Card className="items-center gap-2 px-6 py-12 text-center">
        <CalendarDays className="size-6 text-muted-foreground" />
        <p className="font-serif text-lg font-semibold text-foreground">
          No weeks to check.
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          The weeks come from this term&rsquo;s dates on the school calendar.
        </p>
      </Card>
    );
  }

  const index = Math.max(
    0,
    weeks.findIndex((w) => w.weekNumber === selected)
  );
  const week = weeks[index];
  const key = (w: number, s: string) => `${w}|${s}`;

  const editable = (w: SowCheckWeek, c: SowCheckClass) =>
    c.canCheck && w.started && !c.signed;
  const valueOf = (w: SowCheckWeek, c: SowCheckClass): Draft | null =>
    drafts[key(w.weekNumber, c.sectionId)] ??
    (c.mine ? { option: c.mine.option, note: c.mine.note ?? '' } : null);

  const editableClasses = week.classes.filter((c) => editable(week, c));
  const changed = editableClasses.filter((c) => {
    const d = drafts[key(week.weekNumber, c.sectionId)];
    if (!d) return false;
    return (
      d.option !== c.mine?.option ||
      (d.option !== 'as_planned' && d.note !== (c.mine?.note ?? ''))
    );
  });
  const missingNote = editableClasses.some((c) => {
    const v = valueOf(week, c);
    return v != null && v.option !== 'as_planned' && isEmptyRichText(v.note);
  });

  function setDraft(c: SowCheckClass, patch: Partial<Draft>) {
    const k = key(week.weekNumber, c.sectionId);
    const base = valueOf(week, c) ?? { option: 'as_planned', note: '' };
    setDrafts((prev) => ({ ...prev, [k]: { ...base, ...patch } }));
  }

  async function save() {
    const w = week;
    const toSave = changed.map((c) => ({
      c,
      d: drafts[key(w.weekNumber, c.sectionId)]!,
    }));
    setSaving(true);
    await run(
      async () => {
        // One request per class: each class saves or refuses on its own, and
        // a refusal stops here so the toast names the class it is about.
        for (const { c, d } of toSave) {
          try {
            await apiFetch(
              `/api/sow/${sowId}/checks`,
              jsonInit('POST', {
                weekNumber: w.weekNumber,
                sectionId: c.sectionId,
                option: d.option,
                note: d.option === 'as_planned' ? null : d.note,
              })
            );
          } catch (e) {
            throw new Error(
              `${c.name}: ${e instanceof Error ? e.message : 'Could not save the check.'}`
            );
          }
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[key(w.weekNumber, c.sectionId)];
            return next;
          });
        }
        return null;
      },
      {
        pending: `Saving Week ${w.weekNumber}…`,
        success: `Week ${w.weekNumber} saved`,
      }
    );
    setSaving(false);
  }

  return (
    <section aria-label="Weekly check" className="space-y-4">
      {revising && (
        <p className="text-sm text-ink-3">
          While this scheme is being revised, weeks are checked against the last
          approved plan.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as 'week' | 'term')}>
          <TabsList>
            <TabsTrigger value="week">This week</TabsTrigger>
            <TabsTrigger value="term">Whole term</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === 'week' ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              aria-label="Previous week"
              disabled={index === 0}
              onClick={() => setSelected(weeks[index - 1].weekNumber)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[120px] text-center text-sm font-semibold tabular-nums text-foreground">
              Week {week.weekNumber} of {weeks.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              aria-label="Next week"
              disabled={index === weeks.length - 1}
              onClick={() => setSelected(weeks[index + 1].weekNumber)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {checking.summary}
          </p>
        )}
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <ul className="divide-y divide-border">
          {(view === 'term' ? weeks : [week]).map((w) =>
            w.weekNumber === week.weekNumber ? (
              <OpenWeek
                key={w.weekNumber}
                week={w}
                current={w.weekNumber === checking.thisWeekNumber}
                editable={(c) => editable(w, c)}
                valueOf={(c) => valueOf(w, c)}
                onPick={(c, option) => setDraft(c, { option })}
                onNote={(c, note) => setDraft(c, { note })}
                canSave={changed.length > 0 && !missingNote}
                missingNote={missingNote}
                showSave={editableClasses.length > 0}
                saving={saving}
                quiet={revising}
                onSave={() => void save()}
              />
            ) : (
              <ClosedWeek
                key={w.weekNumber}
                week={w}
                current={w.weekNumber === checking.thisWeekNumber}
                onOpen={() => setSelected(w.weekNumber)}
              />
            )
          )}
        </ul>
      </Card>
    </section>
  );
}

function ClosedWeek({
  week,
  current,
  onOpen,
}: {
  week: SowCheckWeek;
  current: boolean;
  onOpen: () => void;
}) {
  const notes = week.classes.flatMap((c) =>
    c.notes.map((n) => ({ name: c.name, note: n.note }))
  );
  const signed = week.classes.length > 0 && week.classes.every((c) => c.signed);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          ROW,
          'w-full text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[64px_120px_minmax(0,1fr)_auto]'
        )}
        aria-label={`Open Week ${week.weekNumber}`}
      >
        <span
          className={cn(
            'pt-0.5 font-mono text-[12px] font-semibold',
            week.started ? 'text-ink-3' : 'text-ink-5'
          )}
        >
          WK {week.weekNumber}
        </span>
        <span className="hidden pt-0.5 text-[13px] tabular-nums text-ink-3 sm:block">
          {formatRange(week.startsOn, week.endsOn)}
          {current && (
            <span className="block text-xs font-semibold text-primary">
              This week
            </span>
          )}
        </span>
        <span className="min-w-0 space-y-1">
          <span
            className={cn(
              'block text-sm',
              week.started ? 'font-medium text-foreground' : 'text-ink-2'
            )}
          >
            {week.topic || 'No topic'}
          </span>
          {week.events.length > 0 && (
            <span className="block text-xs text-brand-amber">
              {week.events.join(' · ')}
            </span>
          )}
          {notes.map((n, i) => (
            <span key={i} className="block text-xs text-ink-3">
              {n.name}: &ldquo;{toPlainText(n.note)}&rdquo;
            </span>
          ))}
          {week.classes.flatMap((c) =>
            c.reliefNotes.map((r, i) => (
              <span
                key={`relief-${c.sectionId}-${i}`}
                className="block text-xs text-brand-indigo-deep"
              >
                Relief, {formatWeekdayDay(r.taughtOn)}, {c.name} ({r.name}):
                &ldquo;{toPlainText(r.note)}&rdquo;
              </span>
            ))
          )}
        </span>
        <span className="col-span-full flex flex-wrap items-start gap-1.5 sm:col-span-1 sm:max-w-[260px] sm:justify-end">
          {week.started ? (
            <>
              {week.classes.map((c) => (
                <MarkPill key={c.sectionId} c={c} />
              ))}
              {signed && (
                <span className="flex w-full items-center gap-1 text-xs text-ink-3 sm:justify-end">
                  <Check className="size-3.5 text-brand-mint" aria-hidden />
                  Signed by subject head
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-ink-5">Not yet</span>
          )}
        </span>
      </button>
    </li>
  );
}

function OpenWeek({
  week,
  current,
  editable,
  valueOf,
  onPick,
  onNote,
  canSave,
  missingNote,
  showSave,
  saving,
  quiet,
  onSave,
}: {
  week: SowCheckWeek;
  current: boolean;
  editable: (c: SowCheckClass) => boolean;
  valueOf: (c: SowCheckClass) => Draft | null;
  onPick: (c: SowCheckClass, option: CheckOption) => void;
  onNote: (c: SowCheckClass, note: string) => void;
  canSave: boolean;
  missingNote: boolean;
  showSave: boolean;
  saving: boolean;
  /** Not the page's primary action (a draft's is "Send for review"). */
  quiet: boolean;
  onSave: () => void;
}) {
  const details = [
    { label: 'Learning outcomes', html: week.learningOutcomes },
    { label: 'Activities', html: week.activities },
    { label: 'Assessment', html: week.assessment },
  ].filter((d) => d.html && !isEmptyRichText(d.html));
  const dates = formatRange(week.startsOn, week.endsOn);

  return (
    <li
      className={cn(ROW, 'border-l-[3px] border-l-primary bg-accent/40 py-5')}
      aria-current={current ? 'date' : undefined}
    >
      <span className="pt-1 font-mono text-[12px] font-semibold text-primary">
        WK {week.weekNumber}
      </span>
      <span className="hidden pt-0.5 text-[13px] tabular-nums text-ink-3 sm:block">
        {dates}
        {current && (
          <span className="block text-xs font-semibold text-primary">
            This week
          </span>
        )}
      </span>
      <div className="col-span-full min-w-0 space-y-4 sm:col-span-1">
        <div className="space-y-1.5">
          <p className="text-[13px] tabular-nums text-ink-3 sm:hidden">
            {dates}
            {current && (
              <span className="font-semibold text-primary"> · This week</span>
            )}
          </p>
          <h2 className="font-serif text-[22px] font-semibold leading-snug tracking-tight text-foreground">
            {week.topic || 'No topic'}
          </h2>
          {week.events.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-brand-amber">
              <CalendarDays className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>{week.events.join(' · ')}</span>
            </p>
          )}
        </div>

        {details.length > 0 && (
          <div className="grid grid-cols-1 gap-4 text-[13px] text-ink-2 md:grid-cols-3">
            {details.map((d) => (
              <div key={d.label}>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  {d.label}
                </p>
                <RichText html={d.html as string} className="text-[13px]" />
              </div>
            ))}
          </div>
        )}

        {week.classes.some((c) => c.reliefNotes.length > 0) && (
          <div className="space-y-2">
            {week.classes.flatMap((c) =>
              c.reliefNotes.map((r, i) => (
                <ReliefNoteLine
                  key={`${c.sectionId}-${i}`}
                  taughtOn={r.taughtOn}
                  name={r.name}
                  note={r.note}
                  classLabel={c.name}
                />
              ))
            )}
          </div>
        )}

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-semibold text-foreground">
            How did Week {week.weekNumber} go?
          </p>
          {/* The subject head's "Ask the teacher" (oversight, board 11),
              until a newer check answers it or the week is signed. */}
          {week.classes
            .filter((c) => c.asked)
            .map((c) => (
              <div
                key={`asked-${c.sectionId}`}
                className="flex items-start gap-2.5 rounded-lg border border-brand-indigo-soft/40 bg-accent px-3.5 py-2.5 text-[13px] text-brand-indigo-deep"
              >
                <MessageSquareText
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold">
                    {/* "Your" only to a teacher who checks that class. */}
                    {c.canCheck
                      ? 'Your subject head asked'
                      : 'The subject head asked'}
                    {week.classes.length > 1 ? ` about ${c.name}` : ''}:
                  </p>
                  <RichText
                    html={c.asked!.remarks}
                    className="text-[13px] text-ink-2"
                  />
                </div>
              </div>
            ))}
          {!week.started ? (
            <p className="text-[13px] text-muted-foreground">
              This week hasn&rsquo;t started yet.
            </p>
          ) : (
            week.classes.map((c) =>
              editable(c) ? (
                <CheckRow
                  key={c.sectionId}
                  c={c}
                  value={valueOf(c)}
                  onPick={(o) => onPick(c, o)}
                  onNote={(n) => onNote(c, n)}
                />
              ) : (
                <div
                  key={c.sectionId}
                  className="flex flex-wrap items-center gap-2.5"
                >
                  <MarkPill c={c} />
                  {c.signed && (
                    <span className="flex items-center gap-1 text-xs text-ink-3">
                      <Check className="size-3.5 text-brand-mint" aria-hidden />
                      Signed by subject head
                    </span>
                  )}
                  {c.notes.map((n, i) => (
                    <RichText
                      key={i}
                      html={n.note}
                      className="w-full text-xs text-ink-3"
                    />
                  ))}
                </div>
              )
            )
          )}
          {week.started && showSave && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                variant={quiet ? 'outline' : 'default'}
                onClick={onSave}
                disabled={!canSave}
                loading={saving}
                loadingText="Saving…"
              >
                Save Week {week.weekNumber}
              </Button>
              {missingNote && (
                <span className="text-[13px] text-brand-amber">
                  Add a note for each class that didn&rsquo;t go as planned.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function CheckRow({
  c,
  value,
  onPick,
  onNote,
}: {
  c: SowCheckClass;
  value: Draft | null;
  onPick: (o: CheckOption) => void;
  onNote: (note: string) => void;
}) {
  // The option that needs a note, if the picked one does.
  const noteFor = value && value.option !== 'as_planned' ? value.option : null;
  const noteId = `check-note-${c.sectionId}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <span className="w-[110px] text-[13px] font-medium text-foreground">
        {c.name}
      </span>
      <ToggleGroup
        type="single"
        spacing={1.5}
        value={value?.option ?? ''}
        onValueChange={(v) => v && onPick(v as CheckOption)}
        aria-label={`${c.name} this week`}
        className="flex-wrap"
      >
        {CHECK_OPTIONS.map((o) => (
          <ToggleGroupItem
            key={o}
            value={o}
            variant="outline"
            className={cn(
              'h-8 rounded-full border border-border bg-card px-3 text-[13px] font-medium text-ink-2 shadow-none hover:bg-muted',
              o === 'as_planned'
                ? 'data-[state=on]:border-brand-mint data-[state=on]:bg-brand-mint/30 data-[state=on]:text-ink'
                : 'data-[state=on]:border-brand-amber/40 data-[state=on]:bg-brand-amber/10 data-[state=on]:text-ink'
            )}
          >
            {CHECK_LABELS[o]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {value && noteFor && (
        <div className="flex w-full flex-col gap-1 sm:pl-[120px]">
          <label
            htmlFor={noteId}
            className="text-xs font-semibold text-foreground"
          >
            {CHECK_NOTE_PROMPTS[noteFor]}{' '}
            <span className="font-medium text-destructive">· required</span>
          </label>
          <RichTextEditor
            id={noteId}
            rows={2}
            maxLength={CHECK_NOTE_MAX}
            placeholder={CHECK_NOTE_PLACEHOLDERS[noteFor]}
            value={value.note}
            onChange={onNote}
          />
        </div>
      )}
    </div>
  );
}
