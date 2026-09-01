import * as React from 'react';

import { normalizeRichText } from '@/lib/rich-text';
import {
  RICH_TEXT_PROSE_CLASS,
  RICH_TEXT_PROSE_PRINT_CLASS,
} from '@/lib/rich-text/prose';
import { cn } from '@/lib/utils';

/**
 * READ-ONLY DISPLAY OF TEXT WRITTEN IN THE FORMATTING EDITOR.
 *
 * ⚠ THIS IS THE ONLY PLACE IN THE APP THAT RENDERS HTML. Nothing else uses
 * `dangerouslySetInnerHTML`, and nothing else should — route every stored
 * write-up, justification, note and rejection reason through this component.
 *
 * ── why there is no sanitiser library here ──────────────────────────────
 *
 * `normalizeRichText` parses the string against `RICH_TEXT_EXTENSIONS` — the
 * same schema the editor writes with — and re-serialises what survives. A node
 * or mark the schema does not define has nowhere to be put, so `<script>`,
 * inline styles, Word's junk and `javascript:` hrefs are gone before this ever
 * sees them. That is an allow-list by construction rather than a blocklist
 * somebody has to keep up to date, which is why DOMPurify is not a dependency.
 *
 * It holds only while the normalise call stays. **Do not "optimise" this by
 * passing `html` straight to `dangerouslySetInnerHTML`** — the value comes out
 * of a database column that staff, and in some cases the admissions flow,
 * can write to.
 *
 * Renders nothing at all for an empty field, so a blank note leaves no stray
 * empty paragraph behind. Callers that need to say "no note yet" should test
 * the value themselves and render their own empty state.
 */
export function RichText({
  html,
  className,
  print = false,
  as: Tag = 'div',
}: {
  html: string | null | undefined;
  className?: string;
  /**
   * Add the print adjustments: links become ink, the quote rule loses its
   * colour, and lists are kept off page boundaries. Set this on anything that
   * goes through the browser's print dialog — the report card, above all.
   */
  print?: boolean;
  as?: 'div' | 'span' | 'article';
}) {
  const safe = normalizeRichText(html);
  if (safe === '') return null;

  return (
    <Tag
      className={cn(
        RICH_TEXT_PROSE_CLASS,
        print && RICH_TEXT_PROSE_PRINT_CLASS,
        className
      )}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
