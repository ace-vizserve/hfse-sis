import { describe, expect, it } from 'vitest';

import {
  addQuestion,
  addSection,
  addSignature,
  appendSections,
  canAddSignature,
  deleteQuestion,
  deleteSection,
  duplicateQuestion,
  moveQuestion,
  removeChoice,
  setChoice,
  showWhenSources,
  updateQuestion,
  updateSection,
} from '@/lib/events/form-edit';
import {
  EventFormSchema,
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
const ids = (form: EventForm) =>
  form.sections.map((s) => s.questions.map((x) => x.id));

// s1 (child): pick(Yes/No), dep (shows when pick = Yes), plain
// s2 (family): note, sig
function sample(): EventForm {
  return {
    sections: [
      sec({
        id: 's1',
        questions: [
          q({ id: 'pick', type: 'pick_one', choices: ['Yes', 'No'] }),
          q({ id: 'dep', showWhen: { questionId: 'pick', equals: 'Yes' } }),
          q({ id: 'plain' }),
        ],
      }),
      sec({
        id: 's2',
        scope: 'family',
        questions: [q({ id: 'note' }), q({ id: 'sig', type: 'signature' })],
      }),
    ],
  };
}

describe('addQuestion', () => {
  it('inserts after the given question with the given id', () => {
    const f = addQuestion(sample(), 'pick', 'long', { id: 'new' });
    expect(ids(f)[0]).toEqual(['pick', 'new', 'dep', 'plain']);
    const added = f.sections[0].questions[1];
    expect(added).toMatchObject({ type: 'long', label: '', required: false });
  });

  it('puts a question at the top of a section when afterId is null', () => {
    const f = addQuestion(sample(), null, 'short', {
      sectionId: 's2',
      id: 'n',
    });
    expect(ids(f)[1]).toEqual(['n', 'note', 'sig']);
  });

  it('appends to the last section when nothing is given', () => {
    const f = addQuestion(sample(), null, 'date', { id: 'n' });
    expect(ids(f)[1]).toEqual(['note', 'sig', 'n']);
  });

  it('creates a first section on an empty form', () => {
    const f = addQuestion({ sections: [] }, null, 'pick_one', { id: 'n' });
    expect(f.sections).toHaveLength(1);
    expect(f.sections[0].scope).toBe('child');
    expect(f.sections[0].questions[0]).toMatchObject({
      id: 'n',
      choices: ['Option 1'],
    });
  });

  it('makes a fresh id when none is given', () => {
    const f = addQuestion(sample(), 'plain', 'short');
    const id = f.sections[0].questions[3].id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a second signature', () => {
    const before = sample();
    expect(addQuestion(before, 'note', 'signature')).toBe(before);
  });
});

describe('addSignature', () => {
  it('adds it to the last family section', () => {
    const f: EventForm = {
      sections: [
        sec({ id: 'a', scope: 'family' }),
        sec({ id: 'b', scope: 'child' }),
      ],
    };
    const next = addSignature(f, 'sig');
    expect(ids(next)).toEqual([['sig'], []]);
    expect(next.sections[0].questions[0]).toMatchObject({
      type: 'signature',
      required: true,
    });
    expect(EventFormSchema.safeParse(next).success).toBe(true);
  });

  it('creates a "Sign" family section when there is none', () => {
    const f: EventForm = { sections: [sec({ id: 'a' })] };
    const next = addSignature(f, 'sig');
    expect(next.sections).toHaveLength(2);
    expect(next.sections[1]).toMatchObject({ title: 'Sign', scope: 'family' });
    expect(next.sections[1].questions.map((x) => x.id)).toEqual(['sig']);
  });

  it('does nothing when the form already has one', () => {
    const f = sample();
    expect(canAddSignature(f)).toBe(false);
    expect(addSignature(f)).toBe(f);
    expect(canAddSignature({ sections: [] })).toBe(true);
  });
});

describe('updateQuestion', () => {
  it('patches one question', () => {
    const f = updateQuestion(sample(), 'plain', {
      label: 'Allergies',
      required: true,
    });
    expect(f.sections[0].questions[2]).toMatchObject({
      label: 'Allergies',
      required: true,
    });
  });

  it('retyping a source away from Pick one clears its dependants', () => {
    const f = updateQuestion(sample(), 'pick', { type: 'short' });
    expect(f.sections[0].questions[1].showWhen).toBeNull();
  });

  it('gives a choice question a first choice when it has none', () => {
    const f = updateQuestion(sample(), 'plain', { type: 'tick_many' });
    expect(f.sections[0].questions[2].choices).toEqual(['Option 1']);
  });

  it('changing the type away from Pick one turns off "Other…"', () => {
    const withOther = updateQuestion(sample(), 'pick', { allowOther: true });
    expect(withOther.sections[0].questions[0].allowOther).toBe(true);
    const f = updateQuestion(withOther, 'pick', { type: 'tick_many' });
    expect(f.sections[0].questions[0].allowOther).toBe(false);
  });

  it('a signature always stays required', () => {
    const f = updateQuestion(sample(), 'sig', { required: false });
    expect(f.sections[1].questions[1].required).toBe(true);
  });

  it('refuses to make a signature in a child section', () => {
    const f: EventForm = {
      sections: [sec({ id: 'a', questions: [q({ id: 'x' })] })],
    };
    expect(updateQuestion(f, 'x', { type: 'signature' })).toBe(f);
  });
});

describe('choices', () => {
  it('renaming a choice carries dependants with it', () => {
    const f = setChoice(sample(), 'pick', 0, 'Yes please');
    expect(f.sections[0].questions[0].choices).toEqual(['Yes please', 'No']);
    expect(f.sections[0].questions[1].showWhen).toEqual({
      questionId: 'pick',
      equals: 'Yes please',
    });
  });

  it('removing the choice a dependant waits on clears it', () => {
    const f = removeChoice(sample(), 'pick', 0);
    expect(f.sections[0].questions[0].choices).toEqual(['No']);
    expect(f.sections[0].questions[1].showWhen).toBeNull();
  });

  it('removing another choice leaves the dependant alone', () => {
    const f = removeChoice(sample(), 'pick', 1);
    expect(f.sections[0].questions[1].showWhen?.equals).toBe('Yes');
  });
});

describe('deleteQuestion', () => {
  it('removes it and clears dependants pointing at it', () => {
    const f = deleteQuestion(sample(), 'pick');
    expect(ids(f)[0]).toEqual(['dep', 'plain']);
    expect(f.sections[0].questions[0].showWhen).toBeNull();
  });
});

describe('duplicateQuestion', () => {
  it('copies right after with a new id', () => {
    const f = duplicateQuestion(sample(), 'dep', 'copy');
    expect(ids(f)[0]).toEqual(['pick', 'dep', 'copy', 'plain']);
    expect(f.sections[0].questions[2]).toMatchObject({
      showWhen: { questionId: 'pick', equals: 'Yes' },
    });
    const g = duplicateQuestion(sample(), 'plain');
    const newId = g.sections[0].questions[3].id;
    expect(newId).not.toBe('plain');
    expect(newId.length).toBeGreaterThan(10);
  });

  it('never duplicates the signature', () => {
    const f = sample();
    expect(duplicateQuestion(f, 'sig')).toBe(f);
  });
});

describe('moveQuestion', () => {
  it('moves within a section', () => {
    expect(ids(moveQuestion(sample(), 'plain', -1))[0]).toEqual([
      'pick',
      'plain',
      'dep',
    ]);
  });

  it('crosses section boundaries', () => {
    const down = moveQuestion(sample(), 'plain', 1);
    expect(ids(down)).toEqual([
      ['pick', 'dep'],
      ['plain', 'note', 'sig'],
    ]);
    const up = moveQuestion(sample(), 'note', -1);
    expect(ids(up)).toEqual([['pick', 'dep', 'plain', 'note'], ['sig']]);
  });

  it('stops at the ends of the form', () => {
    const f = sample();
    expect(moveQuestion(f, 'pick', -1)).toBe(f);
    expect(moveQuestion(f, 'sig', 1)).toBe(f);
  });

  it('never moves the signature into a child section', () => {
    const f: EventForm = {
      sections: [
        sec({ id: 'a', questions: [q({ id: 'x' })] }),
        sec({
          id: 'b',
          scope: 'family',
          questions: [q({ id: 'sig', type: 'signature' })],
        }),
      ],
    };
    expect(moveQuestion(f, 'sig', -1)).toBe(f);
  });

  it('a dependant moved above its source loses the condition', () => {
    const f = moveQuestion(sample(), 'dep', -1);
    expect(ids(f)[0]).toEqual(['dep', 'pick', 'plain']);
    expect(f.sections[0].questions[0].showWhen).toBeNull();
  });
});

describe('sections', () => {
  it('addSection splits after a question, keeping the scope', () => {
    const f = addSection(sample(), 'note', 'new');
    expect(f.sections.map((s) => s.id)).toEqual(['s1', 's2', 'new']);
    expect(ids(f)).toEqual([['pick', 'dep', 'plain'], ['note'], ['sig']]);
    expect(f.sections[2]).toMatchObject({
      scope: 'family',
      title: 'Untitled section',
    });
  });

  it('addSection with no question appends an empty section', () => {
    const f = addSection(sample(), null, 'new');
    expect(f.sections.map((s) => s.id)).toEqual(['s1', 's2', 'new']);
    expect(f.sections[2].questions).toEqual([]);
  });

  it('updateSection patches', () => {
    const f = updateSection(sample(), 's1', {
      title: 'Camp',
      allowingOnly: true,
    });
    expect(f.sections[0]).toMatchObject({ title: 'Camp', allowingOnly: true });
  });

  it('a section holding the signature cannot become per child', () => {
    const f = sample();
    expect(updateSection(f, 's2', { scope: 'child' })).toBe(f);
  });

  it('changing a scope clears conditions that now cross scopes', () => {
    const f: EventForm = {
      sections: [
        sec({
          id: 'a',
          questions: [q({ id: 'p', type: 'pick_one', choices: ['A'] })],
        }),
        sec({
          id: 'b',
          questions: [
            q({ id: 'd', showWhen: { questionId: 'p', equals: 'A' } }),
          ],
        }),
      ],
    };
    const next = updateSection(f, 'b', { scope: 'family' });
    expect(next.sections[1].questions[0].showWhen).toBeNull();
  });

  it('deleting a section moves its questions into the previous one', () => {
    const f: EventForm = {
      sections: [
        sec({ id: 'a', questions: [q({ id: 'x' })] }),
        sec({ id: 'b', questions: [q({ id: 'y' })] }),
      ],
    };
    const next = deleteSection(f, 'b');
    expect(next.sections.map((s) => s.id)).toEqual(['a']);
    expect(ids(next)).toEqual([['x', 'y']]);
  });

  it('deleting the first section moves its questions into the next one', () => {
    const f: EventForm = {
      sections: [
        sec({ id: 'a', questions: [q({ id: 'x' })] }),
        sec({ id: 'b', questions: [q({ id: 'y' })] }),
      ],
    };
    expect(ids(deleteSection(f, 'a'))).toEqual([['x', 'y']]);
  });

  it('the only section is protected while it holds questions', () => {
    const f: EventForm = {
      sections: [sec({ id: 'a', questions: [q({ id: 'x' })] })],
    };
    expect(deleteSection(f, 'a')).toBe(f);
    expect(
      deleteSection({ sections: [sec({ id: 'a' })] }, 'a').sections
    ).toEqual([]);
  });

  it('never merges the signature into a child section', () => {
    const f = sample();
    expect(deleteSection(f, 's2')).toBe(f);
  });
});

describe('appendSections', () => {
  it('copies sections with fresh ids and remapped conditions', () => {
    const src = sample().sections;
    const f = appendSections({ sections: [] }, src);
    expect(f.sections).toHaveLength(2);
    const [pick, dep] = f.sections[0].questions;
    expect(pick.id).not.toBe('pick');
    expect(f.sections[0].id).not.toBe('s1');
    expect(dep.showWhen).toEqual({ questionId: pick.id, equals: 'Yes' });
    expect(EventFormSchema.safeParse(f).success).toBe(true);
  });

  it('drops a copied signature when the form already has one', () => {
    const f = appendSections(sample(), sample().sections);
    const sigs = f.sections
      .flatMap((s) => s.questions)
      .filter((x) => x.type === 'signature');
    expect(sigs).toHaveLength(1);
    expect(sigs[0].id).toBe('sig');
    expect(EventFormSchema.safeParse(f).success).toBe(true);
  });
});

describe('showWhenSources', () => {
  it('offers earlier Pick one questions in a section of the same scope', () => {
    const f: EventForm = {
      sections: [
        sec({
          id: 'a',
          questions: [
            q({ id: 'p1', type: 'pick_one', choices: ['A'] }),
            q({ id: 't', type: 'tick_many', choices: ['A'] }),
          ],
        }),
        sec({
          id: 'b',
          scope: 'family',
          questions: [q({ id: 'p2', type: 'pick_one', choices: ['A'] })],
        }),
        sec({
          id: 'c',
          questions: [
            q({ id: 'x' }),
            q({ id: 'p3', type: 'pick_one', choices: ['A'] }),
          ],
        }),
      ],
    };
    expect(showWhenSources(f, 'x').map((s) => s.id)).toEqual(['p1']);
    expect(showWhenSources(f, 'p3').map((s) => s.id)).toEqual(['p1']);
    expect(showWhenSources(f, 'p1')).toEqual([]);
  });
});
