import { formatStamp } from '@/lib/events/display';
import type { AnswerValue, EventForm, EventQuestion } from '@/lib/events/form';

// Pure helpers for the staff registrations table and its CSV: which form
// questions become columns, and how one answer reads in a cell.

export type QuestionColumn = {
  id: string;
  label: string;
  scope: 'child' | 'family';
};

/** One column per answerable question, in form order. Info text has no answer. */
export function questionColumns(form: EventForm): QuestionColumn[] {
  const out: QuestionColumn[] = [];
  for (const section of form.sections) {
    for (const q of section.questions) {
      if (q.type === 'info') continue;
      out.push({
        id: q.id,
        label: q.type === 'signature' ? 'Signed by' : q.label,
        scope: section.scope,
      });
    }
  }
  return out;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function readableDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The "Signed by" cell: "Name · 27 Oct 2026, 8:14 pm" (Singapore time). The
 * signature is stored on the parent's submission, not among the answers.
 */
export function formatSignature(
  sig: { name: string; signedAt: string | null } | null | undefined
): string {
  if (!sig || !sig.name.trim()) return '';
  return sig.signedAt ? `${sig.name} · ${formatStamp(sig.signedAt)}` : sig.name;
}

/** An answer as one cell of text. A question the form no longer has reads as empty. */
export function formatAnswer(
  q: EventQuestion | undefined,
  v: AnswerValue | undefined
): string {
  if (!q || v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (q.type === 'date' && typeof v === 'string') return readableDate(v);
  return String(v);
}
