import { z } from 'zod';

export const QUESTION_TYPES = [
  'info',
  'short',
  'long',
  'pick_one',
  'tick_many',
  'number',
  'date',
  'signature',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  info: 'Info text',
  short: 'Short answer',
  long: 'Long answer',
  pick_one: 'Pick one',
  tick_many: 'Tick all that apply',
  number: 'Number',
  date: 'Date',
  signature: 'E-signature',
};

export const EventQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(QUESTION_TYPES),
  label: z.string(),
  help: z.string(),
  required: z.boolean(),
  imageUrl: z.string().nullable(),
  choices: z.array(z.string()),
  allowOther: z.boolean(),
  agreement: z.string(),
  showWhen: z
    .object({ questionId: z.string().min(1), equals: z.string() })
    .nullable(),
});

export const EventSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  scope: z.enum(['child', 'family']),
  allowingOnly: z.boolean(),
  questions: z.array(EventQuestionSchema),
});

export const EventFormSchema = z
  .object({ sections: z.array(EventSectionSchema) })
  .superRefine((form, ctx) => {
    let signatures = 0;
    form.sections.forEach((section, si) => {
      section.questions.forEach((question, qi) => {
        if (question.type !== 'signature') return;
        signatures += 1;
        if (section.scope !== 'family') {
          ctx.addIssue({
            code: 'custom',
            message: 'Put the e-signature in a section asked once per family.',
            path: ['sections', si, 'questions', qi],
          });
        }
        if (signatures > 1) {
          ctx.addIssue({
            code: 'custom',
            message: 'A form can have only one e-signature.',
            path: ['sections', si, 'questions', qi],
          });
        }
      });
    });
  });

export type EventQuestion = z.infer<typeof EventQuestionSchema>;
export type EventSection = z.infer<typeof EventSectionSchema>;
export type EventForm = z.infer<typeof EventFormSchema>;

export type Consent = 'allowing' | 'not_allowing';
export type AnswerValue = string | string[] | number | null;
type Answers = Record<string, AnswerValue>;
type Result = { ok: true } | { ok: false; errors: Record<string, string> };

const REQUIRED = 'This question is required.';

export function sectionShownFor(
  section: EventSection,
  consent: Consent
): boolean {
  if (section.scope === 'family') return true;
  return !section.allowingOnly || consent === 'allowing';
}

export function questionShown(q: EventQuestion, answers: Answers): boolean {
  if (!q.showWhen) return true;
  const v = answers[q.showWhen.questionId];
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.includes(q.showWhen.equals);
  return String(v) === q.showWhen.equals;
}

function isEmpty(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function typeError(q: EventQuestion, v: AnswerValue): string | null {
  switch (q.type) {
    case 'short':
    case 'long':
      return typeof v === 'string' ? null : 'Enter some text.';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
        ? null
        : 'Enter a number.';
    case 'date':
      return typeof v === 'string' && isIsoDate(v)
        ? null
        : 'Enter a valid date.';
    case 'pick_one':
      return typeof v === 'string' && (q.allowOther || q.choices.includes(v))
        ? null
        : 'Pick one of the choices.';
    case 'tick_many':
      return Array.isArray(v) && v.every((x) => q.choices.includes(x))
        ? null
        : 'Tick only the choices shown.';
    default:
      return null;
  }
}

/** Ids of questions visible in these sections; a question whose source is hidden is hidden too. */
function visibleQuestionIds(
  form: EventForm,
  sections: EventSection[],
  answers: Answers
): Set<string> {
  const allById = new Map<string, EventQuestion>();
  for (const s of form.sections)
    for (const q of s.questions) allById.set(q.id, q);
  const byId = new Map<string, EventQuestion>();
  for (const s of sections) for (const q of s.questions) byId.set(q.id, q);
  const memo = new Map<string, boolean>();
  const visit = (q: EventQuestion, trail: Set<string>): boolean => {
    const cached = memo.get(q.id);
    if (cached !== undefined) return cached;
    let shown = questionShown(q, answers);
    if (shown && q.showWhen) {
      const srcId = q.showWhen.questionId;
      const src = byId.get(srcId);
      if (!src && allById.has(srcId)) shown = false;
      if (src)
        shown = !trail.has(src.id) && visit(src, new Set(trail).add(q.id));
    }
    memo.set(q.id, shown);
    return shown;
  };
  const out = new Set<string>();
  byId.forEach((q) => {
    if (visit(q, new Set())) out.add(q.id);
  });
  return out;
}

function sectionsInScope(
  form: EventForm,
  scope: { consent: Consent } | { family: true }
) {
  return 'family' in scope
    ? form.sections.filter((s) => s.scope === 'family')
    : form.sections.filter(
        (s) => s.scope === 'child' && sectionShownFor(s, scope.consent)
      );
}

/** Drops answers for questions that are not shown (section hidden or showWhen, cascading). */
export function dropHiddenAnswers(
  form: EventForm,
  scope: { consent: Consent } | { family: true },
  answers: Answers
): Answers {
  const visible = visibleQuestionIds(
    form,
    sectionsInScope(form, scope),
    answers
  );
  const known = new Set<string>();
  for (const s of form.sections) for (const q of s.questions) known.add(q.id);
  return Object.fromEntries(
    Object.entries(answers).filter(([k]) => !known.has(k) || visible.has(k))
  );
}

function validateSections(
  form: EventForm,
  sections: EventSection[],
  answers: Answers,
  signatureName: string | null
): Result {
  const errors: Record<string, string> = {};
  const visible = visibleQuestionIds(form, sections, answers);
  for (const section of sections) {
    for (const q of section.questions) {
      if (q.type === 'info') continue;
      if (!visible.has(q.id)) continue;
      if (q.type === 'signature') {
        if (q.required && (signatureName ?? '').trim() === '')
          errors[q.id] = REQUIRED;
        continue;
      }
      const v = answers[q.id];
      if (isEmpty(v)) {
        if (q.required) errors[q.id] = REQUIRED;
        continue;
      }
      const err = typeError(q, v as AnswerValue);
      if (err) errors[q.id] = err;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

export function validateChildAnswers(
  form: EventForm,
  consent: Consent,
  answers: Answers
): Result {
  const sections = form.sections.filter(
    (s) => s.scope === 'child' && sectionShownFor(s, consent)
  );
  return validateSections(form, sections, answers, null);
}

export function validateFamilyAnswers(
  form: EventForm,
  answers: Answers,
  signatureName: string
): Result {
  return validateSections(
    form,
    form.sections.filter((s) => s.scope === 'family'),
    answers,
    signatureName
  );
}

export function pruneAnswers(form: EventForm, answers: Answers): Answers {
  const known = new Set<string>();
  for (const s of form.sections) for (const q of s.questions) known.add(q.id);
  return Object.fromEntries(
    Object.entries(answers).filter(([k]) => known.has(k))
  );
}
