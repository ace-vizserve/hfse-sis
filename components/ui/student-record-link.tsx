import { IdentifierLink } from '@/components/ui/identifier-link';

// A student's name, linked to their permanent record only when the viewer can
// actually open it.
//
// `/records/students/[studentNumber]` is registrar-and-above. Every classroom
// surface used to link there unconditionally, so a form adviser clicking a
// student on their own roster was bounced to `/` — the page guard was right
// and the link never asked the same question (KD #173).
//
// Two deliberate choices:
//
//  * `canOpen` is REQUIRED, with no default. KD #173's nav layer fails closed
//    because `can(undefined)` is false; here TypeScript does better — a call
//    site that forgets to decide is a build error, not a silently hidden link.
//    Do NOT push this prop down into `IdentifierLink` itself: that has ~30 call
//    sites, nearly all on registrar-only surfaces, and a defaulted prop there
//    would blank correct links across the app.
//
//  * When the viewer cannot open the record they get plain text, not a
//    disabled or tooltipped link. There is nothing for them to act on, and
//    advertising a page they have no business in is the thing KD #173 was
//    written to stop.
//
// This component owns the URL, which is what lets
// __tests__/auth/module-inpage-link-reachability.test.ts assert that no
// classroom file contains a `/records` literal at all.
export function StudentRecordLink({
  studentNumber,
  canOpen,
  className,
  children,
}: {
  /** Null for a student not yet synced from admissions — never linkable. */
  studentNumber: string | null;
  /** Derive from `canOpenStudentRecord(capability)` on the server. */
  canOpen: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  if (!canOpen || !studentNumber) {
    return (
      <span className={className ?? 'text-sm font-medium text-foreground'}>
        {children}
      </span>
    );
  }
  return (
    <IdentifierLink
      href={`/records/students/${encodeURIComponent(studentNumber)}`}
      className={className}
    >
      {children}
    </IdentifierLink>
  );
}
