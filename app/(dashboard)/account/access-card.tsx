import { KeyRound, School } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { TeacherSectionRow } from '@/lib/account/sections';

/**
 * What this role opens, and which classes you are responsible for.
 *
 * ⚠ THE ASSIGNMENT LIST IS NO LONGER TEACHER-ONLY, and that was a real gap
 * rather than a tidy-up. The old page loaded "Your sections" only when
 * `role === 'teacher'`, so the six staff who hold `school_admin` alongside
 * `teacher` — including four form-class advisers — opened their own account
 * page and saw nothing about the classes they run. A list keyed on the ROLE
 * refuses nobody; it just renders empty, which is why it went unnoticed.
 * `teacher_assignments` is keyed on the USER, so the query never needed the
 * gate that was sitting in front of it.
 */
export function AccessCard({
  modules,
  sections,
}: {
  /** Module display names this role may open, in switcher order. */
  modules: string[];
  /** Every assignment on this account, whatever role it holds. */
  sections: TeacherSectionRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>What this role opens</CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Your access
        </CardTitle>
        <CardAction>
          {/* §7.4 — gradient, never a flat tint, and it sits in CardAction so
              the Card grid positions it top-right on its own. */}
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <KeyRound className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-2.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Modules
          </p>
          {modules.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {modules.map((m) => (
                <li
                  key={m}
                  className="rounded-lg border border-border bg-muted px-2.5 py-1 text-[13px] font-medium text-foreground"
                >
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote
              title="No modules yet"
              body="This role doesn't open any part of the system. Ask a superadmin if that looks wrong."
            />
          )}
        </div>

        <div className="space-y-2.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Classes
          </p>
          {sections.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {sections.map((s, i) => (
                <li
                  key={`${s.sectionName}-${s.roleTag}-${i}`}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {s.sectionName}
                  </span>
                  {/* Informational, not a state — the §9.3 neutral recipe. */}
                  <Badge variant="secondary" className="h-6 shrink-0">
                    {s.roleTag}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote
              title="No classes this year"
              body="You aren't assigned to any section yet. A school admin sets these up."
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * §7.6 — "empty states are never blank". A bare `<p>` reads as a loading bug;
 * this reads as an answer. Scaled down from the full-page empty card because
 * it sits inside a section of a card, not in place of one.
 */
function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <School className="size-4" />
      </span>
      <div className="space-y-0.5">
        <p className="font-serif text-sm font-semibold text-foreground">
          {title}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}
