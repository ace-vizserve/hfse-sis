'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * ⚠ The `Portal` is load-bearing. Without it Radix renders the tooltip inline
 * beside its trigger, where it inherits every ancestor stacking context and is
 * clipped by any ancestor `overflow-hidden` — a bar track, a rounded meter, a
 * card. This wrapper shipped without one while `popover`, `dropdown-menu`,
 * `dialog` and `sheet` all had theirs, so tooltips were the only primitive in
 * the app that could not escape its container.
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Above dialogs and sheets (z-50): a tooltip opened from inside one
        // has to sit on top of it, never behind.
        'z-[60] overflow-hidden rounded-md border border-hairline bg-brand-navy px-3 py-2 text-[12.5px] leading-snug text-white shadow-lg',
        'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
