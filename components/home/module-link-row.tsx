import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';
import { SIDEBAR_REGISTRY, type SidebarModule } from '@/lib/sidebar/registry';

/**
 * One button per module this viewer can open, under the home greeting.
 *
 * The list comes from `switcherModules` — the same answer the topbar switcher
 * draws — so the row and the switcher can never disagree. Navigation only: no
 * counts on the pills; the to-do panel carries the numbers.
 */
export function ModuleLinkRow({
  modules,
  className,
}: {
  modules: SidebarModule[];
  className?: string;
}) {
  if (modules.length === 0) return null;
  return (
    <nav
      aria-label="Open a module"
      className={cn('flex min-w-0 items-center gap-3', className)}
    >
      {/* §3 eyebrow token. */}
      <span className="shrink-0 font-mono text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Open
      </span>
      {/* One shadcn ButtonGroup of the app's outline buttons — same family as
          Account and More in the header — each with the module's switcher
          icon. On a narrow window the group scrolls inside its own strip
          rather than widening the page. */}
      <div className="min-w-0 overflow-x-auto pb-1">
        <ButtonGroup>
          {modules.map((m) => {
            const cfg = SIDEBAR_REGISTRY[m];
            const Icon = cfg.icon;
            return (
              <Button key={m} variant="outline" size="sm" asChild>
                <Link href={cfg.primaryHref}>
                  <Icon aria-hidden />
                  {cfg.label}
                </Link>
              </Button>
            );
          })}
        </ButtonGroup>
      </div>
    </nav>
  );
}
