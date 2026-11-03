import { AlertTriangleIcon, CheckIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  qualityNotes,
  readingOutcome,
  type DocumentReadingView,
} from '@/lib/admissions/document-reading-view';

const NOT_READ: Record<string, string> = {
  unreadable: "The portal couldn't read this file. Check the details by eye.",
  timed_out:
    'The portal ran out of time reading this file. Check the details by eye.',
  failed: "The portal couldn't read this file. Check the details by eye.",
};

function formatDay(day: string | null) {
  if (!day) return null;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Comparison({
  label,
  read,
  entered,
  matches,
}: {
  label: string;
  read: string | null;
  entered: string | null;
  matches: boolean | null;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {matches === true && (
          <Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
            <CheckIcon className="h-3 w-3" /> Matches
          </Badge>
        )}
        {matches === false && (
          <Badge className="h-6 border-destructive/40 bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="h-3 w-3" /> Differs
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">On the passport</dt>
          <dd className="tabular-nums text-foreground">
            {read ?? 'Not verified'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Parent entered</dt>
          <dd className="tabular-nums text-foreground">
            {entered ?? 'Nothing'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The scan quality line: a hint, or the all-clear when it was measured and fine. */
function ScanQuality({ view }: { view: DocumentReadingView }) {
  if (!view.quality) return null;
  const notes = qualityNotes(view.quality);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-medium text-foreground">Scan quality</span>
      {notes.length === 0 ? (
        <Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
          <CheckIcon className="h-3 w-3" /> Looks clear
        </Badge>
      ) : (
        notes.map((note) => (
          <Badge
            key={note}
            className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
          >
            <AlertTriangleIcon className="h-3 w-3" /> {note}
          </Badge>
        ))
      )}
    </div>
  );
}

/**
 * What the parent portal found about an uploaded file: for a passport, what it
 * read against what the application says now, and for any document, how good the
 * scan is. Evidence for the reviewer, not a decision: the file itself is what
 * gets approved.
 */
export function DocumentReadingPanel({ view }: { view: DocumentReadingView }) {
  const outcome = readingOutcome(view);
  const flagged =
    outcome === 'differs' ||
    outcome === 'expired' ||
    qualityNotes(view.quality).length > 0;

  // Nothing was read and nothing was measured, so there's nothing to say.
  if (outcome === 'quality-only' && !view.quality) return null;

  return (
    <section
      aria-label="What the portal found in this file"
      className={
        flagged
          ? 'space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3'
          : 'space-y-3 rounded-xl border border-hairline bg-muted/30 p-3'
      }
    >
      {outcome === 'not-read' && (
        <p className="text-xs text-muted-foreground">{NOT_READ[view.status]}</p>
      )}
      {view.status === 'read' && (
        <>
          <Comparison
            label="Passport number"
            read={view.readNumber}
            entered={view.enteredNumber}
            matches={view.numberMatches}
          />
          <Comparison
            label="Expiry date"
            read={formatDay(view.readExpiry)}
            entered={formatDay(view.enteredExpiry)}
            matches={view.expiryMatches}
          />
        </>
      )}
      {view.expired && (
        <p className="text-xs font-medium text-destructive">
          This passport has already expired.
        </p>
      )}
      {view.passportCount > 1 && (
        <p className="text-xs text-muted-foreground">
          This file holds {view.passportCount} passports. Compared with the one
          closest to what the parent entered.
        </p>
      )}
      <ScanQuality view={view} />
    </section>
  );
}
