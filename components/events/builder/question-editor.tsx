'use client';

import {
  ArrowDown,
  ArrowUp,
  Copy,
  CornerDownRight,
  ImagePlus,
  Trash2,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import { ChoicesEditor } from '@/components/events/builder/choices-editor';
import {
  QuestionImage,
  SignatureBlock,
  AnswerPreview,
} from '@/components/events/builder/question-card';
import { ShowWhenPicker } from '@/components/events/builder/show-when-picker';
import { pickAndUploadImage } from '@/components/events/builder/upload-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  canAddSignature,
  deleteQuestion,
  duplicateQuestion,
  moveQuestion,
  updateQuestion,
} from '@/lib/events/form-edit';
import {
  QUESTION_TYPE_LABELS,
  type EventForm,
  type EventQuestion,
  type QuestionType,
} from '@/lib/events/form';

// The selected question's editing controls: title, picture, type, choices,
// then the footer (move, duplicate, delete, Required, Show only when…).

const TYPE_ORDER: QuestionType[] = [
  'short',
  'long',
  'pick_one',
  'tick_many',
  'number',
  'date',
  'info',
];

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function QuestionEditor({
  eventId,
  form,
  question,
  scope,
  onChange,
  onSelect,
}: {
  eventId: string;
  form: EventForm;
  question: EventQuestion;
  scope: 'child' | 'family';
  /** A new form, or an updater applied to the latest form (after an await). */
  onChange: Dispatch<SetStateAction<EventForm>>;
  /** Moves the selection (after delete / duplicate). */
  onSelect: (id: string | null) => void;
}) {
  const id = question.id;
  const isChoice =
    question.type === 'pick_one' || question.type === 'tick_many';
  const signatureAllowed =
    question.type === 'signature' ||
    (scope === 'family' && canAddSignature(form));

  const all = form.sections.flatMap((s) => s.questions);
  const pos = all.findIndex((x) => x.id === id);
  const canMoveUp = moveQuestion(form, id, -1) !== form;
  const canMoveDown = moveQuestion(form, id, 1) !== form;

  async function addPicture() {
    const url = await pickAndUploadImage(eventId);
    // Applied to the latest form: edits typed during the upload are kept.
    if (url)
      onChange((latest) => updateQuestion(latest, id, { imageUrl: url }));
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-8 pt-6">
        <Input
          value={question.label}
          autoFocus={question.label === ''}
          placeholder={question.type === 'info' ? 'Title' : 'Question'}
          aria-label="Question title"
          onChange={(e) =>
            onChange(updateQuestion(form, id, { label: e.target.value }))
          }
          className="h-11 min-w-0 flex-1 rounded-b-none border-0 border-b-2 border-brand-indigo bg-muted/50 text-[15px] font-medium shadow-none focus-visible:ring-0"
        />
        <IconAction label="Add a picture" onClick={addPicture}>
          <ImagePlus />
        </IconAction>
        <Select
          value={question.type}
          onValueChange={(v) =>
            onChange(updateQuestion(form, id, { type: v as QuestionType }))
          }
        >
          <SelectTrigger className="h-11 w-[210px]" aria-label="Question type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_ORDER.map((t) => (
              <SelectItem key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value="signature" disabled={!signatureAllowed}>
              {QUESTION_TYPE_LABELS.signature}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {question.type !== 'info' && (
        <div className="px-8 pt-3">
          <Input
            value={question.help}
            placeholder="Description (optional)"
            aria-label="Question description"
            onChange={(e) =>
              onChange(updateQuestion(form, id, { help: e.target.value }))
            }
            className="h-9 border-transparent bg-transparent px-3 text-sm shadow-none hover:border-hairline focus-visible:border-brand-indigo"
          />
        </div>
      )}

      {question.imageUrl && (
        <div className="flex items-end gap-3 px-8">
          <QuestionImage url={question.imageUrl} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange(updateQuestion(form, id, { imageUrl: null }))
            }
          >
            Remove picture
          </Button>
        </div>
      )}

      <div className="px-8 py-4">
        {isChoice ? (
          <ChoicesEditor form={form} question={question} onChange={onChange} />
        ) : question.type === 'info' ? (
          <Textarea
            value={question.help}
            placeholder="Text parents will read"
            aria-label="Text"
            rows={3}
            onChange={(e) =>
              onChange(updateQuestion(form, id, { help: e.target.value }))
            }
          />
        ) : question.type === 'signature' ? (
          <SignatureBlock
            agreement={
              <Textarea
                value={question.agreement}
                placeholder="What the parent agrees to by signing"
                aria-label="Agreement text"
                rows={4}
                onChange={(e) =>
                  onChange(
                    updateQuestion(form, id, { agreement: e.target.value })
                  )
                }
              />
            }
          />
        ) : (
          <AnswerPreview question={question} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-8 py-3 text-sm text-ink-3">
        <IconAction
          label="Move up"
          disabled={!canMoveUp}
          onClick={() => onChange(moveQuestion(form, id, -1))}
        >
          <ArrowUp />
        </IconAction>
        <IconAction
          label="Move down"
          disabled={!canMoveDown}
          onClick={() => onChange(moveQuestion(form, id, 1))}
        >
          <ArrowDown />
        </IconAction>
        <IconAction
          label="Duplicate"
          disabled={question.type === 'signature'}
          onClick={() => {
            const copyId = crypto.randomUUID();
            onChange(duplicateQuestion(form, id, copyId));
            onSelect(copyId);
          }}
        >
          <Copy />
        </IconAction>
        <IconAction
          label="Delete"
          onClick={() => {
            onChange(deleteQuestion(form, id));
            onSelect(pos > 0 ? all[pos - 1].id : (all[1]?.id ?? null));
          }}
        >
          <Trash2 />
        </IconAction>
        <span className="mx-2 h-6 w-px bg-hairline" aria-hidden />
        {question.type === 'signature' && (
          <span className="text-[13px] text-ink-3">Always required</span>
        )}
        {question.type !== 'info' && question.type !== 'signature' && (
          <div className="flex items-center gap-2 text-foreground">
            <Label htmlFor={`required-${id}`}>Required</Label>
            <Switch
              id={`required-${id}`}
              checked={question.required}
              onCheckedChange={(v) =>
                onChange(updateQuestion(form, id, { required: v }))
              }
            />
          </div>
        )}
        <span
          className="ml-2 flex h-8 items-center rounded-md border border-hairline bg-muted/50 px-3 text-[13px] text-ink-2"
          title="Set on the section"
        >
          {scope === 'child' ? 'For each child' : 'Once per family'}
        </span>
        {question.type !== 'signature' && (
          <ShowWhenPicker
            form={form}
            question={question}
            onChange={onChange}
            trigger={
              <Button
                type="button"
                variant="link"
                className="h-8 gap-1.5 px-1 text-brand-indigo-deep"
              >
                <CornerDownRight />
                {question.showWhen ? 'Shown only when…' : 'Show only when…'}
              </Button>
            }
          />
        )}
      </div>
    </>
  );
}
