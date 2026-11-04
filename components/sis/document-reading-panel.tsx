'use client';

import {
  AlertTriangleIcon,
  CheckIcon,
  FileQuestionIcon,
  ScanSearchIcon,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  qualityFacts,
  qualityNotes,
  readingOutcome,
  type DocumentReadingView,
} from '@/lib/admissions/document-reading-view';
import { cn } from '@/lib/utils';

/** The wash recipes the review table's status column uses (§9.3), so a result
 *  reads the same in the table and in this panel. */
export const READING_BADGE_TONE = {
  good: 'border-brand-mint/40 bg-brand-mint/10 text-foreground',
  caution: 'border-brand-amber/50 bg-brand-amber/10 text-foreground',
  bad: 'border-destructive/40 bg-destructive/10 text-destructive',
  neutral: 'border-hairline text-muted-foreground',
} as const;

type Tone = keyof typeof READING_BADGE_TONE;

const PANEL_TONE: Record<Tone, { panel: string; tile: string }> = {
  good: {
    panel: 'border-brand-mint/40 bg-brand-mint/10',
    tile: 'bg-brand-mint text-ink',
  },
  caution: {
    panel: 'border-brand-amber/40 bg-brand-amber/5',
    tile: 'bg-brand-amber text-white',
  },
  bad: {
    panel: 'border-destructive/30 bg-destructive/5',
    tile: 'bg-destructive text-destructive-foreground',
  },
  neutral: {
    panel: 'border-hairline bg-muted/30',
    tile: 'bg-muted-foreground text-white',
  },
};

const EYEBROW =
  'font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground';

function formatDay(day: string | null) {
  if (!day) return null;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function ResultBadge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'whitespace-nowrap font-mono text-[10px] uppercase tracking-wider',
        READING_BADGE_TONE[tone]
      )}
    >
      {children}
    </Badge>
  );
}

/** One detail, read across: as the passport has it, as the parent entered it, and the result. */
function ComparisonRow({
  label,
  read,
  entered,
  matches,
  mismatch,
}: {
  label: string;
  read: string | null;
  entered: string | null;
  matches: boolean | null;
  /** How loud a mismatch is, for a value with no check digit behind it. */
  mismatch?: Tone;
}) {
  return (
    <tr className="border-t border-hairline">
      <th
        scope="row"
        className="whitespace-nowrap py-2 pl-3 pr-4 text-left align-top font-serif text-sm font-semibold tracking-tight text-foreground"
      >
        {label}
      </th>
      <td className="break-words py-2 pr-4 align-top font-mono text-[13px] tabular-nums text-foreground">
        {read ?? <span className="text-muted-foreground">Not verified</span>}
      </td>
      <td
        className={cn(
          'break-words py-2 pr-4 align-top font-mono text-[13px] tabular-nums',
          matches === false && mismatch !== 'caution'
            ? 'text-destructive'
            : 'text-foreground'
        )}
      >
        {entered ?? <span className="text-muted-foreground">Nothing</span>}
      </td>
      <td className="py-1.5 pr-3 text-right align-top">
        {matches === true && <ResultBadge tone="good">Matches</ResultBadge>}
        {matches === false && (
          <ResultBadge tone={mismatch ?? 'bad'}>
            {mismatch === 'caution' ? 'Check' : 'Differs'}
          </ResultBadge>
        )}
      </td>
    </tr>
  );
}

function formatMoment(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Singapore',
  });
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="break-words text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

/** The file and scan, spelled out, so "no problems" isn't taken on trust. */
function ScanFacts({
  view,
  wide,
}: {
  view: DocumentReadingView;
  wide: boolean;
}) {
  const notes = qualityNotes(view.quality);
  const facts = qualityFacts(view.quality!);
  return (
    <div className="space-y-2.5 rounded-lg border border-hairline bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-serif text-sm font-semibold tracking-tight text-foreground">
          File and scan
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {notes.length === 0 ? (
            <ResultBadge tone="good">No problems</ResultBadge>
          ) : (
            notes.map((note) => (
              <ResultBadge key={note} tone="caution">
                {note}
              </ResultBadge>
            ))
          )}
        </div>
      </div>
      <dl
        className={cn(
          'grid gap-x-4 gap-y-2.5',
          wide ? 'grid-cols-4' : 'grid-cols-2'
        )}
      >
        <div className="col-span-2">
          <Fact label="Type" value={facts.kind} />
        </div>
        <Fact label="Pages" value={facts.pages} />
        <Fact label="File size" value={facts.size} />
        <Fact label="Sharpness" value={facts.sharpness} />
        <Fact label="Content" value={facts.content} />
        <Fact label="Brightness" value={facts.brightness} />
        <Fact label="Contrast" value={facts.contrast} />
      </dl>
    </div>
  );
}

/** The panel's headline: the condition, and what to do about it. */
function summarize(view: DocumentReadingView): {
  tone: Tone;
  Icon: LucideIcon;
  title: string;
  body: string;
} {
  const outcome = readingOutcome(view);
  const notes = qualityNotes(view.quality);

  if (outcome === 'expired') {
    return {
      tone: 'bad',
      Icon: AlertTriangleIcon,
      title: 'This passport has expired',
      body: 'Ask the parent for the current passport.',
    };
  }
  if (outcome === 'differs') {
    return {
      tone: 'bad',
      Icon: AlertTriangleIcon,
      title: "Details don't match the passport",
      body: 'Check the file against what the parent entered.',
    };
  }
  if (outcome === 'not-read') {
    return {
      tone: 'neutral',
      Icon: FileQuestionIcon,
      title:
        view.status === 'timed_out'
          ? 'Ran out of time reading this file'
          : "Couldn't read this file",
      body: 'Check the details by eye.',
    };
  }
  if (notes.length > 0) {
    return {
      tone: 'caution',
      Icon: ScanSearchIcon,
      title: notes.includes('Nearly blank')
        ? 'This file is nearly blank'
        : `Scan quality: ${notes[0].toLowerCase()}`,
      body: notes.includes('Nearly blank')
        ? "Check it's the real document, not a placeholder."
        : "Check it's legible before approving.",
    };
  }
  return outcome === 'matches'
    ? {
        tone: 'good',
        Icon: CheckIcon,
        title: 'Details match the passport',
        body: 'Read from the passport when the parent uploaded it.',
      }
    : {
        tone: 'good',
        Icon: CheckIcon,
        title: 'No problems found with this scan',
        body: 'Still check it is the right document.',
      };
}

/** The whole result in one badge, for the collapsed row and the review table. */
export function ReadingResultBadge({ view }: { view: DocumentReadingView }) {
  const { tone, label } = readingResult(view);
  return <ResultBadge tone={tone}>{label}</ResultBadge>;
}

function readingResult(view: DocumentReadingView): {
  tone: Tone;
  label: string;
} {
  const outcome = readingOutcome(view);
  const [note] = qualityNotes(view.quality);
  if (outcome === 'differs')
    return { tone: 'bad', label: "Details don't match" };
  if (outcome === 'expired') return { tone: 'bad', label: 'Passport expired' };
  if (outcome === 'not-read')
    return { tone: 'neutral', label: "Couldn't read file" };
  if (note) return { tone: 'caution', label: note };
  return {
    tone: 'good',
    label: outcome === 'matches' ? 'Details match' : 'No scan problems',
  };
}

/** The full finding: the headline, the comparison and the scan quality. */
function ReadingDetails({ view }: { view: DocumentReadingView }) {
  const { tone, Icon, title, body } = summarize(view);
  const isPassport = view.status === 'read';

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl shadow-brand-tile',
              PANEL_TONE[tone].tile
            )}
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="font-serif text-[15px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </p>
            <p className="text-xs text-muted-foreground">{body}</p>
          </div>
        </div>
        {(view.nationality || view.sex) && (
          <dl className="flex gap-5">
            <Fact label="Nationality" value={view.nationality ?? 'Not read'} />
            <Fact label="Sex" value={view.sex ?? 'Not read'} />
          </dl>
        )}
      </div>

      {isPassport && (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <td className="py-2 pl-3 pr-4" />
                <th scope="col" className={cn(EYEBROW, 'py-2 pr-4 text-left')}>
                  On the passport
                </th>
                <th scope="col" className={cn(EYEBROW, 'py-2 pr-4 text-left')}>
                  Parent entered
                </th>
                <td className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="Name"
                read={view.readName}
                entered={view.enteredName}
                matches={view.nameMatches}
                mismatch="caution"
              />
              <ComparisonRow
                label="Date of birth"
                read={formatDay(view.readBirthDate)}
                entered={formatDay(view.enteredBirthDate)}
                matches={view.birthDateMatches}
              />
              <ComparisonRow
                label="Passport number"
                read={view.readNumber}
                entered={view.enteredNumber}
                matches={view.numberMatches}
              />
              <ComparisonRow
                label="Expiry date"
                read={formatDay(view.readExpiry)}
                entered={formatDay(view.enteredExpiry)}
                matches={view.expiryMatches}
              />
            </tbody>
          </table>
        </div>
      )}

      {view.passportCount > 1 && (
        <p className="text-xs text-muted-foreground">
          This file holds {view.passportCount} passports. Compared with the one
          closest to what the parent entered.
        </p>
      )}

      {view.quality && <ScanFacts view={view} wide={isPassport} />}

      {view.checkedAt && (
        <p className="px-1 font-mono text-[10px] text-muted-foreground">
          Checked {formatMoment(view.checkedAt)}.
          {isPassport &&
            ' Name, nationality and sex are as read, with nothing to verify them.'}
        </p>
      )}
    </>
  );
}

/**
 * What the parent portal found about an uploaded file: for a passport, what it
 * read against what the application says now, and for any document, how good the
 * scan is. A button and the result until it's clicked, because it sits on screens
 * already full of documents; the result says whether it's worth opening. It floats over the page
 * rather than opening in place, which would stretch every card in a row, and
 * stays open until dismissed so a number can be copied. Evidence for the reviewer,
 * not a decision: the file itself is what gets approved.
 */
export function DocumentReadingPanel({
  view,
  buttonLabel = 'View document details',
}: {
  view: DocumentReadingView;
  /** Shorter where the surrounding pane already says what it's about. */
  buttonLabel?: string;
}) {
  // Nothing was read and nothing was measured, so there's nothing to say.
  if (view.status === 'not_read' && !view.quality) return null;

  return (
    <Popover>
      <div className="flex flex-wrap items-center gap-2">
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <ScanSearchIcon />
            {buttonLabel}
          </Button>
        </PopoverTrigger>
        <ReadingResultBadge view={view} />
      </div>
      <PopoverContent
        align="start"
        collisionPadding={16}
        aria-label="What the portal found in this file"
        className={cn(
          'max-h-[min(80vh,var(--radix-popover-content-available-height))] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto',
          view.status === 'read' ? 'w-[42rem]' : 'w-96'
        )}
      >
        <ReadingDetails view={view} />
      </PopoverContent>
    </Popover>
  );
}
