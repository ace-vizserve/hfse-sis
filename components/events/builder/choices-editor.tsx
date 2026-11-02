'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  removeChoice,
  setChoice,
  updateQuestion,
} from '@/lib/events/form-edit';
import type { EventForm, EventQuestion } from '@/lib/events/form';
import { cn } from '@/lib/utils';

// The choices of a Pick one / Tick all that apply question, edited in place:
// type over a choice, Enter adds the next, "Add choice or add “Other”".

export function ChoicesEditor({
  form,
  question,
  onChange,
}: {
  form: EventForm;
  question: EventQuestion;
  onChange: (next: EventForm) => void;
}) {
  const round = question.type === 'pick_one';
  // A choice just added is focused once it has rendered.
  const pendingFocus = useRef<number | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const i = pendingFocus.current;
    if (i === null || !inputs.current[i]) return;
    pendingFocus.current = null;
    inputs.current[i]?.focus();
    inputs.current[i]?.select();
  });

  function addChoice() {
    onChange(
      updateQuestion(form, question.id, {
        choices: [...question.choices, `Option ${question.choices.length + 1}`],
      })
    );
    pendingFocus.current = question.choices.length;
  }

  const mark = (
    <span
      className={cn(
        'size-4 shrink-0 border border-hairline',
        round ? 'rounded-full' : 'rounded'
      )}
      aria-hidden
    />
  );

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {question.choices.map((c, i) => (
        <div key={i} className="flex items-center gap-3">
          {mark}
          <Input
            ref={(el) => {
              inputs.current[i] = el;
            }}
            value={c}
            aria-label={`Choice ${i + 1}`}
            onChange={(e) =>
              onChange(setChoice(form, question.id, i, e.target.value))
            }
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              addChoice();
            }}
            className="h-9 flex-1 border-transparent bg-transparent shadow-none hover:border-hairline focus-visible:border-brand-indigo"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={`Remove choice ${i + 1}`}
            disabled={question.choices.length <= 1}
            onClick={() => onChange(removeChoice(form, question.id, i))}
          >
            <X />
          </Button>
        </div>
      ))}
      {question.allowOther && (
        <div className="flex items-center gap-3">
          {mark}
          <span className="h-9 flex-1 content-center px-3 text-ink-3">
            Other…
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Remove “Other”"
            onClick={() =>
              onChange(updateQuestion(form, question.id, { allowOther: false }))
            }
          >
            <X />
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3 text-ink-4">
        <span
          className={cn(
            'size-4 shrink-0 border border-dashed border-hairline',
            round ? 'rounded-full' : 'rounded'
          )}
          aria-hidden
        />
        <Button
          type="button"
          variant="link"
          className="h-9 px-0 text-ink-3"
          onClick={addChoice}
        >
          Add choice
        </Button>
        {!question.allowOther && question.type === 'pick_one' && (
          <>
            <span>or</span>
            <Button
              type="button"
              variant="link"
              className="h-9 px-0 text-brand-indigo-deep"
              onClick={() =>
                onChange(
                  updateQuestion(form, question.id, { allowOther: true })
                )
              }
            >
              add “Other”
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
