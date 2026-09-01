import { generateText, type JSONContent } from '@tiptap/core';
// Isomorphic on purpose. `@tiptap/html` declares conditional exports: the
// browser build uses the real DOM, the node build uses happy-dom. Both are
// needed — these helpers run inside Zod schemas, which validate on the client
// (zodResolver) and again on the server (route handlers).
//
// `happy-dom` is therefore a real runtime dependency of the server build, not
// a test-only one. It is declared in `dependencies` for that reason; do not
// move it to devDependencies because "only tests seem to use it".
import { generateHTML, generateJSON } from '@tiptap/html';

import { RICH_TEXT_EXTENSIONS } from './extensions';

/**
 * Blocks are joined with a single newline rather than TipTap's default blank
 * line. These strings land in spreadsheet cells and email bodies where a
 * doubled gap reads as a mistake.
 */
const BLOCK_SEPARATOR = '\n';

/** An empty ProseMirror document, for the "nothing here" cases. */
const EMPTY_DOC: JSONContent = { type: 'doc', content: [] };

function parse(html: string | null | undefined): JSONContent {
  if (html == null) return EMPTY_DOC;
  const trimmed = html.trim();
  if (trimmed === '') return EMPTY_DOC;
  return generateJSON(trimmed, RICH_TEXT_EXTENSIONS) as JSONContent;
}

/**
 * Formatted text as a plain string — the single stripper.
 *
 * Use it at every boundary that cannot render HTML: the Masterfile `.xlsx`
 * export, the five Resend email templates (whose `escapeHtml` would otherwise
 * show the tags to the reader), the parent-portal API, table search and sort.
 *
 * Safe on text that was never HTML: a bare sentence parses to one paragraph
 * and comes back out unchanged.
 */
export function toPlainText(html: string | null | undefined): string {
  return textFromDoc(parse(html));
}

/**
 * The same stripper, starting from a ProseMirror document instead of an HTML
 * string.
 *
 * The live editor already holds a document, so the on-screen character counter
 * uses this rather than re-parsing `editor.getHTML()` on every keystroke — a
 * 10,000-character write-up would parse the whole field on each key.
 *
 * ⚠ Both entry points MUST end in the same place. If the counter and the Zod
 * `.max()` measured differently, a teacher would watch the counter read 200 of
 * 200 and then be told the note is too long.
 */
export function textFromDoc(doc: JSONContent): string {
  if (!doc.content?.length) return '';

  const text = generateText(doc, RICH_TEXT_EXTENSIONS, {
    blockSeparator: BLOCK_SEPARATOR,
  });

  // NESTED BLOCKS EACH EMIT A SEPARATOR. A bullet list is bulletList >
  // listItem > paragraph, three levels deep, so the raw output opens with two
  // blank lines and puts another between every bullet. In a spreadsheet cell
  // that reads as a broken export rather than as a list, so runs collapse to
  // one line break and the ends are trimmed.
  return text
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Does this field actually contain anything a person wrote?
 *
 * ⚠ THIS FEEDS THE REPORT-CARD PUBLISH GATE. The check it replaces was
 * `writeup.trim().length === 0`, which an empty TipTap document (`<p></p>`,
 * seven characters) silently passes. Empty means "no prose", so a document
 * holding only a horizontal rule or an unticked empty checklist is empty too —
 * none of those is an adviser's comment about a child.
 */
export function isEmptyRichText(html: string | null | undefined): boolean {
  return proseLength(html) === 0;
}

/**
 * Character count of the prose, ignoring the markup.
 *
 * Every `.max(N)` in `lib/schemas/` and every on-screen counter measures with
 * this. The caps were written about what a person typed — a 200-character note
 * would be eaten by `<strong><em><u>` alone if we measured the string.
 */
export function proseLength(html: string | null | undefined): number {
  return toPlainText(html).trim().length;
}

/**
 * Round-trip HTML through the schema, dropping anything not in
 * `RICH_TEXT_EXTENSIONS`.
 *
 * Two jobs. On the way in it is the sanitiser — `<script>`, inline styles,
 * Word's `MsoNormal`/`<o:p>` junk and `javascript:` hrefs all have nowhere to
 * live in the schema, so they disappear. On the way out it is what makes
 * stored HTML safe to render on the read-only surfaces.
 *
 * Returns `''` — never `'<p></p>'` — for empty input, because several of these
 * columns are nullable and their handlers convert `''` to NULL. Emitting an
 * empty paragraph would write a value that every later "is this blank?" test
 * reads as filled in.
 */
export function normalizeRichText(html: string | null | undefined): string {
  const doc = parse(html);
  if (!doc.content?.length) return '';
  if (isEmptyRichText(html)) return '';
  return generateHTML(doc, RICH_TEXT_EXTENSIONS);
}

export { RICH_TEXT_EXTENSIONS } from './extensions';
