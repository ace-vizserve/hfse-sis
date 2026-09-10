'use client';

import { Check, ChevronsUpDown, LogOut, Loader2, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { useRoleSwitch } from '@/lib/hooks/use-role-switch';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type SidebarProfileProps = {
  email: string;
  /**
   * Every role this account holds, from `sessionUser.roles`. One entry is not
   * a choice, so the "Switch view" section renders only above one.
   */
  roles: readonly Role[];
  /**
   * The role in force. This is the account's REAL role — it authorises, and it
   * is also what the caption reads — because switching now rewrites
   * `app_metadata.active_role` rather than painting a different view over a
   * fixed one.
   */
  role: Role | null;
};

function deriveInitials(email: string): string {
  return (
    email
      .split('@')[0]
      .split(/[._-]/)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || 'HF'
  );
}

export function SidebarProfile({ email, roles, role }: SidebarProfileProps) {
  const router = useRouter();
  // ⚠ The switch itself lives in `useRoleSwitch`, shared with the account
  // page. It is a hook rather than a copied function because its
  // `refreshSession()` is the only one in the repo, and a second copy would be
  // a second place to forget it — which fails silently, by rendering the next
  // page in the role the user just left.
  const { switchingTo, switchRole } = useRoleSwitch(role);
  const initials = deriveInitials(email);
  const roleLabel = role ? ROLE_LABEL[role] : '';
  const canSwitchViews = roles.length > 1;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[11px] font-semibold text-white shadow-brand-tile">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <div
              className="truncate text-xs font-medium text-sidebar-foreground"
              title={email}
            >
              {email}
            </div>
            <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
              {roleLabel}
            </div>
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[260px] p-0"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-xs font-semibold text-white shadow-brand-tile">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div
              className="truncate text-[13px] font-medium text-foreground"
              title={email}
            >
              {email}
            </div>
            <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {roleLabel}
            </div>
          </div>
        </div>
        {canSwitchViews && (
          <>
            <div className="p-1.5">
              <div className="px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Switch view
              </div>
              {roles.map((r) => {
                const active = r === role;
                const pending = switchingTo === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => switchRole(r)}
                    disabled={switchingTo !== null && !pending}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-accent',
                      switchingTo !== null && !pending && 'opacity-60'
                    )}
                  >
                    {pending ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <Check
                        className={cn(
                          'size-4 shrink-0',
                          active ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    )}
                    <span>{ROLE_LABEL[r]}</span>
                  </button>
                );
              })}
            </div>
            <Separator />
          </>
        )}
        <div className="p-1.5">
          <Link
            href="/account"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <UserCog className="size-4 text-muted-foreground" />
            <span>Account</span>
          </Link>
          <Separator className="my-1.5" />
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <LogOut className="size-4" />
            <span>Sign out</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
