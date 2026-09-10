'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { staffInitials } from '@/components/sis/staff-visuals';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { useRoleSwitch } from '@/lib/hooks/use-role-switch';

/**
 * Who you are signed in as — the account page's subject.
 *
 * ⚠ THIS REPLACED A 300px RAIL CARD, and the move was the point. The old page
 * put identity in a sidebar while three dashboard widgets took the main
 * column; an account page that has to be read down the side of itself is not
 * an account page. Nothing here is new data — `name`, `email` and `role` were
 * all already fetched. What changed is which of them the page is about.
 *
 * ⚠ THE AVATAR IS THIS CARD'S ICON TILE (§7.4) — gradient, not a flat tint,
 * and it carries `shadow-brand-tile`. A first pass shipped it as `bg-accent`,
 * which is the exact "icon tiles are crafted, not flat" miss the craft
 * standard names. There is deliberately no `CardAction` tile beside it: two
 * tiles on one card compete, and the lockup already IS the tile.
 *
 * ⚠ IT IS A CLIENT COMPONENT ONLY BECAUSE OF THE SWITCH. Everything above the
 * role row is static; if the switch ever moves out, this goes back to being a
 * server component.
 */
export function IdentityBand({
  name,
  email,
  role,
  roles,
}: {
  name: string;
  email: string;
  role: Role | null;
  /**
   * Every role the account holds, `role` included. One entry is not a choice,
   * so the switch renders only above one — same test the sidebar profile uses
   * (`roles.length > 1`), because they are answering the same question.
   */
  roles: readonly Role[];
}) {
  const { switchingTo, switchRole } = useRoleSwitch(role);
  const others = roles.filter((r) => r !== role);

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 py-6 md:flex-row md:items-center md:gap-7">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy font-serif text-base font-semibold text-white shadow-brand-tile">
          {staffInitials(name)}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          {/* Eyebrow / serif / mono — three of the four voices in one lockup
              (§7.1). The old card had one, and read monotone. */}
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Signed in as
          </p>
          <h2 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-foreground">
            {name}
          </h2>
          <p className="break-all font-mono text-[12px] text-muted-foreground">
            {email}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2.5 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {/* ⚠ ROLE_LABEL, never the raw role. The old page printed
                `ACADEMIC_COORDINATOR` in mono caps — the database's word for
                the job, shown to someone who does the job. This map exists
                precisely to stop that, and was already imported two files
                away. */}
            <span className="rounded-lg bg-accent px-2.5 py-1 text-[13px] font-semibold text-brand-indigo-deep">
              {ROLE_LABEL[role as Role] ?? 'No role'}
            </span>
            {others.map((r) => (
              // `outline` is the configuration variant (§9.2) — switching your
              // own view is not the page's primary path, and the page's one
              // `default` Button belongs to Change password.
              <Button
                key={r}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => switchRole(r)}
                disabled={switchingTo !== null}
              >
                {switchingTo === r && (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                )}
                {switchingTo === r
                  ? `Switching to ${ROLE_LABEL[r]}…`
                  : `Switch to ${ROLE_LABEL[r]}`}
              </Button>
            ))}
          </div>
          {others.length > 0 && (
            <p className="max-w-[36ch] text-[12.5px] leading-snug text-muted-foreground md:text-right">
              Switching changes what you can do, not just what you see. You land
              back on the home page.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
