"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

function Tabs({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva("group/tabs-list inline-flex w-fit text-ink-4", {
  variants: {
    variant: {
      // Gradient-tile rail — background-colored container, borderless chips at rest, hover fills with muted; active chip carries the brand gradient + tile shadow.
      default:
        "rounded-md bg-accent p-1 group-data-[orientation=horizontal]/tabs:items-center group-data-[orientation=horizontal]/tabs:gap-1 group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:items-stretch group-data-[orientation=vertical]/tabs:gap-1",
      // Segmented pill — opt-in for toolbars with count badges (e.g. grading data-table status tabs).
      segmented:
        "items-center justify-center rounded-lg border border-hairline bg-muted p-[3px] shadow-input group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Shared base — focus ring, icon sizing, disabled state.
        "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-ink-4 transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",

        // DEFAULT (gradient-tile) — borderless chip, mono uppercase label; hover fills with muted (inactive only).
        "group-data-[variant=default]/tabs-list:h-8 group-data-[variant=default]/tabs-list:rounded group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:font-mono group-data-[variant=default]/tabs-list:text-[11px] group-data-[variant=default]/tabs-list:font-semibold group-data-[variant=default]/tabs-list:uppercase group-data-[variant=default]/tabs-list:tracking-[0.14em] group-data-[variant=default]/tabs-list:text-ink-3 group-data-[variant=default]/tabs-list:data-[state=inactive]:hover:bg-muted group-data-[variant=default]/tabs-list:data-[state=inactive]:hover:text-foreground",
        // DEFAULT active — brand gradient tile + white text + crafted tile shadow.
        "group-data-[variant=default]/tabs-list:data-[state=active]:bg-gradient-to-br group-data-[variant=default]/tabs-list:data-[state=active]:from-brand-indigo group-data-[variant=default]/tabs-list:data-[state=active]:to-brand-navy group-data-[variant=default]/tabs-list:data-[state=active]:text-white group-data-[variant=default]/tabs-list:data-[state=active]:shadow-brand-tile",

        // SEGMENTED (pill) — white pill, indigo text, hairline ring on active.
        "group-data-[variant=segmented]/tabs-list:h-[calc(100%-1px)] group-data-[variant=segmented]/tabs-list:flex-1 group-data-[variant=segmented]/tabs-list:rounded-md group-data-[variant=segmented]/tabs-list:border group-data-[variant=segmented]/tabs-list:border-transparent group-data-[variant=segmented]/tabs-list:px-3 group-data-[variant=segmented]/tabs-list:py-1 group-data-[variant=segmented]/tabs-list:text-sm group-data-[variant=segmented]/tabs-list:font-medium hover:group-data-[variant=segmented]/tabs-list:text-foreground",
        "group-data-[variant=segmented]/tabs-list:data-[state=active]:bg-white group-data-[variant=segmented]/tabs-list:data-[state=active]:text-brand-indigo group-data-[variant=segmented]/tabs-list:data-[state=active]:shadow-xs group-data-[variant=segmented]/tabs-list:data-[state=active]:ring-1 group-data-[variant=segmented]/tabs-list:data-[state=active]:ring-hairline group-data-[variant=segmented]/tabs-list:data-[state=active]:font-semibold",

        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, tabsListVariants, TabsTrigger };
