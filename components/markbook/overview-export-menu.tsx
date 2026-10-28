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
// It downloads either of the school's two files — the CONSOLIDATED FORM (one
// term, a tab per class, P1–S4 in one file) or the Final Report Book
// Masterfile sheet — for exactly what the filters show: grade level and class
// pick the students, subject the columns, term the term. With no grade level
// picked, the Report Book is offered as Primary and Secondary, the two files
// the school keeps.
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
          <>
            {/* Every class P1–S4 in one file, as the school's form is. */}
            <DropdownMenuLabel>Consolidated Form</DropdownMenuLabel>
            <MenuLinks
              items={[
                ['Excel (.xlsx)', base],
                ['CSV (.csv)', `${base}&format=csv`],
              ]}
            />
            <DropdownMenuSeparator />
            {/* The school keeps the Report Book as two files. */}
            <DropdownMenuLabel>Report Book</DropdownMenuLabel>
            <MenuLinks
              items={(['primary', 'secondary'] as const).flatMap((d) => {
                const name = d === 'primary' ? 'Primary' : 'Secondary';
                const url = `${base}&template=report-book&division=${d}`;
                return [
                  [`${name} (.xlsx)`, url],
                  [`${name} (.csv)`, `${url}&format=csv`],
                ] as [string, string][];
              })}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The two school templates, each as Excel or CSV, for one export link. */
export function ExportTemplateItems({ href }: { href: string }) {
  return (
    <MenuLinks
      items={[
        ['Consolidated Form (.xlsx)', href],
        ['Consolidated Form (.csv)', `${href}&format=csv`],
        ['Report Book (.xlsx)', `${href}&template=report-book`],
        ['Report Book (.csv)', `${href}&template=report-book&format=csv`],
      ]}
    />
  );
}

function MenuLinks({ items }: { items: [string, string][] }) {
  return items.map(([label, url]) => (
    <DropdownMenuItem key={label} asChild>
      <a href={url} download>
        {label}
      </a>
    </DropdownMenuItem>
  ));
}
