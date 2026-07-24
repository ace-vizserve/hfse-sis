import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AccountShortcut } from '@/lib/account/shortcuts';

/**
 * The account page's "Shortcuts" list — one row per module this role can
 * open that also has a quick action for that role (`shortcutsForRole`,
 * lib/account/shortcuts.ts already does the scoping). Pure presentation:
 * no data fetching here. Spec:
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md §4.
 */
export function ShortcutsCard({ shortcuts }: { shortcuts: AccountShortcut[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Shortcuts
        </CardTitle>
      </CardHeader>
      <CardContent className="border-t border-border p-0">
        <ul className="divide-y divide-border">
          {shortcuts.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/50"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {s.label}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
