'use client';

import { ChevronDown, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// One export control — mirroring the "Generate Masterfile" menu on the
// per-level view rather than putting several buttons in the header, which
// would have given the page competing primary actions (09a §9.2).
//
// It downloads either of the school's two files — the Consolidated File (one
// tab per class) or the Final Report Book Masterfile sheet — for exactly what
// the filters show: grade level and class pick the students, subject the
// columns, term the terms filled. With no grade level picked the school keeps
// separate Primary and Secondary files, so the menu offers both.
export function OverviewExportMenu({
  ayCode,
  levelId,
  sectionId,
  subjectId,
  termNumber,
}: {
  ayCode: string;
  levelId: string | null;
  sectionId: string | null;
  subjectId: string | null;
  termNumber: number | null;
}) {
  const params = new URLSearchParams({ ay: ayCode });
  if (levelId) params.set('level', levelId);
  if (levelId && sectionId) params.set('class', sectionId);
  if (subjectId) params.set('subject', subjectId);
  if (termNumber) params.set('term', String(termNumber));
  const base = `/api/markbook/masterfile/export?${params.toString()}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Download className="size-4" />
          Export
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {levelId ? (
          <ExportTemplateItems href={base} />
        ) : (
          (['primary', 'secondary'] as const).map((division, i) => (
            <div key={division}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>
                {division === 'primary' ? 'Primary' : 'Secondary'}
              </DropdownMenuLabel>
              <ExportTemplateItems href={`${base}&division=${division}`} />
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The two school templates, each as Excel or CSV, for one export link. */
export function ExportTemplateItems({ href }: { href: string }) {
  const items: [string, string][] = [
    ['Consolidated File (.xlsx)', href],
    ['Consolidated File (.csv)', `${href}&format=csv`],
    ['Report Book (.xlsx)', `${href}&template=report-book`],
    ['Report Book (.csv)', `${href}&template=report-book&format=csv`],
  ];
  return items.map(([label, url]) => (
    <DropdownMenuItem key={label} asChild>
      <a href={url} download>
        {label}
      </a>
    </DropdownMenuItem>
  ));
}
