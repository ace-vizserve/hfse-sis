'use client';

import { Lock, Plus } from 'lucide-react';
import { Fragment, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';

import { CopyFromEventDialog } from '@/components/events/builder/copy-from-event-dialog';
import {
  FloatingToolbar,
  type ToolbarActions,
} from '@/components/events/builder/floating-toolbar';
import { QuestionCard } from '@/components/events/builder/question-card';
import { QuestionEditor } from '@/components/events/builder/question-editor';
import {
  SectionCard,
  WhoIsJoiningSection,
} from '@/components/events/builder/section-card';
import { pickAndUploadImage } from '@/components/events/builder/upload-image';
import { Button } from '@/components/ui/button';
import {
  addQuestion,
  addSection,
  addSignature,
  appendSections,
  canAddSignature,
  updateQuestion,
} from '@/lib/events/form-edit';
import type { EventForm, QuestionType } from '@/lib/events/form';

// The form part of the builder, Google Forms style: what the SIS fills in, the
// built-in "Who's joining" step, then the event's own sections and questions.
// Click a card (or focus it and press Enter) to edit it.

type Selection = { kind: 'question' | 'section'; id: string } | null;

function InsertGap({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center gap-3 px-2" data-slot="insert-gap">
      <span className="h-px flex-1 bg-hairline" aria-hidden />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-6 rounded-full [&_svg]:size-3.5"
        aria-label="Add a question here"
        onClick={onClick}
      >
        <Plus />
      </Button>
      <span className="h-px flex-1 bg-hairline" aria-hidden />
    </div>
  );
}

export function FormCanvas({
  eventId,
  form,
  onChange,
  answerMode,
}: {
  eventId: string;
  form: EventForm;
  /** A new form, or an updater applied to the LATEST form (use it after an await). */
  onChange: Dispatch<SetStateAction<EventForm>>;
  answerMode: 'consent' | 'register';
}) {
  const [selected, setSelected] = useState<Selection>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const total = form.sections.length + 1;

  const selectQuestion = (id: string | null) =>
    setSelected(id ? { kind: 'question', id } : null);

  /** Adds a question where the selection is (or at the end) and selects it. */
  function insert(
    type: QuestionType,
    at?: { afterId: string | null; sectionId?: string },
    patch?: (f: EventForm, id: string) => EventForm
  ) {
    const id = crypto.randomUUID();
    const where =
      at ??
      (selected?.kind === 'question'
        ? { afterId: selected.id }
        : selected?.kind === 'section'
          ? { afterId: null, sectionId: selected.id }
          : { afterId: null });
    // An updater, so a question added after an upload builds on the latest form.
    onChange((latest) => {
      const next = addQuestion(latest, where.afterId, type, {
        id,
        sectionId: where.sectionId,
      });
      if (next === latest) return latest;
      return patch ? patch(next, id) : next;
    });
    selectQuestion(id);
  }

  const actions: ToolbarActions = {
    addQuestion: () => insert('pick_one'),
    addInfo: () => insert('info'),
    copyFromEvent: () => setCopyOpen(true),
    addPicture: async () => {
      const url = await pickAndUploadImage(eventId);
      if (!url) return;
      insert('info', undefined, (f, id) =>
        updateQuestion(f, id, { imageUrl: url })
      );
    },
    addSignature: () => {
      const id = crypto.randomUUID();
      const next = addSignature(form, id);
      if (next === form) return;
      onChange(next);
      selectQuestion(id);
    },
    addSection: () => {
      const id = crypto.randomUUID();
      let after: string | null = null;
      if (selected?.kind === 'question') after = selected.id;
      if (selected?.kind === 'section') {
        const s = form.sections.find((x) => x.id === selected.id);
        after = s?.questions.at(-1)?.id ?? null;
      }
      onChange(addSection(form, after, id));
      setSelected({ kind: 'section', id });
    },
    signatureDisabled: !canAddSignature(form),
  };

  const isSelected = (kind: 'question' | 'section', id: string) =>
    selected?.kind === kind && selected.id === id;
  const toolbarFor = (kind: 'question' | 'section', id: string) =>
    isSelected(kind, id) ? (
      <FloatingToolbar actions={actions} layout="side" />
    ) : null;

  return (
    <div className="flex flex-col gap-3" data-slot="builder-canvas">
      <section className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-dashed border-hairline bg-card/70 px-6 py-3.5 text-sm">
        <Lock className="size-4 text-ink-4" aria-hidden />
        <span className="text-muted-foreground">Filled in by the SIS:</span>
        <span>Parent / guardian name</span>
        <span className="text-ink-4" aria-hidden>
          ·
        </span>
        <span>Handphone</span>
        <span className="text-ink-4" aria-hidden>
          ·
        </span>
        <span>Student</span>
        <span className="text-ink-4" aria-hidden>
          ·
        </span>
        <span>Level and class</span>
      </section>

      <div className="relative">
        <WhoIsJoiningSection total={total} answerMode={answerMode} />
        {selected === null && (
          <FloatingToolbar actions={actions} layout="side" />
        )}
      </div>

      {form.sections.length === 0 && (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-hairline bg-card/70 px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Add the questions parents answer after choosing who’s joining.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => insert('pick_one', { afterId: null })}
          >
            <Plus />
            Add a question
          </Button>
        </section>
      )}

      {form.sections.map((section, si) => (
        <Fragment key={section.id}>
          <SectionCard
            form={form}
            section={section}
            number={si + 2}
            total={total}
            selected={isSelected('section', section.id)}
            onSelect={() => setSelected({ kind: 'section', id: section.id })}
            onChange={onChange}
            toolbar={toolbarFor('section', section.id)}
          />
          <InsertGap
            onClick={() =>
              insert('pick_one', { afterId: null, sectionId: section.id })
            }
          />
          {section.questions.map((question) => (
            <Fragment key={question.id}>
              <QuestionCard
                question={question}
                selected={isSelected('question', question.id)}
                onSelect={() => selectQuestion(question.id)}
                toolbar={toolbarFor('question', question.id)}
              >
                <QuestionEditor
                  eventId={eventId}
                  form={form}
                  question={question}
                  scope={section.scope}
                  onChange={onChange}
                  onSelect={selectQuestion}
                />
              </QuestionCard>
              <InsertGap
                onClick={() => insert('pick_one', { afterId: question.id })}
              />
            </Fragment>
          ))}
        </Fragment>
      ))}

      <FloatingToolbar actions={actions} layout="bar" />

      <CopyFromEventDialog
        eventId={eventId}
        open={copyOpen}
        onOpenChange={setCopyOpen}
        onCopy={(source) => {
          const dropped =
            source.sections.some((s) =>
              s.questions.some((q) => q.type === 'signature')
            ) && !canAddSignature(form);
          onChange((latest) => appendSections(latest, source.sections));
          toast.success(
            dropped
              ? 'Sections copied. Its e-signature was left out — this form already has one.'
              : 'Sections copied.'
          );
        }}
      />
    </div>
  );
}
