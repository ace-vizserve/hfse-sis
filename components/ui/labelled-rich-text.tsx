import { isEmptyRichText } from '@/lib/rich-text';

import { RichText } from './rich-text';

/**
 * A small heading over a block of text somebody wrote — "What happened",
 * "Remarks".
 *
 * Was two byte-identical local `Prose` helpers, in
 * `components/classroom/student-discipline-panel.tsx` and
 * `components/sis/student-discipline-tab.tsx`. They render the same record on
 * two screens and had already been copied once; a third copy was the obvious
 * next step, so they are one component now.
 *
 * ⚠ IT RENDERS NOTHING — LABEL INCLUDED — WHEN THERE IS NOTHING TO SHOW, and
 * that is why the guard belongs in here rather than at the call sites. Both
 * callers used to write `{record.remarks && <Prose …>}`, which was right while
 * the column held plain text and is wrong now: an editor clicked into and left
 * alone stores `<p></p>`, which is perfectly truthy, so the screen would have
 * shown a "Remarks" heading with a blank space under it.
 */
export function LabelledRichText({
  label,
  html,
}: {
  label: string;
  html: string | null | undefined;
}) {
  // Asked directly, not by rendering `RichText` and testing the result: that
  // returns null from INSIDE the component, so the element it produces is
  // always a truthy object and a guard on it would never fire.
  if (isEmptyRichText(html)) return null;

  return (
    <div>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <RichText html={html} className="pt-1 text-ink-3" />
    </div>
  );
}
