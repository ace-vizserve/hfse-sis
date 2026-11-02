import { describe, expect, it } from 'vitest';

import {
  formatAnswer,
  formatSignature,
  questionColumns,
} from '@/lib/events/export-columns';
import type { EventForm, EventQuestion } from '@/lib/events/form';

function q(over: Partial<EventQuestion>): EventQuestion {
  return {
    id: 'q',
    type: 'short',
    label: 'Question',
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

const form: EventForm = {
  sections: [
    {
      id: 's1',
      title: 'Child',
      description: '',
      scope: 'child',
      allowingOnly: false,
      questions: [
        q({ id: 'a', label: 'Topics to discuss' }),
        q({ id: 'i', type: 'info', label: 'Read this' }),
        q({ id: 'b', type: 'number', label: 'Adults attending' }),
      ],
    },
    {
      id: 's2',
      title: 'Family',
      description: '',
      scope: 'family',
      allowingOnly: false,
      questions: [
        q({ id: 'c', type: 'pick_one', label: 'Pickup' }),
        q({ id: 'sig', type: 'signature', label: 'I agree' }),
      ],
    },
  ],
};

describe('questionColumns', () => {
  it('skips info questions and keeps form order across sections', () => {
    expect(questionColumns(form).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
      'sig',
    ]);
  });

  it('carries the scope of the section and labels the signature "Signed by"', () => {
    const cols = questionColumns(form);
    expect(cols[0]).toEqual({
      id: 'a',
      label: 'Topics to discuss',
      scope: 'child',
    });
    expect(cols[2].scope).toBe('family');
    expect(cols[3]).toEqual({ id: 'sig', label: 'Signed by', scope: 'family' });
  });
});

describe('formatSignature', () => {
  it('reads "Name · date, time" in Singapore time', () => {
    expect(
      formatSignature({
        name: 'Maria Santos',
        signedAt: '2026-10-27T12:14:00Z',
      })
    ).toBe('Maria Santos · 27 Oct 2026, 8:14 pm');
  });
  it('shows the name alone when no time is stored', () => {
    expect(formatSignature({ name: 'Maria Santos', signedAt: null })).toBe(
      'Maria Santos'
    );
  });
  it('is empty when the parent did not sign', () => {
    expect(formatSignature(null)).toBe('');
    expect(formatSignature({ name: '  ', signedAt: null })).toBe('');
  });
});

describe('formatAnswer', () => {
  it('joins tick-many with commas', () => {
    expect(formatAnswer(q({ type: 'tick_many' }), ['Reading', 'Maths'])).toBe(
      'Reading, Maths'
    );
  });
  it('prints numbers and text as they are', () => {
    expect(formatAnswer(q({ type: 'number' }), 2)).toBe('2');
    expect(formatAnswer(q({ type: 'short' }), 'Hello')).toBe('Hello');
    expect(formatAnswer(q({ type: 'pick_one' }), 'Yes')).toBe('Yes');
  });
  it('formats a date as a readable day', () => {
    expect(formatAnswer(q({ type: 'date' }), '2026-11-05')).toBe('5 Nov 2026');
  });
  it('returns an empty string for no answer or an unknown question', () => {
    expect(formatAnswer(q({ type: 'short' }), null)).toBe('');
    expect(formatAnswer(q({ type: 'tick_many' }), [])).toBe('');
    expect(formatAnswer(undefined, 'x')).toBe('');
  });
});
