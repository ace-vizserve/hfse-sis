import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The arrange-cover dialog's selection state, pinned.
//
// It shipped broken once and the failure was invisible from the code: ticking
// a class stored '' as the substitute, the checkbox rendered from
// `Boolean(value)`, and so a freshly ticked box drew itself unticked. To the
// person using it the checkbox simply did not work — and the submit button
// stayed disabled while the header claimed a class was covered.
//
// It then shipped broken a SECOND time, differently: un-ticking deleted the
// entry while the Radix Select — handed `value={chosen || undefined}` — went
// uncontrolled and carried on displaying the teacher that had just been
// discarded. The row looked filled in; the counter said "0 of 1 covered".
//
// The fix both times was the same shape: which classes are ticked and who
// covers each are TWO facts and need two pieces of state. These assertions
// guard that separation, because folding them back into one map is the natural
// thing to write and looks fine in review.

const ROOT = process.cwd();
const DIALOG = 'components/sis/teacher-cover-actions.tsx';

const codeOnly = () =>
  readFileSync(join(ROOT, DIALOG), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*/, ''))
    .join('\n');

describe('the arrange-cover dialog', () => {
  const code = codeOnly();

  it('keeps "which are ticked" and "who covers each" in separate state', () => {
    expect(code).toMatch(/const \[ticked, setTicked\] = useState<Set<string>>/);
    expect(code).toMatch(/const \[chosenById, setChosenById\] = useState/);
  });

  it('draws the checkbox from whether the class is ticked, not from who covers it', () => {
    // `checked={Boolean(chosen)}` was the first bug. An empty substitute is a
    // ticked class waiting for a name, not an unticked one.
    expect(code).toMatch(/checked=\{isTicked\}/);
    expect(code).not.toMatch(/checked=\{Boolean\(/);
  });

  it('keeps the dropdown controlled, so it cannot show a discarded teacher', () => {
    // `value={chosen || undefined}` hands Radix back its own internal state.
    // It then renders the last teacher picked even after un-ticking cleared
    // it — a row that looks complete beside a counter that says it is not.
    expect(code).toMatch(/value=\{chosen\}/);
    expect(code).not.toMatch(/value=\{chosen \|\| undefined\}/);
  });

  it('un-ticking touches only membership, never the chosen teacher', () => {
    // So an accidental untick is one click to undo rather than a re-pick.
    expect(code).toMatch(
      /setTicked\(\(prev\) => \{[\s\S]{0,220}copy\.delete\(c\.assignmentId\)/
    );
  });

  it('does not make the teacher dropdown wait for the checkbox', () => {
    // Choosing a teacher IS assigning cover; it ticks the row itself. Gating
    // the dropdown on the checkbox adds a step that exists only because of how
    // the state was modelled.
    expect(code).not.toMatch(
      /disabled=\{c\.alreadyCovered \|\| chosen === undefined\}/
    );
    expect(code).toMatch(
      /setTicked\(\(prev\) => new Set\(prev\)\.add\(c\.assignmentId\)\)/
    );
  });

  it('blocks submission only on a ticked class with nobody in it', () => {
    // Mr Ace's rule: disabled only if something is ticked and has no teacher
    // (or nothing is ticked at all).
    expect(code).toMatch(/tickedCount === 0 \|\| readyCount !== tickedCount/);
  });

  it('counts and labels from classes that actually have a substitute', () => {
    // The header said "1 of 1 covered" while the button was disabled, because
    // both read a count that included ticked-but-empty rows.
    expect(code).toMatch(
      /readyIds = tickedIds\.filter\(\(id\) => Boolean\(chosenById\[id\]\)\)/
    );
    expect(code).toMatch(/Arrange cover for \$\{readyCount\}/);
  });

  it('sends only the classes that have somebody in them', () => {
    expect(code).toMatch(/covers: readyIds\.map/);
  });

  it('says why the button is off', () => {
    // A disabled control with no reason beside it is a dead end.
    expect(code).toMatch(/Tick a class and choose who covers it/);
    expect(code).toMatch(/Choose a teacher for every class you have ticked/);
  });

  it('clears both halves of the selection when the dialog closes', () => {
    expect(code).toMatch(/setTicked\(new Set\(\)\)/);
    expect(code).toMatch(/setChosenById\(\{\}\)/);
  });
});
