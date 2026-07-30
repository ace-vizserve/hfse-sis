// Pure helpers for resolving which report-card terms a parent is currently
// allowed to see, per KD #10 (publication windows gate parent view) + KD #150
// (visibility is gated purely by the publication window, not by current
// enrolment status — a withdrawn student's already-published terms still
// show). Used by app/api/parent/v2/report-card/route.ts.

export type PublicationRow = {
  section_id: string;
  term_id: string;
  publish_from: string;
  publish_until: string;
};

export type TermNumberRow = { id: string; term_number: number };

// Every currently-active publication window (publish_from <= now <=
// publish_until) across ANY of the student's section_ids counts — a student
// can have multiple section_students rows (transfers, cross-AY history,
// withdrawn + active rows), and all their sections are candidates.
export function computeActivePublishedTermNumbers(
  pubs: PublicationRow[],
  terms: TermNumberRow[],
  sectionIds: string[],
  now: number
): Set<number> {
  const termNumberById = new Map(terms.map((t) => [t.id, t.term_number]));
  const sectionIdSet = new Set(sectionIds);
  const result = new Set<number>();
  for (const pub of pubs) {
    if (!sectionIdSet.has(pub.section_id)) continue;
    const from = new Date(pub.publish_from).getTime();
    const until = new Date(pub.publish_until).getTime();
    if (now < from || now > until) continue;
    const termNumber = termNumberById.get(pub.term_id);
    if (termNumber != null) result.add(termNumber);
  }
  return result;
}

export type PayloadLike<T extends { term_number: number; id: string }> = {
  terms: T[];
  attendance: Array<{ term_id: string }>;
  comments: Array<{ term_id: string }>;
};

// Narrows a report-card payload down to exactly the terms whose term_number
// is in the active set. Never returns a term outside the active set.
export function filterPayloadToActiveTerms<
  T extends { term_number: number; id: string },
  P extends PayloadLike<T>,
>(payload: P, activeTermNumbers: Set<number>): P {
  const terms = payload.terms.filter((t) =>
    activeTermNumbers.has(t.term_number)
  );
  const termIds = new Set(terms.map((t) => t.id));
  return {
    ...payload,
    terms,
    attendance: payload.attendance.filter((a) => termIds.has(a.term_id)),
    comments: payload.comments.filter((c) => termIds.has(c.term_id)),
  };
}

/**
 * The form-adviser write-ups from terms BEFORE the one being viewed.
 *
 * A report card is cumulative on comments by design (KD #129): a Term 3 card
 * carries Term 1, 2 and 3 boxes. But the parent payload narrows `terms`,
 * `attendance` and `comments` to the terms whose publication window is open
 * right now, so earlier terms' comments never arrived — a parent opening the
 * Term 3 card saw only the Term 3 comment.
 *
 * These are returned as a SEPARATE, self-contained list rather than merged into
 * `comments`, for two reasons:
 *
 *   1. The external portal reads `payload.comments[0]` / `terms[0]` /
 *      `attendance[0]` — the first element — because today exactly one term
 *      arrives. Adding to `comments` would make it show an EARLIER term's
 *      comment under the viewed term's heading. Wrong data, silently.
 *   2. Each entry carries its own `term_label` + `virtue_theme`, so nothing has
 *      to be looked up in `terms` (which still holds only the viewed term).
 *      That also removes any chance of a lookup miss.
 *
 * Returns EMPTY when viewing Term 4: the final card has no form-adviser comment
 * section at all (KD #49/#129), so handing the portal earlier comments there
 * would invite it to render a block the card is not supposed to have.
 *
 * AUTHORISATION IS THE VIEWED TERM'S WINDOW, and nothing more. The caller has
 * already 403'd unless the viewed term has an active publication window, and the
 * card that window releases is BY DESIGN the one carrying terms 1..N's comments
 * — it is exactly what staff see on their own preview of the same card.
 *
 * A first cut also required each earlier term to have been published in its own
 * right. That was wrong in practice: a school that publishes only the current
 * term's window (the normal case) has no publication row for the earlier ones,
 * so every earlier comment was filtered out and the field arrived empty. The
 * window gates the CARD, not each paragraph on it.
 *
 * Bounds, all of which must hold:
 *   - strictly BEFORE the viewed term (the viewed term stays in `comments`, so
 *     the two lists never overlap)
 *   - term 1..3 only
 *   - submitted, and non-empty after trimming — a draft never reaches a parent
 */
export type EarlierComment = {
  term_id: string;
  term_number: number;
  term_label: string;
  virtue_theme: string | null;
  comment: string;
};

export function selectEarlierComments(
  terms: Array<{
    id: string;
    term_number: number;
    label: string;
    virtue_theme: string | null;
  }>,
  comments: Array<{
    term_id: string;
    comment: string | null;
    submitted: boolean;
  }>,
  viewedTermNumber: number
): EarlierComment[] {
  // The final (T4) card carries no comment section.
  if (viewedTermNumber > 3) return [];

  const byTermId = new Map(comments.map((c) => [c.term_id, c]));
  return terms
    .filter(
      (t) =>
        t.term_number < viewedTermNumber &&
        t.term_number >= 1 &&
        t.term_number <= 3
    )
    .sort((a, b) => a.term_number - b.term_number)
    .flatMap((t) => {
      const record = byTermId.get(t.id);
      const text = record?.comment?.trim();
      if (!record?.submitted || !text) return [];
      return [
        {
          term_id: t.id,
          term_number: t.term_number,
          term_label: t.label,
          virtue_theme: t.virtue_theme,
          comment: text,
        },
      ];
    });
}
