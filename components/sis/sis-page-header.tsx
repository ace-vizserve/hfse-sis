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
}: {
  group: string;
  title: string;
  description?: string;
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
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
  );
}
