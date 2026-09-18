'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * The replacement for a native `title=` attribute.
 *
 * `title` is the browser's own grey box: it waits about a second, ignores
 * every token in `globals.css`, cannot be styled for one theme let alone two,
 * and — the part that actually matters — never appears on keyboard focus when
 * it sits on a non-focusable element. The SIS had 75 of them.
 *
 * Three behaviours this wrapper exists to get right, each of which was a real
 * defect in the hand-rolled sites it replaces:
 *
 * 1. **A blank hint renders nothing at all.** Many call sites pass a
 *    conditional (`{isLate ? 'Marked late' : undefined}`). A `<Tooltip>` around
 *    an empty string still mounts a trigger and still opens an empty box, so
 *    the conditional has to be honoured here rather than at every call site.
 *
 * 2. **`wrap` is for disabled controls.** `buttonVariants` carries
 *    `disabled:pointer-events-none`, and Radix menu items carry
 *    `data-[disabled]:pointer-events-none`. An element that is not hit-tested
 *    never fires a hover — which is why several `title`s that only appeared
 *    when a control was disabled could never be read by anyone. Passing `wrap`
 *    puts the trigger on a focusable span AROUND the dead control, which is
 *    the only way to explain to someone why a button they cannot press is
 *    disabled.
 *
 * 3. **Non-focusable triggers get `tabIndex` here, not at the call site.** A
 *    `<span>` or a `<Badge>` is not tab-reachable, so a tooltip hung on one is
 *    mouse-only. `focusable={false}` opts out for the rare trigger that is
 *    already inside a focusable ancestor — hanging a second tab stop inside a
 *    button is worse than none.
 *
 * Note it does NOT set an `aria-label`. Radix wires the trigger to the content
 * with `aria-describedby`, so the hint is announced in addition to the
 * element's own name. An `<iframe title>` is a different thing entirely — that
 * is the frame's required accessible name, not a tooltip, and must be left as
 * an attribute.
 */
export type HoverHintProps = {
  /** The hint. Falsy (undefined / null / '') renders `children` untouched. */
  hint: React.ReactNode;
  // Typed with its props so `focusable` can read an existing tabIndex —
  // React 19's bare ReactElement types props as `unknown`.
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Extra classes on the tooltip box. */
  className?: string;
  /**
   * Wrap `children` in a focusable span and trigger from that instead. Use
   * when the child is (or can become) `disabled` / `pointer-events-none`.
   */
  wrap?: boolean;
  /** Classes for the `wrap` span — it is `inline-flex` by default. */
  wrapClassName?: string;
  /**
   * Add `tabIndex={0}` to a non-focusable child so the hint is keyboard
   * reachable. Pass `false` when the child already sits inside a focusable
   * ancestor, or is itself a button / link / input.
   */
  focusable?: boolean;
};

export function HoverHint({
  hint,
  children,
  side = 'top',
  align = 'center',
  className,
  wrap = false,
  wrapClassName,
  focusable = true,
}: HoverHintProps) {
  // An absent hint is the common case on conditional call sites — render the
  // child alone rather than an empty box on hover.
  if (hint === undefined || hint === null || hint === '' || hint === false) {
    return children;
  }

  const trigger = wrap ? (
    <span
      tabIndex={0}
      className={cn('inline-flex cursor-default', wrapClassName)}
    >
      {children}
    </span>
  ) : focusable ? (
    React.cloneElement(children, {
      tabIndex: children.props.tabIndex ?? 0,
    } as Partial<React.HTMLAttributes<HTMLElement>>)
  ) : (
    children
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        // The default TooltipContent is a short mono label. A `title` was very
        // often a whole sentence, so hints wrap and read as prose instead.
        className={cn(
          'max-w-[300px] whitespace-pre-line text-left font-sans text-[12.5px] font-medium leading-relaxed',
          className
        )}
      >
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
