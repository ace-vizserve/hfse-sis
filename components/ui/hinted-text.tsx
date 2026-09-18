'use client';

import * as React from 'react';

import { HoverHint } from '@/components/ui/hover-hint';

/**
 * A `<span>` that carries a {@link HoverHint} — for the `title=` sites that
 * live inside SERVER components.
 *
 * `HoverHint` is `'use client'`, and the only way to reach it from a server
 * page without dragging that page's data layer into the browser is a tiny
 * client component like this one. It matters that the `<span>` is created
 * HERE rather than passed in: `HoverHint` clones its child to add `tabIndex`
 * and Radix's `asChild` clones it again to attach the trigger, and neither
 * should be asked to operate on an element that arrived over the RSC wire.
 * Server-supplied `children` are just rendered inside, which is ordinary.
 *
 * Use it only for that case. A span inside a component that is ALREADY a
 * client component should use `HoverHint` directly — one wrapper, not two.
 */
export function HintedText({
  hint,
  className,
  side,
  children,
}: {
  /** Falsy renders the span with no tooltip at all (HoverHint's own rule). */
  hint: React.ReactNode;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactNode;
}) {
  return (
    <HoverHint hint={hint} side={side}>
      <span className={className}>{children}</span>
    </HoverHint>
  );
}
