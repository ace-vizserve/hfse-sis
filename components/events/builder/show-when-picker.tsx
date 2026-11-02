'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showWhenSources, updateQuestion } from '@/lib/events/form-edit';
import type { EventForm, EventQuestion } from '@/lib/events/form';

// "Show only when…": pick an earlier Pick one question (same section kind) and
// one of its listed choices. The question is then shown only for that answer.

export function ShowWhenPicker({
  form,
  question,
  onChange,
  trigger,
}: {
  form: EventForm;
  question: EventQuestion;
  onChange: (next: EventForm) => void;
  trigger: ReactNode;
}) {
  const sources = showWhenSources(form, question.id);
  const current = question.showWhen;
  const source = sources.find((s) => s.id === current?.questionId) ?? null;
  const name = (q: EventQuestion) => q.label.trim() || 'Untitled question';
  // Listed choices only: an "Other" answer is free text, so it cannot be matched.
  const choicesOf = (q: EventQuestion) => [
    ...new Set(q.choices.filter((c) => c.trim() !== '')),
  ];

  function set(questionId: string, equals: string) {
    onChange(
      updateQuestion(form, question.id, { showWhen: { questionId, equals } })
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="font-serif text-base font-semibold">Show only when…</p>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a Pick one question above this one, in a section asked the same
            way, then choose the answer that shows this question.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label id={`sw-q-${question.id}`}>Question</Label>
              <Select
                value={source?.id ?? ''}
                onValueChange={(v) => {
                  const src = sources.find((s) => s.id === v);
                  const first = src ? choicesOf(src)[0] : undefined;
                  if (src && first !== undefined) set(src.id, first);
                }}
              >
                <SelectTrigger aria-labelledby={`sw-q-${question.id}`}>
                  <SelectValue placeholder="Choose a question" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      disabled={choicesOf(s).length === 0}
                    >
                      {name(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {source && current && (
              <div className="space-y-1.5">
                <Label id={`sw-a-${question.id}`}>Is answered</Label>
                <Select
                  value={current.equals}
                  onValueChange={(v) => set(source.id, v)}
                >
                  <SelectTrigger aria-labelledby={`sw-a-${question.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {choicesOf(source).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {current && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange(
                    updateQuestion(form, question.id, { showWhen: null })
                  )
                }
              >
                Always show this question
              </Button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
