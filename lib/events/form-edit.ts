import type {
  EventForm,
  EventQuestion,
  EventSection,
  QuestionType,
} from '@/lib/events/form';

// Pure edits to an event form, used by the builder. Every edit returns a new
// form, or the SAME form object when it is refused (so a caller can tell). After
// any edit, a "Show only when…" that no longer holds is cleared: its source must
// be an earlier Pick one question, in a section asked the same way (each child /
// once per family), that still has the chosen value. The built-in "Who's
// joining" step is not part of the form, so it can never be edited here.

const newId = () => crypto.randomUUID();
const CHOICE_TYPES: QuestionType[] = ['pick_one', 'tick_many'];

export function newQuestion(
  type: QuestionType,
  id: string = newId()
): EventQuestion {
  return {
    id,
    type,
    label: '',
    help: '',
    required: type === 'signature',
    imageUrl: null,
    choices: CHOICE_TYPES.includes(type) ? ['Option 1'] : [],
    allowOther: false,
    agreement: '',
    showWhen: null,
  };
}

export function newSection(
  id: string = newId(),
  over: Partial<EventSection> = {}
): EventSection {
  return {
    id,
    title: 'Untitled section',
    description: '',
    scope: 'child',
    allowingOnly: false,
    questions: [],
    ...over,
  };
}

type Located = { si: number; qi: number; question: EventQuestion };

function locate(form: EventForm, id: string): Located | null {
  for (let si = 0; si < form.sections.length; si++) {
    const qi = form.sections[si].questions.findIndex((x) => x.id === id);
    if (qi >= 0) return { si, qi, question: form.sections[si].questions[qi] };
  }
  return null;
}

const hasSignature = (form: EventForm) =>
  form.sections.some((s) => s.questions.some((x) => x.type === 'signature'));

/** True when the form has no e-signature yet (a form may have one). */
export function canAddSignature(form: EventForm): boolean {
  return !hasSignature(form);
}

/** A signature may only sit in a section asked once per family. */
function signaturesValid(form: EventForm): boolean {
  return form.sections.every(
    (s) =>
      s.scope === 'family' || s.questions.every((x) => x.type !== 'signature')
  );
}

/**
 * The questions a "Show only when…" on `questionId` may point at: Pick one
 * questions before it, in sections asked the same way.
 */
export function showWhenSources(
  form: EventForm,
  questionId: string
): EventQuestion[] {
  const at = locate(form, questionId);
  if (!at) return [];
  const scope = form.sections[at.si].scope;
  const out: EventQuestion[] = [];
  for (let si = 0; si <= at.si; si++) {
    const s = form.sections[si];
    if (s.scope !== scope) continue;
    const end = si === at.si ? at.qi : s.questions.length;
    for (let qi = 0; qi < end; qi++)
      if (s.questions[qi].type === 'pick_one') out.push(s.questions[qi]);
  }
  return out;
}

/** Clears every showWhen that no longer holds. */
function normalize(form: EventForm): EventForm {
  const seen = new Map<string, { q: EventQuestion; scope: string }>();
  let changed = false;
  const sections = form.sections.map((s) => {
    const questions = s.questions.map((x) => {
      let next = x;
      if (x.showWhen) {
        const src = seen.get(x.showWhen.questionId);
        const ok =
          src &&
          src.scope === s.scope &&
          src.q.type === 'pick_one' &&
          src.q.choices.includes(x.showWhen.equals);
        if (!ok) {
          next = { ...x, showWhen: null };
          changed = true;
        }
      }
      seen.set(next.id, { q: next, scope: s.scope });
      return next;
    });
    return { ...s, questions };
  });
  return changed ? { sections } : form;
}

function withQuestions(
  form: EventForm,
  si: number,
  questions: EventQuestion[]
): EventForm {
  return {
    sections: form.sections.map((s, i) => (i === si ? { ...s, questions } : s)),
  };
}

export function addQuestion(
  form: EventForm,
  afterId: string | null,
  type: QuestionType,
  opts: { sectionId?: string; id?: string } = {}
): EventForm {
  if (type === 'signature' && hasSignature(form)) return form;
  const question = newQuestion(type, opts.id);
  let next: EventForm;
  if (afterId) {
    const at = locate(form, afterId);
    if (!at) return form;
    const qs = [...form.sections[at.si].questions];
    qs.splice(at.qi + 1, 0, question);
    next = withQuestions(form, at.si, qs);
  } else if (opts.sectionId) {
    const si = form.sections.findIndex((s) => s.id === opts.sectionId);
    if (si < 0) return form;
    next = withQuestions(form, si, [question, ...form.sections[si].questions]);
  } else if (form.sections.length === 0) {
    next = { sections: [newSection(undefined, { questions: [question] })] };
  } else {
    const si = form.sections.length - 1;
    next = withQuestions(form, si, [...form.sections[si].questions, question]);
  }
  return signaturesValid(next) ? next : form;
}

/** Adds the e-signature to the last family section, or a new "Sign" one. */
export function addSignature(form: EventForm, id?: string): EventForm {
  if (hasSignature(form)) return form;
  const question = newQuestion('signature', id);
  for (let si = form.sections.length - 1; si >= 0; si--) {
    if (form.sections[si].scope === 'family')
      return withQuestions(form, si, [
        ...form.sections[si].questions,
        question,
      ]);
  }
  return {
    sections: [
      ...form.sections,
      newSection(undefined, {
        title: 'Sign',
        scope: 'family',
        questions: [question],
      }),
    ],
  };
}

export function updateQuestion(
  form: EventForm,
  id: string,
  patch: Partial<Omit<EventQuestion, 'id'>>
): EventForm {
  const at = locate(form, id);
  if (!at) return form;
  const cur = at.question;
  const merged: EventQuestion = { ...cur, ...patch };
  if (patch.type && patch.type !== cur.type) {
    if (patch.type === 'signature') {
      if (hasSignature(form)) return form;
      merged.required = true;
      merged.showWhen = null;
    }
    if (CHOICE_TYPES.includes(patch.type) && merged.choices.length === 0)
      merged.choices = ['Option 1'];
  }
  // A parent always has to sign.
  if (merged.type === 'signature') merged.required = true;
  // "Other…" exists only on Pick one; the portal renders it nowhere else.
  if (merged.type !== 'pick_one') merged.allowOther = false;
  const qs = [...form.sections[at.si].questions];
  qs[at.qi] = merged;
  const next = withQuestions(form, at.si, qs);
  return signaturesValid(next) ? normalize(next) : form;
}

/** Renames one choice; conditions waiting on the old wording follow it. */
export function setChoice(
  form: EventForm,
  id: string,
  index: number,
  value: string
): EventForm {
  const at = locate(form, id);
  if (!at || index < 0 || index >= at.question.choices.length) return form;
  const old = at.question.choices[index];
  const choices = [...at.question.choices];
  choices[index] = value;
  return normalize({
    sections: form.sections.map((s) => ({
      ...s,
      questions: s.questions.map((x) => {
        if (x.id === id) return { ...x, choices };
        if (x.showWhen?.questionId === id && x.showWhen.equals === old)
          return { ...x, showWhen: { questionId: id, equals: value } };
        return x;
      }),
    })),
  });
}

/** Removes one choice; conditions waiting on it are cleared. */
export function removeChoice(
  form: EventForm,
  id: string,
  index: number
): EventForm {
  const at = locate(form, id);
  if (!at || index < 0 || index >= at.question.choices.length) return form;
  return updateQuestion(form, id, {
    choices: at.question.choices.filter((_, i) => i !== index),
  });
}

export function deleteQuestion(form: EventForm, id: string): EventForm {
  const at = locate(form, id);
  if (!at) return form;
  return normalize(
    withQuestions(
      form,
      at.si,
      form.sections[at.si].questions.filter((x) => x.id !== id)
    )
  );
}

export function duplicateQuestion(
  form: EventForm,
  id: string,
  copyId: string = newId()
): EventForm {
  const at = locate(form, id);
  if (!at || at.question.type === 'signature') return form;
  const qs = [...form.sections[at.si].questions];
  qs.splice(at.qi + 1, 0, {
    ...at.question,
    choices: [...at.question.choices],
    id: copyId,
  });
  return withQuestions(form, at.si, qs);
}

/** Moves a question one place; at a section's edge it crosses into the next. */
export function moveQuestion(
  form: EventForm,
  id: string,
  dir: -1 | 1
): EventForm {
  const at = locate(form, id);
  if (!at) return form;
  const sections = form.sections.map((s) => ({
    ...s,
    questions: [...s.questions],
  }));
  const own = sections[at.si].questions;
  const target = at.qi + dir;
  if (target >= 0 && target < own.length) {
    own.splice(at.qi, 1);
    own.splice(target, 0, at.question);
  } else {
    const si = at.si + dir;
    if (si < 0 || si >= sections.length) return form;
    own.splice(at.qi, 1);
    if (dir === -1) sections[si].questions.push(at.question);
    else sections[si].questions.unshift(at.question);
  }
  const next = { sections };
  return signaturesValid(next) ? normalize(next) : form;
}

/**
 * A new section. After a question, the section is split there (the questions
 * below move into the new one, which is asked the same way); with no question
 * it is added, empty, at the end.
 */
export function addSection(
  form: EventForm,
  afterQuestionId: string | null,
  id?: string
): EventForm {
  if (!afterQuestionId) {
    return { sections: [...form.sections, newSection(id)] };
  }
  const at = locate(form, afterQuestionId);
  if (!at) return form;
  const s = form.sections[at.si];
  const created = newSection(id, {
    scope: s.scope,
    questions: s.questions.slice(at.qi + 1),
  });
  const sections = [...form.sections];
  sections.splice(
    at.si,
    1,
    { ...s, questions: s.questions.slice(0, at.qi + 1) },
    created
  );
  return { sections };
}

export function updateSection(
  form: EventForm,
  id: string,
  patch: Partial<Omit<EventSection, 'id' | 'questions'>>
): EventForm {
  if (!form.sections.some((s) => s.id === id)) return form;
  const next = {
    sections: form.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
  return signaturesValid(next) ? normalize(next) : form;
}

/**
 * Deletes a section; its questions join the previous section (the next one,
 * for the first). The only section is kept while it still has questions.
 */
export function deleteSection(form: EventForm, id: string): EventForm {
  const si = form.sections.findIndex((s) => s.id === id);
  if (si < 0) return form;
  const gone = form.sections[si];
  if (form.sections.length === 1) {
    return gone.questions.length ? form : { sections: [] };
  }
  const into = si > 0 ? si - 1 : 1;
  const sections = form.sections.map((s, i) =>
    i === into
      ? {
          ...s,
          questions:
            into < si
              ? [...s.questions, ...gone.questions]
              : [...gone.questions, ...s.questions],
        }
      : s
  );
  sections.splice(si, 1);
  const next = { sections };
  return signaturesValid(next) ? normalize(next) : form;
}

/**
 * Appends copies of another form's sections with fresh ids (conditions follow
 * the copies). A copied signature is dropped when the form already has one.
 */
export function appendSections(
  form: EventForm,
  copied: EventSection[]
): EventForm {
  const idMap = new Map<string, string>();
  for (const s of copied) for (const x of s.questions) idMap.set(x.id, newId());
  let signed = hasSignature(form);
  const fresh = copied.map((s) => ({
    ...s,
    id: newId(),
    questions: s.questions.flatMap((x) => {
      if (x.type === 'signature') {
        if (signed) return [];
        signed = true;
      }
      return [
        {
          ...x,
          id: idMap.get(x.id) as string,
          choices: [...x.choices],
          showWhen: x.showWhen
            ? {
                questionId: idMap.get(x.showWhen.questionId) ?? '',
                equals: x.showWhen.equals,
              }
            : null,
        },
      ];
    }),
  }));
  return normalize({ sections: [...form.sections, ...fresh] });
}
