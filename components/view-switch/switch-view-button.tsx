'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { useViewSwitch } from '@/components/view-switch/use-view-switch';

// "Switch to School Admin view" — one button, for the wrong-view notice.
//
// ⚠ IT COMES BACK TO THIS PAGE, and that is the whole point of it existing
// separately from the profile popover. The viewer is being told to switch
// BECAUSE of the page they are standing on; sending them to `/` afterwards
// would make them navigate back to somewhere they had already got to, which
// is the small indignity that makes people stop using a control.
//
// The destination is read from `usePathname()` + `useSearchParams()` rather
// than passed down as a prop. Four server call sites would otherwise each
// hand-build their own URL from route params, and the one that forgot the
// query string would drop the viewer's chosen term or tab without anyone
// noticing. The route validates whatever arrives (lib/auth/in-app-path.ts) and
// the hook navigates to what the route echoes back, so reading it here is a
// convenience, not a trust decision.

type SwitchViewButtonProps = {
  /** The view to switch into — the account's real role. */
  target: Role;
  /** The view currently rendered, so the hook can no-op a pointless switch. */
  activeRole: Role | null;
};

export function SwitchViewButton({
  target,
  activeRole,
}: SwitchViewButtonProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { switchingTo, switchView } = useViewSwitch(activeRole);
  const pending = switchingTo === target;

  const query = searchParams?.toString();
  const destination = `${pathname ?? '/'}${query ? `?${query}` : ''}`;

  return (
    <Button
      type="button"
      onClick={() => switchView(target, destination)}
      // ⚠ NOT `disabled={pending}`, and this matters more here than in either
      // popover. `disabled` removes the element from the tab order, so the
      // browser drops focus to `<body>` — and on this card the button is the
      // ONLY control, so a failed switch would strand a keyboard user with
      // nothing focused and no way back except re-tabbing from the top of the
      // document. It is inert while in flight regardless: `switchView` returns
      // early if a switch is already running. Same reasoning, same shape, as
      // the two popovers' `disabled={switchingTo !== null && !pending}`.
      aria-busy={pending}
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      Switch to {ROLE_LABEL[target]} view
    </Button>
  );
}
