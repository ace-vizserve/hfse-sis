import { describe, expect, it } from 'vitest';

import {
  isEmptyRichText,
  normalizeRichText,
  proseLength,
  toPlainText,
} from '@/lib/rich-text';

// THE FOUR HELPERS THAT KEEP FORMATTED TEXT FROM LEAKING.
//
// Every text box in the SIS stores HTML now. Nothing else in this app has
// ever rendered HTML, so every existing consumer — the Masterfile export, the
// five email templates, the parent-portal API, the report-card publish gate —
// assumes plain text. These helpers are the boundary between the two.
//
// `isEmptyRichText` is the highest-risk of the four. It replaces a
// `writeup.trim().length === 0` test that IS the report-card publish gate. An
// empty TipTap document serialises to `<p></p>` — seven characters, non-empty
// by the old test — so without this a report card would publish with a blank
// adviser comment and nothing would say so.

describe('toPlainText', () => {
  it('strips marks and keeps the prose', () => {
    expect(
      toPlainText('<p><strong>Ravi</strong> is <em>improving</em>.</p>')
    ).toBe('Ravi is improving.');
  });

  it('separates block elements so words do not run together', () => {
    expect(toPlainText('<p>First para.</p><p>Second para.</p>')).toBe(
      'First para.\nSecond para.'
    );
  });

  it('flattens a bullet list into readable lines', () => {
    const html =
      '<ul><li><p>Leads group work</p></li><li><p>Written fluency</p></li></ul>';
    expect(toPlainText(html)).toBe('Leads group work\nWritten fluency');
  });

  it('returns an empty string for null, undefined and empty input', () => {
    expect(toPlainText(null)).toBe('');
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText('')).toBe('');
  });

  it('passes plain text through untouched', () => {
    // Rows written before the editor existed hold bare text, not HTML.
    expect(toPlainText('Just a sentence.')).toBe('Just a sentence.');
  });

  it('decodes entities rather than leaving them visible', () => {
    expect(toPlainText('<p>Ravi &amp; Sara &lt;3</p>')).toBe('Ravi & Sara <3');
  });
});

describe('isEmptyRichText', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['an empty TipTap document', '<p></p>'],
    ['a document holding only a break', '<p><br></p>'],
    ['a document holding only whitespace', '<p>   </p>'],
    ['nested empty blocks', '<p></p><p></p>'],
    ['an empty list item', '<ul><li><p></p></li></ul>'],
  ])('treats %s as empty', (_label, value) => {
    expect(isEmptyRichText(value)).toBe(true);
  });

  it.each([
    ['a plain sentence', 'Ravi has improved.'],
    ['a formatted sentence', '<p><strong>Ravi</strong> has improved.</p>'],
    ['a single list item', '<ul><li><p>One point</p></li></ul>'],
    ['a lone character', '<p>x</p>'],
  ])('treats %s as non-empty', (_label, value) => {
    expect(isEmptyRichText(value)).toBe(false);
  });
});

describe('proseLength', () => {
  it('counts what the teacher typed, not the markup', () => {
    // 'hello' is 5 characters. The <strong> wrapper is not the teacher's prose.
    expect(proseLength('<p><strong>hello</strong></p>')).toBe(5);
  });

  it('does not inflate a short note into a long one', () => {
    // The 200-char caps on the notes fields would be eaten by markup alone.
    const html = '<p><strong><em><u>ok</u></em></strong></p>';
    expect(proseLength(html)).toBe(2);
  });

  it('is zero for every shape of empty document', () => {
    expect(proseLength('<p></p>')).toBe(0);
    expect(proseLength('<p><br></p>')).toBe(0);
    expect(proseLength(null)).toBe(0);
  });
});

describe('normalizeRichText', () => {
  it('drops a script tag entirely', () => {
    // This is the app's first HTML sink. The schema is the whitelist: a node
    // the extension list does not define has nowhere to be put.
    const out = normalizeRichText('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('drops an inline style but keeps the words', () => {
    const out = normalizeRichText(
      '<p><span style="color:#c00">urgent</span></p>'
    );
    expect(out).not.toContain('style');
    expect(out).not.toContain('#c00');
    expect(toPlainText(out)).toBe('urgent');
  });

  it('strips a javascript: link but keeps the link text', () => {
    // The one XSS vector the schema alone does not close: <a> IS an allowed
    // node, so the protocol has to be checked separately.
    const out = normalizeRichText(
      '<p><a href="javascript:alert(1)">click</a></p>'
    );
    expect(out).not.toContain('javascript:');
    expect(toPlainText(out)).toBe('click');
  });

  it('keeps an ordinary https link', () => {
    const out = normalizeRichText(
      '<p><a href="https://hfse.edu.sg">policy</a></p>'
    );
    expect(out).toContain('https://hfse.edu.sg');
  });

  it('keeps the formatting we do support', () => {
    const out = normalizeRichText(
      '<p><strong>b</strong><em>i</em><u>u</u><s>s</s></p><ul><li><p>x</p></li></ul>'
    );
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    expect(out).toContain('<u>');
    expect(out).toContain('<s>');
    expect(out).toContain('<ul>');
  });

  it('discards Word paste junk', () => {
    // Teachers draft in Word. Without this, one report-card comment renders in
    // Calibri while every other comment uses the school's font.
    const word =
      '<p class="MsoNormal" style="font-family:Calibri;font-size:11pt">' +
      '<o:p></o:p><span lang="EN-SG">Ravi did well.</span></p>';
    const out = normalizeRichText(word);
    expect(out).not.toContain('Calibri');
    expect(out).not.toContain('MsoNormal');
    expect(out).not.toContain('o:p');
    expect(toPlainText(out)).toBe('Ravi did well.');
  });

  it('normalises empty input to an empty string, not to <p></p>', () => {
    // Several columns are nullable and their handlers convert '' to NULL.
    // Returning '<p></p>' here would write a "non-empty" blank into the DB.
    expect(normalizeRichText('')).toBe('');
    expect(normalizeRichText(null)).toBe('');
    expect(normalizeRichText('<p></p>')).toBe('');
    expect(normalizeRichText('   ')).toBe('');
  });
});
