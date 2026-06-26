'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ExportSheetButton({
  sectionId,
  termId,
}: {
  sectionId: string;
  termId: string;
}) {
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <a
        href={`/api/attendance/${sectionId}/export?term_id=${termId}`}
        download
      >
        <Download className="size-3.5" />
        Export sheet
      </a>
    </Button>
  );
}
