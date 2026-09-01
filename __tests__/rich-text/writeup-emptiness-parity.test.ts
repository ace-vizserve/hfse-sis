import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isWriteupComplete } from '@/lib/classroom/writeups';
import { hasWriteupContent } from '@/lib/evaluation/roster-rules';
import {
  missingCommentStudents,
  type RosterStudent,
} from '@/lib/markbook/comment-completeness';
import { isEmptyRichText, proseLength } from '@/lib/rich-text';

// Every multi-line box in the app is a formatting editor now, so these columns
// hold HTML. An editor that has been clicked into and left alone stores
// `<p></p>` — SEVEN CHARACTERS, which `.trim().length > 0` reads as "a person
// wrote something here".
//
// The report-card publish gate (lib/markbook/comment-completeness.ts) was fixed
// to measure the prose. A five-copy cluster of the same predicate was not, so
// the dashboard KPI, the evaluation drill, the classroom "N of M submitted"
// figure, the submitted-count query and the change-request reject guard all
// DISAGREED with the gate in exactly the case that matters: an adviser who
// opened the comment box, typed nothing and submitted.
//
// This suite pins the whole cluster to one answer. Every case below fails
// against the `.trim().length` predicates these replaced.

/** Shapes an empty editor actually persists. */
const EMPTY_RICH_TEXT = [
  '',
  '   ',
  '<p></p>',
  '<p><br></p>',
  '<p>   </p>',
  '<ul><li><p></p></li></ul>',
] as const;

/** Real prose, including the pre-editor bare-text rows still in the table. */
const WRITTEN_RICH_TEXT = [
  'Solid term, engaged in class.',
  '<p>Solid term, engaged in class.</p>',
  '<p><strong>Excellent</strong> progress in reading.</p>',
  '<ul><li><p>Improved focus</p></li></ul>',
] as const;

describe('hasWriteupContent — the KD #120 shared predicate', () => {
  it.each(EMPTY_RICH_TEXT)('reads %j as no content', (html) => {
    expect(hasWriteupContent(html)).toBe(false);
  });

  it.each(WRITTEN_RICH_TEXT)('reads %j as content', (html) => {
    expect(hasWriteupContent(html)).toBe(true);
  });

  it('treats null and undefined as no content', () => {
    expect(hasWriteupContent(null)).toBe(false);
    expect(hasWriteupContent(undefined)).toBe(false);
  });

  it('agrees with isEmptyRichText on every case', () => {
    for (const html of [...EMPTY_RICH_TEXT, ...WRITTEN_RICH_TEXT]) {
      expect(hasWriteupContent(html)).toBe(!isEmptyRichText(html));
    }
  });
});

describe('hasWriteupContent fast path stays identical to the parser', () => {
  // hasWriteupContent answers the certain cases without building a DOM,
  // because the parser costs ~10ms a call and this runs once per student per
  // term. The shortcut is only safe while it agrees with the parser on
  // EVERYTHING, so the corpus below is deliberately nasty: entities that trim
  // away to nothing, markup that carries no prose, and text that only exists
  // inside an attribute or a dropped tag.
  const PARITY_CORPUS = [
    ...EMPTY_RICH_TEXT,
    ...WRITTEN_RICH_TEXT,
    '<p>&nbsp;</p>', // trims to nothing — must read EMPTY
    '<p>&#160;</p>',
    '<p>&nbsp;&nbsp;</p>',
    '<p>&amp;</p>', // a real character — must read WRITTEN
    '<p>&lt;p&gt;</p>',
    '<hr>', // no prose
    '<p></p><p></p>',
    '<img src="x.png" alt="a picture of nothing">', // alt text is not prose
    '<blockquote><p></p></blockquote>',
    '<p>Line one</p><p>Line two</p>',
    '<p><em> </em></p>',
    '<ol><li><p>Numbered</p></li></ol>',
  ];

  it.each(PARITY_CORPUS)('agrees with isEmptyRichText for %j', (html) => {
    expect(hasWriteupContent(html)).toBe(!isEmptyRichText(html));
  });

  it('answers a full roster without paying the parser 405 times', () => {
    // The regression guard. Before the fast path this loop took ~4.1s, which
    // is what the evaluation sections list pays on every request.
    const roster = Array.from({ length: 405 }, (_, i) =>
      i % 3 === 0
        ? '<p></p>'
        : `<p>Solid term, engaged in class. Student ${i}.</p>`
    );
    const startedAt = Date.now();
    const written = roster.filter((html) => hasWriteupContent(html)).length;
    const elapsed = Date.now() - startedAt;

    expect(written).toBe(270);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('the classroom tab and the publish gate cannot disagree', () => {
  // The classroom Write-ups tab claims in its header comment to mirror the
  // publish-readiness comment gate. That claim was false; this test is what
  // makes it true by construction rather than by inspection.
  const student: RosterStudent = {
    sectionStudentId: 'ss-1',
    studentId: 'stu-1',
    indexNumber: 1,
    name: 'Tan, Wei',
    enrollmentDate: null,
  };

  it.each([...EMPTY_RICH_TEXT, ...WRITTEN_RICH_TEXT])(
    'gives the same verdict for a submitted write-up of %j',
    (writeup) => {
      const completeHere = isWriteupComplete({ submitted: true, writeup });
      const missingAtGate = missingCommentStudents(
        [student],
        [{ student_id: 'stu-1', writeup, submitted: true }]
      );
      // "Complete" on the tab must mean "not missing" at the gate.
      expect(completeHere).toBe(missingAtGate.length === 0);
    }
  );

  it('does not count a submitted-but-never-typed-in write-up as done', () => {
    expect(isWriteupComplete({ submitted: true, writeup: '<p></p>' })).toBe(
      false
    );
  });

  it('still requires the submitted flag when content is real', () => {
    expect(
      isWriteupComplete({ submitted: false, writeup: '<p>Written.</p>' })
    ).toBe(false);
  });
});

describe('the drill "Draft length" column counts prose, not markup', () => {
  // draftCharCount is rendered to a person as "Draft length" and is exportable,
  // so it has to be the number of characters the adviser typed.
  it('reports 0 for an untouched editor', () => {
    expect(proseLength('<p></p>')).toBe(0);
  });

  it('does not charge the writer for their formatting', () => {
    expect(proseLength('<p><strong>Good</strong></p>')).toBe(
      proseLength('Good')
    );
  });
});

describe('no copy of the cluster is left measuring the raw string', () => {
  // A source-level guard, in the spirit of the subject-name read sweep. The
  // behavioural tests above cannot reach the two call sites that sit behind a
  // service client (the submitted-count query and the change-request reject
  // guard), and a sixth copy reintroduced tomorrow would pass every test above
  // while silently disagreeing with the publish gate again.
  const ROOT = path.resolve(__dirname, '..', '..');

  const CLUSTER = [
    'lib/evaluation/roster-rules.ts',
    'lib/evaluation/queries.ts',
    'lib/evaluation/drill.ts',
    'lib/classroom/writeups.ts',
    'lib/change-requests/decide.ts',
    'app/(evaluation)/evaluation/sections/[sectionId]/page.tsx',
    'app/(classroom)/classroom/[sectionId]/write-ups/page.tsx',
  ];

  /** `<thing>.trim()` used as an emptiness or length test. */
  const RAW_EMPTINESS_TEST =
    /\.trim\(\)\s*(?:\.length|!==\s*''|===\s*''|!==\s*""|===\s*"")/;

  it.each(CLUSTER)(
    '%s measures emptiness through the shared helpers',
    (rel) => {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      const offenders = source
        .split('\n')
        .map((line, i) => ({ line, lineNumber: i + 1 }))
        // Comments explain the bug being fixed and quote the old predicate.
        .filter(({ line }) => !line.trimStart().startsWith('//'))
        .filter(({ line }) => !line.trimStart().startsWith('*'))
        .filter(({ line }) => RAW_EMPTINESS_TEST.test(line))
        // Measuring the STRIPPED text is the correct thing and is what this
        // guard is steering people towards — whether the stripping came from
        // the rich-text helpers or from `hasWriteupContent`'s tag-removing
        // fast path, which the parity block above pins to the parser's answer.
        .filter(
          ({ line }) =>
            !/toPlainText|textFromDoc|proseLength|replace\(\/<\[\^>\]\*>\/g/.test(
              line
            )
        );

      expect(
        offenders.map((o) => `${rel}:${o.lineNumber}: ${o.line.trim()}`)
      ).toEqual([]);
    }
  );
});
