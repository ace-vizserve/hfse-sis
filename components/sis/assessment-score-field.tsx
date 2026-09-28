'use client';

import { AlertTriangle } from 'lucide-react';
import { useId, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  assessmentPercent,
  checkAssessmentScoreInput,
  cleanAssessmentText,
  parseAssessmentGrade,
} from '@/lib/admissions/assessment-grade';
import { cn } from '@/lib/utils';

// One entrance-assessment grade as two numbers — Score and Out of — with the
// percentage worked out live beside them. Stored as exactly `score/max`
// ("29/31") by the stage PATCH route, which applies the same rule
// (`checkAssessmentScoreInput`) to what this sends.
//
// ⚠ UNTOUCHED, IT SENDS THE STORED VALUE BACK UNCHANGED. Old grades were typed
// into Directus in any shape ("<p>93.55% (29/31)</p>", "77%", "na"); the
// route passes a value identical to the stored one without judging it, so an
// old grade nobody edited can never block saving the stage's other fields.
// The first keystroke in either box switches this to the new shape.
export function AssessmentScoreField({
  label,
  stored,
  onChange,
  required = false,
}: {
  label: string;
  /** The value the row holds now, as stored (may be legacy free text). */
  stored: string | null;
  /** `score/max` as typed, or null when both boxes are empty. */
  onChange: (next: string | null) => void;
  /** Marks the label when the stage's status needs this grade. */
  required?: boolean;
}) {
  const initial = parseAssessmentGrade(stored);
  const [score, setScore] = useState(
    initial.score !== null ? String(initial.score) : ''
  );
  const [max, setMax] = useState(
    initial.max !== null ? String(initial.max) : ''
  );
  const [touched, setTouched] = useState(false);

  // What was on record before, when it can't fill the two boxes: a percent
  // with no score ("77%"), or words ("did not complete").
  const storedText = stored ? cleanAssessmentText(stored) : '';
  const previous =
    initial.score === null && storedText
      ? initial.percent !== null
        ? `${initial.percent}%`
        : `“${storedText}”`
      : null;

  const check = touched ? checkAssessmentScoreInput(score, max) : null;
  const error = check && !check.ok ? check : null;

  // Live percentage: from the boxes once edited, from the record before that.
  let percent: number | null = null;
  if (touched) {
    if (check?.ok && check.value !== null) {
      const [s, m] = check.value.split('/').map(Number);
      percent = assessmentPercent(s, m);
    }
  } else if (initial.score !== null) {
    percent = initial.percent;
  }

  function update(nextScore: string, nextMax: string) {
    setTouched(true);
    const bothBlank = nextScore.trim() === '' && nextMax.trim() === '';
    onChange(bothBlank ? null : `${nextScore.trim()}/${nextMax.trim()}`);
  }

  const baseId = useId();
  const scoreId = `${baseId}-score`;
  const maxId = `${baseId}-max`;

  // One row, the same height as the dialog's other fields: label on top, then
  // [score] out of [total] = percent. The two boxes name themselves through
  // placeholders + aria-labels rather than captions underneath, which made
  // this field taller than its neighbours and threw the grid out of line.
  return (
    <div className="space-y-2">
      <label
        htmlFor={scoreId}
        className="block text-xs font-medium text-foreground"
      >
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={scoreId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Score"
          aria-label={`${label} score`}
          value={score}
          onChange={(ev) => {
            setScore(ev.target.value);
            update(ev.target.value, max);
          }}
          aria-invalid={error?.field === 'score' || undefined}
          className="min-w-0 flex-1 text-right tabular-nums"
        />
        <span
          aria-hidden
          className="shrink-0 text-xs text-muted-foreground select-none"
        >
          out of
        </span>
        <Input
          id={maxId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Total"
          aria-label={`${label} out of`}
          value={max}
          onChange={(ev) => {
            setMax(ev.target.value);
            update(score, ev.target.value);
          }}
          aria-invalid={error?.field === 'max' || undefined}
          className="min-w-0 flex-1 text-right tabular-nums"
        />
        <span
          aria-live="polite"
          className={cn(
            'w-16 shrink-0 text-right font-mono text-sm font-semibold tabular-nums',
            percent !== null ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {percent !== null ? `${percent}%` : '—'}
        </span>
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          {error.error}
        </p>
      ) : (
        previous && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Recorded before as{' '}
            <strong className="font-semibold text-foreground">
              {previous}
            </strong>
            .{!touched && ' Enter the score and total to replace it.'}
          </p>
        )
      )}
    </div>
  );
}
