'use client';

import { ChevronDown, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// One export control, two formats — mirroring the "Generate Masterfile" menu on
// the per-level view rather than putting two buttons in the header, which would
// have given the page two competing primary actions (09a §9.2).
export function OverviewExportMenu({ ayCode }: { ayCode: string }) {
  const base = `/api/markbook/masterfile/export?ay=${encodeURIComponent(ayCode)}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Download className="size-4" />
          Export report
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={base} download>
            Excel workbook (.xlsx)
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${base}&format=csv`} download>
            Spreadsheet (.csv)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
