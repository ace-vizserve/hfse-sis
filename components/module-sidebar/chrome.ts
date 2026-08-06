// Shared sidebar chrome — the paint for nav rows, alert badges and count chips.
//
// Hoisted out of `sidebar-nav-item.tsx` so a collapsed group's roll-up badge is
// PIXEL-IDENTICAL to the badges it stands for. `09a-design-patterns.md` §10.2
// is about legends, but the rule is the same shape: the summary reads from the
// same source as the thing it summarises, or the two drift and the summary
// stops meaning what it appears to mean.

export const NAV_ACTIVE_CLASSES =
  'h-9 transition-colors ' +
  'data-[active=true]:bg-accent ' +
  'data-[active=true]:text-brand-indigo-deep ' +
  'data-[active=true]:font-semibold ' +
  'data-[active=true]:ring-1 data-[active=true]:ring-inset data-[active=true]:ring-brand-indigo-soft/40 ' +
  'data-[active=true]:hover:bg-accent ' +
  'data-[active=true]:[&_svg]:text-brand-indigo-deep';

// "Needs attention" pill. Destructive per §9.1 — this is the one sidebar
// element that says something is wrong.
export const NAV_BADGE_CLASSES =
  'rounded-full bg-destructive px-1.5 text-[10px] font-semibold tabular-nums text-white group-data-[collapsible=icon]:hidden';

// Informational count chip. Deliberately quiet — it reports, it does not alert.
export const NAV_COUNT_CLASSES =
  'rounded-md border border-sidebar-border bg-sidebar-accent/40 px-1.5 font-mono text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden';

// The mono eyebrow every group label has worn since the sidebar shipped.
export const NAV_GROUP_LABEL_CLASSES =
  'font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50';
