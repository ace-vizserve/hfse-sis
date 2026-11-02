'use client';

import { CornerDownRight } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

import type { EventQuestion } from '@/lib/events/form';
import { cn } from '@/lib/utils';

// One question on the builder canvas, drawn the way parents will see it. The
// selected card gets the indigo left edge and its editor (passed as children).

export function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {' '}
      *
    </span>
  );
}

function Mark({ round }: { round: boolean }) {
  return (
    <span
      className={cn(
        'size-4 shrink-0 border border-hairline bg-background shadow-input',
        round ? 'rounded-full' : 'rounded'
      )}
      aria-hidden
    />
  );
}

function AnswerLine({ text }: { text: string }) {
  return (
    <div className="mt-4 w-3/5">
      <div className="h-px bg-hairline" />
      <p className="mt-1.5 text-xs text-ink-4">{text}</p>
    </div>
  );
}

export function SignatureBlock({ agreement }: { agreement: ReactNode }) {
  return (
    <>
      {agreement}
      <div className="mt-5 flex items-end gap-6">
        <div className="flex-1">
          <div className="h-px bg-hairline" />
          <p className="mt-1.5 text-xs text-ink-4">
            Type your full name to sign
          </p>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-4">
          Dated automatically
        </p>
      </div>
    </>
  );
}

export function QuestionImage({ url }: { url: string }) {
  return (
    <div className="mt-4 inline-block rounded-md border border-hairline p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- a public upload of any size */}
      <img src={url} alt="" className="max-h-72 max-w-full rounded-sm" />
    </div>
  );
}

/** What a parent sees for the answer part of a question. */
export function AnswerPreview({ question }: { question: EventQuestion }) {
  switch (question.type) {
    case 'short':
      return <AnswerLine text="Short answer" />;
    case 'long':
      return <AnswerLine text="Long answer" />;
    case 'number':
      return <AnswerLine text="Number" />;
    case 'date':
      return <AnswerLine text="Day, month and year" />;
    case 'pick_one':
    case 'tick_many': {
      const round = question.type === 'pick_one';
      const items = [
        ...question.choices,
        ...(question.allowOther ? ['Other'] : []),
      ];
      return (
        <div
          className={cn(
            'mt-4 grid gap-3 text-sm',
            items.length > 4 && 'sm:grid-cols-2'
          )}
        >
          {items.map((c, i) => (
            <span key={i} className="flex items-center gap-3">
              <Mark round={round} />
              {c || <span className="text-ink-4">Empty choice</span>}
            </span>
          ))}
        </div>
      );
    }
    case 'signature':
      return (
        <SignatureBlock
          agreement={
            question.agreement.trim() ? (
              <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-ink-3">
                {question.agreement}
              </p>
            ) : (
              <p className="mt-3 text-[13px] text-ink-4">
                No agreement text yet.
              </p>
            )
          }
        />
      );
    case 'info':
      return question.help.trim() ? (
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">
          {question.help}
        </p>
      ) : null;
  }
}

export function DependentTag({ equals }: { equals: string }) {
  return (
    <p className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-brand-amber/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
      <CornerDownRight className="size-3" aria-hidden />
      Shown only when “{equals}”
    </p>
  );
}

export function QuestionCard({
  question,
  selected,
  onSelect,
  children,
  toolbar,
}: {
  question: EventQuestion;
  selected: boolean;
  onSelect: () => void;
  /** The editor, shown when selected. */
  children?: ReactNode;
  /** The floating toolbar, beside the selected card. */
  toolbar?: ReactNode;
}) {
  const dependent = question.showWhen !== null;
  const title =
    question.label.trim() ||
    (question.type === 'info'
      ? 'Untitled text'
      : question.type === 'signature'
        ? 'E-signature'
        : 'Untitled question');

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <div className={cn('relative', dependent && 'ml-10')}>
      <div
        role="group"
        tabIndex={0}
        aria-label={`Question: ${title}`}
        aria-current={selected || undefined}
        data-slot="question-card"
        onClick={selected ? undefined : onSelect}
        onKeyDown={onKeyDown}
        className={cn(
          'rounded-xl border bg-card shadow-xs outline-none transition-shadow focus-visible:ring-4 focus-visible:ring-brand-indigo/25',
          selected
            ? 'border-brand-indigo shadow-[inset_6px_0_0_var(--color-brand-indigo),0_8px_24px_color-mix(in_oklab,var(--color-brand-navy)_10%,transparent)]'
            : 'cursor-pointer border-border hover:border-brand-indigo-soft',
          dependent && !selected && 'border-dashed border-brand-amber/50'
        )}
      >
        {selected ? (
          <div>
            {dependent && (
              <div className="px-8 pt-5">
                <DependentTag equals={question.showWhen!.equals} />
              </div>
            )}
            {children}
          </div>
        ) : (
          <div className="px-8 py-6">
            {dependent && <DependentTag equals={question.showWhen!.equals} />}
            <p
              className={cn(
                question.type === 'info'
                  ? 'font-serif text-lg font-semibold'
                  : 'text-[15px] font-medium',
                !question.label.trim() && 'text-ink-4'
              )}
            >
              {title}
              {question.required && question.type !== 'info' && (
                <RequiredMark />
              )}
            </p>
            {question.type !== 'info' && question.help.trim() && (
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                {question.help}
              </p>
            )}
            {question.imageUrl && <QuestionImage url={question.imageUrl} />}
            <AnswerPreview question={question} />
          </div>
        )}
      </div>
      {toolbar}
    </div>
  );
}
