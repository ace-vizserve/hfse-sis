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
