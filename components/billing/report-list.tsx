'use client';

import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  EllipsisVertical,
  Search,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// QuickBooks' Standard reports page: "Type report name here", Favorites on
// top, then collapsible sections ("Who owes you", "For my accountant"), each
// report with its star (a favourite, kept in this browser) and ⋮ (Open in
// QuickBooks). Reports the SIS reads open here; the ones QuickBooks' API
// can't produce open in QuickBooks.

export type ListedReport = {
  /** Stable id: the SIS key, or the QuickBooks title for a QuickBooks-only one. */
  id: string;
  title: string;
  group: string;
  /** SIS page, or null when the report opens in QuickBooks. */
  href: string | null;
};

const FAV_KEY = 'billing-report-favorites';

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavorites(ids: string[]) {
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  } catch {
    // Private window or blocked storage: the star still works until reload.
  }
}

export function ReportList({
  reports,
  groups,
  qbReportsUrl,
}: {
  reports: ListedReport[];
  groups: string[];
  /** QuickBooks' Standard reports page. */
  qbReportsUrl: string;
}) {
  const [q, setQ] = React.useState('');
  const [favs, setFavs] = React.useState<string[]>([]);
  const [shut, setShut] = React.useState<Set<string>>(() => new Set());
  // Read after mount: the server render has no browser storage.
  React.useEffect(() => {
    setFavs(readFavorites());
  }, []);

  const toggleFav = (id: string) =>
    setFavs((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      writeFavorites(next);
      return next;
    });
  const toggleGroup = (g: string) =>
    setShut((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  const needle = q.trim().toLowerCase();
  const match = (r: ListedReport) =>
    !needle || r.title.toLowerCase().includes(needle);
  const favorites = favs
    .map((id) => reports.find((r) => r.id === id))
    .filter((r): r is ListedReport => !!r && match(r));
  const sections: Array<{ name: string; items: ListedReport[] }> = [
    { name: 'Favorites', items: favorites },
    ...groups.map((g) => ({
      name: g,
      items: reports.filter((r) => r.group === g && match(r)),
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type report name here"
          aria-label="Find a report"
          className="pl-9"
        />
      </div>

      {sections.map((s) => {
        if (needle && s.items.length === 0) return null;
        const open = !shut.has(s.name);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <Card key={s.name} className="gap-0 px-6 py-4">
            <button
              type="button"
              onClick={() => toggleGroup(s.name)}
              aria-expanded={open}
              className="flex items-center gap-2 text-left"
            >
              <Chevron className="size-4 text-muted-foreground" />
              <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {s.name}
              </h2>
            </button>
            {open &&
              (s.items.length === 0 ? (
                <p className="mt-3 pl-6 text-sm text-muted-foreground">
                  Star a report to keep it here.
                </p>
              ) : (
                // Down the left column first, then the right, as QuickBooks.
                <ul className="mt-2 gap-x-10 md:columns-2">
                  {s.items.map((r) => (
                    <ReportRow
                      key={r.id}
                      report={r}
                      starred={favs.includes(r.id)}
                      onStar={() => toggleFav(r.id)}
                      qbReportsUrl={qbReportsUrl}
                    />
                  ))}
                </ul>
              ))}
          </Card>
        );
      })}
      {needle && sections.every((s) => s.items.length === 0) && (
        <p className="text-sm text-muted-foreground">
          No report is named like that. Clear the search to see them all.
        </p>
      )}
    </div>
  );
}

function ReportRow({
  report: r,
  starred,
  onStar,
  qbReportsUrl,
}: {
  report: ListedReport;
  starred: boolean;
  onStar: () => void;
  qbReportsUrl: string;
}) {
  const name = r.href ? (
    <Link
      href={r.href}
      className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary hover:underline"
    >
      {r.title}
    </Link>
  ) : (
    <a
      href={qbReportsUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground hover:text-primary hover:underline"
      title="Opens in QuickBooks"
    >
      <span className="truncate">{r.title}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
  return (
    <li className="flex break-inside-avoid items-center gap-2 border-b border-border py-1.5">
      {name}
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-pressed={starred}
        aria-label={starred ? `Unfavorite ${r.title}` : `Favorite ${r.title}`}
        onClick={onStar}
      >
        <Star
          className={cn(
            'size-4',
            starred ? 'fill-primary text-primary' : 'text-muted-foreground'
          )}
        />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`More for ${r.title}`}
          >
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <a href={qbReportsUrl} target="_blank" rel="noreferrer">
              Open in QuickBooks
              <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
