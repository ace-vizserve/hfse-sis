import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatPoints } from '@/lib/house-points/standings';
import { houseTileClass } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

// One house's points as a §8 stat card — the year standings on
// /records/house-points and one event's totals on its own page. Shared so the
// two read as the same object at two scopes.
//
// With `href` (the year standings) the whole card opens that house's own page.
// The link is an overlay inside the card rather than a wrapper around it: the
// standings grid styles its cards through `*:data-[slot=card]:`, which only
// reaches direct children.
//
// No 'use client': it renders in the server page and inside the client score
// sheet alike.

export function HouseStatCard({
  name,
  colourToken,
  total,
  footerTitle,
  footerDetail,
  href,
}: {
  name: string;
  colourToken: string;
  total: number;
  footerTitle: string;
  footerDetail: string;
  href?: string;
}) {
  return (
    <Card
      className={cn(
        '@container/card',
        href &&
          'group relative transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring'
      )}
    >
      <CardHeader>
        {/* The house name always sits beside its colour (§9.3). */}
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {name}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
          {formatPoints(total)}
        </CardTitle>
        <CardAction>
          <div
            className={cn(
              'size-9 rounded-xl shadow-brand-tile',
              houseTileClass(colourToken)
            )}
            aria-hidden
          />
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="inline-flex items-center gap-1 font-medium text-foreground">
          {footerTitle}
          {href && (
            <ArrowUpRight
              className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden
            />
          )}
        </p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
      {href && (
        <Link
          href={href}
          className="absolute inset-0 rounded-xl focus-visible:outline-none"
          aria-label={`${name}: see where its points came from`}
        />
      )}
    </Card>
  );
}
