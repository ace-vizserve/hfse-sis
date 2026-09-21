import { describe, expect, it } from 'vitest';

import { splitToastMessage } from '@/lib/hooks/use-write-action';

// A toast title is a heading, not a paragraph. Server messages in this repo are
// written as "what went wrong. what to do about it" — plain English for school
// admins — so the second sentence is a description by construction.
describe('splitToastMessage', () => {
  it('leaves a short message whole, with no empty description', () => {
    // A one-line "Saved" must not become a title with a blank description
    // underneath it.
    const result = splitToastMessage('Saved');
    expect(result).toEqual({ title: 'Saved' });
    expect(result.description).toBeUndefined();
  });

  it('splits a long two-sentence message on the first sentence', () => {
    // The real 409 from the P-Files upload route.
    const result = splitToastMessage(
      "This student has no document record for this year. Ask an administrator to add them to this year's records, then try again."
    );
    expect(result.title).toBe(
      'This student has no document record for this year'
    );
    expect(result.description).toBe(
      "Ask an administrator to add them to this year's records, then try again."
    );
  });

  it('drops a trailing full stop from the title but keeps ! and ?', () => {
    const stop = splitToastMessage(
      'The publish window closed before this saved. Reopen it and try again.'
    );
    expect(stop.title).toBe('The publish window closed before this saved');

    const question = splitToastMessage(
      'Did the parent confirm this by email? Record the reply before marking it promised, so the chase strip stays accurate.'
    );
    expect(question.title).toBe('Did the parent confirm this by email?');
  });

  it('does not split on a decimal or an abbreviation', () => {
    // "0.8" and "e.g." are followed by a lowercase char or a digit, never the
    // capital the lookahead requires — so neither is a sentence end.
    const decimal = splitToastMessage(
      'The weights must add up to 1.0 across every component of this grading sheet, and they currently do not.'
    );
    expect(decimal.description).toBeUndefined();

    const abbrev = splitToastMessage(
      'Pick a narrower window, e.g. one term rather than the whole year, because this export exceeds the row cap.'
    );
    expect(abbrev.description).toBeUndefined();
  });

  it('leaves a long single sentence whole rather than cutting it', () => {
    // A truncated title is worse than a long one — the reader loses the half
    // that said what happened.
    const text =
      'The grading sheet was locked by somebody else while this dialog was open and nothing has been saved';
    expect(splitToastMessage(text)).toEqual({ title: text });
  });

  it('still splits when the first sentence is longer than a title should be', () => {
    // The first version of this bailed out here, which left the worst real
    // message in the app untouched. Moving the remedy into the description is
    // worth doing even when the problem statement is long — what remains is
    // one sentence to rewrite, not a splitter to tune.
    const result = splitToastMessage(
      'This request could not be applied because the approval chain changed after you opened it. Ask the coordinator to re-file it.'
    );
    expect(result.title).toBe(
      'This request could not be applied because the approval chain changed after you opened it'
    );
    expect(result.description).toBe('Ask the coordinator to re-file it.');
  });
});
