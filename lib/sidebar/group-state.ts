import type { NavItem, NavSection } from '@/lib/auth/roles';

// Which sidebar groups the viewer has left open, remembered across reloads and
// module switches. Read server-side in each module layout and passed down, the
// same way `sidebar:state` -> `defaultOpen` already works — a client-only read
// renders the default first and then visibly pops groups open on every load.
export const SIDEBAR_GROUPS_COOKIE = 'sidebar:groups';
export const SIDEBAR_GROUPS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Groups are keyed by a slug of their LABEL, never by their index.
 *
 * `resolveSectionsForRole` drops any group whose items the viewer cannot see,
 * so index 2 is a different group for a teacher than for the academic
 * coordinator. Keying by index would restore the wrong group the moment a
 * viewer's role differed from whoever wrote the cookie.
 */
export function groupKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A group offers a collapse toggle only when it has a label AND more than one
 * item. A single-item group renders a plain label — the toggle would hide one
 * row, which is not worth a control.
 */
export function isCollapsibleGroup(section: NavSection): boolean {
  return Boolean(section.label) && section.items.length > 1;
}

// Wire format: `module:key,key|module:key`. Compact because it rides on a
// cookie sent with every request; empty modules are omitted entirely.
export function decodeGroupCookie(
  raw: string | undefined
): Record<string, string[]> {
  if (!raw) return {};
  // The client percent-encodes on write. Next decodes on read, the raw
  // `document.cookie` path does not — so decode defensively. Keys are slugs
  // (`[a-z0-9-]`) plus the two separators, so a second decode is a no-op and
  // a malformed value falls back to the raw string rather than throwing.
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    value = raw;
  }
  const out: Record<string, string[]> = {};
  for (const part of value.split('|')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const moduleName = part.slice(0, idx);
    const keys = part
      .slice(idx + 1)
      .split(',')
      .filter(Boolean);
    out[moduleName] = keys;
  }
  return out;
}

/**
 * One-liner for a module layout: the groups this viewer left open in this
 * module, or undefined if they have never touched it.
 */
export function expandedGroupsFor(
  raw: string | undefined,
  moduleName: string
): string[] | undefined {
  return decodeGroupCookie(raw)[moduleName];
}

export function encodeGroupCookie(state: Record<string, string[]>): string {
  return Object.entries(state)
    .filter(([, keys]) => keys.length > 0)
    .map(([moduleName, keys]) => `${moduleName}:${keys.join(',')}`)
    .join('|');
}

/**
 * Which groups render open.
 *
 * No saved state -> everything collapsed except the group holding the current
 * page. Saved state -> use it. Either way the group holding the current page is
 * ALWAYS open: a viewer who cannot see where they are has lost their place, and
 * that outranks a stored preference.
 *
 * Groups that aren't collapsible never appear here — the caller renders them
 * open unconditionally.
 */
export function resolveExpandedGroups({
  sections,
  activeHref,
  saved,
}: {
  sections: NavSection[];
  activeHref: string | undefined;
  saved: string[] | undefined;
}): Set<string> {
  const collapsible = sections.filter(isCollapsibleGroup);
  const activeKey = activeHref
    ? collapsible.find((s) => s.items.some((i) => i.href === activeHref))?.label
    : undefined;

  const expanded = new Set<string>(
    saved
      ? // Intersect with what actually exists — a stale key from a group that
        // has since been renamed or filtered away must not linger in the set.
        saved.filter((key) =>
          collapsible.some((s) => groupKey(s.label!) === key)
        )
      : collapsible
          .filter((s) => s.label === activeKey)
          .map((s) => groupKey(s.label!))
  );

  if (activeKey) expanded.add(groupKey(activeKey));
  return expanded;
}

/**
 * What a collapsed group owes the viewer: the badges it is hiding.
 *
 * Every badge in the app sits inside a labelled group, so without this a
 * collapsed group silently swallows "3 change requests" or "5 unsynced
 * students" — the exact signals the badge exists to raise.
 */
export function sumGroupBadges(
  items: NavItem[],
  badges: Partial<Record<string, number>> | undefined
): number {
  if (!badges) return 0;
  return items.reduce(
    (total, item) => total + (item.badgeKey ? (badges[item.badgeKey] ?? 0) : 0),
    0
  );
}
