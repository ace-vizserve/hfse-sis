import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * SisPageHeader — the shared SIS Admin screen header (Task V4,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html`
 * `.scr-head`). Single-sources the header markup that shipped inline on
 * `/sis/admin/staff` via `<DashboardHero>` in Task V3 — same spacing/type,
 * just scoped to "SIS Admin · {group}" so every SIS Admin page's eyebrow
 * reads consistently against its sidebar group ("This year" / "Structure" /
 * "Access & system").
 *
 * Also single-sources the "back to hub" link (final-review fix, minor #5):
 * every SIS Admin page used to render its own `<Link href="/sis">` above
 * this header with an inconsistent label ("Dashboard" / "SIS Admin" /
 * "Admin Hub") — three names for the same destination. Now every page just
 * passes `backHref`/`backLabel` (or omits them for the default "Admin Hub"
 * → `/sis`) so the label can't drift again. `/sis/sections/[id]` is the one
 * legitimate exception — it backs up one level to `/sis/sections`, not the
 * hub — via an explicit override. The Hub itself (`/sis`) is the one page
 * with no "back" destination at all — `showBackLink={false}` (layout
 * redesign pass, Phase 0) omits the link entirely rather than pointing it
 * at itself.
 *
 * Presentation only — no data fetching, no client state. `chips` is the
 * right-side status/identity row (badges, AY pickers, etc.); `actions` is
 * for page-level buttons. Both render in the same flex-wrap row, mirroring
 * `<DashboardHero>`'s badges+actions slot — pass a single wrapping element
 * in `chips` if a page needs its own multi-row right-side layout (e.g. a
 * badge row stacked over an AY switcher).
 */
export function SisPageHeader({
  group,
  title,
  description,
  chips,
  actions,
  backHref = '/sis',
  backLabel = 'Admin Hub',
  showBackLink = true,
}: {
  group: string;
  title: string;
  description?: string;
  chips?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  showBackLink?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {showBackLink && (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
      )}

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            SIS Admin · {group}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {(chips || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {chips}
            {actions}
          </div>
        )}
      </header>
    </div>
  );
}
