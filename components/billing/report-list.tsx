'use client';

import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileBarChart,
  Search,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Billing → Reports. WHAT is here is QuickBooks' Standard reports page: find a
// report by name, Favorites on top (a star, kept in this browser), then the
// collapsible groups ("Who owes you", "For my accountant"), each report with
// its star and ▾ (Open in QuickBooks). HOW it looks is the SIS's: a card per
// group. Reports the SIS reads open here; the ones QuickBooks' API can't
// produce open in QuickBooks.

export type ListedReport = {
  /** Stable id: the SIS key, or the QuickBooks title for a QuickBooks-only one. */
  id: string;
  title: string;
  group: string;
  /** One plain line on what the report shows (SIS reports only). */
  blurb?: string;
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

const SECTION_NOTE: Record<string, string> = {
  Favorites: 'The reports you starred, kept in this browser.',
  'Who owes you': 'What customers owe and how long it has been owed.',
  'For my accountant': 'The books, account by account.',
};

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
    <div className="space-y-6">
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
        return (
          <Card key={s.name}>
            <CardHeader>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight">
                {s.name}
              </CardTitle>
              <CardDescription>
                {SECTION_NOTE[s.name] ?? ''}
                {s.items.length > 0 &&
                  ` ${s.items.length} ${s.items.length === 1 ? 'report' : 'reports'}.`}
              </CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => toggleGroup(s.name)}
                  aria-expanded={open}
                  aria-label={`${open ? 'Hide' : 'Show'} ${s.name}`}
                >
                  {open ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </Button>
              </CardAction>
            </CardHeader>
            {open && (
              <CardContent>
                {s.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Star a report to keep it here.
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
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
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
      {needle && sections.every((s) => s.items.length === 0) && (
        <Card className="py-0">
          <DataTableEmptyState
            icon={FileBarChart}
            title="No report is named like that."
            body="Clear the search to see them all."
          />
        </Card>
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
      className="truncate font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
    >
      {r.title}
    </Link>
  ) : (
    <a
      href={qbReportsUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
      title="Opens in QuickBooks"
    >
      <span className="truncate">{r.title}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
  return (
    <li className="flex items-center gap-2 border-b border-border py-2.5">
      <div className="flex min-w-0 flex-1 flex-col text-sm">
        {name}
        <span className="truncate text-xs text-muted-foreground">
          {r.blurb ?? 'Opens in QuickBooks.'}
        </span>
      </div>
      <ButtonGroup aria-label={`Actions for ${r.title}`}>
        <Button
          variant="outline"
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
              variant="outline"
              size="icon"
              className="size-8"
              aria-label={`More for ${r.title}`}
            >
              <ChevronDown className="size-4" />
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
      </ButtonGroup>
    </li>
  );
}
