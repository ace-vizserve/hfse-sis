import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Micro-label convention (§3.3): every badge reads as a mono uppercase chip so
  // status pills across the app share the tabs / eyebrow typography. Per-variant
  // color is handled below; typography stays base-level.
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase leading-none tracking-[0.14em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/25 focus-visible:ring-offset-1 [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_rgba(15,23,42,0.08)]",
        secondary: "border-hairline bg-muted text-ink-3",
        destructive:
          "border-transparent bg-destructive text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_rgba(15,23,42,0.08)]",
        outline: "border-hairline bg-white text-foreground shadow-input",
        // Muted filled — neutral state pills (e.g. "Inactive", "Archived") that
        // need a dark background so white text reads, without carrying the
        // attention weight of the default indigo gradient.
        muted:
          "border-transparent bg-muted-foreground text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_rgba(15,23,42,0.08)]",
        // Semantic state variants — gradient treatment for §9.3 healthy /
        // warning / blocked. Use these for state pills that benefit from the
        // non-flat brand voice (status columns, lifecycle chips). Wash
        // recipes (Badge variant="outline" + per-tone className) are the
        // fallback when the table needs lighter visual weight.
        success: "border-transparent bg-gradient-to-br from-brand-mint to-brand-sky text-white shadow-sm",
        warning: "border-transparent bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-sm",
        blocked: "border-transparent bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
