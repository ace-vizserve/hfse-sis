import Link from 'next/link';
import { Eye } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { SwitchViewButton } from '@/components/view-switch/switch-view-button';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import type { ViewContext } from '@/lib/auth/view-context';

// "You're looking at this as a teacher, and this isn't one of your classes."
//
// ⚠ WHY THIS EXISTS AT ALL — it is the other half of Phase 3a, and without it
// the phase ships a regression. Once a page resolves its scope through the
// lens, a teaching admin in the Teacher view holds no capability on a class
// she does not teach, and the gate's `notFound()` fires. That would be fine if
// nothing linked there, but plenty does: only Markbook's nav is lensed, so in
// the Teacher view her Attendance sidebar is still the admin's,
// `/attendance/sections` scopes on her REAL role and lists every section in
// the school, and every row links to a register that now 404s. Same shape from
// the student record, the SIS section page and the report-card roster. Click
// "Sections", click a row, get a 404 — with no hint that the reason is a
// setting she chose and can undo in one click.
//
// ⚠ A REAL TEACHER MUST STILL GET A PLAIN 404, and `showWrongViewNotice` below
// is what guarantees it. For a `teacher` account the entitled set is exactly
// `['teacher']`, so there is no other view, nothing to switch to, and a class
// they hold no assignment for is genuinely not found — telling them "you're
// viewing as Teacher" would be nonsense, and offering a switch would advertise
// a capability their account does not have. Do not relax that condition.

/**
 * Should the wrong-view notice replace this gate's `notFound()`?
 *
 * True only when the viewer HAS another view and is not currently in it — i.e.
 * exactly when a switch is both possible and would change the answer. Every
 * single-role account (every teacher, every admin who does not teach) falls
 * through to `notFound()` unchanged.
 */
export function showWrongViewNotice(view: {
  role: Role | null;
  entitled: readonly Role[];
  activeRole: Role | null;
}): boolean {
  return (
    view.role != null &&
    view.entitled.length > 1 &&
    view.activeRole !== null &&
    view.activeRole !== view.role
  );
}

type WrongViewNoticeProps = {
  /** The viewer, straight from `getViewContext()`. */
  view: ViewContext;
  /** One line, sentence case, ending in a full stop. e.g. "Not one of your classes." */
  heading: string;
  /**
   * One sentence naming the view AND the thing they tried to open. The call
   * site writes it because only the call site knows what to call the thing —
   * "3/A isn't a class you teach or advise" reads very differently from
   * "Aria Tan isn't one of your students".
   */
  body: string;
  /** Where someone who would rather STAY in this view should go instead. */
  backHref: string;
  backLabel: string;
};

export function WrongViewNotice({
  view,
  heading,
  body,
  backHref,
  backLabel,
}: WrongViewNoticeProps) {
  // Narrowed by `showWrongViewNotice`, which every call site checks first.
  // Belt-and-braces rather than a non-null assertion: rendering an empty card
  // is a nuisance, rendering "Switch to null view" is a bug on screen.
  if (!showWrongViewNotice(view) || view.role == null) return null;

  return (
    <Card className="items-center gap-4 py-10 text-center">
      {/* Muted tile, not the brand gradient. The gradient tile means "a thing
          you can open" all over this app; this card is the opposite, and the
          one saturated element on it should be the button. */}
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Eye className="size-6" />
      </div>

      <div className="space-y-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Viewing as {ROLE_LABEL[view.activeRole!]}
        </p>
        <p className="font-serif text-xl font-semibold text-foreground">
          {heading}
        </p>
      </div>

      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>

      <div className="flex flex-col items-center gap-3">
        <SwitchViewButton target={view.role} activeRole={view.activeRole} />
        <Link
          href={backHref}
          className="text-sm text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
        >
          {backLabel}
        </Link>
      </div>
    </Card>
  );
}
