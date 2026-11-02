'use client';

import { Lock, Trash2 } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { deleteSection, updateSection } from '@/lib/events/form-edit';
import type { EventForm, EventSection } from '@/lib/events/form';
import { cn } from '@/lib/utils';

// A section header on the builder canvas: the "Section N of M" tab, its title
// and description, and how it is asked (for each child who is joining / once
// per family). A per-child section is only ever asked of children who are
// joining; Not allowing / unticked children give the reason (consent events)
// or nothing (register events). `allowingOnly` stays in the stored schema but
// is no longer offered.

const SCOPE_LABELS = {
  child: 'Asked for each child who is joining',
  family: 'Asked once per family',
} as const;

export function SectionFrame({
  number,
  total,
  children,
  className,
  ...rest
}: {
  number: number;
  total: number;
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="mt-4">
      <div className="inline-flex items-center rounded-t-lg bg-gradient-to-br from-brand-indigo to-brand-navy px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
        Section {number} of {total}
      </div>
      <div
        className={cn(
          'rounded-xl rounded-tl-none border border-border bg-card px-8 py-5 shadow-[inset_0_3px_0_var(--color-brand-indigo)]',
          className
        )}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

/** The built-in first step; not part of the form and not editable. */
export function WhoIsJoiningSection({
  total,
  answerMode,
}: {
  total: number;
  answerMode: 'consent' | 'register';
}) {
  const consent = answerMode === 'consent';
  return (
    <SectionFrame number={1} total={total} data-slot="who-is-joining">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-xl font-semibold tracking-tight">
            {consent ? 'Who’s joining' : 'Who’s coming'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {consent
              ? 'Each child: Allowing / Not allowing, with a reason when Not allowing.'
              : 'Tick each child who is coming.'}
          </p>
        </div>
        <span className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-hairline bg-muted/50 px-3 text-[13px] text-ink-2">
          <Lock className="size-3.5 text-ink-4" aria-hidden />
          Set by the SIS
        </span>
      </div>
    </SectionFrame>
  );
}

export function SectionCard({
  form,
  section,
  number,
  total,
  selected,
  onSelect,
  onChange,
  toolbar,
}: {
  form: EventForm;
  section: EventSection;
  number: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: EventForm) => void;
  toolbar?: ReactNode;
}) {
  const id = section.id;
  const hasSignature = section.questions.some((q) => q.type === 'signature');
  const title = section.title.trim() || 'Untitled section';
  const canDelete = form.sections.length > 1 || section.questions.length === 0;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  function remove() {
    const next = deleteSection(form, id);
    if (next === form) {
      toast.error(
        hasSignature
          ? 'Move the e-signature to a section asked once per family first.'
          : 'A form needs this section while it has questions.'
      );
      return;
    }
    onChange(next);
  }

  return (
    <div className="relative">
      <SectionFrame
        number={number}
        total={total}
        role="group"
        tabIndex={0}
        aria-label={`Section: ${title}`}
        aria-current={selected || undefined}
        data-slot="section-card"
        onClick={selected ? undefined : onSelect}
        onKeyDown={onKeyDown}
        className={cn(
          'outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/25',
          selected
            ? 'border-brand-indigo'
            : 'cursor-pointer hover:border-brand-indigo-soft'
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {selected ? (
              <div className="flex flex-col gap-2">
                <Input
                  value={section.title}
                  placeholder="Section title"
                  aria-label="Section title"
                  onChange={(e) =>
                    onChange(updateSection(form, id, { title: e.target.value }))
                  }
                  className="h-11 rounded-b-none border-0 border-b-2 border-brand-indigo bg-muted/50 font-serif text-xl font-semibold shadow-none focus-visible:ring-0"
                />
                <Textarea
                  value={section.description}
                  placeholder="Description (optional)"
                  aria-label="Section description"
                  rows={2}
                  onChange={(e) =>
                    onChange(
                      updateSection(form, id, { description: e.target.value })
                    )
                  }
                />
              </div>
            ) : (
              <>
                <p
                  className={cn(
                    'font-serif text-xl font-semibold tracking-tight',
                    !section.title.trim() && 'text-ink-4'
                  )}
                >
                  {title}
                </p>
                {section.description.trim() && (
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                    {section.description}
                  </p>
                )}
              </>
            )}
          </div>
          {/* Always shown, so a section left empty after its questions are deleted can go too. */}
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={section.scope}
              onValueChange={(v) =>
                onChange(
                  updateSection(form, id, {
                    scope: v as EventSection['scope'],
                  })
                )
              }
            >
              <SelectTrigger
                className="h-8 w-auto gap-2 text-[13px]"
                aria-label="How this section is asked"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="child" disabled={hasSignature}>
                  {SCOPE_LABELS.child}
                </SelectItem>
                <SelectItem value="family">{SCOPE_LABELS.family}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Delete section"
              title={
                canDelete
                  ? 'Delete section'
                  : 'A form needs this section while it has questions'
              }
              disabled={!canDelete}
              onClick={(e) => {
                e.stopPropagation();
                remove();
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </SectionFrame>
      {toolbar}
    </div>
  );
}
