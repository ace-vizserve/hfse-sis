/**
 * HOW FORMATTED TEXT LOOKS, IN ONE PLACE.
 *
 * Used by the editor's content area AND by every read-only surface that
 * renders stored HTML (the report card's adviser comment, the discipline
 * panels, the classroom write-ups page). One constant, so a bullet list looks
 * the same while a teacher types it and after it is saved.
 *
 * Hand-written rather than `@tailwindcss/typography`: the plugin is not
 * installed, and its defaults carry their own greys, which would breach
 * hard-rules.md #7. Every colour here is a token.
 *
 * There is deliberately no `h1`/`h2` rule — the schema defines exactly one
 * heading level (h3), so anything else cannot occur.
 */
export const RICH_TEXT_PROSE_CLASS = [
  'text-sm leading-relaxed text-foreground',

  // Paragraphs. The last one loses its bottom margin so the field does not
  // carry a phantom blank line under the caret.
  '[&_p]:my-0 [&_p:not(:last-child)]:mb-2',

  // Lists. `list-outside` with padding keeps wrapped lines aligned under the
  // text rather than under the bullet.
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:list-outside [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:list-outside [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li>p]:mb-0',
  '[&_li]:marker:text-ink-5',

  // Checklists. TipTap renders these as a <ul data-type="taskList"> whose
  // items hold a real checkbox, so the disc marker has to come back off.
  '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
  '[&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start',
  '[&_ul[data-type=taskList]_li]:gap-2',
  '[&_ul[data-type=taskList]_li>label]:mt-0.5 [&_ul[data-type=taskList]_li>label]:shrink-0',
  '[&_ul[data-type=taskList]_li>div]:min-w-0 [&_ul[data-type=taskList]_li>div]:flex-1',
  '[&_input[type=checkbox]]:size-3.5 [&_input[type=checkbox]]:accent-brand-indigo',

  // The single heading level. Serif, because that is the editorial voice of
  // this app (09-design-system.md §3.3) and a section title is exactly where
  // it belongs.
  '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-serif [&_h3]:text-base',
  '[&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-foreground',
  '[&_h3:first-child]:mt-0',

  // A quote of someone else's words — a parent's or a student's, in a
  // discipline record. The indigo rule marks it as reported speech rather
  // than the staff member's own account.
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-brand-indigo/40',
  '[&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_blockquote]:italic',

  '[&_hr]:my-3 [&_hr]:border-t [&_hr]:border-hairline',

  '[&_a]:font-medium [&_a]:text-brand-indigo [&_a]:underline [&_a]:underline-offset-2',
  '[&_a:hover]:text-brand-indigo-deep',

  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_s]:text-ink-4',
].join(' ');

/**
 * Print variant for the report card.
 *
 * The sheet goes to a mono laser printer, so the indigo link and quote rule
 * become ink; and a list must not be split across a page boundary, because
 * half an adviser's comment on the back of the page is worse than a slightly
 * shorter page.
 */
export const RICH_TEXT_PROSE_PRINT_CLASS = [
  'print:[&_a]:text-ink print:[&_a]:no-underline',
  'print:[&_blockquote]:border-hairline-strong',
  'print:[&_ul]:break-inside-avoid print:[&_ol]:break-inside-avoid',
].join(' ');
