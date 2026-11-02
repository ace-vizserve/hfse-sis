import { describe, expect, it } from 'vitest';

import {
  dropHiddenAnswers,
  EventFormSchema,
  pruneAnswers,
  questionShown,
  QUESTION_TYPE_LABELS,
  sectionShownFor,
  validateChildAnswers,
  validateFamilyAnswers,
  type EventForm,
  type EventQuestion,
  type EventSection,
} from '@/lib/events/form';

function q(over: Partial<EventQuestion> & { id: string }): EventQuestion {
  return {
    type: 'short',
    label: 'Q',
    help: '',
    required: false,
    imageUrl: null,
    choices: [],
    allowOther: false,
    agreement: '',
    showWhen: null,
    ...over,
  };
}
function sec(over: Partial<EventSection> & { id: string }): EventSection {
  return {
    title: 'S',
    description: '',
    scope: 'child',
    allowingOnly: false,
    questions: [],
    ...over,
  };
}

describe('labels', () => {
  it('has the exact labels', () => {
    expect(QUESTION_TYPE_LABELS.tick_many).toBe('Tick all that apply');
    expect(QUESTION_TYPE_LABELS.signature).toBe('E-signature');
  });
});

describe('sectionShownFor', () => {
  it('hides allowingOnly child sections for not_allowing; family always shown', () => {
    const child = sec({ id: 'a', allowingOnly: true });
    const fam = sec({ id: 'b', scope: 'family', allowingOnly: true });
    expect(sectionShownFor(child, 'not_allowing')).toBe(false);
    expect(sectionShownFor(child, 'allowing')).toBe(true);
    expect(sectionShownFor(fam, 'not_allowing')).toBe(true);
    expect(sectionShownFor(sec({ id: 'c' }), 'not_allowing')).toBe(true);
  });
});

describe('questionShown', () => {
  const x = q({ id: 'x', showWhen: { questionId: 'src', equals: 'Yes' } });
  it('follows showWhen', () => {
    expect(questionShown(x, { src: 'Yes' })).toBe(true);
    expect(questionShown(x, { src: 'No' })).toBe(false);
    expect(questionShown(x, {})).toBe(false);
    expect(questionShown(x, { src: ['Yes', 'No'] })).toBe(true);
    expect(questionShown(q({ id: 'y' }), {})).toBe(true);
  });
});

describe('validateChildAnswers', () => {
  const form: EventForm = {
    sections: [
      sec({
        id: 's1',
        questions: [
          q({ id: 'a', required: true }),
          q({
            id: 'b',
            required: true,
            showWhen: { questionId: 'a', equals: 'go' },
          }),
          q({ id: 'p', type: 'pick_one', choices: ['x', 'y'] }),
          q({ id: 'n', type: 'number' }),
          q({ id: 'd', type: 'date' }),
          q({ id: 't', type: 'tick_many', choices: ['x', 'y'] }),
        ],
      }),
      sec({
        id: 's2',
        allowingOnly: true,
        questions: [q({ id: 'only', required: true })],
      }),
    ],
  };
  it('requires visible, skips hidden', () => {
    expect(validateChildAnswers(form, 'not_allowing', {})).toEqual({
      ok: false,
      errors: { a: 'This question is required.' },
    });
    expect(validateChildAnswers(form, 'not_allowing', { a: 'stop' })).toEqual({
      ok: true,
    });
    const r = validateChildAnswers(form, 'allowing', { a: 'go' });
    expect(r).toEqual({
      ok: false,
      errors: {
        b: 'This question is required.',
        only: 'This question is required.',
      },
    });
  });
  it('checks types', () => {
    const base = { a: 'stop' };
    const bad = (extra: Record<string, never | string | number | string[]>) =>
      validateChildAnswers(form, 'not_allowing', { ...base, ...extra });
    expect(bad({ p: 'z' }).ok).toBe(false);
    expect(bad({ p: 'x' }).ok).toBe(true);
    expect(bad({ n: Infinity }).ok).toBe(false);
    expect(bad({ n: 3 }).ok).toBe(true);
    expect(bad({ d: '2026-13-40' }).ok).toBe(false);
    expect(bad({ d: '29/10/2026' }).ok).toBe(false);
    expect(bad({ d: '2026-10-29' }).ok).toBe(true);
    expect(bad({ t: ['x', 'q'] }).ok).toBe(false);
    expect(bad({ t: ['x', 'y'] }).ok).toBe(true);
  });
  it('allowOther accepts any pick_one value', () => {
    const f: EventForm = {
      sections: [
        sec({
          id: 's',
          questions: [
            q({ id: 'p', type: 'pick_one', choices: ['x'], allowOther: true }),
          ],
        }),
      ],
    };
    expect(validateChildAnswers(f, 'allowing', { p: 'zzz' }).ok).toBe(true);
  });
});

describe('validateFamilyAnswers', () => {
  const form: EventForm = {
    sections: [
      sec({ id: 'c', questions: [q({ id: 'childq', required: true })] }),
      sec({
        id: 'f',
        scope: 'family',
        questions: [
          q({ id: 'sig', type: 'signature', required: true }),
          q({ id: 'fq', required: true }),
        ],
      }),
    ],
  };
  it('requires signatureName and family answers only', () => {
    expect(validateFamilyAnswers(form, { fq: 'v' }, '  ')).toEqual({
      ok: false,
      errors: { sig: 'This question is required.' },
    });
    expect(validateFamilyAnswers(form, { fq: 'v' }, ' Ann ')).toEqual({
      ok: true,
    });
    expect(validateFamilyAnswers(form, {}, 'Ann').ok).toBe(false);
  });
});

describe('schema', () => {
  it('rejects a signature in a child section', () => {
    const r = EventFormSchema.safeParse({
      sections: [
        sec({ id: 's', questions: [q({ id: 'sig', type: 'signature' })] }),
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0].message).toBe(
        'Put the e-signature in a section asked once per family.'
      );
  });
  it('rejects two signatures, accepts one in a family section', () => {
    const two = {
      sections: [
        sec({
          id: 's',
          scope: 'family',
          questions: [
            q({ id: 'a', type: 'signature' }),
            q({ id: 'b', type: 'signature' }),
          ],
        }),
      ],
    };
    expect(EventFormSchema.safeParse(two).success).toBe(false);
    const one = {
      sections: [
        sec({
          id: 's',
          scope: 'family',
          questions: [q({ id: 'a', type: 'signature' })],
        }),
      ],
    };
    expect(EventFormSchema.safeParse(one).success).toBe(true);
  });
});

describe('pruneAnswers', () => {
  it('drops unknown ids', () => {
    const f: EventForm = {
      sections: [sec({ id: 's', questions: [q({ id: 'a' })] })],
    };
    expect(pruneAnswers(f, { gone: 'x', a: 'k' })).toEqual({ a: 'k' });
  });
});

describe('dropHiddenAnswers', () => {
  const form: EventForm = {
    sections: [
      sec({
        id: 's1',
        questions: [
          q({ id: 'A' }),
          q({ id: 'B', showWhen: { questionId: 'A', equals: 'Yes' } }),
          q({
            id: 'C',
            required: true,
            showWhen: { questionId: 'B', equals: 'on' },
          }),
        ],
      }),
      sec({ id: 's2', allowingOnly: true, questions: [q({ id: 'only' })] }),
      sec({ id: 'f', scope: 'family', questions: [q({ id: 'fam' })] }),
    ],
  };
  it('flip to No drops the follow-up', () => {
    expect(
      dropHiddenAnswers(form, { consent: 'allowing' }, { A: 'No', B: 'on' })
    ).toEqual({ A: 'No' });
    expect(
      dropHiddenAnswers(form, { consent: 'allowing' }, { A: 'Yes', B: 'on' })
    ).toEqual({ A: 'Yes', B: 'on' });
  });
  it('cascades A -> B -> C', () => {
    const a = { A: 'No', B: 'on', C: 'x' };
    expect(dropHiddenAnswers(form, { consent: 'allowing' }, a)).toEqual({
      A: 'No',
    });
    expect(
      validateChildAnswers(form, 'allowing', { A: 'No', B: 'on' })
    ).toEqual({ ok: true });
  });
  it('not_allowing drops allowingOnly answers; family scope drops child answers', () => {
    expect(
      dropHiddenAnswers(
        form,
        { consent: 'not_allowing' },
        { A: 'k', only: 'z' }
      )
    ).toEqual({ A: 'k' });
    expect(
      dropHiddenAnswers(form, { family: true }, { A: 'k', fam: 'f' })
    ).toEqual({ fam: 'f' });
  });
});

describe('source in a section that is not shown', () => {
  const form: EventForm = {
    sections: [
      sec({ id: 'ao', allowingOnly: true, questions: [q({ id: 'X' })] }),
      sec({
        id: 'plain',
        questions: [
          q({
            id: 'B',
            required: true,
            showWhen: { questionId: 'X', equals: 'Yes' },
          }),
        ],
      }),
    ],
  };
  it('hides the dependent, drops its answer, does not require it', () => {
    const a = { X: 'Yes', B: 'stale' };
    expect(dropHiddenAnswers(form, { consent: 'not_allowing' }, a)).toEqual({});
    expect(validateChildAnswers(form, 'not_allowing', { X: 'Yes' })).toEqual({
      ok: true,
    });
    expect(validateChildAnswers(form, 'allowing', { X: 'Yes' }).ok).toBe(false);
  });
});
