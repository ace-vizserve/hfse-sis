'use client';

import { Globe2, Loader2, Search, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

type Match = {
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  level: string | null;
  section: string | null;
  status: string | null;
};

const DEBOUNCE_MS = 300;

export function CrossAySearch() {
  const [query, setQuery] = React.useState('');
  const [matches, setMatches] = React.useState<Match[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Debounce the query → fetch.
  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/sis/search?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
        if (!res.ok) {
          setMatches([]);
          return;
        }
        const data = (await res.json()) as { matches?: Match[] };
        setMatches(data.matches ?? []);
      } catch {
        setMatches([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Click outside → close.
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const showResults = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative w-full md:max-w-md">
      <div className="relative">
        <Globe2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Find student across all years…"
          className="h-10 pl-9 pr-9"
          aria-label="Find student across all academic years"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setMatches([]);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {showResults && (
        <Card className="absolute left-0 right-0 top-full z-50 mt-2 p-0 shadow-lg">
          <ScrollArea className="h-[420px]">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Searching all academic years…
            </div>
          )}

          {!loading && matches.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <Search className="size-5 text-muted-foreground/40" />
              <p className="text-sm text-foreground">No matches</p>
              <p className="text-xs text-muted-foreground">
                Try a name, student number (e.g. <code className="font-mono">H260010</code>), or enrolee number.
              </p>
            </div>
          )}

          {!loading && matches.length > 0 && (
            <ul className="divide-y divide-border">
              {matches.map((m) => (
                <li key={`${m.ayCode}:${m.enroleeNumber}`}>
                  <Link
                    href={{
                      pathname: `/records/students/by-enrolee/${m.enroleeNumber}`,
                      query: { ay: m.ayCode },
                    }}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <Badge
                      variant="outline"
                      className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wider"
                    >
                      {m.ayCode}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">{m.fullName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                        <span className="tabular-nums">{m.enroleeNumber}</span>
                        {m.studentNumber && <span className="tabular-nums">{m.studentNumber}</span>}
                        {(m.level || m.section) && (
                          <span>
                            {[m.level, m.section].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {m.status && <span className="uppercase tracking-wider">{m.status}</span>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
